/* ==========================================================================
   OEE demo — MES pages (MES mode). Logic lives in mes.js. Like ops.js, these
   pages use app.js helpers that are looked up when a page renders.
   Every page checks its own menu key; links between MES pages check the
   target key too, so an MES-only role never lands outside MES.
   ========================================================================== */
'use strict';

const moPill = o => pill(MO_STATUS[o.status][1], MO_STATUS[o.status][0]);
const opPill = st => pill(OP_STATUS[st][1], OP_STATUS[st][0]);
const lotPill = l => pill(LOT_STATUS[l.status][1], LOT_STATUS[l.status][0]);
const mesCan = key => menuLevel(key) !== 'deny';
const canOrder = o => canEdit('mes_order') && assetLevel(o.lineId) === 'edit';
const lotVisible = l => l.kind === 'raw' || (Mes.order(l.orderId) && Mes.visibleOrder(Mes.order(l.orderId)));
const lotLink = l => !l ? '–' : mesCan('mes_trace') ? `<button class="link mono" data-act="mes-trace" data-arg="${l.id}">${esc(l.no)}</button>` : `<span class="mono">${esc(l.no)}</span>`;
const moLink = o => mesCan('mes_order') ? `<button class="link mono" data-act="mes-view" data-arg="${o.id}">${esc(o.no)}</button>` : `<span class="mono">${esc(o.no)}</span>`;
const dt = t => `<span class="mono">${fmtDT(t)}</span>`;
const pctBar = v => `<div style="display:flex;align-items:center;gap:8px;min-width:120px">${meter(v, v >= 1 ? 'good' : '')}<span class="mono" style="font-size:12px">${fmtPct(v)}</span></div>`;
const mName = mid => esc(DB.asset(mid)?.name || mid);
const orderHue = o => `hsl(${Math.round((parseInt(o.no.slice(-3), 10) || hashStr(o.no)) * 137.5) % 360} 55% 50%)`;
function mesOrders() { return Mes.c.orders.filter(o => Mes.visibleOrder(o) && o.ops.some(op => DB.isUnder(op.mid, S.assetId) || DB.isUnder(S.assetId, o.lineId))); }
function mesKey(arg) { const [oid, k] = arg.split(':'); return { o: Mes.order(oid), k: +k }; }

/* ---------- overview ---------- */
function pMesOverview() {
  const now = Date.now(); const os = mesOrders(); const { eta } = Mes.plan(now);
  const act = os.filter(mesActive); const late = act.filter(o => eta.get(o.id) > o.due);
  const reps = Mes.c.reports.filter(r => r.at >= now - 7 * DAY && DB.isUnder(r.mid, S.assetId) && assetLevel(r.mid) !== 'deny');
  const g = reps.reduce((a, r) => a + r.good, 0), sc = reps.reduce((a, r) => a + r.scrap, 0);
  const ncrs = Mes.c.ncrs.filter(n => n.status === 'open' && lotVisible(Mes.lot(n.lotId)));
  const held = Mes.c.lots.filter(l => l.status === 'hold' && lotVisible(l));
  const list = os.filter(o => mesActive(o) || o.status === 'planned').sort((a, b) => a.due - b.due);
  const load = Mes.loadHours(now);
  const wc = opMachines().map(m => {
    const mine = Mes.c.orders.filter(mesActive).flatMap(o => o.ops.map((op, k) => ({ o, op, k }))).filter(x => x.op.mid === m.id && x.op.status !== 'done');
    const run = mine.find(x => x.op.status === 'running' || x.op.status === 'paused');
    return { id: m.id, m, run, queue: mine.length - (run ? 1 : 0), load: load[m.id] || 0 };
  });
  const mats = Mes.c.materials.map(m => { const s = Mes.stock(m.id); const res = Mes.reserved(m.id); return { id: m.id, m, ...s, res, free: r3(s.avail - res) }; }).filter(x => x.avail < x.m.min || x.free < 0);
  return head('MES Overview', '', 'Production orders, work centers and material for the selected asset.') +
    `<div class="grid g4" style="margin-bottom:20px">
      ${statTile('Active orders', act.length, `${os.filter(o => o.status === 'planned').length} planned, not released yet`, '--accent')}
      ${statTile('At risk', late.length, 'estimated finish after the due date', late.length ? '--crit' : '--good')}
      ${statTile('Yield, 7 days', fmtPct(g + sc ? g / (g + sc) : null), `${fmtNum(g)} good · ${fmtNum(sc)} scrap`, Charts.levelVar(g + sc ? g / (g + sc) : null))}
      ${statTile('Open NCR', ncrs.length, `${held.length} lot${held.length === 1 ? '' : 's'} on hold`, ncrs.length ? '--warn' : '--good')}</div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Order progress</h3></div>${table('mes-ov', [
      { h: 'Order', f: o => moLink(o) }, { h: 'Product', f: o => esc(Mes.product(o.productId).name) }, { h: 'Qty', cls: 'num', f: o => fmtNum(o.qty) },
      { h: 'Progress', f: o => pctBar(Mes.progress(o)) }, { h: 'Now at', f: o => { const op = Mes.currentOp(o); return op && mesActive(o) ? `${op.seq} ${esc(op.name)} · ${mName(op.mid)}` : '–'; } },
      { h: 'Due', f: o => dt(o.due) }, { h: 'Est. finish', f: o => eta.has(o.id) ? `<span class="mono" style="${eta.get(o.id) > o.due ? 'color:var(--crit)' : ''}">${fmtDT(eta.get(o.id))}</span>` : '–' },
      { h: 'Status', f: o => moPill(o) }], list, { pageSize: 8, empty: 'No open orders here.' })}</div>
    <div class="grid g-1-2" style="margin-bottom:20px">
      <div class="card"><div class="card-head"><h3>Material alerts</h3></div>${table('mes-mat-al', [
        { h: 'Material', f: x => `<span class="mono" style="white-space:nowrap">${esc(x.m.code)}</span><br><span style="font-size:12px;color:var(--muted)">${esc(x.m.name)}</span>` },
        { h: 'Available', cls: 'num', f: x => `${fmtNum(x.avail, 1)} ${esc(x.m.unit)}` }, { h: 'Reserved', cls: 'num', f: x => fmtNum(x.res, 1) },
        { h: '', f: x => x.free < 0 ? pill('crit', 'Short') : pill('warn', 'Below min') }], mats, { pageSize: 6, empty: 'All materials above minimum stock.' })}</div>
      <div class="card"><div class="card-head"><h3>Work centers</h3></div>${table('mes-wc', [
        { h: 'Machine', f: r => esc(r.m.name) }, { h: 'Machine state', f: r => statusPill(Sim.status(r.m.id)) },
        { h: 'Running', f: r => r.run ? `<span class="mono">${esc(r.run.o.no)}</span> · ${r.run.op.seq} ${esc(r.run.op.name)} ${r.run.op.status === 'paused' ? pill('warn', 'Paused') : ''}` : '<span style="color:var(--faint)">Idle</span>' },
        { h: 'Queue', cls: 'num', f: r => fmtNum(r.queue) }, { h: 'Load', cls: 'num', f: r => `${fmtNum(r.load, 1)} h` }], wc, { pageSize: 8, empty: 'No machines here.' })}</div></div>`;
}

