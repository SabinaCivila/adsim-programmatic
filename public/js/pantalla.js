const socket = io();
let catalog = null;
let state = null;
let lastResult = null;
let recentEvents = [];

fetchCatalog().then((c) => { catalog = c; render(); });
socket.on('state:update', ({ state: s }) => { state = s; render(); });
socket.on('auction:result', (result) => { lastResult = result; renderStage(); });
socket.on('market:event', (ev) => {
  recentEvents.unshift(`⚡ ${ev.label}: ${ev.description} (${ev.target})`);
  recentEvents = recentEvents.slice(0, 8);
  renderTicker();
});

setInterval(() => { if (state) updateTimer(); }, 1000);

function updateTimer() {
  const timerEl = document.getElementById('timer');
  if (state.status === 'running' && state.endsAt) timerEl.textContent = formatMs(state.endsAt - Date.now());
  else if (state.status === 'paused' && state.pausedRemainingMs != null) timerEl.textContent = formatMs(state.pausedRemainingMs);
  else timerEl.textContent = '--:--';
}

function render() {
  if (!state || !catalog) return;
  document.getElementById('status-pill').textContent = statusLabel(state.status);
  document.getElementById('status-pill').className = `status-pill status-${state.status}`;
  updateTimer();

  const idle = document.getElementById('idle-message');
  const stageWrap = document.getElementById('stage-wrap');
  if (state.status === 'lobby') {
    idle.style.display = '';
    idle.textContent = 'Esperando a que el profesor configure la partida...';
    stageWrap.style.display = 'none';
    return;
  }
  if (state.status === 'ended') {
    idle.style.display = 'none';
    stageWrap.style.display = '';
    renderFinalRanking();
    return;
  }
  idle.style.display = 'none';
  stageWrap.style.display = '';
  if (!lastResult && state.auctionLog?.length) lastResult = state.auctionLog[0];
  renderStage();
  renderRanking();
}

function renderStage() {
  const stage = document.getElementById('auction-stage');
  if (!lastResult) {
    stage.innerHTML = '';
    stage.appendChild(el('div', { class: 'empty-state' }, 'Preparando la primera subasta...'));
    return;
  }
  const r = lastResult;
  stage.innerHTML = '';
  stage.className = 'auction-stage flash';
  stage.appendChild(el('div', { class: 'auction-id' }, `Subasta #${r.opportunityId}`));
  stage.appendChild(el('div', { class: 'opp-profile' }, [
    el('span', {}, `👤 ${r.opportunity.edad} años`),
    el('span', {}, `📍 ${r.opportunity.ubicacion}`),
    el('span', {}, `📱 ${r.opportunity.dispositivo}`),
    el('span', {}, `❤️ ${r.opportunity.interes}`),
  ]));

  if (r.bids.length === 0) {
    stage.appendChild(el('div', { class: 'empty-state' }, 'Ningún equipo puja en esta oportunidad.'));
  } else {
    r.bids.forEach((b, idx) => {
      const isWinner = r.impressionGranted && idx === 0;
      stage.appendChild(el('div', { class: `bidder-row ${isWinner ? 'winner' : ''}` }, [
        el('span', {}, b.teamName),
        el('span', {}, euros(b.bid)),
      ]));
    });
  }

  if (r.impressionGranted) {
    const extras = [];
    if (r.clicked) extras.push('👆 clic');
    if (r.converted) extras.push(`💰 conversión (+${euros(r.revenue)})`);
    stage.appendChild(el('div', { class: 'winner-banner' }, [
      el('span', {}, `🏆 Gana ${r.winnerTeamName}`),
      el('span', {}, `Coste: ${euros(r.clearingPrice)}`),
      el('span', {}, extras.join(' · ') || '1 impresión'),
    ]));
  }
}

function renderRanking() {
  const grid = document.getElementById('projector-ranking-grid');
  grid.innerHTML = '';
  (state.ranking || []).slice(0, 8).forEach((t, idx) => {
    const pos = idx + 1;
    grid.appendChild(el('div', { class: 'card tight', style: 'display:flex; justify-content:space-between; align-items:center;' }, [
      el('div', { style: 'display:flex; align-items:center; gap:14px;' }, [
        el('div', { class: `rank-pos ${pos <= 3 ? 'top' + pos : ''}`, style: 'font-size:22px;' }, String(pos)),
        el('div', {}, [
          el('div', { style: 'font-weight:700; font-size:16px;' }, t.teamName),
          el('div', { style: 'color:var(--text-dim); font-size:12px;' }, `ROAS ${num(t.roas)} · ${t.conversions} conv.`),
        ]),
      ]),
      el('div', { style: 'font-size:22px; font-weight:800;' }, num(t.score)),
    ]));
  });
}

function renderFinalRanking() {
  document.getElementById('auction-stage').innerHTML = '';
  const stage = document.getElementById('auction-stage');
  stage.appendChild(el('h2', { style: 'font-size:26px; text-align:center;' }, '🏁 Partida finalizada'));
  renderRanking();
}

function renderTicker() {
  document.getElementById('event-ticker').textContent = recentEvents.join('   ·   ');
}
