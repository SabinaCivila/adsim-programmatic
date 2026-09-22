const socket = io();
let catalog = null;
let state = null;
let myTeamId = localStorage.getItem('adsim_team_id') || null;
let showingNewCampaignForm = false;
let editingCampaignId = null;

fetchCatalog().then((c) => { catalog = c; render(); });
socket.on('state:update', ({ state: s }) => { state = s; render(); });
socket.on('action:error', ({ message }) => toast(message, 'error'));
socket.on('market:event', (ev) => toast(`Evento de mercado: ${ev.label}`, 'info'));

document.getElementById('switch-team-btn').addEventListener('click', () => {
  localStorage.removeItem('adsim_team_id');
  myTeamId = null;
  render();
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

  if (myTeamId && !state.teams[myTeamId]) { myTeamId = null; localStorage.removeItem('adsim_team_id'); }
  // Si el equipo que estábamos editando dejó de existir (p. ej. lo quitó el
  // profesor), cerramos el formulario en vez de intentar reconstruirlo con
  // datos que ya no están.
  if (editingCampaignId && !state.campaigns[editingCampaignId]) editingCampaignId = null;

  if (!myTeamId) {
    document.getElementById('team-select-section').style.display = '';
    document.getElementById('team-dashboard').style.display = 'none';
    document.getElementById('switch-team-btn').style.display = 'none';
    renderTeamSelect();
    return;
  }

  document.getElementById('team-select-section').style.display = 'none';
  document.getElementById('team-dashboard').style.display = '';
  document.getElementById('switch-team-btn').style.display = '';
  document.getElementById('team-role-label').textContent = state.teams[myTeamId].name;

  // --- Secciones "en vivo": se refrescan siempre, no contienen datos sin guardar del usuario.
  renderEventsBanner();
  renderBudgetCards();
  renderMyRank();
  renderCampaignList();

  // --- Formularios interactivos: solo se (re)construyen cuando cambia SU IDENTIDAD
  // (se abren, se cierran, o cambian de campaña objetivo) — nunca por un
  // state:update ajeno. Esto es lo que evita que se pierda lo que el alumno
  // está escribiendo cuando otro equipo o el profesor hace algo a la vez.
  renderOnce(document.getElementById('campaign-form-holder'), showingNewCampaignForm ? 'new' : null, () => buildCampaignForm(null));
  renderOnce(document.getElementById('campaign-edit-holder'), editingCampaignId, () => buildCampaignForm(state.campaigns[editingCampaignId]));
}

function renderTeamSelect() {
  const container = document.getElementById('team-select-section');
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'hero', style: 'padding:50px 10px;' }, [
    el('h1', { style: 'font-size:24px;' }, '¿Qué equipo eres?'),
    el('p', { style: 'color:var(--text-dim);' }, 'Selecciona tu equipo para acceder a su panel de campañas.'),
  ]));
  const teams = Object.values(state.teams);
  const grid = el('div', { class: 'grid grid-cols-3', style: 'max-width:700px; margin: 0 auto;' });
  if (teams.length === 0) {
    grid.appendChild(el('div', { class: 'empty-state' }, 'El profesor todavía no ha creado equipos. Espera a que la partida esté configurada.'));
  }
  teams.forEach((t) => {
    grid.appendChild(el('div', {
      class: 'card', style: 'cursor:pointer; text-align:center;',
      onclick: () => { localStorage.setItem('adsim_team_id', t.id); myTeamId = t.id; render(); },
    }, [el('h3', {}, t.name), el('div', { style: 'color:var(--text-dim); font-size:13px;' }, euros(t.budgetInitial))]));
  });
  container.appendChild(grid);
}

function renderEventsBanner() {
  const container = document.getElementById('events-banner');
  container.innerHTML = '';
  (state.activeEvents || []).forEach((ev) => {
    container.appendChild(el('div', { class: 'event-banner' }, `⚡ ${ev.label} (${ev.target}): ${ev.description}`));
  });
}