/* ---------- production order ---------- */
function pMesOrder() {
  const ed = canEdit('mes_order'); const { eta } = Mes.plan();
  const all = mesOrders().sort((a, b) => b.createdAt - a.createdAt);
  const f = S.mesOrdF; const list = f === 'active' ? all.filter(o => mesActive(o) || o.status === 'planned') : f === 'done' ? all.filter(o => !mesActive(o) && o.status !== 'planned') : all;
  const btn = (a, o, l, cls = '') => `<button class="btn sm ${cls}" data-act="${a}" data-arg="${o.id}">${l}</button>`;
  const acts = o => !canOrder(o) ? '' : `<div class="acts">${o.status === 'planned' ? btn('mes-release', o, 'Release', 'primary') : ''}${o.status === 'completed' ? btn('mes-close', o, 'Close') : ''}${o.status === 'planned' || (mesActive(o) && !o.startedAt) ? btn('mes-cancel', o, 'Cancel', 'danger') : ''}</div>`;
  EXPORTS.mo = () => exportCSV('Production_Orders', ['Order', 'Product', 'Customer', 'Qty', 'Good', 'Due', 'Priority', 'Status', 'Created', 'Completed'], list.map(o => [o.no, Mes.product(o.productId).name, o.customer, o.qty, o.ops[o.ops.length - 1].good, fmtDT(o.due), o.priority, MO_STATUS[o.status][0], fmtDT(o.createdAt), fmtDT(o.completedAt)]));
  return head('Production Order', `${segBtns('mes-ordf', f, [['active', 'Open'], ['done', 'Finished'], ['all', 'All']])}${ed ? `<button class="btn primary" data-act="mes-new">${ic('plus')}New order</button>` : ''}`, 'Plan an order from a product routing, check material, then release it to the shop floor.') +
    `<div class="card"><div class="card-head"><h3>Orders</h3>${csvBtn('export', 'mo')}</div>${table('mes-mo', [
      { h: 'Order', f: o => moLink(o) }, { h: 'Product', f: o => esc(Mes.product(o.productId).name) }, { h: 'Customer', f: o => esc(o.customer || '–') },
      { h: 'Qty', cls: 'num', f: o => fmtNum(o.qty) }, { h: 'Due', f: o => dt(o.due) }, { h: 'Priority', f: o => prioPill(o.priority) }, { h: 'Status', f: o => moPill(o) },
      { h: 'Progress', f: o => pctBar(Mes.progress(o)) }, { h: 'Est. finish', f: o => eta.has(o.id) ? `<span class="mono" style="${eta.get(o.id) > o.due ? 'color:var(--crit)' : ''}">${fmtDT(eta.get(o.id))}</span>` : '–' },
      { h: 'Action', cls: 'num', f: acts }], list, { pageSize: 10, empty: 'No orders here.' })}</div>`;
}
function mesOrderForm() {
  const ps = Mes.c.products.filter(p => DB.asset(p.lineId) && assetLevel(p.lineId) === 'edit');
  if (!ps.length) return toast('You cannot plan orders for any line in your asset access.', 'warn');
  openModal({
    title: 'New production order', wide: true, saveLabel: 'Create',
    body: row('Product', `<select class="input" id="mo-p">${ps.map(p => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)} (${esc(DB.asset(p.lineId).name)})</option>`).join('')}</select>`, 'mo-p', true) +
      row('Quantity', `<input class="input" id="mo-q" type="number" min="1" step="1" value="500" style="width:140px">`, 'mo-q', true) +
      row('Due', `<input class="input" type="datetime-local" id="mo-due" value="${toLocalInput(startOfDay(Date.now()) + 3 * DAY + 17 * HOUR)}" style="width:auto">`, 'mo-due', true) +
      row('Priority', `<select class="input" id="mo-prio">${Object.entries(WO_PRIO).map(([k, [l]]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${l}</option>`).join('')}</select>`) +
      row('Customer', `<input class="input" id="mo-cust">`) + row('Note', `<textarea class="input" id="mo-note" rows="2"></textarea>`) +
      row('', `<label class="check"><input type="checkbox" id="mo-rel" checked> Release now if all material is available</label>`),
    onSave: () => {
      const d = { productId: fv('mo-p'), qty: Math.round(+fv('mo-q')), due: new Date(fv('mo-due')).getTime(), priority: fv('mo-prio'), customer: fv('mo-cust'), note: fv('mo-note') };
      let ok = setErr('mo-q', d.qty > 0 ? '' : 'Enter a quantity above 0.');
      ok = setErr('mo-due', isFinite(d.due) ? (d.due < Date.now() ? 'The due date is in the past.' : '') : 'Choose a due date.') && ok;
      if (!ok) return;
      const o = Mes.createOrder(d, S.user.username); let msg = `${esc(o.no)} created.`; let kind = 'good';
      if (document.getElementById('mo-rel').checked) {
        const sh = Mes.shortages(o);
        if (sh.length) { msg += ` Kept as planned, short of ${sh.map(n => esc(Mes.material(n.matId).name)).join(', ')}.`; kind = 'warn'; } else { Mes.release(o, S.user.username); msg = `${esc(o.no)} created and released.`; }
      }
      DB.save(); closeModal(); toast(msg, kind); render();
    },
  });
}
function mesRelease(o) {
  const sh = Mes.shortages(o);
  if (!sh.length) { Mes.release(o, S.user.username); DB.save(); toast(`${esc(o.no)} released to the shop floor.`, 'good'); return render(); }
  openModal({
    title: `Cannot release ${o.no}`, wide: true,
    body: `<p style="margin:0;color:var(--muted)">Not enough free material. Stock already reserved by released orders is not counted. Receive material or reduce the quantity first.</p>
      <div class="table-wrap"><table><thead><tr><th>Material</th><th class="num">Needed</th><th class="num">Free</th><th class="num">Short</th></tr></thead><tbody>${sh.map(n => { const m = Mes.material(n.matId); return `<tr><td><span class="mono">${esc(m.code)}</span> ${esc(m.name)}</td><td class="num">${fmtNum(n.left, 1)} ${esc(m.unit)}</td><td class="num">${fmtNum(Math.max(0, n.free), 1)}</td><td class="num" style="color:var(--crit)">${fmtNum(n.left - Math.max(0, n.free), 1)}</td></tr>`; }).join('')}</tbody></table></div>`,
    foot: `<button class="btn" data-act="modal-close" type="button">Close</button>${canEdit('mes_material') ? `<button class="btn primary" data-act="mes-recv" data-arg="${sh[0].matId}" type="button">Receive material</button>` : ''}`,
  });
}
function mesOrderView(o) {
  const p = Mes.product(o.productId); const { eta } = Mes.plan();
  const lots = Mes.c.lots.filter(l => l.orderId === o.id);
  const ev = Mes.c.events.filter(e => e.orderId === o.id).sort((a, b) => b.at - a.at).slice(0, 14);
  const th = h => `<thead><tr>${h.map(x => `<th class="${x[1] || ''}">${x[0]}</th>`).join('')}</tr></thead>`;
  openModal({
    title: `${o.no} · ${p.name}`, wide: true,
    body: kvrow('Status', `${moPill(o)} ${prioPill(o.priority)}`) + kvrow('Quantity', `${fmtNum(o.qty)} ${esc(p.unit)} · finished good ${fmtNum(o.ops[o.ops.length - 1].good)}`) + kvrow('Line', esc(DB.path(o.lineId))) +
      kvrow('Customer', esc(o.customer || '–')) + kvrow('Due', `${dt(o.due)}${eta.has(o.id) ? ` · est. finish <span class="mono" style="${eta.get(o.id) > o.due ? 'color:var(--crit)' : ''}">${fmtDT(eta.get(o.id))}</span>` : ''}`) +
      kvrow('Created', `${dt(o.createdAt)} by ${esc(userName(o.createdBy))}`) + (o.releasedAt ? kvrow('Released', dt(o.releasedAt)) : '') + (o.note ? kvrow('Note', esc(o.note)) : '') +
      `<h3 style="font-size:13.5px;margin:14px 0 8px">Operations</h3><div class="table-wrap"><table>${th([['Op'], ['Machine'], ['Status'], ['Good', 'num'], ['Scrap', 'num'], ['Yield', 'num'], ['Started'], ['Done'], ['Operator']])}<tbody>${o.ops.map((op, k) => `<tr><td>${op.seq} ${esc(op.name)}</td><td>${mName(op.mid)}</td><td>${opPill(Mes.opState(o, k))}</td><td class="num">${fmtNum(op.good)}</td><td class="num">${fmtNum(op.scrap)}</td><td class="num">${fmtPct(op.good + op.scrap ? op.good / (op.good + op.scrap) : null)}</td><td>${dt(op.startedAt)}</td><td>${dt(op.doneAt)}</td><td>${esc(op.by ? userName(op.by) : '')}</td></tr>`).join('')}</tbody></table></div>
      <h3 style="font-size:13.5px;margin:14px 0 8px">Material (BOM)</h3><div class="table-wrap"><table>${th([['Material'], ['At op'], ['Per unit', 'num'], ['Required', 'num'], ['Used', 'num'], ['In stock', 'num']])}<tbody>${Mes.bomNeed(o).map(b => { const m = Mes.material(b.matId); return `<tr><td><span class="mono">${esc(m.code)}</span> ${esc(m.name)}</td><td>${b.seq}</td><td class="num">${fmtNum(b.qtyPer, 3)} ${esc(m.unit)}</td><td class="num">${fmtNum(b.need, 1)}</td><td class="num">${fmtNum(b.used, 1)}</td><td class="num">${fmtNum(Mes.stock(b.matId).avail, 1)}</td></tr>`; }).join('')}</tbody></table></div>
      <h3 style="font-size:13.5px;margin:14px 0 8px">Lots produced</h3><div>${lots.length ? lots.map(l => `${lotLink(l)} <span style="font-size:12px;color:var(--muted)">op ${l.seq} · ${fmtNum(l.init)} ${esc(l.unit)}</span> ${l.status !== 'available' ? lotPill(l) : ''}`).join('<br>') : '<span style="color:var(--muted)">None yet.</span>'}</div>
      <h3 style="font-size:13.5px;margin:14px 0 8px">History</h3><div style="font-size:12.5px;display:grid;gap:4px">${ev.map(e => `<div>${dt(e.at)} ${esc(e.text)} <span style="color:var(--muted)">· ${esc(userName(e.by))}</span></div>`).join('')}</div>`,
    foot: `<button class="btn" data-act="modal-close" type="button">Close</button>${canOrder(o) && o.status === 'planned' ? `<button class="btn primary" data-act="mes-release" data-arg="${o.id}" type="button">Release</button>` : ''}${canOrder(o) && o.status === 'completed' ? `<button class="btn primary" data-act="mes-close" data-arg="${o.id}" type="button">Close order</button>` : ''}`,
  });
}

/* ---------- dispatch ---------- */
function mesGantt(rows, from, to, W) {
  if (!rows.length) return `<div class="chart-empty">No machines in scope.</div>`;
  const L = Math.min(190, W * 0.28), R = 10, T = 6, rh = 30, B = 24, w = W - L - R, H = T + rows.length * rh + B;
  const x = t => L + (Math.min(Math.max(t, from), to) - from) / (to - from) * w;
  let g = ''; const n = Math.max(2, Math.floor(w / 110));
  for (let i = 0; i <= n; i++) { const t = from + (to - from) * i / n, xx = x(t); g += `<line class="grid-line" x1="${xx}" x2="${xx}" y1="${T}" y2="${T + rows.length * rh}"/><text x="${xx}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}">${Charts.timeLabel(t, (to - from) / n)}</text>`; }
  rows.forEach((r, i) => {
    const y = T + i * rh; const lbl = r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label;
    g += `<text class="lbl" x="${L - 10}" y="${y + rh / 2 + 4}" text-anchor="end">${esc(lbl)}</text><rect x="${L}" y="${y + 4}" width="${w}" height="${rh - 8}" rx="4" style="fill:var(--line)"/>`;
    r.bars.forEach(b => {
      if (b.e < from || b.s > to) return;
      const x0 = x(b.s), x1 = x(b.e); if (x1 - x0 < 0.5) return;
      const tip = `${b.o.no} · ${Mes.product(b.o.productId).name}\nOp ${b.op.seq} ${b.op.name}\n${fmtDT(b.s)} → ${fmtDT(b.e)}\nDue ${fmtDT(b.o.due)}${b.late ? '\nFinishes after the due date' : ''}`;
      g += `<g><title>${esc(tip)}</title><rect x="${x0}" y="${y + 4}" width="${x1 - x0}" height="${rh - 8}" rx="4" style="fill:${orderHue(b.o)};opacity:${b.done ? 0.35 : 0.9};${b.late ? 'stroke:var(--crit);stroke-width:2;' : ''}${b.active ? 'stroke:var(--text);stroke-width:1.5;' : ''}"/>
        ${x1 - x0 > 70 ? `<text x="${x0 + 6}" y="${y + rh / 2 + 4}" style="fill:#fff;font-size:10.5px;font-weight:600">${esc(b.o.no.slice(3))} · ${b.op.seq}</text>` : ''}</g>`;
    });
  });
  const nx = x(Date.now()); g += `<line x1="${nx}" x2="${nx}" y1="${T}" y2="${T + rows.length * rh}" style="stroke:var(--accent);stroke-width:2;stroke-dasharray:4 3"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Machine schedule">${g}</svg>`;
}
function pMesDispatch() {
  const now = Date.now(); const { ops } = Mes.plan(now); const hz = { '24h': DAY, '48h': 2 * DAY, '7d': 7 * DAY }[S.mesHz];
  const ms = opMachines(); const from = now - 4 * HOUR, to = now + hz;
  const items = Mes.c.orders.filter(o => mesActive(o) && Mes.visibleOrder(o)).flatMap(o => o.ops.map((op, k) => ({ id: `${o.id}:${k}`, o, op, k, p: ops.get(`${o.id}:${k}`) }))).filter(x => x.p);
  const rows = ms.map(m => ({ label: m.name, bars: items.filter(x => x.op.mid === m.id).map(x => ({ s: x.p.s, e: x.p.e, o: x.o, op: x.op, done: x.p.done, active: x.p.active, late: !x.p.done && x.p.e > x.o.due })) }));
  const queue = items.filter(x => x.op.status !== 'done' && ms.some(m => m.id === x.op.mid)).sort((a, b) => a.p.s - b.p.s);
  const edO = o => canEdit('mes_dispatch') && assetLevel(o.lineId) === 'edit';
  const machSel = x => edO(x.o) && x.op.status === 'waiting' && x.op.mids.length > 1 ? `<select class="input" data-mes="mach" data-arg="${x.id}" style="padding:4px 28px 4px 8px" aria-label="Machine">${x.op.mids.map(mid => `<option value="${mid}" ${mid === x.op.mid ? 'selected' : ''}>${mName(mid)}</option>`).join('')}</select>` : mName(x.op.mid);
  const prioSel = x => edO(x.o) ? `<select class="input" data-mes="prio" data-arg="${x.o.id}" style="padding:4px 28px 4px 8px" aria-label="Priority">${Object.entries(WO_PRIO).map(([k, [l]]) => `<option value="${k}" ${k === x.o.priority ? 'selected' : ''}>${l}</option>`).join('')}</select>` : prioPill(x.o.priority);
  return head('Dispatch', segBtns('mes-hz', S.mesHz, [['24h', 'Next 24 hours'], ['48h', 'Next 48 hours'], ['7d', 'Next 7 days']]), 'Finite-capacity schedule of released orders, by priority then due date. Change the priority or the machine and the plan updates.') +
    `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Machine schedule</h3><div class="legend"><span><i style="background:var(--accent)"></i>Now</span><span><i style="background:transparent;box-shadow:inset 0 0 0 2px var(--crit)"></i>Late against due date</span><span><i style="background:transparent;box-shadow:inset 0 0 0 2px var(--text)"></i>Running</span><span class="hint">Each colour is one order</span></div></div>${chart(W => mesGantt(rows, from, to, W))}</div>
    <div class="card"><div class="card-head"><h3>Dispatch list</h3></div>${table('mes-dq', [
      { h: 'Order', f: x => moLink(x.o) }, { h: 'Product', f: x => esc(Mes.product(x.o.productId).name) }, { h: 'Op', f: x => `${x.op.seq} ${esc(x.op.name)}` },
      { h: 'Machine', f: machSel }, { h: 'Status', f: x => opPill(Mes.opState(x.o, x.k)) }, { h: 'Left', cls: 'num', f: x => fmtNum(Math.max(0, x.o.qty - x.op.good)) },
      { h: 'Planned start', f: x => dt(x.p.active ? x.op.startedAt : x.p.s) }, { h: 'Planned end', f: x => `<span class="mono" style="${x.p.e > x.o.due ? 'color:var(--crit)' : ''}">${fmtDT(x.p.e)}</span>` },
      { h: 'Due', f: x => dt(x.o.due) }, { h: 'Priority', f: prioSel }], queue, { pageSize: 12, empty: 'Nothing to dispatch. Release an order first.' })}</div>`;
}

/* ---------- shop floor terminal ---------- */
function pMesTerminal() {
  const ms = opMachines();
  if (!ms.length) return head('Shop Floor') + `<div class="card empty">No machines under this asset. Pick a line or machine in the sidebar.</div>`;
  if (!ms.some(m => m.id === S.mesM)) S.mesM = (ms.find(m => assetLevel(m.id) === 'edit') || ms[0]).id;
  const m = DB.asset(S.mesM); const now = Date.now(); const me = S.user.username;
  const ed = canEdit('mes_terminal') && assetLevel(m.id) === 'edit';
  const ck = Mes.onClock(me); const here = ck?.mid === m.id;
  const crew = Mes.c.clock.filter(x => !x.out && x.mid === m.id);
  const { ops } = Mes.plan(now);
  const mine = Mes.c.orders.filter(o => mesActive(o) && Mes.visibleOrder(o)).flatMap(o => o.ops.map((op, k) => ({ id: `${o.id}:${k}`, o, op, k, st: Mes.opState(o, k), p: ops.get(`${o.id}:${k}`) }))).filter(x => x.op.mid === m.id && x.op.status !== 'done');
  const cur = mine.find(x => x.st === 'running' || x.st === 'paused');
  const queue = mine.filter(x => x !== cur).sort((a, b) => (a.p?.s || 0) - (b.p?.s || 0));
  const st = Sim.status(m.id); const sg = Sim.current(m.id);
  const kind = machineKind(m).kind; const lvl = Mes.skill(me, kind);
  let curHTML = `<div class="empty" style="padding:18px">No operation running on this machine. ${queue.some(x => x.st === 'ready') ? 'Start the next one from the queue below.' : ''}</div>`;
  if (cur) {
    const { o, op, k } = cur; const p = Mes.product(o.productId); const arg = cur.id;
    const lastRep = Mes.c.reports.filter(r => r.orderId === o.id && r.seq === op.seq).reduce((a, r) => Math.max(a, r.at), op.startedAt);
    const iot = calcMachine(m, lastRep, now, false);
    const inp = k ? Mes.inputAvail(o, k) : null;
    const needFirst = op.inspect === 'first' && !op.firstOk, needFinal = op.inspect === 'final' && !op.finalOk;
    const b = (a, l, cls = '', dis = false) => `<button class="btn ${cls}" data-act="${a}" data-arg="${arg}" ${dis || !ed ? 'disabled' : ''}>${l}</button>`;
    curHTML = `<div class="grid g2" style="gap:16px">
      <div style="display:grid;gap:2px">${kvrow('Order', `${moLink(o)} ${prioPill(o.priority)}`)}${kvrow('Product', `${esc(p.code)} · ${esc(p.name)}`)}${kvrow('Operation', `<b>${op.seq} ${esc(op.name)}</b> ${opPill(op.status)}`)}
        ${kvrow('Output', `<b class="mono">${fmtNum(op.good)}</b> good · <span class="mono">${fmtNum(op.scrap)}</span> scrap · of ${fmtNum(o.qty)} ${esc(p.unit)}`)}${kvrow('Progress', pctBar(o.qty ? op.good / o.qty : 0))}
        ${k ? kvrow('Input waiting', `<span class="mono">${fmtNum(inp)}</span> pcs from op ${o.ops[k - 1].seq}`) : ''}
        ${kvrow('Machine counter', `<span class="mono">${fmtNum(iot.total)}</span> pcs, <span class="mono">${fmtNum(iot.bad)}</span> NG since ${fmtTime(lastRep, false)} <span class="hint">(from the IoT counter)</span>`)}
        ${op.inspect ? kvrow(`${INSP_TYPE[op.inspect]} inspection`, (op.inspect === 'first' ? op.firstOk : op.finalOk) ? pill('good', 'Passed') : pill('warn', 'Required')) : ''}</div>
      <div style="display:grid;gap:10px;align-content:start"><div class="well" style="padding:12px 14px;font-size:13px"><b style="display:block;margin-bottom:4px">${ic('clip').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} Work instruction</b>${esc(op.instruction || 'No instruction for this operation.')}
        ${op.checks.length ? `<ul style="margin:8px 0 0;padding-left:18px;color:var(--muted)">${op.checks.map(c => `<li>${esc(c.name)}: ${esc(c.spec)}</li>`).join('')}</ul>` : ''}</div>
        <div class="acts" style="flex-wrap:wrap;justify-content:flex-start">
          ${needFirst ? b('mes-insp', 'First-piece inspection', 'primary').replace(`data-arg="${arg}"`, `data-arg="${arg}:first"`) : ''}
          ${b('mes-report', 'Report output', needFirst ? '' : 'primary', needFirst || op.status === 'paused')}
          ${b('mes-pause', op.status === 'paused' ? 'Resume' : 'Pause')}
          ${needFinal ? b('mes-insp', 'Final inspection').replace(`data-arg="${arg}"`, `data-arg="${arg}:final"`) : ''}
          ${b('mes-finish', 'Finish operation', '', needFinal)}</div></div></div>`;
  }
  const recent = Mes.c.reports.filter(r => r.mid === m.id).sort((a, b) => b.at - a.at).slice(0, 8);
  return `<div class="card op-head" style="margin-bottom:20px"><div style="display:grid;gap:8px"><h2 style="margin:0">Shop Floor · ${esc(m.name)}</h2>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><select class="input" id="mes-m" style="width:auto" aria-label="Machine">${ms.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(x.name)}${assetLevel(x.id) === 'edit' ? '' : ' (view only)'}</option>`).join('')}</select>
        ${statusPill(st)} <span style="font-size:12.5px;color:var(--muted)">${st === 'run' ? 'Machine running' : esc(DB.reason(sg?.reasonId)?.name || 'Stopped')}</span></div></div>
      <div style="display:grid;gap:6px;justify-items:end;text-align:right"><span style="font-size:13px">${here ? `You are clocked in here since <b class="mono">${fmtTime(ck.in, false)}</b>` : ck ? `You are clocked in at ${mName(ck.mid)}` : 'You are not clocked in'}</span>
        ${ed ? `<button class="btn ${here ? '' : 'primary'}" data-act="mes-clock" data-arg="${here ? 'out' : m.id}">${here ? 'Clock out' : 'Clock in here'}</button>` : ''}
        <span style="font-size:12px;color:var(--muted)">Skill ${esc(kind)}: ${myRole()?.superAdmin ? 'Super Admin' : SKILL_LVL[lvl]} · On this machine: ${crew.length ? crew.map(x => esc(userName(x.user))).join(', ') : 'nobody'}</span></div></div>
    ${!ed ? `<div class="card" style="margin-bottom:20px;color:var(--muted);font-size:13px">${ic('shield').replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-3px"')} View only. Your role cannot run operations on this machine.</div>` : ''}
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Current operation</h3></div>${curHTML}</div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Queue on this machine</h3></div>${table('mes-q', [
      { h: 'Order', f: x => moLink(x.o) }, { h: 'Product', f: x => esc(Mes.product(x.o.productId).name) }, { h: 'Op', f: x => `${x.op.seq} ${esc(x.op.name)}` },
      { h: 'Left', cls: 'num', f: x => fmtNum(Math.max(0, x.o.qty - x.op.good)) }, { h: 'Input ready', cls: 'num', f: x => x.k ? fmtNum(Mes.inputAvail(x.o, x.k)) : 'raw material' },
      { h: 'Status', f: x => opPill(x.st) }, { h: 'Planned start', f: x => dt(x.p?.s) }, { h: 'Due', f: x => dt(x.o.due) },
      { h: 'Action', cls: 'num', f: x => ed && x.st === 'ready' && !cur ? `<button class="btn sm primary" data-act="mes-start" data-arg="${x.id}">Start</button>` : '' }], queue, { pageSize: 6, empty: 'Nothing queued on this machine.' })}</div>
    <div class="card"><div class="card-head"><h3>Recent output on this machine</h3></div>${table('mes-rr', [
      { h: 'Time', f: r => dt(r.at) }, { h: 'Order', f: r => { const o = Mes.order(r.orderId); return o ? moLink(o) : ''; } }, { h: 'Op', f: r => r.seq },
      { h: 'Good', cls: 'num', f: r => fmtNum(r.good) }, { h: 'Scrap', cls: 'num', f: r => fmtNum(r.scrap) }, { h: 'Lot', f: r => lotLink(Mes.lot(r.lotId)) }, { h: 'By', f: r => esc(userName(r.by)) }], recent, { pageSize: 8, empty: 'No output reported yet.' })}</div>`;
}
function mesStart({ o, k }) {
  const op = o.ops[k]; const me = S.user.username; const kind = Mes.skillOf(op);
  if (Mes.onClock(me)?.mid !== op.mid) return toast(`Clock in at ${mName(op.mid)} first.`, 'warn');
  const lvl = Mes.skill(me, kind);
  if (!myRole()?.superAdmin && lvl < 1) return toast(`You are not trained for ${esc(kind)}. Ask your supervisor to update the skill matrix.`, 'crit');
  if (Mes.c.orders.some(x => mesActive(x) && x.ops.some(y => y.mid === op.mid && (y.status === 'running' || y.status === 'paused')))) return toast('Another operation is running on this machine. Finish it first.', 'warn');
  Mes.startOp(o, k, me); DB.save();
  toast(`${esc(o.no)} op ${op.seq} started.${op.inspect === 'first' ? ' Do the first-piece inspection before reporting output.' : ''}${lvl === 1 ? ' You are a trainee on this skill, work with a qualified operator.' : ''}`, lvl === 1 ? 'warn' : 'good');
  refreshContent();
}
function mesReportForm({ o, k }) {
  const op = o.ops[k]; const m = DB.asset(op.mid); const now = Date.now();
  const lastRep = Mes.c.reports.filter(r => r.orderId === o.id && r.seq === op.seq).reduce((a, r) => Math.max(a, r.at), op.startedAt);
  const iot = calcMachine(m, lastRep, now, false); const cap = k ? Mes.inputAvail(o, k) : Infinity;
  const bad = Math.min(Math.round(iot.bad), cap), good = Math.max(0, Math.min(Math.round(iot.total - iot.bad), cap - bad));
  const mats = o.bom.filter(b => b.seq === op.seq);
  openModal({
    title: `Report output · ${o.no} op ${op.seq}`, saveLabel: 'Book output',
    body: `<p style="margin:0;font-size:12.5px;color:var(--muted)">Filled in from the machine counter since ${fmtTime(lastRep, false)}. Correct it to what you counted.${k ? ` ${fmtNum(cap)} pcs are waiting from op ${o.ops[k - 1].seq}.` : ''}</p>` +
      row('Good', `<input class="input" id="rp-good" type="number" min="0" step="1" value="${good}" style="width:140px">`, 'rp-good', true) +
      row('Scrap', `<input class="input" id="rp-scrap" type="number" min="0" step="1" value="${bad}" style="width:140px">`, 'rp-scrap') +
      mats.map(b => { const mt = Mes.material(b.matId); const ls = Mes.rawLots(b.matId); return row(`${mt.name} lot`, `<select class="input" data-rplot="${b.matId}">${ls.map(l => `<option value="${l.id}">${esc(l.no)} · ${fmtNum(l.qty, 2)} ${esc(l.unit)} · ${esc(l.supplier)} ${esc(l.supLot)}</option>`).join('') || '<option value="">No lot in stock</option>'}</select><div style="font-size:12px;color:var(--muted);margin-top:4px">${fmtNum(b.qtyPer, 3)} ${esc(mt.unit)} per piece. Takes from the next lot (first in, first out) when this one runs out.</div>`); }).join('') +
      `<div class="err" id="rp-err" style="color:var(--crit);font-size:12.5px"></div>`,
    onSave: () => {
      const g = Math.round(+fv('rp-good') || 0), s = Math.round(+fv('rp-scrap') || 0);
      const err = Mes.checkReport(o, k, g, s); if (!setErr('rp', err)) return;
      const pick = {}; document.querySelectorAll('[data-rplot]').forEach(x => { if (x.value) pick[x.dataset.rplot] = x.value; });
      const lot = Mes.report(o, k, { good: g, scrap: s, pick }, S.user.username); DB.save(); closeModal();
      toast(`Booked ${fmtNum(g)} good, ${fmtNum(s)} scrap.${lot ? ` New lot <b>${esc(lot.no)}</b>.` : ''}`, 'good'); render();
    },
  });
}
function mesInspectForm({ o, k }, type) {
  const op = o.ops[k];
  openModal({
    title: `${INSP_TYPE[type]} inspection · ${o.no} op ${op.seq}`, wide: true, saveLabel: 'Save result',
    body: `<div class="table-wrap"><table><thead><tr><th>Check</th><th>Spec</th><th>Measured</th><th>OK</th><th>NG</th></tr></thead><tbody>${op.checks.map((c, i) => `<tr><td>${esc(c.name)}</td><td>${esc(c.spec)}</td><td><input class="input" data-inval="${i}" style="padding:4px 8px;width:120px"></td><td><input type="radio" name="in-${i}" value="ok" checked aria-label="OK"></td><td><input type="radio" name="in-${i}" value="ng" aria-label="Not OK"></td></tr>`).join('')}</tbody></table></div>` +
      row('Note', `<textarea class="input" id="in-note" rows="2"></textarea>`),
    onSave: () => {
      const items = op.checks.map((c, i) => ({ ...c, val: document.querySelector(`[data-inval="${i}"]`).value.trim(), ok: document.querySelector(`input[name="in-${i}"]:checked`).value === 'ok' }));
      const r = Mes.inspect(o, k, { type, items, note: fv('in-note') }, S.user.username); DB.save(); closeModal();
      toast(r.result === 'pass' ? `${INSP_TYPE[type]} inspection passed.` : `${INSP_TYPE[type]} inspection FAILED. Do not run on. Fix the cause and inspect again, or raise an NCR.`, r.result === 'pass' ? 'good' : 'crit'); render();
    },
  });
}
function mesFinish({ o, k }) {
  const op = o.ops[k];
  if (op.inspect === 'final' && !op.finalOk) return toast('Final inspection must pass before you finish this operation.', 'warn');
  const left = k ? Mes.inputAvail(o, k) : 0; const short = o.qty - op.good;
  confirmBox(`Finish op ${op.seq} ${op.name}`, `${fmtNum(op.good)} good and ${fmtNum(op.scrap)} scrap on ${esc(o.no)}.${short > 0 ? ` That is <b>${fmtNum(short)} short</b> of the order quantity.` : ''}${left > 0 ? ` ${fmtNum(left)} pcs from the previous operation stay in WIP.` : ''}`, () => {
    Mes.finishOp(o, k, S.user.username); DB.save();
    toast(o.status === 'completed' ? `${esc(o.no)} completed. Finished goods are in the FG store.` : `Op ${op.seq} finished.`, 'good'); render();
  }, 'Finish');
}

/* ---------- material & lot ---------- */
function pMesMaterial() {
  const ed = canEdit('mes_material'); const hold = ed || canEdit('mes_quality');
  const mats = Mes.c.materials.map(m => { const s = Mes.stock(m.id); const res = Mes.reserved(m.id); return { id: m.id, m, ...s, res, free: r3(s.avail - res) }; });
  const lots = Mes.c.lots.filter(l => lotVisible(l) && (S.mesKind === 'all' || l.kind === S.mesKind) && (S.mesUsed || l.qty > 0)).sort((a, b) => b.at - a.at);
  const src = l => l.kind === 'raw' ? `${esc(l.supplier)} <span class="mono" style="font-size:12px">${esc(l.supLot)}</span>` : `${esc(Mes.order(l.orderId)?.no || '')} · op ${l.seq} · ${mName(l.mid)}`;
  const acts = l => `<div class="acts">${hold && l.qty > 0 && (l.status === 'available' || l.status === 'hold') && !Mes.c.ncrs.some(n => n.lotId === l.id && n.status === 'open') ? `<button class="btn sm" data-act="mes-hold" data-arg="${l.id}">${l.status === 'hold' ? 'Release hold' : 'Hold'}</button>` : ''}${ed && l.kind === 'fg' && l.status === 'available' ? `<button class="btn sm primary" data-act="mes-ship" data-arg="${l.id}">Ship</button>` : ''}</div>`;
  EXPORTS.lots = () => exportCSV('Lots', ['Lot', 'Kind', 'Item', 'Qty', 'Initial', 'Unit', 'Status', 'Date', 'Source', 'Location'], lots.map(l => [l.no, LOT_KIND[l.kind], Mes.itemOf(l)?.name, l.qty, l.init, l.unit, LOT_STATUS[l.status][0], fmtDT(l.at), l.kind === 'raw' ? `${l.supplier} ${l.supLot}` : Mes.order(l.orderId)?.no, l.location]));
  return head('Material & Lot', ed ? `<button class="btn primary" data-act="mes-recv" data-arg="">${ic('plus')}Receive material</button>` : '', 'Raw material stock with reservations by released orders, and every lot made on the shop floor.') +
    `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Raw material stock</h3></div>${table('mes-stock', [
      { h: 'Code', f: x => `<span class="mono">${esc(x.m.code)}</span>` }, { h: 'Material', f: x => esc(x.m.name) }, { h: 'Available', cls: 'num', f: x => `${fmtNum(x.avail, 1)} ${esc(x.m.unit)}` },
      { h: 'On hold', cls: 'num', f: x => x.hold ? fmtNum(x.hold, 1) : '–' }, { h: 'Reserved', cls: 'num', f: x => fmtNum(x.res, 1) }, { h: 'Free', cls: 'num', f: x => `<span style="${x.free < 0 ? 'color:var(--crit)' : ''}">${fmtNum(x.free, 1)}</span>` },
      { h: 'Min', cls: 'num', f: x => fmtNum(x.m.min) }, { h: 'Status', f: x => x.free < 0 ? pill('crit', 'Short') : x.avail < x.m.min ? pill('warn', 'Below min') : pill('good', 'OK') },
      { h: '', cls: 'num', f: x => ed ? `<button class="btn sm" data-act="mes-recv" data-arg="${x.id}">Receive</button>` : '' }], mats, { pageSize: 12 })}</div>
    <div class="card"><div class="card-head"><h3>Lots</h3><div class="toolbar">${segBtns('mes-kind', S.mesKind, [['all', 'All'], ['raw', 'Raw'], ['wip', 'WIP'], ['fg', 'Finished']])}<label class="check"><input type="checkbox" id="mes-used" ${S.mesUsed ? 'checked' : ''}> Show used up</label>${csvBtn('export', 'lots')}</div></div>${table('mes-lots', [
      { h: 'Lot', f: l => lotLink(l) }, { h: 'Kind', f: l => esc(LOT_KIND[l.kind]) }, { h: 'Item', f: l => esc(Mes.itemOf(l)?.name || '') }, { h: 'Qty', cls: 'num', f: l => `${fmtNum(l.qty, l.kind === 'raw' ? 1 : 0)} / ${fmtNum(l.init, l.kind === 'raw' ? 1 : 0)} ${esc(l.unit)}` },
      { h: 'Status', f: l => lotPill(l) }, { h: 'Date', f: l => dt(l.at) }, { h: 'Source', f: src }, { h: 'Location', f: l => esc(l.location || '') }, { h: 'Action', cls: 'num', f: acts }], lots, { pageSize: 12, empty: 'No lots.' })}</div>`;
}
function mesRecvForm(matId) {
  openModal({
    title: 'Receive material', saveLabel: 'Receive',
    body: row('Material', `<select class="input" id="rv-m">${Mes.c.materials.map(m => `<option value="${m.id}" ${m.id === matId ? 'selected' : ''}>${esc(m.code)} · ${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select>`, 'rv-m', true) +
      row('Quantity', `<input class="input" id="rv-q" type="number" min="0" step="any" style="width:140px">`, 'rv-q', true) +
      row('Supplier', `<input class="input" id="rv-sup">`, 'rv-sup', true) + row('Supplier lot', `<input class="input" id="rv-sl">`, 'rv-sl', true) +
      row('Location', `<input class="input" id="rv-loc" value="RM store">`),
    onSave: () => {
      const d = { matId: fv('rv-m'), qty: r3(+fv('rv-q')), supplier: fv('rv-sup'), supLot: fv('rv-sl'), location: fv('rv-loc') };
      let ok = setErr('rv-q', d.qty > 0 ? '' : 'Enter the quantity received.');
      ok = setErr('rv-sup', d.supplier ? '' : 'Supplier is required.') && ok;
      ok = setErr('rv-sl', d.supLot ? '' : 'Supplier lot is required for traceability.') && ok;
      if (!ok) return;
      const l = Mes.receive(d, S.user.username); DB.save(); closeModal(); toast(`Received as lot <b>${esc(l.no)}</b>.`, 'good'); render();
    },
  });
}
function mesShipForm(l) {
  openModal({
    title: `Ship lot ${l.no}`, saveLabel: 'Ship',
    body: kvrow('Item', esc(Mes.itemOf(l).name)) + kvrow('In stock', `${fmtNum(l.qty)} ${esc(l.unit)}`) +
      row('Quantity', `<input class="input" id="sh-q" type="number" min="1" max="${l.qty}" step="1" value="${l.qty}" style="width:140px">`, 'sh-q', true) +
      row('Customer', `<input class="input" id="sh-c" value="${esc(Mes.order(l.orderId)?.customer || '')}">`, 'sh-c', true),
    onSave: () => {
      const q = Math.round(+fv('sh-q')), c = fv('sh-c');
      let ok = setErr('sh-q', q > 0 && q <= l.qty ? '' : `Enter 1 to ${fmtNum(l.qty)}.`); ok = setErr('sh-c', c ? '' : 'Customer is required.') && ok; if (!ok) return;
      Mes.ship(l, q, c, S.user.username); DB.save(); closeModal(); toast(`Shipped ${fmtNum(q)} ${esc(l.unit)} to ${esc(c)}.`, 'good'); render();
    },
  });
}

