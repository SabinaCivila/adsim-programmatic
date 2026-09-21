const socket = io();
let catalog = null;
let state = null;
let scoringWeights = { conversions: 1, roas: 1, ctr: 1, cpaInverse: 1, efficiency: 1, objectiveCompliance: 1 };

fetchCatalog().then((c) => { catalog = c; render(); });

socket.on('state:update', ({ state: s }) => { state = s; render(); });
socket.on('action:error', ({ message }) => toast(message, 'error'));
socket.on('market:event', (ev) => toast(`Evento activado: ${ev.label} → ${ev.target}`, 'success'));

setInterval(() => { if (state) updateTimer(); }, 1000);

function updateTimer() {
  const timerEl = document.getElementById('timer');
  if (state.status === 'running' && state.endsAt) {
    timerEl.textContent = formatMs(state.endsAt - Date.now());
  } else if (state.status === 'paused' && state.pausedRemainingMs != null) {
    timerEl.textContent = formatMs(state.pausedRemainingMs);
  } else {
    timerEl.textContent = '--:--';
  }
}

function render() {
  if (!state || !catalog) return;
  document.getElementById('status-pill').textContent = statusLabel(state.status);
  document.getElementById('status-pill').className = `status-pill status-${state.status}`;
  updateTimer();

  renderLobby();
  renderControls();
  renderEvents();
  renderRanking();
  renderAuctionFeed();
  renderCampaigns();
  renderTeams();
}

// ---------- Lobby: configuración inicial ----------
function renderLobby() {
  const container = document.getElementById('lobby-section');
  if (state.status !== 'lobby') { container.innerHTML = ''; return; }

  container.innerHTML = '';
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', {}, 'Configurar nueva partida'));
  card.appendChild(el('div', { class: 'field-row' }, [
    wrapField('Presupuesto inicial por equipo (€)', el('input', { id: 'cfg-budget', type: 'number', value: state.config.initialBudget })),
    wrapField('Duración de la partida (minutos)', el('input', { id: 'cfg-duration', type: 'number', value: state.config.durationMs / 60000 })),
  ]));
  card.appendChild(el('div', { class: 'field-row' }, [
    wrapField('Cada cuánto se resuelve una subasta (segundos)', el('input', { id: 'cfg-tick', type: 'number', value: state.config.tickIntervalMs / 1000 })),
    el('div'),
  ]));

  card.appendChild(el('h3', { style: 'margin-top:18px;' }, 'Criterio de evaluación del ranking'));
  card.appendChild(el('p', { style: 'color:var(--text-dim); font-size:13px; margin:0 0 8px;' }, 'Ajusta el peso de cada indicador (0 = no cuenta). Por defecto, todos pesan igual.'));
  const scoringGrid = el('div', { class: 'grid grid-cols-3', id: 'scoring-grid' });
  catalog.CRITERIOS_RANKING.forEach((c) => {
    scoringGrid.appendChild(wrapField(c.label, el('input', {
      type: 'number', min: '0', max: '5', step: '0.5', value: scoringWeights[c.id],
      onchange: (e) => { scoringWeights[c.id] = Number(e.target.value); },
    })));
  });
  card.appendChild(scoringGrid);

  card.appendChild(el('div', { style: 'margin-top:18px; display:flex; gap:10px;' }, [
    el('button', {
      class: 'btn',
      onclick: () => {
        const initialBudget = Number(document.getElementById('cfg-budget').value) || 500;
        const durationMs = (Number(document.getElementById('cfg-duration').value) || 20) * 60000;
        const tickIntervalMs = (Number(document.getElementById('cfg-tick').value) || 6) * 1000;
        socket.emit('profesor:createGame', { initialBudget, durationMs, tickIntervalMs, scoring: scoringWeights });
        toast('Partida creada. Añade equipos y pulsa Iniciar.', 'success');
      },
    }, 'Crear / reconfigurar partida'),
  ]));

  container.appendChild(card);

  container.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Equipos')));
  const teamCard = el('div', { class: 'card' });
  const addRow = el('div', { style: 'display:flex; gap:8px; margin-bottom:14px;' }, [
    el('input', { id: 'new-team-name', placeholder: 'Nombre del equipo (ej. Equipo Alfa)' }),
    el('button', {
      class: 'btn secondary',
      onclick: () => {
        const nameInput = document.getElementById('new-team-name');
        socket.emit('profesor:addTeam', { name: nameInput.value });
        nameInput.value = '';
      },
    }, 'Añadir equipo'),
  ]);
  teamCard.appendChild(addRow);
  const teams = Object.values(state.teams);
  if (teams.length === 0) {
    teamCard.appendChild(el('div', { class: 'empty-state' }, 'Todavía no hay equipos. Añade al menos uno para poder iniciar.'));
  } else {
    teams.forEach((t) => {
      teamCard.appendChild(el('div', { style: 'display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);' }, [
        el('span', {}, `${t.name} — presupuesto ${euros(t.budgetInitial)}`),
        el('button', { class: 'btn danger small', onclick: () => socket.emit('profesor:removeTeam', { teamId: t.id }) }, 'Quitar'),
      ]));
    });
  }
  container.appendChild(teamCard);

  container.appendChild(el('div', { style: 'margin-top:18px;' }, [
    el('button', {
      class: 'btn',
      onclick: () => socket.emit('profesor:startGame'),
    }, '▶ Iniciar partida'),
  ]));
}

