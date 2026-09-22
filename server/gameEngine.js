const crypto = require('crypto');
const {
  EDADES, UBICACIONES, DISPOSITIVOS, INTERESES, HORARIOS, TIPOS_CONTENIDO,
  SEGMENT_BASE, EVENTOS,
} = require('./data');

const id = () => crypto.randomUUID();

// Umbral mínimo de coincidencia de segmentación para que una campaña pueda pujar.
const MATCH_THRESHOLD = 0.34;
// Nº máximo de resultados de subasta que conservamos en el histórico enviado al cliente.
const AUCTION_LOG_LIMIT = 60;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pickWeighted(entries) {
  // entries: [{ key, weight }]
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    if (r < e.weight) return e.key;
    r -= e.weight;
  }
  return entries[entries.length - 1].key;
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

class GameEngine {
  constructor(io) {
    this.io = io;
    this.tickHandle = null;
    this.reset();
  }

  // ---------- Ciclo de vida de la partida ----------

  reset() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.state = {
      id: id(),
      status: 'lobby', // lobby | running | paused | ended
      config: {
        initialBudget: 500,
        durationMs: 20 * 60 * 1000,
        tickIntervalMs: 6000,
        scoring: {
          conversions: 1, roas: 1, ctr: 1, cpaInverse: 1, efficiency: 1, objectiveCompliance: 1,
        },
      },
      teams: {},
      campaigns: {},
      marketState: {
        segmentDemand: Object.fromEntries(INTERESES.map((i) => [i, 1])),
        segmentCtrMultiplier: Object.fromEntries(INTERESES.map((i) => [i, 1])),
        segmentCvrMultiplier: Object.fromEntries(INTERESES.map((i) => [i, 1])),
      },
      activeEvents: [],
      auctionLog: [],
      startedAt: null,
      endsAt: null,
      pausedRemainingMs: null,
      opportunityCounter: 0,
    };
    return this.state;
  }

  createGame(config = {}) {
    // Guard crítico: sin esto, una pestaña de profesor duplicada o
    // desincronizada (p. ej. tras una reconexión, o un segundo dispositivo
    // del profesor) puede reenviar "crear partida" mientras hay una partida
    // en curso y borrar de golpe todos los equipos y campañas de todo el
    // mundo, sin aviso ni forma de deshacerlo. Reproducido y confirmado
    // durante la auditoría: ver informe, sección de causas raíz.
    if (this.state.status === 'running' || this.state.status === 'paused') {
      throw new Error('No se puede reconfigurar una partida en curso (se perderían equipos y campañas). Usa "Reiniciar partida" si quieres empezar de cero, o espera a que termine.');
    }
    this.reset();
    this.state.config = this._sanitizeConfig(config);
    this._broadcastState('game:created');
    return this.state;
  }

  // Evita configuraciones degeneradas (presupuesto 0, duración negativa,
  // subastas cada 0ms...) que producirían divisiones por cero o partidas
  // inservibles más adelante en el motor.
  _sanitizeConfig(config = {}) {
    const defaults = {
      initialBudget: 500,
      durationMs: 20 * 60 * 1000,
      tickIntervalMs: 6000,
      scoring: {
        conversions: 1, roas: 1, ctr: 1, cpaInverse: 1, efficiency: 1, objectiveCompliance: 1,
      },
    };
    const initialBudget = clamp(Number(config.initialBudget) || defaults.initialBudget, 10, 100000);
    const durationMs = clamp(Number(config.durationMs) || defaults.durationMs, 60 * 1000, 4 * 60 * 60 * 1000);
    const tickIntervalMs = clamp(Number(config.tickIntervalMs) || defaults.tickIntervalMs, 2000, 60000);
    const scoring = (config.scoring && typeof config.scoring === 'object')
      ? { ...defaults.scoring, ...config.scoring }
      : defaults.scoring;
    return {
      initialBudget, durationMs, tickIntervalMs, scoring,
    };
  }

  addTeam(name) {
    const team = {
      id: id(),
      name: name && name.trim() ? name.trim() : `Equipo ${Object.keys(this.state.teams).length + 1}`,
      budgetInitial: this.state.config.initialBudget,
      budgetSpent: 0,
      revenueSimulated: 0,
      createdAt: Date.now(),
    };
    this.state.teams[team.id] = team;
    this._broadcastState('team:added');
    return team;
  }

  removeTeam(teamId) {
    delete this.state.teams[teamId];
    Object.keys(this.state.campaigns).forEach((cid) => {
      if (this.state.campaigns[cid].teamId === teamId) delete this.state.campaigns[cid];
    });
    this._broadcastState('team:removed');
  }

  startGame() {
    if (this.state.status === 'running') return this.state;
    if (Object.keys(this.state.teams).length === 0) {
      throw new Error('No se puede iniciar la partida sin equipos.');
    }
    const now = Date.now();
    if (this.state.status === 'paused' && this.state.pausedRemainingMs != null) {
      this.state.endsAt = now + this.state.pausedRemainingMs;
    } else {
      this.state.startedAt = now;
      this.state.endsAt = now + this.state.config.durationMs;
    }
    this.state.pausedRemainingMs = null;
    this.state.status = 'running';
    this._scheduleTicks();
    this._broadcastState('game:started');
    return this.state;
  }

  pauseGame() {
    if (this.state.status !== 'running') return this.state;
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.state.pausedRemainingMs = Math.max(0, this.state.endsAt - Date.now());
    this.state.status = 'paused';
    this._broadcastState('game:paused');
    return this.state;
  }

  resetGame() {
    const preservedTeams = this.state.teams;
    const preservedConfig = this.state.config;
    this.reset();
    this.state.teams = Object.fromEntries(
      Object.values(preservedTeams).map((t) => [t.id, {
        ...t, budgetSpent: 0, revenueSimulated: 0, budgetInitial: preservedConfig.initialBudget,
      }]),
    );
    this.state.config = preservedConfig;
    this._broadcastState('game:reset');
    return this.state;
  }

  _scheduleTicks() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = setInterval(() => this._tick(), this.state.config.tickIntervalMs);
  }

  // ---------- Campañas ----------

  createCampaign(teamId, payload) {
    const team = this.state.teams[teamId];
    if (!team) throw new Error('Equipo no encontrado.');
    const remaining = team.budgetInitial - team.budgetSpent;
    const budget = clamp(Number(payload.budget) || 0, 1, Math.max(1, remaining));
    if (budget > remaining) throw new Error('Presupuesto de campaña superior al disponible del equipo.');

    const campaign = {
      id: id(),
      teamId,
      name: payload.name || 'Nueva campaña',
      objetivo: payload.objetivo,
      targeting: {
        edades: payload.targeting?.edades || [],
        ubicaciones: payload.targeting?.ubicaciones || [],
        dispositivos: payload.targeting?.dispositivos || [],
        intereses: payload.targeting?.intereses || [],
        horarios: payload.targeting?.horarios || [],
        tiposContenido: payload.targeting?.tiposContenido || [],
      },
      formato: payload.formato || 'banner',
      budget,
      maxBid: clamp(Number(payload.maxBid) || 1, 0.05, 50),
      strategy: payload.strategy || 'cpm_fijo',
      targetCPA: Number(payload.targetCPA) || 20,
      targetROAS: Number(payload.targetROAS) || 3,
      creativeQuality: clamp(Number(payload.creativeQuality) || 6, 1, 10),
      status: 'active', // active | paused | budget_exhausted
      createdAt: Date.now(),
      metrics: {
        impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0, auctionsWon: 0, auctionsParticipated: 0,
      },
    };
    this.state.campaigns[campaign.id] = campaign;
    this._broadcastState('campaign:created');
    return campaign;
  }

  updateCampaign(campaignId, payload) {
    const campaign = this.state.campaigns[campaignId];
    if (!campaign) throw new Error('Campaña no encontrada.');
    const team = this.state.teams[campaign.teamId];
    const fields = ['name', 'objetivo', 'formato', 'strategy', 'maxBid', 'targetCPA', 'targetROAS', 'creativeQuality', 'status'];
    fields.forEach((f) => {
      if (payload[f] !== undefined) campaign[f] = payload[f];
    });
    if (payload.targeting) {
      campaign.targeting = { ...campaign.targeting, ...payload.targeting };
    }
    if (payload.budget !== undefined) {
      const remaining = team.budgetInitial - team.budgetSpent + campaign.budget; // re-add its own current allocation
      const newBudget = clamp(Number(payload.budget), campaign.metrics.spend, remaining);
      campaign.budget = newBudget;
    }
    campaign.maxBid = clamp(Number(campaign.maxBid), 0.05, 50);
    campaign.creativeQuality = clamp(Number(campaign.creativeQuality), 1, 10);
    if (campaign.status !== 'budget_exhausted' && campaign.metrics.spend < campaign.budget) {
      // si el usuario reactiva manualmente, permitirlo
    }
    this._broadcastState('campaign:updated');
    return campaign;
  }

  // ---------- Eventos de mercado ----------

  triggerEvent(eventId, targetSegment, durationMsOverride) {
    const def = EVENTOS.find((e) => e.id === eventId);
    if (!def) throw new Error('Evento no reconocido.');
    const duration = durationMsOverride || def.defaultDurationMs;
    const event = {
      id: id(),
      eventId: def.id,
      label: def.label,
      description: def.description,
      target: targetSegment || 'global',
      effect: def.effect,
      multiplier: def.multiplier,
      startedAt: Date.now(),
      expiresAt: Date.now() + duration,
    };
    this.state.activeEvents.push(event);
    this._applyEventMultipliers();
    this.io.emit('market:event', event);
    this._broadcastState('market:event');
    return event;
  }

  _applyEventMultipliers() {
    const { segmentDemand, segmentCtrMultiplier, segmentCvrMultiplier } = this.state.marketState;
    INTERESES.forEach((i) => {
      segmentDemand[i] = 1;
      segmentCtrMultiplier[i] = 1;
      segmentCvrMultiplier[i] = 1;
    });
    const now = Date.now();
    this.state.activeEvents = this.state.activeEvents.filter((ev) => ev.expiresAt > now);
    this.state.activeEvents.forEach((ev) => {
      const targets = ev.target === 'global' ? INTERESES : [ev.target];
      targets.forEach((seg) => {
        if (!segmentDemand[seg]) return;
        if (ev.effect === 'demand' || ev.effect === 'demand_ctr') segmentDemand[seg] *= ev.multiplier;
        if (ev.effect === 'ctr' || ev.effect === 'demand_ctr') segmentCtrMultiplier[seg] *= ev.multiplier;
        if (ev.effect === 'cvr') segmentCvrMultiplier[seg] *= ev.multiplier;
      });
    });
  }

  // ---------- Motor de subastas (tick) ----------

  _generateOpportunity() {
    const { segmentDemand } = this.state.marketState;
    const interes = pickWeighted(INTERESES.map((i) => ({ key: i, weight: segmentDemand[i] })));
    this.state.opportunityCounter += 1;
    return {
      id: this.state.opportunityCounter,
      timestamp: Date.now(),
      edad: randomFrom(EDADES),
      ubicacion: randomFrom(UBICACIONES),
      dispositivo: randomFrom(DISPOSITIVOS),
      interes,
      horario: randomFrom(HORARIOS),
      tipoContenido: randomFrom(TIPOS_CONTENIDO),
    };
  }

  _matchScore(targeting, opp) {
    // Importante: solo puntuamos las dimensiones que la campaña ha especificado.
    // Una dimensión sin marcar significa "no me importa" y NO debe contar como
    // coincidencia automática, o una campaña muy segmentada (ej. solo "viajes")
    // acabaría siendo elegible casi siempre igual que una campaña de alcance total,
    // anulando el propósito de segmentar.
    const dims = [
      [targeting.edades, opp.edad],
      [targeting.ubicaciones, opp.ubicacion],
      [targeting.dispositivos, opp.dispositivo],
      [targeting.intereses, opp.interes],
      [targeting.horarios, opp.horario],
      [targeting.tiposContenido, opp.tipoContenido],
    ];
    const specified = dims.filter(([selected]) => selected && selected.length > 0);
    if (specified.length === 0) return 1; // campaña de alcance total: sin filtros, coincide con cualquiera
    const matched = specified.filter(([selected, value]) => selected.includes(value)).length;
    return matched / specified.length;
  }

  _autoBid(campaign, matchScore, predictedCVR, segmentBase) {
    const mb = campaign.maxBid;
    switch (campaign.strategy) {
      case 'maximizar_conversiones': {
        const factor = clamp(0.4 + predictedCVR * 8, 0.4, 1);
        return mb * factor;
      }
      case 'maximizar_alcance':
        return mb * 0.55;
      case 'cpa_objetivo': {
        const bid = campaign.targetCPA * predictedCVR;
        return clamp(bid, 0.05, mb);
      }
      case 'roas_objetivo': {
        const expectedRevenue = predictedCVR * segmentBase.revenuePerConversion;
        const bid = expectedRevenue / campaign.targetROAS;
        return clamp(bid, 0.05, mb);
      }
      case 'cpm_fijo':
      default:
        return mb;
    }
  }

  _eligibleCampaigns() {
    return Object.values(this.state.campaigns).filter((c) => {
      if (c.status !== 'active') return false;
      const team = this.state.teams[c.teamId];
      if (!team) return false;
      if (c.metrics.spend >= c.budget) return false;
      if (team.budgetSpent >= team.budgetInitial) return false;
      return true;
    });
  }

  _tick() {
    if (this.state.status !== 'running') return;
    if (Date.now() >= this.state.endsAt) {
      this._endGame();
      return;
    }
    this._applyEventMultipliers(); // limpia eventos caducados

    const opp = this._generateOpportunity();
    const segmentBase = SEGMENT_BASE[opp.interes];
    const { segmentDemand, segmentCtrMultiplier, segmentCvrMultiplier } = this.state.marketState;
    const reservePrice = +(segmentBase.baseCPM * segmentDemand[opp.interes] * 0.6).toFixed(2);

    const candidates = this._eligibleCampaigns();
    const bids = [];
    candidates.forEach((campaign) => {
      const matchScore = this._matchScore(campaign.targeting, opp);
      if (matchScore < MATCH_THRESHOLD) return;
      const qualityScore = clamp(0.5 * matchScore + 0.5 * (campaign.creativeQuality / 10), 0.1, 1.2);
      const predictedCTR = clamp(segmentBase.baseCTR * segmentCtrMultiplier[opp.interes] * (0.6 + 0.4 * matchScore), 0.001, 0.6);
      const predictedCVR = clamp(segmentBase.baseCVR * segmentCvrMultiplier[opp.interes] * (0.6 + 0.4 * matchScore), 0.001, 0.6);
      const rawBid = this._autoBid(campaign, matchScore, predictedCVR, segmentBase);
      const bid = clamp(+rawBid.toFixed(2), 0.05, campaign.maxBid);
      const adRank = bid * qualityScore;
      campaign.metrics.auctionsParticipated += 1;
      bids.push({
        campaignId: campaign.id, teamId: campaign.teamId, campaignName: campaign.name,
        bid, qualityScore, adRank, predictedCTR, predictedCVR,
      });
    });

    bids.sort((a, b) => b.adRank - a.adRank);

    const result = {
      opportunityId: opp.id,
      timestamp: opp.timestamp,
      opportunity: opp,
      bids: bids.map((b) => ({
        teamId: b.teamId, teamName: this.state.teams[b.teamId]?.name, campaignName: b.campaignName, bid: b.bid,
      })),
      winnerTeamId: null,
      winnerTeamName: null,
      winnerCampaignId: null,
      clearingPrice: null,
      impressionGranted: false,
      clicked: false,
      converted: false,
      revenue: 0,
    };

    if (bids.length > 0) {
      const winner = bids[0];
      const clearingPrice = GameEngine.resolveClearingPrice(bids, reservePrice);

      const campaign = this.state.campaigns[winner.campaignId];
      const team = this.state.teams[winner.teamId];
      campaign.metrics.impressions += 1;
      campaign.metrics.spend = +(campaign.metrics.spend + clearingPrice).toFixed(2);
      campaign.metrics.auctionsWon += 1;
      team.budgetSpent = +(team.budgetSpent + clearingPrice).toFixed(2);

      const { clicked, converted, revenue } = GameEngine.simulateOutcome(
        winner.predictedCTR,
        winner.predictedCVR,
        segmentBase.revenuePerConversion,
      );
      if (clicked) campaign.metrics.clicks += 1;
      if (converted) {
        campaign.metrics.conversions += 1;
        campaign.metrics.revenue = +(campaign.metrics.revenue + revenue).toFixed(2);
        team.revenueSimulated = +(team.revenueSimulated + revenue).toFixed(2);
      }

      if (campaign.metrics.spend >= campaign.budget) campaign.status = 'budget_exhausted';
      if (team.budgetSpent >= team.budgetInitial) {
        Object.values(this.state.campaigns)
          .filter((c) => c.teamId === team.id && c.status === 'active')
          .forEach((c) => { c.status = 'budget_exhausted'; });
      }

      Object.assign(result, {
        winnerTeamId: winner.teamId,
        winnerTeamName: this.state.teams[winner.teamId]?.name,
        winnerCampaignId: winner.campaignId,
        winnerCampaignName: winner.campaignName,
        clearingPrice,
        impressionGranted: true,
        clicked,
        converted,
        revenue,
      });
    }

    this.state.auctionLog.unshift(result);
    if (this.state.auctionLog.length > AUCTION_LOG_LIMIT) this.state.auctionLog.length = AUCTION_LOG_LIMIT;

    this.io.emit('auction:result', result);
    this._broadcastState('tick');
  }

  _endGame() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    this.state.status = 'ended';
    this._broadcastState('game:ended');
  }

  // ---------- Lógica económica pura (estáticas, sin efectos secundarios) ----------
  // Se extraen como funciones puras -en vez de dejarlas inline dentro de
  // _tick()- precisamente para poder probarlas de forma determinista: reciben
  // un `rng` inyectable (por defecto Math.random) en lugar de generar
  // aleatoriedad ellas mismas, así los tests pueden fijar la secuencia y
  // comprobar un resultado exacto en lugar de solo "no lanza error".

  // Subasta de segundo precio: el ganador paga lo mínimo necesario para
  // superar al segundo mejor ad_rank, nunca más de su propia puja, nunca
  // menos que el precio de reserva del segmento.
  static resolveClearingPrice(bidsSortedDesc, reservePrice) {
    const winner = bidsSortedDesc[0];
    if (bidsSortedDesc.length > 1) {
      const second = bidsSortedDesc[1];
      return clamp(+((second.adRank / winner.qualityScore) + 0.01).toFixed(2), reservePrice, winner.bid);
    }
    return clamp(reservePrice, 0.05, winner.bid);
  }

  // Cadena económica de una impresión ganada:
  //   ¿clic? -> sorteo con probabilidad predictedCTR
  //   ¿conversión? (solo si hubo clic) -> sorteo con probabilidad predictedCVR
  //   ingreso de la conversión -> revenuePerConversion x factor aleatorio [0.8, 1.2]
  // Es un modelo probabilístico por impresión (no "impresiones x CTR" de
  // forma determinista): así una misma campaña puede tener sesiones con
  // mejor o peor suerte, igual que en datos reales de campañas — pero en
  // agregado, sobre muchas impresiones, converge a las tasas configuradas.
  static simulateOutcome(predictedCTR, predictedCVR, revenuePerConversion, rng = Math.random) {
    let clicked = false;
    let converted = false;
    let revenue = 0;
    if (rng() < predictedCTR) {
      clicked = true;
      if (rng() < predictedCVR) {
        converted = true;
        revenue = +(revenuePerConversion * (0.8 + rng() * 0.4)).toFixed(2);
      }
    }
    return { clicked, converted, revenue };
  }

  // ---------- Ranking ----------

  computeRanking() {
    const teams = Object.values(this.state.teams);
    const perTeam = teams.map((team) => {
      const campaigns = Object.values(this.state.campaigns).filter((c) => c.teamId === team.id);
      const agg = campaigns.reduce((acc, c) => {
        acc.impressions += c.metrics.impressions;
        acc.clicks += c.metrics.clicks;
        acc.conversions += c.metrics.conversions;
        acc.spend += c.metrics.spend;
        acc.revenue += c.metrics.revenue;
        return acc;
      }, { impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0 });

      const ctr = agg.impressions > 0 ? agg.clicks / agg.impressions : 0;
      const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : null;
      const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
      const cpa = agg.conversions > 0 ? agg.spend / agg.conversions : null;
      const roas = agg.spend > 0 ? agg.revenue / agg.spend : 0;
      const efficiency = team.budgetInitial > 0 ? (agg.revenue - agg.spend) / team.budgetInitial : 0;
      const objectiveCompliance = campaigns.length > 0
        ? campaigns.reduce((s, c) => s + this._objectiveCompliance(c), 0) / campaigns.length
        : 0;

      return {
        teamId: team.id,
        teamName: team.name,
        budgetInitial: team.budgetInitial,
        budgetSpent: team.budgetSpent,
        budgetRemaining: +(team.budgetInitial - team.budgetSpent).toFixed(2),
        impressions: agg.impressions,
        clicks: agg.clicks,
        conversions: agg.conversions,
        spend: +agg.spend.toFixed(2),
        revenue: +agg.revenue.toFixed(2),
        ctr, cpc, cpm, cpa, roas, efficiency, objectiveCompliance,
      };
    });

    const norm = (key, invert = false) => {
      const values = perTeam.map((t) => (t[key] == null ? 0 : t[key]));
      const min = Math.min(...values);
      const max = Math.max(...values);
      return perTeam.map((t) => {
        const v = t[key] == null ? 0 : t[key];
        if (max === min) return 50;
        const n = ((v - min) / (max - min)) * 100;
        return invert ? 100 - n : n;
      });
    };

    const weights = this.state.config.scoring;
    const normalized = {
      conversions: norm('conversions'),
      roas: norm('roas'),
      ctr: norm('ctr'),
      cpaInverse: perTeam.map((t, idx) => (t.cpa == null ? 0 : norm('cpa', true)[idx])),
      efficiency: norm('efficiency'),
      objectiveCompliance: norm('objectiveCompliance'),
    };

    const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0) || 1;
    const ranking = perTeam.map((t, idx) => {
      const score = Object.keys(weights).reduce((s, key) => s + weights[key] * (normalized[key]?.[idx] || 0), 0) / totalWeight;
      return { ...t, score: +score.toFixed(1) };
    });

    ranking.sort((a, b) => b.score - a.score);
    return ranking;
  }

  _objectiveCompliance(campaign) {
    const m = campaign.metrics;
    const roas = m.spend > 0 ? m.revenue / m.spend : 0;
    const cpc = m.clicks > 0 ? m.spend / m.clicks : null;
    const cpa = m.conversions > 0 ? m.spend / m.conversions : null;
    switch (campaign.objetivo) {
      case 'impresiones': return clamp(m.impressions / 400, 0, 1);
      case 'notoriedad': return clamp(m.impressions / 400, 0, 1);
      case 'clics': return clamp(m.clicks / 40, 0, 1);
      case 'conversiones': return clamp(m.conversions / 8, 0, 1);
      case 'roas': return clamp(roas / 4, 0, 1);
      case 'cpc_bajo': return cpc == null ? 0 : clamp(0.4 / cpc, 0, 1);
      case 'cpa_bajo': return cpa == null ? 0 : clamp(12 / cpa, 0, 1);
      default: return 0;
    }
  }

  // ---------- Serialización / broadcast ----------

  getPublicState() {
    return {
      ...this.state,
      ranking: this.state.status === 'lobby' ? [] : this.computeRanking(),
      now: Date.now(),
    };
  }

  _broadcastState(reason) {
    this.io.emit('state:update', { reason, state: this.getPublicState() });
  }
}

module.exports = { GameEngine };