/* ---------- traceability ---------- */
function traceTree(n, dir, depth = 0) {
  if (!n?.lot) return '';
  const l = n.lot; const it = Mes.itemOf(l);
  const ships = dir === 'f' ? (n.ships || []).map(s => `<li class="ship">${ic('out').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"')} Shipped ${fmtNum(s.qty)} ${esc(l.unit)} to <b>${esc(s.customer)}</b> · ${dt(s.at)}</li>`).join('') : '';
  const kids = n.kids.map(k => traceTree(k, dir, depth + 1)).join('') + ships;
  return `<li><div class="tr-node">${lotLink(l)} <span>${esc(it?.name || '')}</span> ${pill(l.kind === 'fg' ? 'accent' : l.kind === 'raw' ? 'idle' : 'good', LOT_KIND[l.kind])} ${n.qty != null ? `<span class="mono" style="font-size:12px;color:var(--muted)">${fmtNum(n.qty, l.kind === 'raw' ? 2 : 0)} ${esc(l.unit)}</span>` : ''} ${l.status === 'hold' ? lotPill(l) : ''}</div>${kids ? `<ul>${kids}</ul>` : ''}</li>`;
}
function pMesTrace() {
  let l = Mes.lot(S.mesLot);
  if (!l || !lotVisible(l)) { l = Mes.c.lots.filter(x => x.kind === 'fg' && lotVisible(x)).sort((a, b) => b.at - a.at)[0]; S.mesLot = l?.id; }
  const all = Mes.c.lots.filter(lotVisible);
  const search = `<input class="input" id="mes-lot-q" list="mes-lot-list" placeholder="Lot number, e.g. ${esc(l?.no || 'L…')}" style="width:220px" aria-label="Lot number"><datalist id="mes-lot-list">${all.map(x => `<option value="${esc(x.no)}">${esc(Mes.itemOf(x)?.name || '')}</option>`).join('')}</datalist><button class="btn primary" data-act="mes-trace-go">${ic('search')}Trace</button>`;
  if (!l) return head('Traceability', search) + `<div class="card empty">No lots yet.</div>`;
  const o = l.orderId && Mes.order(l.orderId); const it = Mes.itemOf(l);
  const rep = Mes.c.reports.find(r => r.lotId === l.id);
  const op = o && o.ops.find(x => x.seq === l.seq);
  const insp = o ? Mes.c.inspections.filter(i => i.orderId === o.id && i.seq === l.seq) : [];
  const ncrs = Mes.c.ncrs.filter(n => n.lotId === l.id);
  let perf = '';
  if (rep && op) {
    const to = rep.at, from = to - (rep.good + rep.scrap) * op.cycleSec * 1000 / MES_EFF;
    const c = finish(calcMachine(DB.asset(rep.mid), from, to, false));
    perf = `<div class="card"><div class="card-head"><h3>Machine while this lot was made <span class="hint">${mName(rep.mid)} · ${fmtTime(from, false)}–${fmtTime(to, false)}</span></h3></div>
      <div class="grid g4" style="gap:12px">${[['OEE', c.OEE], ['Availability', c.A], ['Performance', c.P], ['Quality', c.Q]].map(([t, v]) => `<div class="well" style="padding:10px 12px"><div style="font-size:12px;color:var(--muted)">${t}</div><b class="mono" style="font-size:20px;color:var(${Charts.levelVar(v)})">${fmtPct(v)}</b></div>`).join('')}</div>
      <p style="margin:10px 0 0;font-size:12.5px;color:var(--muted)">Reported by ${esc(userName(rep.by))} at ${fmtDT(rep.at)}: ${fmtNum(rep.good)} good, ${fmtNum(rep.scrap)} scrap. Machine counter for the same window: ${fmtNum(c.total)} pcs, ${fmtNum(c.bad)} NG.</p></div>`;
  }
  const impact = l.kind !== 'fg' ? Mes.impact(l.id) : [];
  const impShips = impact.flatMap(f => Mes.c.ships.filter(s => s.lotId === f.id).map(s => ({ ...s, lot: f })));
  EXPORTS.impact = () => exportCSV(`Recall_${l.no}`, ['Finished lot', 'Product', 'Order', 'Made', 'In stock', 'Status', 'Shipped to', 'Shipped qty', 'Shipped at'], impact.flatMap(f => { const sh = Mes.c.ships.filter(s => s.lotId === f.id); const base = [f.no, Mes.itemOf(f).name, Mes.order(f.orderId)?.no, f.init, f.qty, LOT_STATUS[f.status][0]]; return sh.length ? sh.map(s => [...base, s.customer, s.qty, fmtDT(s.at)]) : [[...base, '', '', '']]; }));
  return head('Traceability', search, 'Lot genealogy: what went into a lot and where it went, down to the customer shipment.') +
    `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3><span class="mono">${esc(l.no)}</span> · ${esc(it?.name || '')}</h3>${lotPill(l)}</div>
      ${kvrow('Kind', esc(LOT_KIND[l.kind]))}${kvrow('Quantity', `${fmtNum(l.qty, l.kind === 'raw' ? 2 : 0)} of ${fmtNum(l.init, l.kind === 'raw' ? 2 : 0)} ${esc(l.unit)} left`)}${kvrow(l.kind === 'raw' ? 'Received' : 'Made', `${dt(l.at)} by ${esc(userName(l.by))}`)}
      ${l.kind === 'raw' ? kvrow('Supplier', `${esc(l.supplier)} · lot <span class="mono">${esc(l.supLot)}</span>`) : kvrow('Made on', `${o ? moLink(o) : ''} · op ${l.seq} ${esc(op?.name || '')} · ${mName(l.mid)}`)}
      ${kvrow('Location', esc(l.location || '–'))}${insp.length ? kvrow('Inspections', insp.map(i => `${pill(i.result === 'pass' ? 'good' : 'crit', `${INSP_TYPE[i.type]} ${i.result}`)} <span style="font-size:12px;color:var(--muted)">${fmtDT(i.at)} · ${esc(userName(i.by))}</span>`).join('<br>')) : ''}
      ${ncrs.length ? kvrow('NCR', ncrs.map(n => `<span class="mono">${esc(n.no)}</span> ${pill(n.status === 'open' ? 'crit' : 'idle', n.status === 'open' ? 'Open' : NCR_DISP[n.disp])} ${esc(n.desc)}`).join('<br>')) : ''}</div>
    <div class="grid g2" style="margin-bottom:20px">
      <div class="card"><div class="card-head"><h3>Made from <span class="hint">backward trace</span></h3></div><ul class="trace">${traceTree(Mes.backward(l.id), 'b')}</ul></div>
      <div class="card"><div class="card-head"><h3>Used in <span class="hint">forward trace</span></h3></div><ul class="trace">${traceTree(Mes.forward(l.id), 'f')}</ul></div></div>
    ${l.kind !== 'fg' ? `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Recall impact <span class="hint">finished lots that contain this lot</span></h3>${csvBtn('export', 'impact')}</div>
      ${impact.length ? `<p style="margin:0 0 10px;font-size:13px">${impact.length} finished lot${impact.length > 1 ? 's' : ''}, ${fmtNum(impact.reduce((a, f) => a + f.qty, 0))} pcs still in stock, ${fmtNum(impShips.reduce((a, s) => a + s.qty, 0))} pcs shipped to ${[...new Set(impShips.map(s => s.customer))].map(esc).join(', ') || 'nobody yet'}.</p>` : ''}
      ${table('mes-imp', [{ h: 'Finished lot', f: f => lotLink(f) }, { h: 'Order', f: f => { const x = Mes.order(f.orderId); return x ? moLink(x) : ''; } }, { h: 'Made', f: f => dt(f.at) }, { h: 'In stock', cls: 'num', f: f => fmtNum(f.qty) }, { h: 'Status', f: f => lotPill(f) },
        { h: 'Shipped', f: f => Mes.c.ships.filter(s => s.lotId === f.id).map(s => `${fmtNum(s.qty)} to ${esc(s.customer)}`).join('<br>') || '–' }], impact.map(f => ({ ...f, id: f.id })), { pageSize: 8, empty: 'Not in any finished lot yet.' })}</div>` : ''}
    ${perf}`;
}