function wrapField(labelText, inputNode) {
  const wrap = el('div');
  wrap.appendChild(el('label', {}, labelText));
  wrap.appendChild(inputNode);
  return wrap;
}

// ---------- Controles durante la partida ----------
function renderControls() {
  const container = document.getElementById('controls-section');
  container.innerHTML = '';
  if (state.status === 'lobby') return;

  const card = el('div', { class: 'card', style: 'display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;' });
  const left = el('div', { style: 'display:flex; gap:10px; flex-wrap:wrap;' });
  if (state.status === 'running') {
    left.appendChild(el('button', { class: 'btn warn', onclick: () => socket.emit('profesor:pauseGame') }, '⏸ Pausar'));
  } else if (state.status === 'paused') {
    left.appendChild(el('button', { class: 'btn', onclick: () => socket.emit('profesor:startGame') }, '▶ Reanudar'));
  }
  left.appendChild(el('button', {
    class: 'btn danger',
    onclick: () => { if (confirm('¿Reiniciar la partida? Se perderán campañas y métricas.')) socket.emit('profesor:resetGame'); },
  }, '↺ Reiniciar partida'));
  card.appendChild(left);
  card.appendChild(el('div', { style: 'color:var(--text-dim); font-size:13px;' }, `${Object.keys(state.teams).length} equipos · ${Object.keys(state.campaigns).length} campañas · ${state.opportunityCounter} subastas resueltas`));
  container.appendChild(card);
}

// ---------- Eventos de mercado ----------
function renderEvents() {
  const container = document.getElementById('events-section');
  container.innerHTML = '';
  if (state.status === 'lobby' || state.status === 'ended') return;

  container.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Eventos de mercado')));
  const card = el('div', { class: 'card' });

  if (state.activeEvents.length > 0) {
    state.activeEvents.forEach((ev) => {
      const remaining = Math.max(0, ev.expiresAt - Date.now());
      card.appendChild(el('div', { class: 'event-banner' }, `⚡ ${ev.label} — ${ev.description} (segmento: ${ev.target}, quedan ${formatMs(remaining)})`));
    });
  }

  const row = el('div', { class: 'field-row', style: 'align-items:end;' });
  const eventSelect = el('select', { id: 'event-select' }, catalog.EVENTOS.map((e) => el('option', { value: e.id }, e.label)));
  const targetSelect = el('select', { id: 'event-target' }, [
    el('option', { value: 'global' }, 'Todos los segmentos'),
    ...catalog.INTERESES.map((i) => el('option', { value: i }, i)),
  ]);
  row.appendChild(wrapField('Tipo de evento', eventSelect));
  row.appendChild(wrapField('Segmento objetivo', targetSelect));
  card.appendChild(row);
  card.appendChild(el('button', {
    class: 'btn warn', style: 'margin-top:12px;',
    onclick: () => socket.emit('profesor:triggerEvent', { eventId: eventSelect.value, target: targetSelect.value }),
  }, '⚡ Activar evento'));

  container.appendChild(card);
}

