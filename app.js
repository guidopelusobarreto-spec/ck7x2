/* Optimizador de compras — lógica principal (sin dependencias) */
'use strict';
const STORE_KEY = 'optcompras-v1', SYNC_KEY = 'optcompras-sync';
const LEVELS = { A: 4, B: 3, C: 2, D: 1 };
const CHANNEL_LABEL = { online: 'Tienda online', b2b: 'Cotización (WhatsApp, email)', telegram: 'Telegram / foro', directorio: 'Directorio / PDF' };
const DEFAULT_SETTINGS = { maxPkg: 8, minLevel: 'C', channels: ['online', 'b2b', 'telegram', 'directorio'], payMode: 'any', preferEU: false, euPct: 50, fixed: [] };
let S = null;          // estado completo (datos + ajustes)
let LAST = null;       // último resultado del optimizador

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (n == null || isNaN(n)) ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const num = v => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? null : x; };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3000); }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* almacenamiento no disponible */ } }
function load() { try { const r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
const vendorById = id => S.vendors.find(v => v.id === id);
const productById = id => S.products.find(p => p.id === id);
function offerEUR(o) { const fx = S.fx[o.currency] || 1; return o.price * o.units / fx; }
function vendorShipping(v, net) {
  if (Array.isArray(v.shippingTiers) && v.shippingTiers.length) {
    const t = [...v.shippingTiers].sort((a, b) => a.from - b.from).filter(t => net == null || net >= t.from).pop() || v.shippingTiers[0];
    return { value: t.cost, est: false, tiers: true };
  }
  return v.shipping != null ? { value: v.shipping, est: false } : { value: v.shippingEstimate ?? 0, est: true };
}
function payOK(v, mode) {
  const p = (v.payment || '').toLowerCase();
  if (mode === 'cardOnly') return /tarjeta|paypal/.test(p);
  if (mode === 'noTransfer') return /tarjeta|paypal|por confirmar/.test(p);
  return true;
}
// Ventana desde abajo, con los botones siempre visibles.
function sheet(html, onOpen) {
  const d = $('#sheet');
  d.innerHTML = html;
  $$('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
  d.showModal();
  onOpen?.(d);
  return d;
}

/* ---------- carga ---------- */
function init() {
  S = load() || { version: 1, dataDate: '', fx: { USD: 1.1206, INR: 108.3965, EUR: 1 }, products: [], vendors: [], offers: [], excluded: [] };
  S.settings = Object.assign({}, DEFAULT_SETTINGS, S.settings || {});
  bindTabs(); bindPlan(); bindSettings(); bindSync();
  renderAll();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  checkUpdate();
}

function renderAll() {
  $('#dataInfo').textContent = S.products.length
    ? `${S.products.length} productos · ${S.vendors.length} proveedores · datos del ${S.dataDate || '—'}`
    : 'Sin datos todavía';
  renderPlanControls(); renderProducts(); renderVendors(); renderSettings(); renderUpdateNote();
  recalc();
}

/* ---------- pestañas ---------- */
function showTab(name) {
  $$('.tabbar button').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === name ? 'true' : 'false'));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  window.scrollTo({ top: 0 });
  if (name === 'plan') recalc();
}
function bindTabs() { $$('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab))); }

/* ---------- optimizador ---------- */
function eligibleVendors() {
  const st = S.settings;
  return S.vendors.filter(v => v.active
    && st.channels.includes(v.channel)
    && (LEVELS[v.level] || 0) >= LEVELS[st.minLevel]
    && payOK(v, st.payMode));
}

function optimize() {
  const st = S.settings;
  const prods = S.products.filter(p => p.active);
  const vend = eligibleVendors();
  const vIndex = new Map(vend.map((v, i) => [v.id, i]));
  let perProd0 = prods.map(p => S.offers
    .filter(o => o.active && o.productId === p.id && vIndex.has(o.vendorId))
    .map(o => ({ o, vi: vIndex.get(o.vendorId), cost: offerEUR(o) * (p.qty || 1) }))
    .sort((a, b) => a.cost - b.cost));
  // proveedores fijos: lo que vendan se compra en ellos (el más barato entre los fijos)
  const fixedIds = (st.fixed || []).filter(id => vendorById(id));
  const fixedOff = fixedIds.filter(id => !vIndex.has(id));                 // fuera por los filtros
  const fixedVi = new Set(fixedIds.filter(id => vIndex.has(id)).map(id => vIndex.get(id)));
  const locked = new Set();
  perProd0 = perProd0.map((l, i) => { const f = l.filter(x => fixedVi.has(x.vi)); if (f.length) { locked.add(i); return f; } return l; });
  const fixedUsed = [...fixedVi].filter(vi => perProd0.some(l => l.some(x => x.vi === vi)));
  const fixedUnused = [...fixedVi].filter(vi => !fixedUsed.includes(vi)).map(vi => vend[vi]);
  if (fixedUsed.length > st.maxPkg) return { error: `Has fijado ${fixedUsed.length} proveedores y el máximo de paquetes es ${st.maxPkg}.` };
  // prioridad almacén UE: en péptidos con precio de referencia, si hay oferta UE dentro del techo, solo se usan ofertas UE
  const euUsed = [], euNone = [];
  if (st.preferEU) {
    prods.forEach((p, i) => {
      if (locked.has(i) || p.category !== 'Péptido' || !p.ref) return;
      const cap = p.ref * (p.qty || 1) * (1 + (st.euPct ?? 50) / 100);
      const eu = perProd0[i].filter(x => vend[x.vi].euWarehouse && x.cost <= cap + 1e-9);
      if (eu.length) { perProd0[i] = eu; euUsed.push(p); } else euNone.push(p);
    });
  }
  // candidatos: primero los fijos; después, por nº de productos en los que son los más baratos
  const wins = new Map();
  perProd0.forEach(l => l.forEach((x, j) => wins.set(x.vi, (wins.get(x.vi) || 0) + (j === 0 ? 10 : 1))));
  const rest = [...wins.keys()].filter(vi => !fixedUsed.includes(vi)).sort((a, b) => wins.get(b) - wins.get(a));
  const cand = [...fixedUsed, ...rest];
  if (cand.length > 30) return { error: 'Demasiados proveedores elegibles (máx. 30). Desactiva algunos.' };
  const n = cand.length, nF = fixedUsed.length;
  const bitOf = new Map(cand.map((vi, k) => [vi, 2 ** k]));
  const full = 2 ** n - 1;
  const perProd = perProd0.map(l => l.map(x => {
    const v = vend[x.vi];
    return { ...x, bit: bitOf.get(x.vi), lb: x.cost * (1 - (v.couponPct || 0) / 100) };
  }));
  const perProdLB = perProd.map(l => [...l].sort((a, b) => a.lb - b.lb));
  const maxK = Math.min(st.maxPkg, n);
  const KEEP = 6, best = [];
  let evaluated = 0, nodes = 0;
  const sub = new Float64Array(vend.length);

  function evalMask(mask) {
    evaluated++;
    sub.fill(0);
    const picks = [];
    let uncovered = 0;
    for (let pi = 0; pi < perProdLB.length; pi++) {
      const l = perProdLB[pi]; let pick = null;
      for (let j = 0; j < l.length; j++) if (mask & l[j].bit) { pick = l[j]; break; }
      if (!pick) { if (l.length) uncovered++; continue; }
      sub[pick.vi] += pick.cost; picks.push({ p: prods[pi], ...pick });
    }
    let total = 0, shipT = 0, coupon = 0, estShip = 0;
    const orders = [];
    for (let k = 0; k < n; k++) {
      if (!(mask & (2 ** k))) continue;
      const vi = cand[k], v = vend[vi];
      if (sub[vi] === 0) return null;                       // proveedor sin uso: combinación no mínima
      const c = sub[vi] * (v.couponPct || 0) / 100, net = sub[vi] - c;
      if (v.minOrder && net < v.minOrder) return null;       // no alcanza el pedido mínimo
      const sh = vendorShipping(v, net);
      const s = (v.freeFrom && net >= v.freeFrom) ? 0 : sh.value;
      if (s && sh.est) estShip++;
      total += net + s; shipT += s; coupon += c;
      orders.push({ v, fixed: k < nF, subtotal: sub[vi], coupon: c, ship: s, shipEst: sh.est && s > 0, lines: picks.filter(x => x.vi === vi) });
    }
    return { total, shipT, coupon, uncovered, orders, estShip, score: total + uncovered * 1e6 };
  }
  function push(r) {
    if (!r) return;
    best.push(r); best.sort((a, b) => a.score - b.score);
    if (best.length > KEEP) best.pop();
  }
  // cota inferior: cada producto al menor precio posible entre los proveedores aún permitidos; envíos ≥ 0
  function lowerBound(allowed) {
    let lb = 0, unc = 0;
    for (let pi = 0; pi < perProdLB.length; pi++) {
      const l = perProdLB[pi]; if (!l.length) continue;
      let found = false;
      for (let j = 0; j < l.length; j++) if (allowed & l[j].bit) { lb += l[j].lb; found = true; break; }
      if (!found) unc++;
    }
    return lb + unc * 1e6;
  }
  // ramificación y poda: incluir/excluir cada proveedor (los fijos ya están incluidos)
  function rec(k, mask, depth) {
    nodes++;
    const allowed = depth === maxK ? mask : (mask | (full - (2 ** k - 1)));
    if (best.length === KEEP && lowerBound(allowed) >= best[KEEP - 1].score) return;
    if (k === n || depth === maxK) { if (depth > 0) push(evalMask(mask)); return; }
    rec(k + 1, mask + 2 ** k, depth + 1);
    rec(k + 1, mask, depth);
  }
  const t0 = performance.now();
  rec(nF, 2 ** nF - 1, nF);
  const noOffer = prods.filter((p, i) => !perProd[i].length);
  const byFilter = noOffer.filter(p => S.offers.some(o => o.active && o.productId === p.id && vendorById(o.vendorId)?.active));
  return { best, evaluated, nodes, ms: Math.round(performance.now() - t0), total: prods.length, noOffer, byFilter, euUsed, euNone,
    fixedOff: fixedOff.map(vendorById), fixedUnused };
}

let recalcT = null;
function recalc() {
  if (!S.products.length) { $('#results').innerHTML = `<div class="card"><h2>Sin datos todavía</h2><p>La app no incluye la tabla de proveedores. En <b>Ajustes</b> escribe la clave de la actualización semanal o importa tu archivo .json. Los datos se guardan solo en este dispositivo.</p></div>`; return; }
  clearTimeout(recalcT);
  recalcT = setTimeout(() => { LAST = optimize(); renderResults(LAST); }, 60);
}

function bindPlan() {
  const onChange = () => { readPlanControls(); recalc(); };
  ['#maxPkg', '#minLevel', '#payMode', '#preferEU', '#euPct'].forEach(s => $(s).addEventListener('change', onChange));
  $$('.chan').forEach(c => c.addEventListener('change', onChange));
  $('#btnFixed').addEventListener('click', fixedSheet);
}
function readPlanControls() {
  const st = S.settings;
  st.maxPkg = Math.max(1, Math.min(10, parseInt($('#maxPkg').value) || 8));
  st.minLevel = $('#minLevel').value;
  st.channels = $$('.chan').filter(c => c.checked).map(c => c.value);
  st.payMode = $('#payMode').value;
  st.preferEU = $('#preferEU').checked;
  st.euPct = Math.max(0, Math.min(300, num($('#euPct').value) ?? 50));
  save(); renderCondSummary();
}
function renderPlanControls() {
  const st = S.settings;
  $('#maxPkg').value = st.maxPkg; $('#minLevel').value = st.minLevel;
  $$('.chan').forEach(c => c.checked = st.channels.includes(c.value));
  $('#payMode').value = st.payMode || 'any';
  $('#preferEU').checked = !!st.preferEU; $('#euPct').value = st.euPct ?? 50;
  $('#fixedChips').innerHTML = (st.fixed || []).map(id => vendorById(id)).filter(Boolean)
    .map(v => `<span class="chip">${esc(v.name)} <button class="x" data-unfix="${esc(v.id)}" aria-label="Quitar ${esc(v.name)}">✕</button></span>`).join('') || '<span class="hint">Ninguno</span>';
  $$('[data-unfix]').forEach(b => b.addEventListener('click', () => { st.fixed = st.fixed.filter(x => x !== b.dataset.unfix); save(); renderPlanControls(); recalc(); }));
  renderCondSummary();
}
function renderCondSummary() {
  const st = S.settings;
  const pay = { any: 'cualquier pago', noTransfer: 'sin transferencia ni cripto', cardOnly: 'solo tarjeta o PayPal' }[st.payMode];
  $('#condSummary').textContent = `${st.maxPkg} paquetes · nivel ${st.minLevel}${st.minLevel === 'A' ? '' : '+'} · ${pay}${st.preferEU ? ' · UE preferida' : ''}${st.fixed?.length ? ` · ${st.fixed.length} fijo(s)` : ''}`;
}
function fixedSheet() {
  const act = new Set(S.products.filter(p => p.active).map(p => p.id));
  const list = S.vendors.filter(v => S.offers.some(o => o.vendorId === v.id && o.active && act.has(o.productId)));
  sheet(`<h2>Proveedores fijos</h2><p class="hint">Todo lo que venda un proveedor fijo se le compra a él; el resto se optimiza. Útil si ya has decidido comprar en una tienda concreta.</p>
    <div class="checklist">${list.map(v => `<label class="inline"><input type="checkbox" value="${esc(v.id)}" ${S.settings.fixed.includes(v.id) ? 'checked' : ''}> ${esc(v.name)} <small class="hint">nivel ${esc(v.level)}${v.active ? '' : ' · desactivado'}</small></label>`).join('')}</div>
    <div class="actions"><button class="primary" id="fxOk">Aplicar</button><button class="ghost" data-close>Cancelar</button></div>`, d => {
    $('#fxOk', d).addEventListener('click', () => { S.settings.fixed = $$('input:checked', d).map(c => c.value); save(); d.close(); renderPlanControls(); recalc(); });
  });
}

/* ---------- mensajes de cotización ---------- */
const EN = [[/Retatrutida/g, 'Retatrutide'], [/Ivermectina/g, 'Ivermectin'], [/Dutasterida/g, 'Dutasteride'], [/Finasterida/g, 'Finasteride'], [/Dapoxetina/g, 'Dapoxetine'],
  [/Tadalafilo/g, 'Tadalafil'], [/Clomifeno/g, 'Clomiphene'], [/Minoxidil oral/g, 'Oral minoxidil'], [/viales/g, 'vials'], [/tabletas/g, 'tablets'], [/cápsulas/g, 'capsules'],
  [/tira de/g, 'strip of'], [/ o /g, ' or '], [/(\d),(\d)/g, '$1.$2']];
const toEN = s => EN.reduce((t, [a, b]) => t.replace(a, b), String(s));
function quoteText(o) {
  const india = /India/.test(o.v.country || '') && o.v.channel === 'b2b';
  const items = o.lines.map(l => ({ want: `${l.p.name}: ${l.p.target}${(l.p.qty || 1) > 1 ? ` (×${l.p.qty})` : ''}`, listing: l.o.desc }));
  const en = ['Hello,', '', 'I would like a quote for the following items, shipped to Bulgaria (EU):',
    ...items.map(i => `- ${toEN(i.want)} (your listing: ${toEN(i.listing)})`), '',
    'Could you please confirm:',
    `1. Unit price and total price${india ? ' for export (your listing shows a domestic price)' : ''}.`,
    '2. Shipping cost to Bulgaria and delivery time.',
    '3. Where the goods ship from (EU warehouse or another country).',
    '4. Accepted payment methods.',
    '5. Batch number and certificate of analysis (COA) for each item.', '', 'Thank you.'].join('\n');
  const es = ['Hola:', '', 'Quisiera un presupuesto de los siguientes artículos, con envío a Bulgaria (UE):',
    ...items.map(i => `- ${i.want} (vuestro anuncio: ${i.listing})`), '',
    '¿Podéis confirmarme?',
    `1. Precio por unidad y total${india ? ' para exportación (el anuncio muestra un precio nacional)' : ''}.`,
    '2. Gastos de envío a Bulgaria y plazo de entrega.',
    '3. Desde dónde se envía (almacén en la UE u otro país).',
    '4. Formas de pago aceptadas.',
    '5. Número de lote y certificado de análisis (COA) de cada artículo.', '', 'Gracias.'].join('\n');
  return { en, es };
}
function quoteSheet(o) {
  const { en, es } = quoteText(o), v = o.v;
  const wa = (v.whatsapp || '').replace(/[^\d]/g, '');
  sheet(`<h2>Pedir cotización · ${esc(v.name)}</h2>
    <p class="label">Mensaje en inglés</p><pre class="msg" id="msgEN">${esc(en)}</pre>
    <details><summary>Traducción al español</summary><pre class="msg">${esc(es)}</pre></details>
    <div class="actions wrap">
      <button class="primary" id="qCopy">Copiar mensaje</button>
      ${navigator.share ? '<button class="ghost" id="qShare">Compartir…</button>' : ''}
      <a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(en)}">WhatsApp${wa ? '' : ' (elegir contacto)'}</a>
      ${v.email ? `<a class="btn ghost" href="mailto:${esc(v.email)}?subject=${encodeURIComponent('Quote request — shipping to Bulgaria')}&body=${encodeURIComponent(en)}">Correo</a>` : ''}
      <button class="ghost" data-close>Cerrar</button></div>`, d => {
    $('#qCopy', d).addEventListener('click', async () => { try { await navigator.clipboard.writeText(en); toast('Mensaje copiado'); } catch (e) { toast('No se pudo copiar: selecciona el texto'); } });
    $('#qShare', d)?.addEventListener('click', () => navigator.share({ text: en }).catch(() => {}));
  });
}

function orderText(r) {
  const out = [];
  r.orders.forEach(o => {
    out.push(`== ${o.v.name} ==`);
    o.lines.forEach(l => out.push(`- ${l.p.name}: ${l.o.desc}${(l.p.qty || 1) > 1 ? ' ×' + l.p.qty : ''} — ${eur(l.cost)}`));
    out.push(`Subtotal ${eur(o.subtotal)}${o.coupon ? ' · cupón −' + eur(o.coupon) : ''} · envío ${o.ship ? eur(o.ship) + (o.shipEst ? ' (estimado)' : '') : 'gratis'}`);
    out.push('');
  });
  out.push(`TOTAL ${eur(r.total)}`);
  return out.join('\n');
}

function ordersHTML(r, ri) {
  return r.orders.map((o, oi) => {
    const v = o.v;
    return `<div class="vendor-order"><header><h3>${esc(v.name)}</h3><b>${eur(o.subtotal - o.coupon + o.ship)}</b></header>
      <div class="tags">${o.fixed ? '<span class="tag fix">Fijo</span>' : ''}<span class="tag">${esc(CHANNEL_LABEL[v.channel] || v.channel)}</span><span class="tag ${v.level === 'D' ? 'bad' : ''}">Nivel ${esc(v.level)}</span>${v.euWarehouse ? '<span class="tag">Almacén UE (declarado)</span>' : ''}${v.tests ? '<span class="tag ok">Con análisis independientes</span>' : ''}</div>
      <p class="pay"><b>Pago:</b> ${esc(v.payment || 'no publicado')}</p>
      ${v.notes ? `<p class="hint">${esc(v.notes)}</p>` : ''}${v.tests ? `<p class="hint"><b>Análisis:</b> ${esc(v.tests)}</p>` : ''}
      <table class="lines">${o.lines.map(l => `<tr><td>${esc(l.p.name)}<br><small class="hint">${esc(l.o.desc)}${(l.p.qty || 1) > 1 ? ' ×' + l.p.qty : ''}</small>${l.o.url ? `<br><a href="${esc(l.o.url)}" target="_blank" rel="noopener">Ver oferta ↗</a>` : ''}</td><td class="num">${eur(l.cost)}</td></tr>`).join('')}
      ${o.coupon ? `<tr><td>Cupón ${v.couponPct}%</td><td class="num">−${eur(o.coupon)}</td></tr>` : ''}
      <tr><td>Envío${o.shipEst ? ' (estimado)' : ''}</td><td class="num">${o.ship ? eur(o.ship) : 'gratis'}</td></tr></table>
      <div class="row wrap"><button class="ghost slim qBtn" data-r="${ri}" data-o="${oi}">Pedir cotización</button>${v.url ? `<a class="btn ghost slim" href="${esc(v.url)}" target="_blank" rel="noopener">Web ↗</a>` : ''}</div></div>`;
  }).join('');
}

function renderResults(res) {
  const box = $('#results');
  if (res.error) { box.innerHTML = `<div class="card warn"><p>${esc(res.error)}</p></div>`; return; }
  $('#calcInfo').textContent = `${res.evaluated.toLocaleString('es-ES')} combinaciones evaluadas en ${res.ms} ms. Óptimo exacto en precio de productos; el envío gratis y los pedidos mínimos se aplican sobre la asignación más barata.`;
  if (!res.best.length) { box.innerHTML = `<div class="card empty">No hay ninguna combinación válida con estas condiciones. Abre «Condiciones del plan» y permite más paquetes o más canales.</div>`; return; }
  const r = res.best[0];
  const warn = [];
  if (r.uncovered) warn.push(`<span class="tag bad">${r.uncovered} producto(s) sin cubrir con ${S.settings.maxPkg} paquetes</span>`);
  const notFilter = res.noOffer.filter(p => !res.byFilter.includes(p));
  if (notFilter.length) warn.push(`<span class="tag bad">Sin ninguna oferta activa: ${notFilter.map(p => esc(p.name)).join(', ')}</span>`);
  if (r.estShip) warn.push(`<span class="tag warn">${r.estShip} envío(s) estimado(s)</span>`);
  if (r.orders.some(o => o.v.channel === 'b2b')) warn.push(`<span class="tag warn">Incluye proveedores que piden presupuesto: el precio final hay que confirmarlo</span>`);
  if (res.fixedOff.length) warn.push(`<span class="tag warn">Fijos excluidos por las condiciones: ${res.fixedOff.map(v => esc(v.name)).join(', ')}</span>`);
  if (res.fixedUnused.length) warn.push(`<span class="tag warn">Fijos sin productos activos: ${res.fixedUnused.map(v => esc(v.name)).join(', ')}</span>`);
  let html = '';
  if (res.byFilter.length) html += `<div class="card warn"><h2>${res.byFilter.length} producto(s) fuera por los filtros</h2>
    <p>Las condiciones (pago, canales o nivel) excluyen a todos los proveedores de: <b>${res.byFilter.map(p => esc(p.name)).join(', ')}</b>.</p>
    <button class="primary" id="clearFilters">Quitar filtros</button></div>`;
  html += `<div class="card">
    <h2>Plan más barato</h2>
    <div class="total">${eur(r.total)}</div>
    <div class="kpis">
      <div class="kpi"><b>${r.orders.length}</b><span>paquetes</span></div>
      <div class="kpi"><b>${eur(r.total - r.shipT)}</b><span>productos</span></div>
      <div class="kpi"><b>${eur(r.shipT)}</b><span>envíos</span></div>
      <div class="kpi"><b>${eur(r.coupon)}</b><span>cupones</span></div>
    </div>
    <div class="tags">${warn.join('')}</div>`;
  if (S.settings.preferEU) html += `<p class="hint"><b>Almacén UE (hasta +${S.settings.euPct ?? 50} % sobre la referencia):</b> ${res.euUsed.length ? 'se usa oferta UE en ' + res.euUsed.map(p => esc(p.name)).join(', ') : 'ningún péptido tiene oferta UE dentro del techo'}.${res.euNone.length ? ' Sin oferta UE dentro del techo: ' + res.euNone.map(p => esc(p.name)).join(', ') + '.' : ''} El almacén es el declarado por el vendedor, no confirmado.</p>`;
  html += ordersHTML(r, 0) + `<div class="row" style="margin-top:.8rem"><button class="ghost copyPlan" data-i="0">Copiar pedido</button></div></div>`;
  if (res.best.length > 1) {
    html += `<div class="card"><h2>Alternativas</h2>${res.best.slice(1).map((a, k) => {
      const diff = a.uncovered > r.uncovered ? `<span class="tag bad">cubre ${a.uncovered - r.uncovered} producto(s) menos</span>` : `<small class="hint">(${a.total >= r.total ? '+' : '−'}${eur(Math.abs(a.total - r.total))})</small>`;
      return `<details class="altd"><summary><span class="name">${a.orders.map(o => esc(o.v.name.split(' (')[0])).join(' + ')}</span><span class="best">${eur(a.total)}</span><span class="diff">${diff}</span></summary>
        <div class="body">${ordersHTML(a, k + 1)}<div class="row" style="margin-top:.8rem"><button class="ghost copyPlan" data-i="${k + 1}">Copiar este pedido</button></div></div></details>`;
    }).join('')}</div>`;
  }
  box.innerHTML = html;
  $('#clearFilters')?.addEventListener('click', () => {
    Object.assign(S.settings, { payMode: 'any', minLevel: 'C', channels: [...DEFAULT_SETTINGS.channels] });
    save(); renderPlanControls(); recalc(); toast('Filtros quitados');
  });
  $$('.copyPlan').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(orderText(res.best[+b.dataset.i])); toast('Pedido copiado'); } catch (e) { toast('No se pudo copiar'); }
  }));
  $$('.qBtn').forEach(b => b.addEventListener('click', () => quoteSheet(res.best[+b.dataset.r].orders[+b.dataset.o])));
}