function renderBudgetCards() {
  const team = state.teams[myTeamId];
  const container = document.getElementById('budget-cards');
  container.innerHTML = '';
  const remaining = team.budgetInitial - team.budgetSpent;
  const cards = [
    ['Presupuesto inicial', euros(team.budgetInitial), ''],
    ['Gastado', euros(team.budgetSpent), ''],
    ['Restante', euros(remaining), ''],
    ['Beneficio / pérdida', profitLabel(team.revenueSimulated, team.budgetSpent), profitClass(team.revenueSimulated, team.budgetSpent)],
  ];
  cards.forEach(([label, value, cls]) => {
    container.appendChild(el('div', { class: 'card metric-card' }, [
      el('div', { class: 'label' }, label),
      el('div', { class: `value ${cls}` }, value),
    ]));
  });
}

function renderMyRank() {
  const container = document.getElementById('my-rank');
  container.innerHTML = '';
  const mine = (state.ranking || []).find((r) => r.teamId === myTeamId);
  const pos = (state.ranking || []).findIndex((r) => r.teamId === myTeamId) + 1;
  if (!mine) {
    container.appendChild(el('div', { class: 'empty-state' }, 'El ranking aparecerá cuando empiece la partida.'));
    return;
  }
  container.appendChild(el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [
    el('div', {}, [
      el('div', { style: 'font-size:13px; color:var(--text-dim);' }, `Posición ${pos} de ${state.ranking.length}`),
      el('div', { style: 'font-size:13px; margin-top:4px;' }, `ROAS ${roasLabel(mine.spend, mine.roas)} · CTR ${pct(mine.ctr)} · CPA ${mine.cpa != null ? euros(mine.cpa) : '—'} · ${mine.conversions} conversiones · Beneficio ${profitLabel(mine.revenue, mine.spend)}`),
    ]),
    el('div', { style: 'font-size:30px; font-weight:800;' }, num(mine.score)),
  ]));
}

// ---------- Formulario de campaña (crear / editar) ----------
document.getElementById('new-campaign-btn').addEventListener('click', () => {
  showingNewCampaignForm = !showingNewCampaignForm;
  editingCampaignId = null;
  render();
});

function chipToggle(options, selectedArr) {
  const wrap = el('div', { class: 'chips' });
  const selected = new Set(selectedArr);
  options.forEach((opt) => {
    const chip = el('div', { class: `chip ${selected.has(opt) ? 'active' : ''}` }, opt);
    chip.addEventListener('click', () => {
      if (selected.has(opt)) selected.delete(opt); else selected.add(opt);
      chip.classList.toggle('active');
    });
    wrap.appendChild(chip);
  });
  wrap._getSelected = () => Array.from(selected);
  return wrap;
}