// ---------- Ranking ----------
function renderRanking() {
  const container = document.getElementById('ranking-panel');
  container.innerHTML = '';
  if (!state.ranking || state.ranking.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' }, 'El ranking aparecerá cuando la partida empiece.'));
    return;
  }
  state.ranking.forEach((t, idx) => {
    const pos = idx + 1;
    container.appendChild(el('div', { class: 'rank-row' }, [
      el('div', { class: `rank-pos ${pos <= 3 ? 'top' + pos : ''}` }, String(pos)),
      el('div', {}, [
        el('div', { style: 'font-weight:600;' }, t.teamName),
        el('div', { style: 'color:var(--text-dim); font-size:12px;' }, `ROAS ${num(t.roas)} · CTR ${pct(t.ctr)} · ${t.conversions} conv.`),
      ]),
      el('div', { style: 'font-weight:700; font-size:17px;' }, num(t.score)),
    ]));
  });
}

// ---------- Feed de subastas ----------
function renderAuctionFeed() {
  const container = document.getElementById('auction-feed');
  container.innerHTML = '';
  if (!state.auctionLog || state.auctionLog.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' }, 'Todavía no se ha resuelto ninguna subasta.'));
    return;
  }
  state.auctionLog.slice(0, 25).forEach((r) => {
    const line = r.impressionGranted
      ? `#${r.opportunityId} · ${r.winnerTeamName} ganó a ${euros(r.clearingPrice)} ${r.converted ? '· ✅ conversión' : r.clicked ? '· clic' : ''}`
      : `#${r.opportunityId} · sin pujadores elegibles`;
    container.appendChild(el('div', { style: 'padding:7px 0; border-bottom:1px solid var(--border); font-size:13px;' }, [
      el('span', { style: 'color:var(--text-dim);' }, `${r.opportunity.interes} · ${r.opportunity.ubicacion} · ${r.opportunity.dispositivo} — `),
      line,
    ]));
  });
}

// ---------- Campañas de todos los equipos ----------
function renderCampaigns() {
  const container = document.getElementById('campaigns-panel');
  container.innerHTML = '';
  const campaigns = Object.values(state.campaigns);
  if (campaigns.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' }, 'Los equipos aún no han creado campañas.'));
    return;
  }
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    'Equipo', 'Campaña', 'Objetivo', 'Estrategia', 'Estado', 'Gasto / Presup.', 'Impr.', 'Clics', 'Conv.', 'CTR', 'ROAS',
  ].map((h) => el('th', {}, h)))));
  const tbody = el('tbody');
  campaigns.forEach((c) => {
    const team = state.teams[c.teamId];
    const ctr = c.metrics.impressions > 0 ? c.metrics.clicks / c.metrics.impressions : 0;
    const roas = c.metrics.spend > 0 ? c.metrics.revenue / c.metrics.spend : 0;
    tbody.appendChild(el('tr', {}, [
      el('td', {}, team ? team.name : '—'),
      el('td', {}, c.name),
      el('td', {}, catalog.OBJETIVOS.find((o) => o.id === c.objetivo)?.label || c.objetivo),
      el('td', {}, catalog.ESTRATEGIAS.find((s) => s.id === c.strategy)?.label.split(' (')[0] || c.strategy),
      el('td', {}, el('span', { class: `badge ${c.status}` }, c.status)),
      el('td', {}, `${euros(c.metrics.spend)} / ${euros(c.budget)}`),
      el('td', {}, num(c.metrics.impressions)),
      el('td', {}, num(c.metrics.clicks)),
      el('td', {}, num(c.metrics.conversions)),
      el('td', {}, pct(ctr)),
      el('td', {}, num(roas)),
    ]));
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// ---------- Equipos (resumen presupuesto) ----------
function renderTeams() {
  const container = document.getElementById('teams-panel');
  container.innerHTML = '';
  const teams = Object.values(state.teams);
  if (teams.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' }, 'No hay equipos todavía.'));
    return;
  }
  const grid = el('div', { class: 'grid grid-cols-4' });
  teams.forEach((t) => {
    const spentPct = t.budgetInitial > 0 ? Math.min(100, (t.budgetSpent / t.budgetInitial) * 100) : 0;
    const card = el('div', { class: 'card tight metric-card' });
    card.appendChild(el('div', { class: 'label' }, t.name));
    card.appendChild(el('div', { class: 'value', style: 'font-size:19px;' }, `${euros(t.budgetInitial - t.budgetSpent)} restante`));
    card.appendChild(el('div', { class: 'progress-bar' }, el('div', { style: `width:${spentPct}%;` })));
    card.appendChild(el('div', { class: 'sub' }, `Gastado ${euros(t.budgetSpent)} de ${euros(t.budgetInitial)}`));
    grid.appendChild(card);
  });
  container.appendChild(grid);
}