/* ---------- productos ---------- */
function renderProducts() {
  const list = $('#productList');
  if (!S.products.length) { list.innerHTML = '<div class="empty">Sin productos.</div>'; return; }
  const open = new Set($$('details.prod[open]').map(d => d.dataset.id));
  list.innerHTML = S.products.map(p => {
    const offs = S.offers.filter(o => o.productId === p.id);
    const act = offs.filter(o => o.active && vendorById(o.vendorId)?.active);
    const min = act.length ? Math.min(...act.map(o => offerEUR(o) * (p.qty || 1))) : null;
    return `<details class="prod" data-id="${p.id}" ${open.has(String(p.id)) ? 'open' : ''}>
      <summary><input type="checkbox" class="pActive" data-id="${p.id}" ${p.active ? 'checked' : ''} aria-label="Activar ${esc(p.name)}">
        <span class="name">${esc(p.name)}<small>${esc(p.target)} · ${esc(p.category)}</small></span>
        <span class="best">${min != null ? 'desde ' + eur(min) : 'sin oferta'}</span></summary>
      <div class="body">
        <div class="grid2">
          <label>Objetivo<input type="text" class="pTarget" data-id="${p.id}" value="${esc(p.target)}"></label>
          <label>Lotes del objetivo<input type="number" min="1" step="1" class="pQty" data-id="${p.id}" value="${p.qty || 1}" inputmode="numeric"></label>
        </div>
        ${offs.sort((a, b) => offerEUR(a) - offerEUR(b)).map(o => offerRow(o, p)).join('') || '<p class="hint">Sin ofertas.</p>'}
        <button class="ghost slim addOffer" data-id="${p.id}">+ Añadir oferta</button>
        <div class="newOffer" data-id="${p.id}"></div>
      </div></details>`;
  }).join('');
  bindProductEvents();
}
function offerRow(o, p) {
  const v = vendorById(o.vendorId);
  return `<div class="offer" data-oid="${o.id}">
    <input type="checkbox" class="oActive" data-oid="${o.id}" ${o.active ? 'checked' : ''} aria-label="Usar oferta">
    <div><b>${esc(v ? v.name : o.vendorId)}</b>${v && !v.active ? ' <span class="tag bad">proveedor desactivado</span>' : ''}<div class="meta">${esc(o.desc)} · ${o.price} ${esc(o.currency)} × ${o.units} · ${esc(o.status || '')}${o.url ? ` · <a href="${esc(o.url)}" target="_blank" rel="noopener">fuente</a>` : ''}</div></div>
    <div class="side"><span class="eur">${eur(offerEUR(o) * (p.qty || 1))}</span><button class="mini oEdit" data-oid="${o.id}">Editar</button></div>
    <div class="edit"><div class="grid3">
      <label>Precio<input type="number" step="0.01" class="oPrice" data-oid="${o.id}" value="${o.price}" inputmode="decimal"></label>
      <label>Divisa<select class="oCur" data-oid="${o.id}">${Object.keys(S.fx).map(c => `<option ${c === o.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>Unidades a comprar<input type="number" step="0.01" min="0" class="oUnits" data-oid="${o.id}" value="${o.units}" inputmode="decimal"></label>
    </div>
    <label>Descripción<input type="text" class="oDesc" data-oid="${o.id}" value="${esc(o.desc)}"></label>
    <div class="row"><button class="mini oDel" data-oid="${o.id}">Eliminar oferta</button></div></div>
  </div>`;
}
function bindProductEvents() {
  $$('.pActive').forEach(c => { c.addEventListener('click', e => e.stopPropagation()); c.addEventListener('change', () => { productById(+c.dataset.id).active = c.checked; save(); }); });
  $$('.pTarget').forEach(i => i.addEventListener('change', () => { const p = productById(+i.dataset.id); p.target = i.value; p.targetUser = true; save(); renderProducts(); }));
  $$('.pQty').forEach(i => i.addEventListener('change', () => { productById(+i.dataset.id).qty = Math.max(1, parseInt(i.value) || 1); save(); renderProducts(); }));
  $$('.oActive').forEach(c => c.addEventListener('change', () => { S.offers.find(o => o.id === c.dataset.oid).active = c.checked; save(); renderProducts(); }));
  $$('.oEdit').forEach(b => b.addEventListener('click', () => b.closest('.offer').classList.toggle('editing')));
  const upd = (sel, key, fn) => $$(sel).forEach(i => i.addEventListener('change', () => { const o = S.offers.find(x => x.id === i.dataset.oid); const val = fn(i.value); if (val == null) return toast('Valor no válido'); o[key] = val; save(); renderProducts(); }));
  upd('.oPrice', 'price', num); upd('.oUnits', 'units', num); upd('.oCur', 'currency', v => v); upd('.oDesc', 'desc', v => v);
  $$('.oDel').forEach(b => b.addEventListener('click', () => { if (!confirm('¿Eliminar esta oferta?')) return; S.offers = S.offers.filter(o => o.id !== b.dataset.oid); save(); renderProducts(); }));
  $$('.addOffer').forEach(b => b.addEventListener('click', () => {
    const box = $(`.newOffer[data-id="${b.dataset.id}"]`);
    box.innerHTML = `<div class="card" style="margin-top:8px"><div class="grid2">
      <label>Proveedor<select class="nV">${S.vendors.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select></label>
      <label>Descripción<input type="text" class="nD" placeholder="p. ej. 40 mg × 300"></label>
      <label>Precio<input type="number" step="0.01" class="nP" inputmode="decimal"></label>
      <label>Divisa<select class="nC">${Object.keys(S.fx).map(c => `<option>${c}</option>`).join('')}</select></label>
      <label>Unidades a comprar<input type="number" step="0.01" class="nU" value="1" inputmode="decimal"></label>
      <label>URL<input type="url" class="nL" placeholder="https://"></label></div>
      <button class="primary nSave">Guardar oferta</button></div>`;
    $('.nSave', box).addEventListener('click', () => {
      const price = num($('.nP', box).value), units = num($('.nU', box).value);
      if (price == null || units == null) return toast('Indica precio y unidades');
      S.offers.push({ id: 'u' + Date.now(), productId: +b.dataset.id, vendorId: $('.nV', box).value, desc: $('.nD', box).value || '—', price, currency: $('.nC', box).value, units, status: 'Añadida por el usuario', url: $('.nL', box).value, active: true });
      save(); renderProducts(); toast('Oferta añadida');
    });
  }));
}
$('#allOn')?.addEventListener('click', () => { S.products.forEach(p => p.active = true); save(); renderProducts(); });
$('#allOff')?.addEventListener('click', () => { S.products.forEach(p => p.active = false); save(); renderProducts(); });

/* ---------- proveedores ---------- */
function renderVendors() {
  const list = $('#vendorList');
  const open = new Set($$('details.vend[open]').map(d => d.dataset.id));
  list.innerHTML = S.vendors.map(v => {
    const n = S.offers.filter(o => o.vendorId === v.id).length;
    const sh = vendorShipping(v);
    return `<details class="vend" data-id="${esc(v.id)}" ${open.has(v.id) ? 'open' : ''}>
      <summary><input type="checkbox" class="vActive" data-id="${esc(v.id)}" ${v.active ? 'checked' : ''} aria-label="Activar ${esc(v.name)}">
        <span class="name">${esc(v.name)}<small>${esc(CHANNEL_LABEL[v.channel] || v.channel)} · nivel ${esc(v.level)} · ${n} oferta(s)${v.tests ? ' · con análisis' : ''}</small></span>
        <span class="best">${sh.value ? eur(sh.value) + (sh.est ? '*' : '') : 'envío 0'}</span></summary>
      <div class="body">
        <div class="grid3">
          <label>Envío (€, vacío = desconocido)<input type="number" step="0.01" class="vf" data-k="shipping" data-id="${esc(v.id)}" value="${v.shipping ?? ''}" inputmode="decimal"></label>
          <label>Envío estimado (€)<input type="number" step="0.01" class="vf" data-k="shippingEstimate" data-id="${esc(v.id)}" value="${v.shippingEstimate ?? ''}" inputmode="decimal"></label>
          <label>Envío gratis desde (€)<input type="number" step="0.01" class="vf" data-k="freeFrom" data-id="${esc(v.id)}" value="${v.freeFrom ?? ''}" inputmode="decimal"></label>
          <label>Pedido mínimo (€)<input type="number" step="0.01" class="vf" data-k="minOrder" data-id="${esc(v.id)}" value="${v.minOrder ?? ''}" inputmode="decimal"></label>
          <label>Cupón (%)<input type="number" step="1" class="vf" data-k="couponPct" data-id="${esc(v.id)}" value="${v.couponPct ?? 0}" inputmode="numeric"></label>
          <label>Nivel<select class="vs" data-k="level" data-id="${esc(v.id)}">${['A', 'B', 'C', 'D'].map(l => `<option ${l === v.level ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="grid2">
          <label>Canal<select class="vs" data-k="channel" data-id="${esc(v.id)}">${Object.entries(CHANNEL_LABEL).map(([k, l]) => `<option value="${k}" ${k === v.channel ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Pago<input type="text" class="vs" data-k="payment" data-id="${esc(v.id)}" value="${esc(v.payment || '')}"></label>
          <label>WhatsApp (con prefijo)<input type="tel" class="vs" data-k="whatsapp" data-id="${esc(v.id)}" value="${esc(v.whatsapp || '')}" placeholder="+852…"></label>
          <label>Correo<input type="email" class="vs" data-k="email" data-id="${esc(v.id)}" value="${esc(v.email || '')}"></label>
        </div>
        <label class="inline"><input type="checkbox" class="vEU" data-id="${esc(v.id)}" ${v.euWarehouse ? 'checked' : ''}> Almacén en la UE (declarado por el vendedor)</label>
        <label>Análisis independientes (p. ej. «Finnrick: retatrutida 3/3, 2026»)<input type="text" class="vs" data-k="tests" data-id="${esc(v.id)}" value="${esc(v.tests || '')}"></label>
        <label>Notas<input type="text" class="vs" data-k="notes" data-id="${esc(v.id)}" value="${esc(v.notes || '')}"></label>
        ${v.url ? `<p class="hint"><a href="${esc(v.url)}" target="_blank" rel="noopener">Abrir web del proveedor</a></p>` : ''}
      </div></details>`;
  }).join('');
  $$('.vActive').forEach(c => { c.addEventListener('click', e => e.stopPropagation()); c.addEventListener('change', () => { vendorById(c.dataset.id).active = c.checked; save(); }); });
  $$('.vf').forEach(i => i.addEventListener('change', () => { const v = vendorById(i.dataset.id); v[i.dataset.k] = i.value === '' ? (i.dataset.k === 'couponPct' ? 0 : null) : num(i.value); save(); renderVendors(); }));
  $$('.vs').forEach(i => i.addEventListener('change', () => { vendorById(i.dataset.id)[i.dataset.k] = i.value.trim(); save(); renderVendors(); }));
  $$('.vEU').forEach(c => c.addEventListener('change', () => { vendorById(c.dataset.id).euWarehouse = c.checked; save(); }));
}
$('#addVendor')?.addEventListener('click', () => {
  const name = prompt('Nombre del proveedor'); if (!name) return;
  S.vendors.push({ id: 'v' + Date.now(), name, country: '', channel: 'online', payment: 'Por confirmar', shipping: null, shippingEstimate: 30, freeFrom: null, minOrder: null, couponPct: 0, level: 'C', notes: 'Añadido por el usuario', url: '', active: true, user: true });
  save(); renderVendors(); toast('Proveedor añadido');
});

/* ---------- datos: importar conservando lo elegido ---------- */
function validData(d) { return d && Array.isArray(d.products) && Array.isArray(d.vendors) && Array.isArray(d.offers); }
// Datos nuevos + tus selecciones: productos activos y cantidades, ofertas desactivadas, tus ofertas y proveedores añadidos, condiciones.
function mergeKeep(prev, d) {
  if (prev && prev.products.length) {
    d.products.forEach(p => { const q = prev.products.find(x => x.id === p.id); if (q) { p.active = q.active; p.qty = q.qty; if (q.targetUser) { p.target = q.target; p.targetUser = true; } } });
    d.offers.forEach(o => { const q = prev.offers.find(x => x.productId === o.productId && x.vendorId === o.vendorId && x.desc === o.desc); if (q) o.active = q.active; });
    prev.offers.filter(o => String(o.id).startsWith('u') && !d.offers.some(x => x.id === o.id)).forEach(o => d.offers.push(o));
    // solo se conservan los proveedores añadidos por el usuario; los retirados de los datos no vuelven
    const mine = v => v.user || /^v\d{12,}$/.test(v.id);
    prev.vendors.filter(v => mine(v) && !d.vendors.some(x => x.id === v.id)).forEach(v => d.vendors.push(v));
    if (d.settings === undefined && prev.settings?.fixed) prev.settings.fixed = prev.settings.fixed.filter(id => d.vendors.some(v => v.id === id));
    d.vendors.forEach(v => { const q = prev.vendors.find(x => x.id === v.id); if (q) for (const k of ['whatsapp', 'email']) if (q[k] && !v[k]) v[k] = q[k]; });
  }
  d.settings = Object.assign({}, DEFAULT_SETTINGS, prev?.settings || {});
  return d;
}

/* ---------- actualización semanal (datos cifrados junto a la app) ---------- */
function syncState() { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch (e) { return {}; } }
function setSync(p) { const s = Object.assign(syncState(), p); try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) {} renderSyncInfo(); return s; }
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decryptPack(pack, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(pack.salt), iterations: pack.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(pack.iv) }, key, b64(pack.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function checkUpdate({ force = false } = {}) {
  const sy = syncState();
  if (!sy.key || !window.crypto?.subtle) return false;
  const now = new Date().toISOString();
  let pack;
  try {
    const r = await fetch('datos.enc?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? 'todavía no hay datos publicados' : 'error ' + r.status);
    pack = await r.json();
  } catch (e) { setSync({ lastCheck: now, lastError: 'No se pudo descargar: ' + e.message }); return false; }
  if (!force && pack.updated && pack.updated === sy.applied && S.products.length) { setSync({ lastCheck: now, lastError: '' }); return false; }
  let d;
  try { d = await decryptPack(pack, sy.key); if (!validData(d)) throw new Error('formato'); }
  catch (e) { setSync({ lastCheck: now, lastError: 'Clave incorrecta o datos dañados' }); toast('Actualización: clave incorrecta'); return false; }
  S = mergeKeep(S, d); save();
  setSync({ applied: pack.updated, lastCheck: now, lastError: '', changes: d.changes || [], changesSeen: false, dataDate: d.dataDate });
  renderAll(); toast(`Datos actualizados (${d.dataDate})`);
  return true;
}
function renderSyncInfo() {
  const s = syncState(), el = $('#syncInfo'); if (!el) return;
  const f = x => x ? new Date(x).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  el.innerHTML = !s.key ? 'Sin clave: la app no se actualiza sola.' : `Clave guardada en este dispositivo. Datos aplicados: <b>${esc(s.dataDate || '—')}</b> · última comprobación: ${f(s.lastCheck)}${s.lastError ? `<br><span class="bad-txt">${esc(s.lastError)}</span>` : ''}`;
}
function renderUpdateNote() {
  const s = syncState(), box = $('#updateNote');
  if (!s.changes?.length || s.changesSeen) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card info"><h2>Novedades de los datos (${esc(s.dataDate || '')})</h2><ul>${s.changes.slice(0, 12).map(c => `<li>${esc(typeof c === 'string' ? c : c.text)}</li>`).join('')}</ul>
    ${s.changes.length > 12 ? `<p class="hint">y ${s.changes.length - 12} más.</p>` : ''}<button class="ghost slim" id="chgOk">Entendido</button></div>`;
  $('#chgOk').addEventListener('click', () => { setSync({ changesSeen: true }); renderUpdateNote(); });
}
function bindSync() {
  $('#btnSyncSave').addEventListener('click', async () => {
    const k = $('#syncKey').value.trim();
    if (!k) return toast('Escribe la clave');
    setSync({ key: k, applied: '' }); $('#syncKey').value = '';
    toast('Comprobando…');
    if (await checkUpdate({ force: true })) showTab('plan');
  });
  $('#btnSyncForget').addEventListener('click', () => { setSync({ key: '', applied: '' }); toast('Clave olvidada'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { const s = syncState(); if (s.key && (!s.lastCheck || Date.now() - Date.parse(s.lastCheck) > 6 * 3600e3)) checkUpdate(); } });
  renderSyncInfo();
}

/* ---------- ajustes ---------- */
function renderSettings() {
  $('#fxUSD').value = S.fx.USD; $('#fxINR').value = S.fx.INR;
  $('#excludedInfo').textContent = (S.excluded || []).length ? 'Excluidos: ' + S.excluded.join(' · ') : '';
}
function uiPrefs() { try { return JSON.parse(localStorage.getItem('optcompras-ui') || '{}'); } catch (e) { return {}; } }
function setUI(k, v) { const u = uiPrefs(); u[k] = v; try { localStorage.setItem('optcompras-ui', JSON.stringify(u)); } catch (e) {} applyUI(); }
function applyUI() {
  const u = uiPrefs(); const el = document.documentElement;
  el.dataset.size = u.size || 'grande'; el.dataset.contrast = u.contrast || 'normal';
  $$('#sizeSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.size === el.dataset.size ? 'true' : 'false'));
  $('#contrastHigh').checked = el.dataset.contrast === 'alto';
}
function bindSettings() {
  $$('#sizeSeg button').forEach(b => b.addEventListener('click', () => setUI('size', b.dataset.size)));
  $('#contrastHigh').addEventListener('change', e => setUI('contrast', e.target.checked ? 'alto' : 'normal'));
  applyUI();
  ['USD', 'INR'].forEach(c => $('#fx' + c).addEventListener('change', e => { const v = num(e.target.value); if (!v) return toast('Tipo no válido'); S.fx[c] = v; save(); renderProducts(); toast('Tipo de cambio actualizado'); }));
  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `optimizador-compras-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#fileImport').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!validData(d)) throw new Error('formato');
      const keep = S.products.length && confirm('¿Conservar tus selecciones (productos activos, cantidades, ofertas desactivadas y condiciones)? Pulsa «Cancelar» para usar el archivo tal cual.');
      S = keep ? mergeKeep(S, d) : mergeKeep(null, d);
      save(); renderAll(); toast('Datos importados');
    } catch (err) { toast('Archivo no válido'); }
    e.target.value = '';
  });
}

/* ---------- instalación (PWA) ---------- */
let deferredInstall = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (!isStandalone()) $('#btnInstall').hidden = false; });
window.addEventListener('appinstalled', () => { deferredInstall = null; $('#btnInstall').hidden = true; toast('App instalada'); });
$('#btnInstall').addEventListener('click', async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    const r = await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null;
    if (r && r.outcome === 'accepted') $('#btnInstall').hidden = true;
  } else sheet(`<h2>Cómo instalar</h2><ul><li><b>Chrome (Android):</b> menú <b>⋮</b> → <b>Instalar app</b> o <b>Añadir a pantalla de inicio</b>.</li>
    <li><b>Samsung Internet:</b> menú <b>≡</b> → <b>Añadir página a</b> → <b>Pantalla de inicio</b>.</li><li><b>iPhone (Safari):</b> <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>.</li></ul>
    <div class="actions"><button class="ghost" data-close>Cerrar</button></div>`);
});

init();