/* ---------- quality ---------- */
function pMesQuality() {
  const ed = canEdit('mes_quality'); const now = Date.now(); const wk = now - 7 * DAY;
  const inScope = mid => DB.isUnder(mid, S.assetId) && assetLevel(mid) !== 'deny';
  const insp = Mes.c.inspections.filter(i => inScope(i.mid)).sort((a, b) => b.at - a.at);
  const i7 = insp.filter(i => i.at >= wk); const pass = i7.filter(i => i.result === 'pass').length;
  const ncrs = Mes.c.ncrs.filter(n => lotVisible(Mes.lot(n.lotId))).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.at - a.at);
  const held = Mes.c.lots.filter(l => l.status === 'hold' && lotVisible(l));
  const reps = Mes.c.reports.filter(r => r.at >= wk && inScope(r.mid));
  const g = reps.reduce((a, r) => a + r.good, 0), sc = reps.reduce((a, r) => a + r.scrap, 0);
  const byOp = {}; reps.forEach(r => { const o = Mes.order(r.orderId); const op = o.ops.find(x => x.seq === r.seq); const k = op.name; byOp[k] = byOp[k] || { g: 0, s: 0 }; byOp[k].g += r.good; byOp[k].s += r.scrap; });
  const items = Object.entries(byOp).map(([label, v]) => { const y = v.g / (v.g + v.s); return { label, value: y * 100, color: y >= 0.99 ? '--good' : y >= 0.97 ? '--warn' : '--crit', tip: `${label}: ${fmtPct(y)} (${fmtNum(v.g)} good, ${fmtNum(v.s)} scrap)` }; });
  return head('Quality & NCR', ed ? `<button class="btn primary" data-act="mes-ncr-new">${ic('plus')}Raise NCR</button>` : '', 'Inspection results from the shop floor and non-conformance reports. A lot with an open NCR is on hold and cannot be used.') +
    `<div class="grid g4" style="margin-bottom:20px">
      ${statTile('Inspections, 7 days', i7.length, `${fmtPct(i7.length ? pass / i7.length : null)} passed first time`, i7.length && pass < i7.length ? '--warn' : '--good')}
      ${statTile('Open NCR', ncrs.filter(n => n.status === 'open').length, 'waiting for a disposition', ncrs.some(n => n.status === 'open') ? '--crit' : '--good')}
      ${statTile('Lots on hold', held.length, `${fmtNum(held.reduce((a, l) => a + l.qty, 0))} units blocked`, held.length ? '--warn' : '--good')}
      ${statTile('Scrap, 7 days', fmtNum(sc), `${fmtPct(g + sc ? sc / (g + sc) : null)} of reported output`, '--text')}</div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Non-conformance reports</h3></div>${table('mes-ncr', [
      { h: 'NCR', f: n => `<span class="mono">${esc(n.no)}</span>` }, { h: 'Lot', f: n => lotLink(Mes.lot(n.lotId)) }, { h: 'Item', f: n => esc(Mes.itemOf(Mes.lot(n.lotId))?.name || '') },
      { h: 'Qty', cls: 'num', f: n => fmtNum(n.qty) }, { h: 'Defect', f: n => esc(DB.reason(n.defect)?.name || '') }, { h: 'Description', f: n => `<span style="font-size:12.5px">${esc(n.desc)}</span>` },
      { h: 'Raised', f: n => `${dt(n.at)}<br><span style="font-size:12px;color:var(--muted)">${esc(userName(n.by))}</span>` },
      { h: 'Status', f: n => n.status === 'open' ? pill('crit', 'Open') : `${pill('idle', NCR_DISP[n.disp])}<div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(n.dispNote)}</div>` },
      { h: 'Action', cls: 'num', f: n => ed && n.status === 'open' ? `<button class="btn sm primary" data-act="mes-disp" data-arg="${n.id}">Disposition</button>` : '' }], ncrs, { pageSize: 8, empty: 'No NCRs.' })}</div>
    <div class="grid g-1-2">
      <div class="card"><div class="card-head"><h3>Yield by operation <span class="hint">7 days</span></h3></div>${chart(W => Charts.bars(items, { W, H: 230, fmt: v => v.toFixed(1) + '%' }))}</div>
      <div class="card"><div class="card-head"><h3>Inspection log</h3></div>${table('mes-insp', [
        { h: 'Time', f: i => dt(i.at) }, { h: 'Order', f: i => { const o = Mes.order(i.orderId); return o ? moLink(o) : ''; } }, { h: 'Op', f: i => i.seq }, { h: 'Machine', f: i => mName(i.mid) },
        { h: 'Type', f: i => INSP_TYPE[i.type] }, { h: 'Result', f: i => pill(i.result === 'pass' ? 'good' : 'crit', i.result === 'pass' ? 'Pass' : 'Fail') },
        { h: 'Not OK', f: i => `<span style="font-size:12px">${i.items.filter(x => !x.ok).map(x => esc(x.name + (x.val ? ` (${x.val})` : ''))).join(', ') || '–'}</span>` }, { h: 'By', f: i => esc(userName(i.by)) }], insp, { pageSize: 8, empty: 'No inspections.' })}</div></div>`;
}
function mesNcrForm() {
  const ls = Mes.c.lots.filter(l => lotVisible(l) && l.qty > 0 && (l.status === 'available' || l.status === 'hold')).sort((a, b) => b.at - a.at);
  openModal({
    title: 'Raise NCR', wide: true, saveLabel: 'Raise NCR',
    body: row('Lot', `<select class="input" id="nc-lot">${ls.map(l => `<option value="${l.id}">${esc(l.no)} · ${esc(Mes.itemOf(l)?.name || '')} · ${fmtNum(l.qty, 2)} ${esc(l.unit)}</option>`).join('')}</select>`, 'nc-lot', true) +
      row('Quantity affected', `<input class="input" id="nc-q" type="number" min="0" step="any" style="width:140px">`, 'nc-q', true) +
      row('Defect', `<select class="input" id="nc-d">${DB.reasons('quality').map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>`) +
      row('Description', `<textarea class="input" id="nc-desc" rows="3" placeholder="What is wrong, how many, how it was found"></textarea>`, 'nc-desc', true),
    onSave: () => {
      const l = Mes.lot(fv('nc-lot')); const q = r3(+fv('nc-q'));
      let ok = setErr('nc-q', l && q > 0 && q <= l.qty ? '' : `Enter 0 to ${fmtNum(l?.qty || 0, 2)}.`); ok = setErr('nc-desc', fv('nc-desc') ? '' : 'Describe the problem.') && ok; if (!ok) return;
      const n = Mes.raiseNcr({ lotId: l.id, qty: q, defect: fv('nc-d'), desc: fv('nc-desc') }, S.user.username); DB.save(); closeModal();
      toast(`${esc(n.no)} raised. Lot ${esc(l.no)} is on hold.`, 'warn'); render();
    },
  });
}
function mesDispForm(n) {
  const l = Mes.lot(n.lotId); const opts = Object.entries(NCR_DISP).filter(([k]) => k !== 'return' || l.kind === 'raw');
  openModal({
    title: `Disposition ${n.no}`, saveLabel: 'Close NCR',
    body: kvrow('Lot', `<span class="mono">${esc(l.no)}</span> · ${esc(Mes.itemOf(l)?.name || '')}`) + kvrow('Affected', `${fmtNum(n.qty, 2)} ${esc(l.unit)}`) + kvrow('Problem', esc(n.desc)) +
      row('Disposition', `<select class="input" id="ds-d">${opts.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`) +
      row('Note', `<textarea class="input" id="ds-n" rows="2" placeholder="Decision and root cause"></textarea>`, 'ds-n', true) +
      `<p style="margin:0;font-size:12px;color:var(--muted)">Scrap and Return take the affected quantity out of the lot. Rework and Use as is release the lot from hold.</p>`,
    onSave: () => { if (!setErr('ds-n', fv('ds-n') ? '' : 'Write the decision.')) return; Mes.dispose(n, fv('ds-d'), fv('ds-n'), S.user.username); DB.save(); closeModal(); toast(`${esc(n.no)} closed.`, 'good'); render(); },
  });
}