function buildCampaignForm(existing) {
  const t = existing ? existing.targeting : { edades: [], ubicaciones: [], dispositivos: [], intereses: [], horarios: [], tiposContenido: [] };
  const form = el('div', { class: 'card', style: 'margin-bottom:16px; border-color:var(--accent);' });

  const nameInput = el('input', { value: existing?.name || '', placeholder: 'Nombre de la campaña' });
  const objetivoSelect = el('select', {}, catalog.OBJETIVOS.map((o) => el('option', { value: o.id }, o.label)));
  const formatoSelect = el('select', {}, catalog.FORMATOS.map((f) => el('option', { value: f }, f)));
  const strategySelect = el('select', {}, catalog.ESTRATEGIAS.map((s) => el('option', { value: s.id }, s.label)));
  if (existing) {
    objetivoSelect.value = existing.objetivo;
    formatoSelect.value = existing.formato;
    strategySelect.value = existing.strategy;
  }
  const budgetInput = el('input', { type: 'number', value: existing?.budget ?? 100, min: '1' });
  const maxBidInput = el('input', { type: 'number', value: existing?.maxBid ?? 2, step: '0.05', min: '0.05' });
  const targetCPAInput = el('input', { type: 'number', value: existing?.targetCPA ?? 20, step: '0.5' });
  const targetROASInput = el('input', { type: 'number', value: existing?.targetROAS ?? 3, step: '0.1' });
  const creativeQualityInput = el('input', { type: 'range', min: '1', max: '10', value: existing?.creativeQuality ?? 6 });

  form.appendChild(el('h3', {}, existing ? `Editando: ${existing.name}` : 'Nueva campaña'));
  form.appendChild(el('div', { class: 'field-row' }, [wrapField('Nombre', nameInput), wrapField('Objetivo', objetivoSelect)]));
  form.appendChild(el('div', { class: 'field-row' }, [wrapField('Formato publicitario', formatoSelect), wrapField('Estrategia de puja', strategySelect)]));
  form.appendChild(el('div', { class: 'field-row' }, [
    wrapField('Presupuesto de campaña (€)', budgetInput),
    wrapField('Puja máxima por impresión (€)', maxBidInput),
  ]));
  form.appendChild(el('div', { class: 'field-row' }, [
    wrapField('CPA objetivo (solo estrategia CPA) €', targetCPAInput),
    wrapField('ROAS objetivo (solo estrategia ROAS)', targetROASInput),
  ]));
  form.appendChild(wrapField('Calidad de la creatividad (1-10)', creativeQualityInput));

  form.appendChild(el('h4', { style: 'margin-top:18px;' }, 'Segmentación (sin marcar = cualquiera)'));
  const edadesChips = chipToggle(catalog.EDADES, t.edades);
  const ubicacionesChips = chipToggle(catalog.UBICACIONES, t.ubicaciones);
  const dispositivosChips = chipToggle(catalog.DISPOSITIVOS, t.dispositivos);
  const interesesChips = chipToggle(catalog.INTERESES, t.intereses);
  const horariosChips = chipToggle(catalog.HORARIOS, t.horarios);
  const tiposChips = chipToggle(catalog.TIPOS_CONTENIDO, t.tiposContenido);
  [['Edad', edadesChips], ['Ubicación', ubicacionesChips], ['Dispositivo', dispositivosChips],
    ['Intereses', interesesChips], ['Horario', horariosChips], ['Tipo de contenido', tiposChips]].forEach(([label, chips]) => {
    form.appendChild(el('label', {}, label));
    form.appendChild(chips);
  });

  const actions = el('div', { style: 'display:flex; gap:10px; margin-top:18px;' });
  actions.appendChild(el('button', {
    class: 'btn',
    onclick: () => {
      const payload = {
        name: nameInput.value || 'Campaña sin nombre',
        objetivo: objetivoSelect.value,
        formato: formatoSelect.value,
        strategy: strategySelect.value,
        budget: Number(budgetInput.value),
        maxBid: Number(maxBidInput.value),
        targetCPA: Number(targetCPAInput.value),
        targetROAS: Number(targetROASInput.value),
        creativeQuality: Number(creativeQualityInput.value),
        targeting: {
          edades: edadesChips._getSelected(),
          ubicaciones: ubicacionesChips._getSelected(),
          dispositivos: dispositivosChips._getSelected(),
          intereses: interesesChips._getSelected(),
          horarios: horariosChips._getSelected(),
          tiposContenido: tiposChips._getSelected(),
        },
      };
      if (existing) {
        socket.emit('campaign:update', { campaignId: existing.id, ...payload });
        toast('Campaña actualizada.', 'success');
        editingCampaignId = null;
      } else {
        socket.emit('campaign:create', { teamId: myTeamId, ...payload });
        toast('Campaña creada.', 'success');
        showingNewCampaignForm = false;
      }
      render();
    },
  }, existing ? 'Guardar cambios' : 'Crear campaña'));
  actions.appendChild(el('button', {
    class: 'btn secondary',
    onclick: () => { showingNewCampaignForm = false; editingCampaignId = null; render(); },
  }, 'Cancelar'));
  form.appendChild(actions);
  return form;
}

