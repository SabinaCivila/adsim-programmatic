// Pruebas de la lógica del motor de simulación (server/gameEngine.js).
//
// Usan node:test (incluido en Node 18+, sin dependencias nuevas que instalar,
// en línea con el resto del proyecto). Se centran en detectar REGRESIONES
// reales: cada test fija unas entradas y comprueba un resultado calculado a
// mano de forma independiente, no "la función devuelve lo mismo que le
// metimos" (eso no detectaría nada si el cálculo interno estuviera mal).
//
// Ejecutar con: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine } = require('../server/gameEngine');

function fakeIo() {
  return { emit() {} };
}

function newEngine() {
  return new GameEngine(fakeIo());
}

// Recorre un objeto/array y falla si encuentra NaN, Infinity o `undefined`
// en cualquier campo numérico o de tipo "debería tener valor". El usuario
// pidió explícitamente comprobar que esto no ocurra en los resultados.
function assertNoBadNumbers(value, path = 'state') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} es ${value} (no finito)`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoBadNumbers(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([k, v]) => assertNoBadNumbers(v, `${path}.${k}`));
  }
}

// ---------------------------------------------------------------------------
// 1. Ciclo de vida de la partida / equipos: el guard anti-borrado accidental
// ---------------------------------------------------------------------------

test('createGame no puede destruir una partida en curso (regresión del bug de equipos que desaparecían)', () => {
  const engine = newEngine();
  engine.createGame({ initialBudget: 500, durationMs: 600000, tickIntervalMs: 6000 });
  engine.addTeam('Equipo Alfa');
  engine.addTeam('Equipo Beta');
  engine.startGame();
  assert.equal(Object.keys(engine.state.teams).length, 2);

  assert.throws(() => engine.createGame({ initialBudget: 999 }), /partida en curso/i);

  // Los equipos deben seguir existiendo tal cual tras el intento rechazado.
  assert.equal(Object.keys(engine.state.teams).length, 2);
  assert.equal(engine.state.status, 'running');

  if (engine.tickHandle) clearInterval(engine.tickHandle);
});

test('createGame sí funciona en lobby y vuelve a estar disponible cuando la partida termina', () => {
  const engine = newEngine();
  engine.createGame({});
  engine.addTeam('Equipo Alfa');
  assert.doesNotThrow(() => engine.createGame({ initialBudget: 300 }));
  assert.equal(Object.keys(engine.state.teams).length, 0); // recreación real: sí se espera que vacíe

  engine.addTeam('Equipo Beta');
  engine.startGame();
  engine._endGame();
  assert.doesNotThrow(() => engine.createGame({ initialBudget: 200 }));
});

test('_sanitizeConfig aplica límites razonables a configuraciones degeneradas', () => {
  const engine = newEngine();
  engine.createGame({ initialBudget: 0, durationMs: -5000, tickIntervalMs: 1 });
  assert.ok(engine.state.config.initialBudget >= 10, 'presupuesto mínimo no aplicado');
  assert.ok(engine.state.config.durationMs >= 60000, 'duración mínima no aplicada');
  assert.ok(engine.state.config.tickIntervalMs >= 2000, 'intervalo mínimo no aplicado');
});

// ---------------------------------------------------------------------------
// 2. Segmentación: regresión del bug de elegibilidad encontrado en el MVP
// ---------------------------------------------------------------------------

test('_matchScore: una campaña segmentada NO es elegible en audiencias que no coinciden', () => {
  const engine = newEngine();
  const targeting = {
    edades: [], ubicaciones: [], dispositivos: [], intereses: ['viajes'], horarios: [], tiposContenido: [],
  };
  const oppQueNoCoincide = { edad: '25-34', ubicacion: 'Madrid', dispositivo: 'movil', interes: 'tecnologia', horario: 'tarde', tipoContenido: 'video' };
  const oppQueCoincide = { ...oppQueNoCoincide, interes: 'viajes' };

  assert.equal(engine._matchScore(targeting, oppQueNoCoincide), 0);
  assert.equal(engine._matchScore(targeting, oppQueCoincide), 1);
});

test('_matchScore: una campaña sin ningún filtro coincide con cualquier oportunidad (alcance total)', () => {
  const engine = newEngine();
  const targeting = {
    edades: [], ubicaciones: [], dispositivos: [], intereses: [], horarios: [], tiposContenido: [],
  };
  const opp = { edad: '18-24', ubicacion: 'Bilbao', dispositivo: 'tablet', interes: 'moda', horario: 'noche', tipoContenido: 'blog' };
  assert.equal(engine._matchScore(targeting, opp), 1);
});

test('_matchScore: coincidencia parcial cuando se especifican varias dimensiones', () => {
  const engine = newEngine();
  const targeting = {
    edades: ['18-24'], ubicaciones: [], dispositivos: [], intereses: ['tecnologia'], horarios: [], tiposContenido: [],
  };
  const oppSoloEdadCoincide = { edad: '18-24', ubicacion: 'Madrid', dispositivo: 'movil', interes: 'moda', horario: 'tarde', tipoContenido: 'video' };
  assert.equal(engine._matchScore(targeting, oppSoloEdadCoincide), 0.5); // 1 de 2 dimensiones especificadas
});

// ---------------------------------------------------------------------------
// 3. Subasta: segundo precio
// ---------------------------------------------------------------------------

test('resolveClearingPrice: con dos pujadores, el ganador paga justo por encima del segundo, nunca más de su puja', () => {
  const bids = [
    { bid: 3.0, qualityScore: 1.0, adRank: 3.0 },
    { bid: 2.0, qualityScore: 1.0, adRank: 2.0 },
  ];
  const price = GameEngine.resolveClearingPrice(bids, 0.5);
  assert.equal(price, 2.01); // (2.0/1.0) + 0.01
  assert.ok(price <= bids[0].bid);
});

test('resolveClearingPrice: con un solo pujador, paga el precio de reserva (no su puja completa)', () => {
  const bids = [{ bid: 5.0, qualityScore: 1.0, adRank: 5.0 }];
  const price = GameEngine.resolveClearingPrice(bids, 1.2);
  assert.equal(price, 1.2);
});

test('resolveClearingPrice: nunca cobra por debajo del precio de reserva del segmento', () => {
  const bids = [
    { bid: 3.0, qualityScore: 2.0, adRank: 6.0 },
    { bid: 0.1, qualityScore: 1.0, adRank: 0.1 },
  ];
  const price = GameEngine.resolveClearingPrice(bids, 2.0);
  assert.ok(price >= 2.0, `el precio (${price}) no debería bajar del reserve price (2.0)`);
});

// ---------------------------------------------------------------------------
// 4. Cadena económica: impresión -> clic -> conversión -> ingreso
// ---------------------------------------------------------------------------

test('simulateOutcome: sin clic no hay conversión ni ingreso (regla de negocio explícita del profesor)', () => {
  const rngSiempreAlto = () => 0.999; // nunca por debajo de ninguna probabilidad razonable
  const { clicked, converted, revenue } = GameEngine.simulateOutcome(0.5, 0.5, 100, rngSiempreAlto);
  assert.equal(clicked, false);
  assert.equal(converted, false);
  assert.equal(revenue, 0);
});

test('simulateOutcome: hay clic pero no conversión cuando el segundo sorteo falla', () => {
  const secuencia = [0.01, 0.99]; // primer sorteo (CTR) gana, segundo (CVR) falla
  let i = 0;
  const rng = () => secuencia[i++];
  const { clicked, converted, revenue } = GameEngine.simulateOutcome(0.5, 0.5, 100, rng);
  assert.equal(clicked, true);
  assert.equal(converted, false);
  assert.equal(revenue, 0);
});

test('simulateOutcome: con clic y conversión forzados, el ingreso es revenuePerConversion x [0.8, 1.2]', () => {
  const secuencia = [0.01, 0.01, 0.5]; // CTR ok, CVR ok, jitter de ingreso = 0.5
  let i = 0;
  const rng = () => secuencia[i++];
  const { clicked, converted, revenue } = GameEngine.simulateOutcome(0.5, 0.5, 100, rng);
  assert.equal(clicked, true);
  assert.equal(converted, true);
  assert.equal(revenue, 100 * (0.8 + 0.5 * 0.4)); // = 100 * 1.0 = 100
});

// ---------------------------------------------------------------------------
// 5. Métricas derivadas: CTR, CPC, CPA, ROAS, Beneficio (computeRanking)
// ---------------------------------------------------------------------------

test('computeRanking calcula CTR/CPC/CPA/ROAS/beneficio correctamente a partir de métricas conocidas', () => {
  const engine = newEngine();
  engine.createGame({ initialBudget: 1000 });
  const team = engine.addTeam('Equipo Test');
  const campaign = engine.createCampaign(team.id, {
    name: 'Campaña conocida', objetivo: 'conversiones', strategy: 'cpm_fijo', budget: 1000, maxBid: 2, creativeQuality: 5,
  });

  // Fijamos métricas a mano, como si hubieran salido de 1000 impresiones reales.
  Object.assign(campaign.metrics, {
    impressions: 1000, clicks: 50, conversions: 5, spend: 200, revenue: 500,
  });

  const ranking = engine.computeRanking();
  const row = ranking.find((r) => r.teamId === team.id);

  assert.equal(row.ctr, 50 / 1000); // 0.05
  assert.equal(row.cpc, 200 / 50); // 4
  assert.equal(row.cpa, 200 / 5); // 40
  assert.equal(row.roas, 500 / 200); // 2.5 -> "por cada 1€ invertido, 2.5€ de ingresos"
  const beneficioEsperado = (500 - 200) / 1000; // eficiencia = beneficio relativo al presupuesto inicial
  assert.equal(row.efficiency, beneficioEsperado);
  assert.equal(row.revenue - row.spend, 300); // beneficio absoluto en €
});

test('computeRanking: una campaña puede ser NO rentable (ROAS < 1, beneficio negativo)', () => {
  const engine = newEngine();
  engine.createGame({ initialBudget: 1000 });
  const team = engine.addTeam('Equipo Perdedor');
  const campaign = engine.createCampaign(team.id, {
    name: 'Campaña cara', objetivo: 'clics', strategy: 'cpm_fijo', budget: 1000, maxBid: 2, creativeQuality: 5,
  });
  Object.assign(campaign.metrics, { impressions: 500, clicks: 10, conversions: 1, spend: 500, revenue: 300 });

  const ranking = engine.computeRanking();
  const row = ranking.find((r) => r.teamId === team.id);
  assert.equal(row.roas, 300 / 500); // 0.6x -> pierde dinero
  assert.ok(row.roas < 1, 'ROAS debería ser menor que 1 (no rentable)');
  assert.ok(row.revenue - row.spend < 0, 'el beneficio debería ser negativo');
});

test('computeRanking no produce NaN/Infinity cuando un equipo no ha gastado nada todavía', () => {
  const engine = newEngine();
  engine.createGame({ initialBudget: 500 });
  engine.addTeam('Equipo Nuevo'); // sin campañas ni gasto
  const ranking = engine.computeRanking();
  assertNoBadNumbers(ranking, 'ranking');
});

// ---------------------------------------------------------------------------
// 6. Eligibilidad económica: presupuesto agotado bloquea la puja
// ---------------------------------------------------------------------------

test('_eligibleCampaigns excluye campañas y equipos sin presupuesto restante', () => {
  const engine = newEngine();
  engine.createGame({ initialBudget: 100 });
  const team = engine.addTeam('Equipo Sin Presupuesto');
  const campaign = engine.createCampaign(team.id, {
    name: 'Campaña agotada', objetivo: 'clics', strategy: 'cpm_fijo', budget: 50, maxBid: 1, creativeQuality: 5,
  });

  // Caso 1: la campaña ha gastado todo su presupuesto propio.
  campaign.metrics.spend = 50;
  assert.equal(engine._eligibleCampaigns().length, 0);

  // Caso 2: la campaña tiene margen propio pero el EQUIPO ya no tiene presupuesto.
  campaign.metrics.spend = 10;
  team.budgetSpent = 100;
  assert.equal(engine._eligibleCampaigns().length, 0);
});

// ---------------------------------------------------------------------------
// 7. Eventos de mercado: deben cambiar variables reales, no solo el texto
// ---------------------------------------------------------------------------

test('triggerEvent "tendencia_viral" incrementa de verdad la demanda (y por tanto el precio) del segmento afectado', () => {
  const engine = newEngine();
  engine.createGame({});
  engine.addTeam('Equipo'); // no imprescindible, pero deja el estado más realista

  assert.equal(engine.state.marketState.segmentDemand.viajes, 1);
  engine.triggerEvent('tendencia_viral', 'viajes');
  assert.equal(engine.state.marketState.segmentDemand.viajes, 1.8);
  // Otros segmentos no marcados no deben verse afectados.
  assert.equal(engine.state.marketState.segmentDemand.tecnologia, 1);
  assert.equal(engine.state.marketState.segmentCtrMultiplier.viajes, 1); // este evento no toca CTR
});

test('triggerEvent "crisis_reputacion" reduce el CTR (no la demanda) del segmento afectado', () => {
  const engine = newEngine();
  engine.createGame({});
  engine.triggerEvent('crisis_reputacion', 'moda');
  assert.equal(engine.state.marketState.segmentCtrMultiplier.moda, 0.5);
  assert.equal(engine.state.marketState.segmentDemand.moda, 1); // no toca demanda
});

test('triggerEvent con target "global" afecta a todos los segmentos', () => {
  const engine = newEngine();
  engine.createGame({});
  engine.triggerEvent('cambio_algoritmo', 'global');
  Object.values(engine.state.marketState.segmentCtrMultiplier).forEach((v) => assert.equal(v, 0.7));
});

test('un evento caducado deja de afectar al mercado tras expirar', () => {
  const engine = newEngine();
  engine.createGame({});
  const ev = engine.triggerEvent('subida_cpm', 'viajes');
  assert.equal(engine.state.marketState.segmentDemand.viajes, 1.4);

  ev.expiresAt = Date.now() - 1; // forzamos la caducidad
  engine._applyEventMultipliers();

  assert.equal(engine.state.marketState.segmentDemand.viajes, 1);
  assert.equal(engine.state.activeEvents.length, 0);
});

test('un evento de demanda SÍ altera el precio de reserva real que se cobra en la subasta (impacto económico, no solo visual)', () => {
  // Reproduce el mismo cálculo de reservePrice que usa _tick() en gameEngine.js,
  // para comprobar que depende de segmentDemand y que triggerEvent lo modifica de verdad.
  const { SEGMENT_BASE } = require('../server/data');
  const engine = newEngine();
  engine.createGame({});

  const reserveAntes = +(SEGMENT_BASE.viajes.baseCPM * engine.state.marketState.segmentDemand.viajes * 0.6).toFixed(2);

  engine.triggerEvent('tendencia_viral', 'viajes'); // x1.8 de demanda
  const reserveDespues = +(SEGMENT_BASE.viajes.baseCPM * engine.state.marketState.segmentDemand.viajes * 0.6).toFixed(2);

  assert.ok(reserveDespues > reserveAntes, 'el precio de reserva debería subir tras el evento de demanda');
  assert.equal(reserveDespues, +(reserveAntes * 1.8).toFixed(2));
});

// ---------------------------------------------------------------------------
// 8. Prueba de estrés lógica: muchos ticks reales, con eventos y ediciones
//    en medio, comprobando invariantes económicas (paso 10-16 del guion del profesor).
// ---------------------------------------------------------------------------

test('estrés: 200 subastas con 3 equipos y eventos de mercado no rompen ninguna invariante económica', () => {
  const engine = newEngine();
  engine.createGame({ initialBudget: 300, durationMs: 3600000, tickIntervalMs: 999999 });
  const alfa = engine.addTeam('Equipo Alfa');
  const beta = engine.addTeam('Equipo Beta');
  const gamma = engine.addTeam('Equipo Gamma');

  engine.createCampaign(alfa.id, { name: 'Alfa viajes', objetivo: 'roas', strategy: 'roas_objetivo', budget: 150, maxBid: 3, targetROAS: 3, creativeQuality: 8, targeting: { intereses: ['viajes'] } });
  engine.createCampaign(beta.id, { name: 'Beta tech', objetivo: 'conversiones', strategy: 'maximizar_conversiones', budget: 150, maxBid: 2.5, creativeQuality: 7, targeting: { intereses: ['tecnologia'], edades: ['18-24'] } });
  engine.createCampaign(gamma.id, { name: 'Gamma alcance', objetivo: 'impresiones', strategy: 'maximizar_alcance', budget: 150, maxBid: 1.5, creativeQuality: 5, targeting: {} });

  engine.startGame();
  if (engine.tickHandle) clearInterval(engine.tickHandle); // controlamos los ticks a mano, sin esperar al setInterval real

  for (let i = 0; i < 200; i += 1) {
    if (i === 50) engine.triggerEvent('tendencia_viral', 'viajes');
    if (i === 120) engine.pauseGame();
    if (i === 121) engine.startGame();
    if (engine.tickHandle) { clearInterval(engine.tickHandle); engine.tickHandle = null; }
    engine._tick();
  }

  // Invariante 1: nada de NaN/Infinity/undefined en ningún sitio del estado público.
  const publicState = engine.getPublicState();
  assertNoBadNumbers(publicState.teams, 'teams');
  assertNoBadNumbers(publicState.campaigns, 'campaigns');
  assertNoBadNumbers(publicState.ranking, 'ranking');

  // Invariante 2: ningún equipo ha gastado más de lo que tenía.
  Object.values(engine.state.teams).forEach((t) => {
    assert.ok(t.budgetSpent <= t.budgetInitial + 0.01, `${t.name} gastó ${t.budgetSpent} de ${t.budgetInitial}`);
  });

  // Invariante 3: ninguna campaña ha gastado más de su propio presupuesto asignado.
  Object.values(engine.state.campaigns).forEach((c) => {
    assert.ok(c.metrics.spend <= c.budget + 0.01, `${c.name} gastó ${c.metrics.spend} de ${c.budget}`);
    // Invariante 4: coherencia interna clicks <= impressions, conversions <= clicks.
    assert.ok(c.metrics.clicks <= c.metrics.impressions, `${c.name}: más clics que impresiones`);
    assert.ok(c.metrics.conversions <= c.metrics.clicks, `${c.name}: más conversiones que clics`);
  });

  // Invariante 5: el gasto sumado de las campañas de un equipo coincide con el gasto del equipo
  // (ninguna subasta "perdió" o "duplicó" dinero por el camino).
  Object.values(engine.state.teams).forEach((t) => {
    const sumaCampañas = Object.values(engine.state.campaigns)
      .filter((c) => c.teamId === t.id)
      .reduce((s, c) => s + c.metrics.spend, 0);
    assert.ok(Math.abs(sumaCampañas - t.budgetSpent) < 0.05, `descuadre de gasto en ${t.name}: campañas suman ${sumaCampañas}, equipo registra ${t.budgetSpent}`);
  });

  if (engine.tickHandle) clearInterval(engine.tickHandle);
});