/* ---------- labor ---------- */
function pMesLabor() {
  const ed = canEdit('mes_labor'); const now = Date.now(); const wk = now - 7 * DAY;
  const onFloor = Mes.c.clock.filter(x => !x.out && DB.asset(x.mid) && DB.isUnder(x.mid, S.assetId) && assetLevel(x.mid) !== 'deny');
  const kinds = [...new Set(Mes.c.products.flatMap(p => p.routing.flatMap(r => r.mids.map(mid => machineKind(DB.asset(mid)).kind))))];
  const roleOf = u => DB.cfg.roles.find(r => r.id === u.roleId); const parent = r => r?.parentId ? DB.cfg.roles.find(x => x.id === r.parentId) : r;
  const people = DB.cfg.users.filter(u => u.active && !roleOf(u)?.superAdmin && ((parent(roleOf(u))?.menu?.mes_terminal || 'deny') !== 'deny' || Mes.c.skills[u.username]));
  const cell = (u, k) => { const v = Mes.skill(u.username, k); const p = pill(['idle', 'warn', 'good', 'accent'][v], SKILL_LVL[v]); return ed ? `<button class="link" data-act="mes-skill" data-arg="${esc(u.username)}|${esc(k)}" title="Click to change" style="text-decoration:none">${p}</button>` : p; };
  const sum = people.map(u => {
    const cks = Mes.c.clock.filter(x => x.user === u.username && (x.out || now) > wk);
    const h = cks.reduce((a, x) => a + (Math.min(x.out || now, now) - Math.max(x.in, wk)) / HOUR, 0);
    const reps = Mes.c.reports.filter(r => r.by === u.username && r.at >= wk); const g = reps.reduce((a, r) => a + r.good, 0), s = reps.reduce((a, r) => a + r.scrap, 0);
    return { id: u.username, u, h, g, s, n: reps.length };
  });
  return head('Labor', '', 'Who is on which machine, what they are trained for, and their output. Operators must clock in on a machine and hold the skill before they can start an operation.') +
    `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>On the floor now</h3></div>${table('mes-floor', [
      { h: 'Operator', f: x => esc(userName(x.user)) }, { h: 'Machine', f: x => mName(x.mid) }, { h: 'Since', f: x => dt(x.in) }, { h: 'Hours', cls: 'num', f: x => fmtNum((now - x.in) / HOUR, 1) },
      { h: 'Running', f: x => { const r = Mes.c.orders.filter(mesActive).flatMap(o => o.ops.filter(op => op.mid === x.mid && op.status === 'running').map(op => `${o.no} · ${op.seq} ${op.name}`)); return esc(r[0] || '–'); } }], onFloor, { pageSize: 8, empty: 'Nobody clocked in.' })}</div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Skill matrix ${ed ? '<span class="hint">click a cell to change the level</span>' : ''}</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Operator</th>${kinds.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${people.map(u => `<tr><td>${esc(u.fullName)} <span class="mono" style="font-size:11.5px;color:var(--muted)">${esc(u.username)}</span></td>${kinds.map(k => `<td>${cell(u, k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h3>Last 7 days</h3></div>${table('mes-lab', [
      { h: 'Operator', f: r => esc(r.u.fullName) }, { h: 'Clocked hours', cls: 'num', f: r => fmtNum(r.h, 1) }, { h: 'Reports', cls: 'num', f: r => fmtNum(r.n) },
      { h: 'Good', cls: 'num', f: r => fmtNum(r.g) }, { h: 'Scrap', cls: 'num', f: r => fmtNum(r.s) }, { h: 'Good per hour', cls: 'num', f: r => r.h ? fmtNum(r.g / r.h) : '–' }], sum, { pageSize: 10 })}</div>`;
}

/* ---------- product & routing ---------- */
function pMesProduct() {
  const ed = canEdit('mes_product'); const ps = Mes.c.products;
  if (!Mes.product(S.mesProd)) S.mesProd = ps[0]?.id;
  const p = Mes.product(S.mesProd);
  const b = (a, arg, l, cls = '') => `<button class="btn sm ${cls}" data-act="${a}" data-arg="${arg}">${l}</button>`;
  return head('Product & Routing', ed ? `<button class="btn" data-act="mes-mat-edit" data-arg="">${ic('plus')}Material</button><button class="btn primary" data-act="mes-prod-edit" data-arg="">${ic('plus')}Product</button>` : '', 'Master data for orders. A new order copies the routing and BOM, so changes here do not touch orders already created.') +
    `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Products</h3></div>${table('mes-prods', [
      { h: 'Code', f: x => `<button class="link mono" data-act="mes-prod" data-arg="${x.id}">${esc(x.code)}</button>` }, { h: 'Name', f: x => esc(x.name) }, { h: 'Line', f: x => mName(x.lineId) },
      { h: 'Operations', cls: 'num', f: x => x.routing.length }, { h: 'BOM items', cls: 'num', f: x => x.bom.length }, { h: 'Unit', f: x => esc(x.unit) },
      { h: '', cls: 'num', f: x => ed ? b('mes-prod-edit', x.id, 'Edit') : '' }], ps, { pageSize: 10, rowCls: x => x.id === S.mesProd ? 'sel' : '' })}</div>
    ${p ? `<div class="card" style="margin-bottom:20px"><div class="card-head"><h3>Routing · ${esc(p.name)}</h3>${ed ? b('mes-op-edit', `${p.id}:`, `${ic('plus')}Operation`) : ''}</div>${table('mes-rt', [
      { h: 'Op', f: r => r.seq }, { h: 'Name', f: r => esc(r.name) }, { h: 'Work center', f: r => r.mids.map(mName).join('<br>') }, { h: 'Cycle', cls: 'num', f: r => `${fmtNum(r.cycleSec, 1)} s` },
      { h: 'Setup', cls: 'num', f: r => `${fmtNum(r.setupMin)} min` }, { h: 'Inspection', f: r => r.inspect ? pill('accent', INSP_TYPE[r.inspect]) : '–' }, { h: 'Skill', f: r => esc(machineKind(DB.asset(r.mids[0])).kind) },
      { h: 'Instruction', f: r => `<span style="font-size:12px;color:var(--muted)">${esc(r.instruction.length > 70 ? r.instruction.slice(0, 68) + '…' : r.instruction)}</span>` },
      { h: '', cls: 'num', f: r => ed ? `<div class="acts">${b('mes-op-edit', `${p.id}:${r.seq}`, 'Edit')}${b('mes-op-del', `${p.id}:${r.seq}`, ic('trash'), 'danger')}</div>` : '' }], p.routing.map(r => ({ ...r, id: String(r.seq) })), { pageSize: 20 })}</div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>Bill of material · per 1 ${esc(p.unit)}</h3>${ed ? b('mes-bom-edit', `${p.id}:`, `${ic('plus')}Item`) : ''}</div>${table('mes-bom', [
        { h: 'Material', f: x => `<span class="mono">${esc(Mes.material(x.matId).code)}</span> ${esc(Mes.material(x.matId).name)}` }, { h: 'Qty', cls: 'num', f: x => `${fmtNum(x.qtyPer, 3)} ${esc(Mes.material(x.matId).unit)}` }, { h: 'At op', f: x => x.seq },
        { h: '', cls: 'num', f: x => ed ? `<div class="acts">${b('mes-bom-edit', `${p.id}:${x.i}`, 'Edit')}${b('mes-bom-del', `${p.id}:${x.i}`, ic('trash'), 'danger')}</div>` : '' }], p.bom.map((x, i) => ({ ...x, i, id: String(i) })), { pageSize: 20, empty: 'No material.' })}</div>
      <div class="card"><div class="card-head"><h3>Materials</h3></div>${table('mes-mats', [
        { h: 'Code', f: m => `<span class="mono">${esc(m.code)}</span>` }, { h: 'Name', f: m => esc(m.name) }, { h: 'Unit', f: m => esc(m.unit) }, { h: 'Min stock', cls: 'num', f: m => fmtNum(m.min) },
        { h: '', cls: 'num', f: m => ed ? b('mes-mat-edit', m.id, 'Edit') : '' }], Mes.c.materials, { pageSize: 12 })}</div></div>` : ''}`;
}
function mesProdForm(p) {
  const lines = DB.cfg.assets.filter(a => !a.isMachine && DB.machinesUnder(a.id).length && DB.kids(a.id).some(k => k.isMachine || DB.kids(k.id).length));
  openModal({
    title: p ? `Edit ${p.code}` : 'New product',
    body: row('Code', `<input class="input" id="pd-code" value="${esc(p?.code || '')}">`, 'pd-code', true) + row('Name', `<input class="input" id="pd-name" value="${esc(p?.name || '')}">`, 'pd-name', true) +
      row('Line', `<select class="input" id="pd-line">${lines.map(a => `<option value="${a.id}" ${a.id === p?.lineId ? 'selected' : ''}>${esc(DB.path(a.id))}</option>`).join('')}</select>`) +
      row('Unit', `<input class="input" id="pd-unit" value="${esc(p?.unit || 'pcs')}" style="width:120px">`),
    onSave: () => {
      const d = { code: fv('pd-code'), name: fv('pd-name'), lineId: fv('pd-line'), unit: fv('pd-unit') || 'pcs' };
      let ok = setErr('pd-code', d.code ? (Mes.c.products.some(x => x.code === d.code && x !== p) ? 'This code exists.' : '') : 'Code is required.'); ok = setErr('pd-name', d.name ? '' : 'Name is required.') && ok; if (!ok) return;
      if (p) Object.assign(p, d); else { const n = { id: uid('pr'), ...d, routing: [], bom: [] }; Mes.c.products.push(n); S.mesProd = n.id; }
      DB.save(); closeModal(); toast('Product saved.', 'good'); render();
    },
  });
}
function mesOpForm(p, op) {
  const ms = DB.machinesUnder(p.lineId);
  openModal({
    title: op ? `Edit op ${op.seq}` : `New operation · ${p.code}`, wide: true,
    body: row('Op number', `<input class="input" id="ro-seq" type="number" min="1" step="1" value="${op?.seq ?? ((p.routing[p.routing.length - 1]?.seq || 0) + 10)}" style="width:120px">`, 'ro-seq', true) +
      row('Name', `<input class="input" id="ro-name" value="${esc(op?.name || '')}">`, 'ro-name', true) +
      row('Work center', `<select class="input" id="ro-m" multiple size="5">${ms.map(m => `<option value="${m.id}" ${op?.mids.includes(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`, 'ro-m', true) +
      row('Cycle time (s)', `<input class="input" id="ro-cyc" type="number" min="0.1" step="0.1" value="${op?.cycleSec ?? ''}" placeholder="from machine rate" style="width:140px">`) +
      row('Setup (min)', `<input class="input" id="ro-set" type="number" min="0" step="1" value="${op?.setupMin ?? 15}" style="width:120px">`) +
      row('Inspection', `<select class="input" id="ro-in"><option value="">None</option>${['first', 'final'].map(k => `<option value="${k}" ${op?.inspect === k ? 'selected' : ''}>${INSP_TYPE[k]}</option>`).join('')}</select>`) +
      row('Check items', `<textarea class="input" id="ro-chk" rows="3" placeholder="One per line: Check | Spec">${esc((op?.checks || []).map(c => `${c.name} | ${c.spec}`).join('\n'))}</textarea>`, 'ro-chk') +
      row('Work instruction', `<textarea class="input" id="ro-ins" rows="3">${esc(op?.instruction || '')}</textarea>`),
    onSave: () => {
      const mids = [...document.getElementById('ro-m').selectedOptions].map(o => o.value); const seq = Math.round(+fv('ro-seq'));
      const checks = fv('ro-chk').split('\n').map(s => s.trim()).filter(Boolean).map(s => { const [name, spec = ''] = s.split('|').map(x => x.trim()); return { name, spec }; });
      const d = { seq, name: fv('ro-name'), mids, cycleSec: +fv('ro-cyc') || (mids[0] ? Math.round(3600 / DB.asset(mids[0]).rate * 10) / 10 : 0), setupMin: Math.max(0, +fv('ro-set') || 0), inspect: fv('ro-in'), checks, instruction: fv('ro-ins') };
      let ok = setErr('ro-seq', seq > 0 ? (p.routing.some(r => r.seq === seq && r !== op) ? 'This op number is used.' : '') : 'Enter an op number.');
      ok = setErr('ro-name', d.name ? '' : 'Name is required.') && ok; ok = setErr('ro-m', mids.length ? '' : 'Pick at least one machine.') && ok;
      ok = setErr('ro-chk', d.inspect && !checks.length ? 'Add at least one check item for the inspection.' : '') && ok; if (!ok) return;
      if (op) { p.bom.forEach(b => { if (b.seq === op.seq) b.seq = seq; }); Object.assign(op, d); } else p.routing.push(d);
      p.routing.sort((a, b) => a.seq - b.seq); DB.save(); closeModal(); toast('Routing saved.', 'good'); render();
    },
  });
}
function mesBomForm(p, i) {
  const b = p.bom[i];
  openModal({
    title: b ? 'Edit BOM item' : 'New BOM item',
    body: row('Material', `<select class="input" id="bm-m">${Mes.c.materials.map(m => `<option value="${m.id}" ${m.id === b?.matId ? 'selected' : ''}>${esc(m.code)} · ${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select>`) +
      row(`Qty per ${p.unit}`, `<input class="input" id="bm-q" type="number" min="0" step="any" value="${b?.qtyPer ?? ''}" style="width:140px">`, 'bm-q', true) +
      row('Used at op', `<select class="input" id="bm-s">${p.routing.map(r => `<option value="${r.seq}" ${r.seq === b?.seq ? 'selected' : ''}>${r.seq} ${esc(r.name)}</option>`).join('')}</select>`, 'bm-s', true),
    onSave: () => {
      const d = { matId: fv('bm-m'), qtyPer: +fv('bm-q'), seq: +fv('bm-s') };
      let ok = setErr('bm-q', d.qtyPer > 0 ? '' : 'Enter a quantity above 0.'); ok = setErr('bm-s', d.seq ? '' : 'Add an operation to the routing first.') && ok; if (!ok) return;
      if (b) Object.assign(b, d); else p.bom.push(d); DB.save(); closeModal(); toast('BOM saved.', 'good'); render();
    },
  });
}
function mesMatForm(m) {
  openModal({
    title: m ? `Edit ${m.code}` : 'New material',
    body: row('Code', `<input class="input" id="mt-code" value="${esc(m?.code || '')}">`, 'mt-code', true) + row('Name', `<input class="input" id="mt-name" value="${esc(m?.name || '')}">`, 'mt-name', true) +
      row('Unit', `<input class="input" id="mt-unit" value="${esc(m?.unit || 'kg')}" style="width:120px">`) + row('Min stock', `<input class="input" id="mt-min" type="number" min="0" step="any" value="${m?.min ?? 0}" style="width:140px">`),
    onSave: () => {
      const d = { code: fv('mt-code'), name: fv('mt-name'), unit: fv('mt-unit') || 'pcs', min: Math.max(0, +fv('mt-min') || 0) };
      let ok = setErr('mt-code', d.code ? (Mes.c.materials.some(x => x.code === d.code && x !== m) ? 'This code exists.' : '') : 'Code is required.'); ok = setErr('mt-name', d.name ? '' : 'Name is required.') && ok; if (!ok) return;
      if (m) Object.assign(m, d); else Mes.c.materials.push({ id: uid('mt'), ...d }); DB.save(); closeModal(); toast('Material saved.', 'good'); render();
    },
  });
}

/* ---------- dispatcher, actions and change events (merged in app.js) ---------- */
const MES_PAGES = { mes_overview: pMesOverview, mes_order: pMesOrder, mes_dispatch: pMesDispatch, mes_terminal: pMesTerminal, mes_material: pMesMaterial, mes_trace: pMesTrace, mes_quality: pMesQuality, mes_labor: pMesLabor, mes_product: pMesProduct };
const mesGuard = key => { if (canEdit(key)) return true; toast('You do not have edit access here.', 'warn'); return false; };
const MES_ACT = {
  'mes-ordf'(el) { S.mesOrdF = el.dataset.arg; S.tables['mes-mo'] = { page: 1 }; refreshContent(); },
  'mes-new'() { if (mesGuard('mes_order')) mesOrderForm(); },
  'mes-view'(el) { mesOrderView(Mes.order(el.dataset.arg)); },
  'mes-release'(el) { const o = Mes.order(el.dataset.arg); if (!canOrder(o)) return toast('You do not have edit access to this order.', 'warn'); closeModal(); mesRelease(o); },
  'mes-close'(el) { const o = Mes.order(el.dataset.arg); if (!canOrder(o)) return; closeModal(); Mes.close(o, S.user.username); DB.save(); toast(`${esc(o.no)} closed.`, 'good'); render(); },
  'mes-cancel'(el) { const o = Mes.order(el.dataset.arg); if (!canOrder(o)) return; confirmBox('Cancel order', `Cancel <b>${esc(o.no)}</b>? It stays in the list as cancelled.`, () => { Mes.cancel(o, S.user.username); DB.save(); toast(`${esc(o.no)} cancelled.`); render(); }, 'Cancel order'); },
  'mes-trace'(el) { if (!mesCan('mes_trace')) return; closeModal(); S.mesLot = el.dataset.arg; S.page = 'mes_trace'; S.mode = 'mes'; render(); document.getElementById('content')?.scrollTo(0, 0); },
  'mes-trace-go'() { const l = Mes.lotByNo(fv('mes-lot-q')); if (!l || !lotVisible(l)) return toast('No lot with that number in your access.', 'warn'); S.mesLot = l.id; refreshContent(); },
  'mes-hz'(el) { S.mesHz = el.dataset.arg; refreshContent(); },
  'mes-clock'(el) {
    if (!canEdit('mes_terminal')) return; const a = el.dataset.arg; const me = S.user.username;
    if (a === 'out') { const x = Mes.c.orders.some(o => mesActive(o) && o.ops.some(op => op.status === 'running' && op.by === me && op.mid === Mes.onClock(me)?.mid)); Mes.clockOut(me); DB.save(); toast(`Clocked out.${x ? ' Your operation is still running, hand it over or pause it.' : ''}`, x ? 'warn' : 'good'); }
    else { if (assetLevel(a) !== 'edit') return; Mes.clockIn(me, a); DB.save(); toast(`Clocked in at ${mName(a)}.`, 'good'); }
    refreshContent();
  },
  'mes-start'(el) { if (mesGuard('mes_terminal')) mesStart(mesKey(el.dataset.arg)); },
  'mes-report'(el) { if (mesGuard('mes_terminal')) mesReportForm(mesKey(el.dataset.arg)); },
  'mes-pause'(el) { if (!mesGuard('mes_terminal')) return; const { o, k } = mesKey(el.dataset.arg); Mes.pauseOp(o, k, S.user.username); DB.save(); refreshContent(); },
  'mes-insp'(el) { if (!canEdit('mes_terminal') && !canEdit('mes_quality')) return; const [oid, k, type] = el.dataset.arg.split(':'); mesInspectForm({ o: Mes.order(oid), k: +k }, type); },
  'mes-finish'(el) { if (mesGuard('mes_terminal')) mesFinish(mesKey(el.dataset.arg)); },
  'mes-recv'(el) { if (!mesGuard('mes_material')) return; closeModal(); mesRecvForm(el.dataset.arg); },
  'mes-kind'(el) { S.mesKind = el.dataset.arg; S.tables['mes-lots'] = { page: 1 }; refreshContent(); },
  'mes-hold'(el) { if (!canEdit('mes_material') && !canEdit('mes_quality')) return; const l = Mes.lot(el.dataset.arg); Mes.hold(l, l.status !== 'hold', S.user.username); DB.save(); toast(`Lot ${esc(l.no)} ${l.status === 'hold' ? 'on hold' : 'released'}.`, l.status === 'hold' ? 'warn' : 'good'); refreshContent(); },
  'mes-ship'(el) { if (mesGuard('mes_material')) mesShipForm(Mes.lot(el.dataset.arg)); },
  'mes-ncr-new'() { if (mesGuard('mes_quality')) mesNcrForm(); },
  'mes-disp'(el) { if (mesGuard('mes_quality')) mesDispForm(Mes.ncr(el.dataset.arg)); },
  'mes-skill'(el) { if (!mesGuard('mes_labor')) return; const [u, k] = el.dataset.arg.split('|'); const sk = Mes.c.skills[u] = Mes.c.skills[u] || {}; sk[k] = ((sk[k] || 0) + 1) % 4; DB.save(); refreshContent(); },
  'mes-prod'(el) { S.mesProd = el.dataset.arg; refreshContent(); },
  'mes-prod-edit'(el) { if (mesGuard('mes_product')) mesProdForm(Mes.product(el.dataset.arg)); },
  'mes-op-edit'(el) { if (!mesGuard('mes_product')) return; const [pid, seq] = el.dataset.arg.split(':'); const p = Mes.product(pid); mesOpForm(p, p.routing.find(r => r.seq === +seq && seq !== '')); },
  'mes-op-del'(el) {
    if (!mesGuard('mes_product')) return; const [pid, seq] = el.dataset.arg.split(':'); const p = Mes.product(pid); const op = p.routing.find(r => r.seq === +seq);
    if (p.bom.some(b => b.seq === op.seq)) return toast('Move or delete the BOM items used at this op first.', 'warn');
    confirmBox('Delete operation', `Delete op ${op.seq} ${esc(op.name)} from ${esc(p.code)}? Orders already created keep their copy.`, () => { p.routing = p.routing.filter(r => r !== op); DB.save(); toast('Operation deleted.'); render(); });
  },
  'mes-bom-edit'(el) { if (!mesGuard('mes_product')) return; const [pid, i] = el.dataset.arg.split(':'); mesBomForm(Mes.product(pid), i === '' ? -1 : +i); },
  'mes-bom-del'(el) { if (!mesGuard('mes_product')) return; const [pid, i] = el.dataset.arg.split(':'); const p = Mes.product(pid); p.bom.splice(+i, 1); DB.save(); toast('BOM item deleted.'); refreshContent(); },
  'mes-mat-edit'(el) { if (mesGuard('mes_product')) mesMatForm(Mes.material(el.dataset.arg)); },
};
function MES_CHANGE(t) {
  if (t.id === 'mes-m') { S.mesM = t.value; t.blur(); refreshContent(); return true; }
  if (t.id === 'mes-used') { S.mesUsed = t.checked; S.tables['mes-lots'] = { page: 1 }; refreshContent(); return true; }
  if (t.id === 'mes-lot-q') { const l = Mes.lotByNo(t.value); if (l && lotVisible(l)) { S.mesLot = l.id; t.blur(); refreshContent(); } return true; }
  if (t.dataset.mes === 'mach' || t.dataset.mes === 'prio') {
    const o = t.dataset.mes === 'mach' ? mesKey(t.dataset.arg).o : Mes.order(t.dataset.arg);
    if (!canEdit('mes_dispatch') || assetLevel(o.lineId) !== 'edit') return true;
    if (t.dataset.mes === 'mach') { const { k } = mesKey(t.dataset.arg); o.ops[k].mid = t.value; Mes.log('dispatch', o, `Op ${o.ops[k].seq} moved to ${DB.asset(t.value).name}`, S.user.username, Date.now()); }
    else { o.priority = t.value; Mes.log('dispatch', o, `Priority set to ${WO_PRIO[t.value][0]}`, S.user.username, Date.now()); }
    DB.save(); t.blur(); toast('Schedule updated.', 'good'); refreshContent(); return true;
  }
  return false;
}
