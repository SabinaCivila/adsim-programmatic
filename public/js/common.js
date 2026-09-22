// Utilidades compartidas por las tres vistas (profesor, equipo, pantalla).

function euros(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

function pct(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return (v * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + '%';
}

function num(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

function formatMs(ms) {
  if (ms == null || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ROAS solo tiene sentido una vez que se ha gastado algo; mostrar "0,00x"
// para un equipo/campaña que aún no ha pujado se confunde fácilmente con
// "perdió todo su dinero". Mostramos "—" hasta que haya gasto real.
function roasLabel(spend, roas) {
  if (!(spend > 0)) return '—';
  return `${num(roas)}x`;
}

// Beneficio/pérdida en euros, con signo explícito para que se lea de un
// vistazo si la campaña/equipo es rentable o no.
function profitLabel(revenue, spend) {
  const profit = (revenue || 0) - (spend || 0);
  const sign = profit > 0 ? '+' : '';
  return `${sign}${euros(profit)}`;
}
function profitClass(revenue, spend) {
  const profit = (revenue || 0) - (spend || 0);
  if (profit > 0) return 'profit-positive';
  if (profit < 0) return 'profit-negative';
  return '';
}

function statusLabel(status) {
  return { lobby: 'En espera', running: 'En curso', paused: 'Pausada', ended: 'Finalizada' }[status] || status;
}

async function fetchCatalog() {
  const res = await fetch('/api/catalog');
  return res.json();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === false || v == null) { /* atributo booleano en falso: no lo añadimos */ }
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

// ---------------------------------------------------------------------------
// renderOnce: pieza central de la gestión de estado de la interfaz.
//
// Causa raíz de la pérdida de datos detectada (nombres de campaña que se
// borran, selects que vuelven a su valor inicial, segmentación que se
// desmarca): el servidor emite `state:update` a TODOS los clientes cada vez
// que ocurre CUALQUIER cosa en la partida (otro equipo crea una campaña, el
// profesor añade un equipo, se resuelve una subasta cada pocos segundos...).
// Antes, cada `render()` volvía a construir TODO el DOM desde cero
// (`innerHTML = ''` + reconstrucción), incluidos los formularios que un
// alumno tenía abiertos y sin guardar en ese preciso instante — así que
// cualquier evento ajeno borraba lo que esa persona estaba escribiendo.
//
// renderOnce reconstruye un contenedor solo cuando cambia su "identidad"
// (por ejemplo: qué campaña se está editando, o si el formulario de
// creación está abierto o cerrado). Si la identidad no ha cambiado, el
// contenedor se deja intacto -aunque haya llegado un `state:update`-, así
// que lo que el usuario está escribiendo/seleccionando nunca se pierde por
// una acción de otra persona. Cuando la identidad SÍ cambia (el usuario
// abre otro formulario, o lo cierra), se reconstruye a propósito.
function renderOnce(container, key, buildFn) {
  const keyStr = key == null ? '' : String(key);
  if (container.dataset.builtKey === keyStr && keyStr !== '') return; // misma identidad: no tocar
  container.innerHTML = '';
  container.dataset.builtKey = keyStr;
  if (key == null) return;
  container.appendChild(buildFn());
}

function wrapField(labelText, inputNode) {
  const wrap = el('div');
  wrap.appendChild(el('label', {}, labelText));
  wrap.appendChild(inputNode);
  return wrap;
}

// Marca de agua discreta, consistente en las tres vistas. No intercepta clics
// (pointer-events: none) y se ancla en una esquina para no tapar nunca
// botones, formularios ni gráficos.
function mountWatermark() {
  const wm = el('div', {
    class: 'adsim-watermark',
    'aria-hidden': 'true',
  }, 'Sabina Civila');
  document.body.appendChild(wm);
}
document.addEventListener('DOMContentLoaded', mountWatermark);

function toast(message, kind = 'info') {
  let holder = document.getElementById('toast-holder');
  if (!holder) {
    holder = el('div', { id: 'toast-holder', style: 'position:fixed;bottom:16px;right:16px;z-index:999;display:flex;flex-direction:column;gap:8px;' });
    document.body.appendChild(holder);
  }
  const colors = { info: 'var(--accent)', error: 'var(--danger)', success: 'var(--good)' };
  const node = el('div', {
    style: `background:var(--bg-card-solid); border:1px solid ${colors[kind]}; color:var(--text); padding:10px 14px; border-radius:8px; font-size:13px; box-shadow:0 6px 20px #0008; max-width:320px;`,
  }, message);
  holder.appendChild(node);
  setTimeout(() => node.remove(), 4500);
}