function renderCampaignList() {
  const container = document.getElementById('campaign-list');
  container.innerHTML = '';
  const campaigns = Object.values(state.campaigns).filter((c) => c.teamId === myTeamId);
  if (campaigns.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' }, 'Todavía no has creado ninguna campaña.'));
    return;
  }
  campaigns.forEach((c) => {
    const beingEdited = editingCampaignId === c.id;
    const ctr = c.metrics.impressions > 0 ? c.metrics.clicks / c.metrics.impressions : 0;
    const cpc = c.metrics.clicks > 0 ? c.metrics.spend / c.metrics.clicks : null;
    const cpm = c.metrics.impressions > 0 ? (c.metrics.spend / c.metrics.impressions) * 1000 : 0;
    const cpa = c.metrics.conversions > 0 ? c.metrics.spend / c.metrics.conversions : null;
    const spentPct = c.budget > 0 ? Math.min(100, (c.metrics.spend / c.budget) * 100) : 0;

    const card = el('div', { class: 'card', style: `margin-bottom:14px; ${beingEdited ? 'border-color:var(--accent);' : ''}` });
    card.appendChild(el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [
      el('div', {}, [
        el('h3', {}, c.name),
        el('div', { style: 'color:var(--text-dim); font-size:12.5px;' }, `${catalog.OBJETIVOS.find((o) => o.id === c.objetivo)?.label || c.objetivo} · ${catalog.ESTRATEGIAS.find((s) => s.id === c.strategy)?.label.split(' (')[0]}`),
      ]),
      el('span', { class: `badge ${c.status}` }, c.status),
    ]));
    card.appendChild(el('div', { class: 'progress-bar', style: 'margin:10px 0 4px;' }, el('div', { style: `width:${spentPct}%;` })));
    card.appendChild(el('div', { style: 'font-size:12px; color:var(--text-dim);' }, `${euros(c.metrics.spend)} de ${euros(c.budget)} gastado`));

    const metricsGrid = el('div', { class: 'grid grid-cols-6', style: 'margin-top:14px;' });
    [
      ['Impr.', num(c.metrics.impressions), ''],
      ['Clics', num(c.metrics.clicks), ''],
      ['Conv.', num(c.metrics.conversions), ''],
      ['CTR', pct(ctr), ''],
      ['CPC', cpc != null ? euros(cpc) : '—', ''],
      ['CPM', euros(cpm), ''],
      ['CPA', cpa != null ? euros(cpa) : '—', ''],
      ['ROAS', roasLabel(c.metrics.spend, c.metrics.spend > 0 ? c.metrics.revenue / c.metrics.spend : 0), ''],
      ['Ingresos', euros(c.metrics.revenue), ''],
      ['Beneficio', profitLabel(c.metrics.revenue, c.metrics.spend), profitClass(c.metrics.revenue, c.metrics.spend)],
    ].forEach(([label, value, cls]) => {
      metricsGrid.appendChild(el('div', { class: 'metric-card' }, [
        el('div', { class: 'label' }, label),
        el('div', { class: `value ${cls}`, style: 'font-size:17px;' }, value),
      ]));
    });
    card.appendChild(metricsGrid);

    const actions = el('div', { style: 'display:flex; gap:8px; margin-top:14px;' });
    actions.appendChild(el('button', {
      class: 'btn secondary small',
      disabled: beingEdited,
      onclick: () => { editingCampaignId = c.id; showingNewCampaignForm = false; render(); },
    }, beingEdited ? 'Editando ↑' : 'Editar'));
    if (c.status === 'active') {
      actions.appendChild(el('button', { class: 'btn warn small', onclick: () => socket.emit('campaign:update', { campaignId: c.id, status: 'paused' }) }, 'Pausar'));
    } else if (c.status === 'paused') {
      actions.appendChild(el('button', { class: 'btn small', onclick: () => socket.emit('campaign:update', { campaignId: c.id, status: 'active' }) }, 'Reactivar'));
    }
    card.appendChild(actions);
    container.appendChild(card);
  });
}
