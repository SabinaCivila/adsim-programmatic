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

function wrapField(labelText, inputNode) {
  const wrap = el('div');
  wrap.appendChild(el('label', {}, labelText));
  wrap.appendChild(inputNode);
  return wrap;
}

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
