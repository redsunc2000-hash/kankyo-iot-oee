/* ==========================================================================
   OEE demo — MES (manufacturing execution)
   Products with BOM and routing, production orders, dispatch schedule,
   shop-floor execution (start / report / finish with lot output), material
   lots with genealogy, inspections and NCR, labor (clock-in, skills).
   Logic and seed only; the pages are in mes-ui.js.
   MES access is its own set of menu keys (MES mode). The seeded MES roles
   deny every other menu, and the older roles deny MES.
   ========================================================================== */
'use strict';

const MO_STATUS = { planned: ['Planned', 'idle'], released: ['Released', 'accent'], in_progress: ['In progress', 'good'], completed: ['Completed', 'accent'], closed: ['Closed', 'idle'], cancelled: ['Cancelled', 'idle'] };
const OP_STATUS = { waiting: ['Waiting', 'idle'], ready: ['Ready', 'accent'], running: ['Running', 'good'], paused: ['Paused', 'warn'], done: ['Done', 'accent'] };
const LOT_STATUS = { available: ['Available', 'good'], hold: ['On hold', 'crit'], consumed: ['Used up', 'idle'], shipped: ['Shipped', 'accent'], scrapped: ['Scrapped', 'idle'], returned: ['Returned', 'idle'] };
const LOT_KIND = { raw: 'Raw material', wip: 'WIP', fg: 'Finished good' };
const NCR_DISP = { rework: 'Rework', scrap: 'Scrap', use_as_is: 'Use as is', return: 'Return to supplier' };
const INSP_TYPE = { first: 'First piece', final: 'Final', patrol: 'Patrol' };
const SKILL_LVL = ['Not trained', 'Trainee', 'Qualified', 'Trainer'];
const PRIO_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const MES_EFF = 0.85; // planned speed vs ideal cycle time, used for scheduling
const MES_KEYS = MENU_KEYS.find(g => g.mode === 'mes').items.map(i => i.key);
const mesActive = o => o.status === 'released' || o.status === 'in_progress';
const r3 = v => Math.round(v * 1000) / 1000;
const clone = o => JSON.parse(JSON.stringify(o));

const Mes = {
  get c() { return DB.cfg.mes; },
  init() { this.ensureCfg(); },

  /* ---------- setup: roles, users, master data and history ---------- */
  ensureCfg() {
    const c = DB.cfg; if (c.mes) return;
    const t = Date.now(); const st = { createdBy: 'admin', createdAt: t - 20 * DAY, updatedBy: 'admin', updatedAt: t - 20 * DAY };
    // existing roles never see MES; MES roles see nothing but MES
    c.roles.forEach(r => { if (!r.superAdmin && !r.parentId) MES_KEYS.forEach(k => r.menu[k] = 'deny'); });
    const allDeny = Object.fromEntries(MENU_KEYS.flatMap(g => g.items.map(i => [i.key, 'deny'])));
    const mesMenu = lv => ({ ...allDeny, ...Object.fromEntries(MES_KEYS.map((k, i) => [k, lv[i]])) });
    //                    overview order   dispatch terminal material trace   quality  labor    product
    const roles = [
      { id: 'mesplp', name: 'MES Planner parent', parentId: null, menu: mesMenu(['view', 'edit', 'edit', 'view', 'edit', 'view', 'view', 'view', 'edit']), assets: {} },
      { id: 'mespl', name: 'MES Planner', parentId: 'mesplp', menu: {}, assets: { p1: 'edit' } },
      { id: 'mesopp', name: 'MES Operator parent', parentId: null, menu: mesMenu(['view', 'view', 'view', 'edit', 'view', 'view', 'edit', 'view', 'deny']), assets: {} },
      { id: 'mesopa', name: 'MES Operator air filter line', parentId: 'mesopp', menu: {}, assets: { p1: 'view', zs: 'deny', zn: 'edit' } },
      { id: 'mesopw', name: 'MES Operator water filter line', parentId: 'mesopp', menu: {}, assets: { p1: 'view', zn: 'deny', zs: 'edit' } },
      { id: 'mesqcp', name: 'MES Quality parent', parentId: null, menu: mesMenu(['view', 'view', 'deny', 'view', 'edit', 'view', 'edit', 'deny', 'view']), assets: {} },
      { id: 'mesqc', name: 'MES QC inspector', parentId: 'mesqcp', menu: {}, assets: { p1: 'edit' } },
    ];
    const users = [
      { id: 'u6', username: 'mes.planner', password: 'mes.planner', fullName: 'Kanokwan R.', email: 'kanokwan@kankyo-solutions.example', roleId: 'mespl', active: true },
      { id: 'u7', username: 'mes.op', password: 'mes.op', fullName: 'Kittipong W.', email: 'kittipong@kankyo-solutions.example', roleId: 'mesopa', active: true },
      { id: 'u8', username: 'mes.op.w', password: 'mes.op.w', fullName: 'Wichai S.', email: 'wichai@kankyo-solutions.example', roleId: 'mesopw', active: true },
      { id: 'u9', username: 'mes.qc', password: 'mes.qc', fullName: 'Duangjai P.', email: 'duangjai@kankyo-solutions.example', roleId: 'mesqc', active: true },
    ];
    roles.forEach(r => { if (!c.roles.some(x => x.id === r.id)) c.roles.push({ ...st, ...r }); });
    users.forEach(u => { if (!c.users.some(x => x.username === u.username)) c.users.push({ ...st, ...u }); });
    c.mes = this.seedMaster();
    this.seedHistory(t);
    DB.save();
  },
  seedMaster() {
    const M = (id, code, name, unit, min) => ({ id, code, name, unit, min });
    const materials = [
      M('mt1', 'MED-HEPA-H13', 'HEPA H13 glass-fibre media', 'm²', 400), M('mt2', 'ADH-HM-01', 'Hot-melt adhesive', 'kg', 40),
      M('mt3', 'RES-PP-BLK', 'PP resin, black', 'kg', 300), M('mt4', 'GSK-EPDM-10', 'EPDM gasket strip 10 mm', 'm', 800),
      M('mt5', 'CRB-ACT-12', 'Activated carbon powder', 'kg', 150), M('mt6', 'BND-PE-01', 'PE binder', 'kg', 60),
      M('mt7', 'MEM-RO-75', 'RO membrane sheet', 'm²', 150), M('mt8', 'RES-ABS-WHT', 'ABS resin, white', 'kg', 200),
      M('mt9', 'ORG-NBR-30', 'NBR O-ring 30 mm', 'pcs', 800), M('mt10', 'MED-SYN-G4', 'Synthetic G4 media', 'm²', 300),
    ];
    const cyc = mid => Math.round(3600 / DB.asset(mid).rate * 10) / 10;
    const O = (seq, name, mids, setupMin, inspect, checks, instruction) => ({ seq, name, mids, cycleSec: cyc(mids[0]), setupMin, inspect, checks: checks.map(([n, s]) => ({ name: n, spec: s })), instruction });
    const products = [
      { id: 'pr1', code: 'AP-HEPA-H13-400', name: 'HEPA filter H13 400×400', lineId: 'ln', unit: 'pcs', routing: [
        O(10, 'Media cutting', ['m4'], 15, '', [], 'Load the H13 media roll with the printed side up. Cut length 2,350 mm ±2. Check the first 3 cuts with the steel rule.'),
        O(20, 'Pleating', ['m2'], 20, 'first', [['Pleat height', '45 ±0.5 mm'], ['Pleat count', '78 pleats'], ['No media cracks', 'visual']], 'Set pleat height 45 mm, 78 pleats per pack. Keep media tension 1.2–1.5 bar.'),
        O(30, 'Lamination', ['m3'], 15, '', [], 'Hot-melt bead on both sides of the pack, glue temp 175 °C. Check the bead is continuous.'),
        O(40, 'Frame injection', ['m5', 'm6'], 25, 'first', [['Frame flatness', '≤ 0.8 mm'], ['No short shot', 'visual'], ['Corner weld line', 'visual']], 'Use mold FR-400. Barrel 210/220/225 °C, cycle 12 s. Remove sprue before the frame cools.'),
        O(50, 'Ultrasonic welding', ['m7'], 10, '', [], 'Weld the pack into the frame, amplitude 80 %, weld time 0.6 s. Peel-test 1 piece per 100.'),
        O(60, 'Final assembly', ['m1'], 10, 'final', [['Gasket fitted all round', 'visual'], ['Label and lot number', 'readable'], ['Pressure drop at 0.5 m/s', '≤ 250 Pa']], 'Fit the gasket strip, apply the lot label, pack 4 per carton.'),
      ], bom: [{ matId: 'mt1', qtyPer: 0.9, seq: 10 }, { matId: 'mt2', qtyPer: 0.05, seq: 30 }, { matId: 'mt3', qtyPer: 0.35, seq: 40 }, { matId: 'mt4', qtyPer: 1.6, seq: 60 }] },
      { id: 'pr3', code: 'AP-PRE-G4-400', name: 'Pre-filter G4 400×400', lineId: 'ln', unit: 'pcs', routing: [
        O(10, 'Media cutting', ['m4'], 10, '', [], 'Load the G4 synthetic media. Cut length 1,600 mm ±3.'),
        O(20, 'Pleating', ['m2'], 15, 'first', [['Pleat height', '25 ±0.5 mm'], ['Pleat count', '48 pleats']], 'Set pleat height 25 mm, 48 pleats per pack.'),
        O(40, 'Frame injection', ['m5', 'm6'], 25, '', [], 'Use mold FR-400. Barrel 205/215/220 °C.'),
        O(60, 'Final assembly', ['m1'], 10, 'final', [['Gasket fitted all round', 'visual'], ['Label and lot number', 'readable']], 'Fit the gasket strip, label, pack 6 per carton.'),
      ], bom: [{ matId: 'mt10', qtyPer: 0.8, seq: 10 }, { matId: 'mt3', qtyPer: 0.3, seq: 40 }, { matId: 'mt4', qtyPer: 1.6, seq: 60 }] },
      { id: 'pr2', code: 'WC-CB-10', name: 'Carbon block cartridge 10"', lineId: 'ls', unit: 'pcs', routing: [
        O(10, 'Carbon block extrusion', ['m9'], 30, 'first', [['Block OD', '62 ±0.3 mm'], ['Block length', '248 ±1 mm'], ['No cracks', 'visual']], 'Mix carbon and binder 5 : 1. Die temp 190 °C. Cut every 248 mm.'),
        O(20, 'Core sintering', ['m11'], 20, '', [], 'Oven profile S-2: 210 °C for 18 min. Load 40 blocks per tray.'),
        O(30, 'Membrane winding', ['m10'], 15, '', [], 'Wind 2 layers of RO membrane. Tension 18 N. Seal the overlap with tape.'),
        O(40, 'Housing injection', ['m12', 'm13'], 25, 'first', [['Thread gauge', 'GO / NO-GO pass'], ['Wall thickness', '2.0 ±0.15 mm'], ['No sink marks', 'visual']], 'Use mold HS-10. Barrel 230/240/245 °C, cycle 12 s.'),
        O(50, 'Cartridge assembly', ['m8'], 10, '', [], 'Fit 2 O-rings and the end caps. Torque 4 N·m.'),
        O(60, 'Pressure leak test', ['m14'], 10, 'final', [['Leak rate at 6 bar', '≤ 0.5 cc/min'], ['Burst sample', '≥ 12 bar (1 per lot)'], ['Label and lot number', 'readable']], 'Test every cartridge at 6 bar for 20 s. Rejects go to the red bin.'),
      ], bom: [{ matId: 'mt5', qtyPer: 0.4, seq: 10 }, { matId: 'mt6', qtyPer: 0.08, seq: 10 }, { matId: 'mt7', qtyPer: 0.6, seq: 30 }, { matId: 'mt8', qtyPer: 0.3, seq: 40 }, { matId: 'mt9', qtyPer: 2, seq: 50 }] },
    ];
    const skills = {
      'mes.op': { Cutting: 3, Pleating: 2, Lamination: 2, 'Injection molding': 2, 'Ultrasonic welding': 1, Assembly: 2 },
      'mes.op.w': { Extrusion: 2, 'Sintering oven': 2, Winding: 2, 'Injection molding': 1, Assembly: 2, 'Leak testing': 3 },
      'mes.qc': { 'Leak testing': 2, Assembly: 1 },
    };
    return { materials, products, orders: [], lots: [], links: [], reports: [], inspections: [], ncrs: [], ships: [], clock: [], skills, events: [], seq: {} };
  },
  seedHistory(now) {
    const ago = h => now - h * HOUR;
    [['mt1', 500, 96, 'Lydall Filtration', 'LY-24871'], ['mt1', 600, 40, 'Lydall Filtration', 'LY-25012'], ['mt1', 400, 8, 'Lydall Filtration', 'LY-25090'],
      ['mt2', 50, 96, 'Henkel Thailand', 'HK-7781'], ['mt2', 50, 30, 'Henkel Thailand', 'HK-7802'],
      ['mt3', 400, 96, 'IRPC', 'PP-11820'], ['mt3', 400, 20, 'IRPC', 'PP-11904'],
      ['mt4', 1000, 96, 'Siam Rubber', 'SR-5531'], ['mt4', 1500, 30, 'Siam Rubber', 'SR-5560'], ['mt4', 1500, 5, 'Siam Rubber', 'SR-5588'],
      ['mt5', 300, 90, 'Calgon Carbon', 'CC-90412'], ['mt5', 300, 20, 'Calgon Carbon', 'CC-90477'],
      ['mt6', 80, 90, 'SCG Chemicals', 'SCG-3371'],
      ['mt7', 300, 90, 'Toray Membrane', 'TM-60218'], ['mt7', 300, 30, 'Toray Membrane', 'TM-60255'],
      ['mt8', 300, 90, 'IRPC', 'ABS-2290'], ['mt8', 300, 12, 'IRPC', 'ABS-2317'],
      ['mt9', 2000, 90, 'NOK Thailand', 'NOK-1140'], ['mt9', 2000, 10, 'NOK Thailand', 'NOK-1162'],
      ['mt10', 1000, 24, 'Freudenberg', 'FD-88210']]
      .forEach(([matId, qty, h, supplier, supLot]) => this.receive({ matId, qty, supplier, supLot, location: 'RM store' }, 'mes.planner', ago(h)));

    const air = { user: 'mes.op', insp: 'mes.qc' }, water = { user: 'mes.op.w', insp: 'mes.qc' };
    const o1 = this.seedOrder('pr1', 400, ago(30), 'normal', 'Siam Clean Air Co.', { ...air, endAgo: 50, done: 6 });
    const o2 = this.seedOrder('pr2', 300, ago(12), 'normal', 'AquaPure Distribution', { ...water, endAgo: 30, done: 6, mids: { 3: 'm13' }, failFirst: 3 });
    const o3 = this.seedOrder('pr1', 600, ago(-14), 'high', 'Siam Clean Air Co.', { ...air, endAgo: 0.3, done: 3, partial: true });
    this.seedOrder('pr2', 500, ago(-20), 'normal', 'AquaPure Distribution', { ...water, endAgo: 0.5, done: 1, partial: true });
    this.seedOrder('pr3', 800, ago(-30), 'normal', 'HomeAir Retail', { release: true });
    this.seedOrder('pr1', 500, ago(-72), 'normal', 'CleanRoom Tech', {});
    this.seedOrder('pr2', 1200, ago(-40), 'high', 'AquaPure Distribution', {});

    this.close(o1, 'mes.planner', ago(46));
    this.c.lots.filter(l => l.kind === 'fg' && l.orderId === o1.id).forEach((l, i) => this.ship(l, i ? 100 : l.qty, 'Siam Clean Air Co.', 'mes.planner', ago(40 - i)));
    const fg2 = this.c.lots.filter(l => l.kind === 'fg' && l.orderId === o2.id);
    this.ship(fg2[0], fg2[0].qty, 'AquaPure Distribution', 'mes.planner', ago(20));
    const n1 = this.raiseNcr({ lotId: fg2[fg2.length - 1].id, qty: 6, defect: 'q4', desc: 'Scratches on the housing found at packing.' }, 'mes.qc', ago(26));
    this.dispose(n1, 'scrap', 'Scratched housings scrapped. Mold HS-10 cavity 2 polished.', 'mes.qc', ago(24));
    const adh = this.c.lots.find(l => l.matId === 'mt2' && l.status === 'available' && l.at < ago(90));
    if (adh) { const n2 = this.raiseNcr({ lotId: adh.id, qty: Math.min(5, adh.qty), defect: 'q1', desc: 'Viscosity out of spec on the supplier CoA (8,900 cP, spec 6,000–8,000).' }, 'mes.qc', ago(34)); this.dispose(n2, 'return', 'Returned to Henkel, credit note requested.', 'mes.qc', ago(33)); }
    const held = this.c.lots.filter(l => l.orderId === o3.id && l.seq === 30 && l.status === 'available').pop();
    if (held) this.raiseNcr({ lotId: held.id, qty: Math.min(20, held.qty), defect: 'q1', desc: 'Glue bead skips on one side of the pack, about 20 pieces.' }, 'mes.qc', ago(0.6));
    this.clockIn('mes.qc', 'm14', ago(2));
  },
  seedOrder(productId, qty, due, priority, customer, { user, insp, endAgo = 0, done = 0, partial = false, mids = {}, failFirst = -1, release = false }) {
    const now = Date.now(); const p = this.product(productId);
    const dur = k => (p.routing[k].setupMin * MIN + qty * p.routing[k].cycleSec * 1000 / MES_EFF);
    let total = 0; for (let k = 0; k < done; k++) total += dur(k) + 12 * MIN;
    if (partial) total += dur(done) / 2 + 8 * MIN;
    let t = now - endAgo * HOUR - total;
    if (!done && !partial) t = now - (release ? 1 : 5) * HOUR;
    const o = this.createOrder({ productId, qty, due, priority, customer }, 'mes.planner', t - 3 * HOUR);
    Object.entries(mids).forEach(([k, mid]) => o.ops[k].mid = mid);
    if (!done && !partial && !release) return o;
    this.release(o, 'mes.planner', t - 2 * HOUR);
    for (let k = 0; k < Math.min(o.ops.length, done + (partial ? 1 : 0)); k++) {
      const op = o.ops[k]; const d = dur(k); const s = t; const full = k < done;
      this.c.clock.push({ id: uid('ck'), user, mid: op.mid, in: s - 5 * MIN, out: full ? s + d + 6 * MIN : null });
      this.startOp(o, k, user, s);
      const ok = pass => op.checks.map(c => ({ ...c, ok: pass, val: '' }));
      if (op.inspect === 'first') {
        if (k === failFirst) this.inspect(o, k, { type: 'first', items: ok(true).map((x, i) => i === 0 ? { ...x, ok: false, val: 'out of spec' } : x), note: 'First shot out of spec, mold temperature adjusted.' }, insp, s + 5 * MIN);
        this.inspect(o, k, { type: 'first', items: ok(true), note: '' }, insp, s + (k === failFirst ? 18 : 7) * MIN);
      }
      const startQty = k ? null : Math.round(qty * 1.02);
      const avail = () => k ? this.inputAvail(o, k) : startQty - op.good - op.scrap;
      const rate = 0.006 + (hashStr(o.no + k) % 100) / 6000;
      const rep = (q, at) => { const sc = Math.round(q * rate); this.report(o, k, { good: q - sc, scrap: sc }, user, at); };
      rep(Math.floor(avail() / (full ? 2 : 3)), s + d / 2);
      if (!full) break;
      rep(avail(), s + d);
      if (op.inspect === 'final') this.inspect(o, k, { type: 'final', items: ok(true), note: '' }, insp, s + d + 3 * MIN);
      this.finishOp(o, k, user, s + d + 5 * MIN);
      t = s + d + 12 * MIN;
    }
    return o;
  },

  /* ---------- lookups ---------- */
  product(id) { return this.c.products.find(p => p.id === id); },
  material(id) { return this.c.materials.find(m => m.id === id); },
  order(id) { return this.c.orders.find(o => o.id === id); },
  lot(id) { return this.c.lots.find(l => l.id === id); },
  lotByNo(no) { const q = String(no || '').trim().toUpperCase(); return this.c.lots.find(l => l.no.toUpperCase() === q); },
  ncr(id) { return this.c.ncrs.find(n => n.id === id); },
  itemOf(l) { return l.kind === 'raw' ? this.material(l.matId) : this.product(l.productId); },
  next(k) { const s = this.c.seq; s[k] = (s[k] || 0) + 1; return s[k]; },
  log(type, o, text, by, at, extra = {}) { this.c.events.push({ id: uid('ev'), type, at, by, orderId: o?.id || null, text, ...extra }); },
  skillOf(op) { return machineKind(DB.asset(op.mid || op.mids[0])).kind; },
  skill(user, kind) { return this.c.skills[user]?.[kind] || 0; },
  visibleOrder(o) { return DB.asset(o.lineId) && assetLevel(o.lineId) !== 'deny'; },

  /* ---------- orders ---------- */
  createOrder(d, by, at = Date.now()) {
    const p = this.product(d.productId);
    const o = { id: uid('mo'), no: `MO-${woTag(at)}-${String(this.next('MO')).padStart(3, '0')}`, productId: p.id, lineId: p.lineId, qty: d.qty, due: d.due, priority: d.priority || 'normal', customer: d.customer || '', note: d.note || '',
      status: 'planned', createdAt: at, createdBy: by, releasedAt: null, startedAt: null, completedAt: null, closedAt: null, bom: clone(p.bom),
      ops: p.routing.map(r => ({ ...clone(r), mid: this.pickMachine(r.mids), status: 'waiting', good: 0, scrap: 0, startedAt: null, doneAt: null, by: null, firstOk: false, finalOk: false })) };
    this.c.orders.push(o);
    this.log('create', o, `Order created for ${fmtNum(o.qty)} ${p.unit} ${p.name}`, by, at);
    return o;
  },
  pickMachine(mids) { if (mids.length < 2 || !this.c.orders.length) return mids[0]; const load = this.loadHours(); return mids.reduce((a, b) => (load[b] || 0) < (load[a] || 0) ? b : a); },
  bomNeed(o) {
    return o.bom.map(b => {
      const used = this.c.reports.filter(r => r.orderId === o.id).reduce((a, r) => a + r.used.filter(u => u.matId === b.matId).reduce((x, u) => x + u.qty, 0), 0);
      return { ...b, need: r3(b.qtyPer * o.qty), used: r3(used), left: Math.max(0, r3(b.qtyPer * o.qty - used)) };
    });
  },
  rawLots(matId) { return this.c.lots.filter(l => l.kind === 'raw' && l.matId === matId && l.status === 'available' && l.qty > 0).sort((a, b) => a.at - b.at); },
  stock(matId) { const ls = this.c.lots.filter(l => l.kind === 'raw' && l.matId === matId); const s = st => r3(ls.filter(l => l.status === st).reduce((a, l) => a + l.qty, 0)); return { avail: s('available'), hold: s('hold') }; },
  reserved(matId, exceptId) { return r3(this.c.orders.filter(o => mesActive(o) && o.id !== exceptId).reduce((a, o) => a + (this.bomNeed(o).find(b => b.matId === matId)?.left || 0), 0)); },
  shortages(o) { return this.bomNeed(o).map(n => ({ ...n, free: r3(this.stock(n.matId).avail - this.reserved(n.matId, o.id)) })).filter(n => n.left > n.free + 1e-9); },
  release(o, by, at = Date.now()) { o.status = 'released'; o.releasedAt = at; this.log('release', o, 'Released to the shop floor', by, at); },
  close(o, by, at = Date.now()) { o.status = 'closed'; o.closedAt = at; this.log('close', o, 'Order closed', by, at); },
  cancel(o, by, at = Date.now()) { o.status = 'cancelled'; o.closedAt = at; o.ops.forEach(op => { if (op.status !== 'done') op.status = 'waiting'; }); this.log('cancel', o, 'Order cancelled', by, at); },
  /* share of all routing work done: each op counts its good output against the order quantity */
  progress(o) { return o.qty ? o.ops.reduce((a, op) => a + (op.status === 'done' ? 1 : Math.min(1, op.good / o.qty)), 0) / o.ops.length : 0; },
  currentOp(o) { return o.ops.find(op => op.status === 'running' || op.status === 'paused') || o.ops.find(op => op.status !== 'done'); },

  /* ---------- operations ---------- */
  inputLots(o, k) { const prev = o.ops[k - 1]; return this.c.lots.filter(l => l.orderId === o.id && l.seq === prev.seq && l.status === 'available' && l.qty > 0).sort((a, b) => a.at - b.at); },
  inputAvail(o, k) { return k ? this.inputLots(o, k).reduce((a, l) => a + l.qty, 0) : Infinity; },
  opState(o, k) {
    const op = o.ops[k];
    if (op.status !== 'waiting') return op.status;
    if (!mesActive(o)) return 'waiting';
    return k === 0 || this.inputAvail(o, k) > 0 ? 'ready' : 'waiting';
  },
  startOp(o, k, by, at = Date.now()) {
    const op = o.ops[k]; op.status = 'running'; op.startedAt = op.startedAt || at; op.by = by;
    if (o.status === 'released') { o.status = 'in_progress'; o.startedAt = at; }
    this.log('start', o, `Op ${op.seq} ${op.name} started on ${DB.asset(op.mid).name}`, by, at, { seq: op.seq, mid: op.mid });
  },
  pauseOp(o, k, by, at = Date.now()) { const op = o.ops[k]; op.status = op.status === 'paused' ? 'running' : 'paused'; this.log(op.status === 'paused' ? 'pause' : 'resume', o, `Op ${op.seq} ${op.status === 'paused' ? 'paused' : 'resumed'}`, by, at, { seq: op.seq, mid: op.mid }); },
  /* returns an error message, or '' when the report can be booked */
  checkReport(o, k, good, scrap) {
    const op = o.ops[k]; const q = good + scrap;
    if (!(good >= 0 && scrap >= 0) || q <= 0) return 'Enter a good or scrap quantity.';
    if (op.inspect === 'first' && !op.firstOk) return 'First-piece inspection has not passed yet.';
    if (k && q > this.inputAvail(o, k)) return `Only ${fmtNum(this.inputAvail(o, k))} pcs from op ${o.ops[k - 1].seq} are available (lots on hold are not counted).`;
    for (const b of o.bom.filter(b => b.seq === op.seq)) {
      const have = this.rawLots(b.matId).reduce((a, l) => a + l.qty, 0); const m = this.material(b.matId);
      if (have + 1e-9 < b.qtyPer * q) return `Not enough ${m.name}: need ${fmtNum(b.qtyPer * q, 2)} ${m.unit}, ${fmtNum(have, 2)} available.`;
    }
    return '';
  },
  take(l, q) { l.qty = r3(l.qty - q); if (l.qty <= 0) { l.qty = 0; l.status = 'consumed'; } },
  report(o, k, { good, scrap, pick = {} }, by, at = Date.now()) {
    const op = o.ops[k]; const q = good + scrap; const p = this.product(o.productId); const last = k === o.ops.length - 1;
    const used = [];
    if (k) { let need = q; for (const l of this.inputLots(o, k)) { if (need <= 0) break; const x = Math.min(need, l.qty); this.take(l, x); used.push({ lotId: l.id, qty: x }); need -= x; } }
    o.bom.filter(b => b.seq === op.seq).forEach(b => {
      let need = r3(b.qtyPer * q); const lots = this.rawLots(b.matId);
      const first = pick[b.matId]; if (first) lots.sort((x, y) => (y.id === first) - (x.id === first));
      for (const l of lots) { if (need <= 1e-9) break; const x = r3(Math.min(need, l.qty)); this.take(l, x); used.push({ lotId: l.id, qty: x, matId: b.matId }); need = r3(need - x); }
    });
    let lot = null;
    if (good > 0) {
      const d = new Date(at); const tag = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
      lot = { id: uid('lot'), no: `L${tag}-${String(this.next('L')).padStart(4, '0')}`, kind: last ? 'fg' : 'wip', productId: p.id, qty: good, init: good, unit: p.unit, status: 'available', at, by, orderId: o.id, seq: op.seq, mid: op.mid, location: last ? 'FG store' : `WIP · ${DB.asset(op.mid).name}` };
      this.c.lots.push(lot);
      used.forEach(u => this.c.links.push({ from: u.lotId, to: lot.id, qty: u.qty }));
    }
    op.good += good; op.scrap += scrap;
    this.c.reports.push({ id: uid('rp'), orderId: o.id, seq: op.seq, mid: op.mid, at, by, good, scrap, lotId: lot?.id || null, used });
    this.log('report', o, `Op ${op.seq}: ${fmtNum(good)} good, ${fmtNum(scrap)} scrap${lot ? ` → lot ${lot.no}` : ''}`, by, at, { seq: op.seq, mid: op.mid, lotId: lot?.id });
    return lot;
  },
  finishOp(o, k, by, at = Date.now()) {
    const op = o.ops[k]; op.status = 'done'; op.doneAt = at;
    this.log('finish', o, `Op ${op.seq} ${op.name} finished: ${fmtNum(op.good)} good, ${fmtNum(op.scrap)} scrap`, by, at, { seq: op.seq, mid: op.mid });
    if (o.ops.every(x => x.status === 'done')) { o.status = 'completed'; o.completedAt = at; this.log('complete', o, `Order completed with ${fmtNum(op.good)} good`, by, at); }
  },
  inspect(o, k, { type, items, note }, by, at = Date.now()) {
    const op = o.ops[k]; const result = items.every(i => i.ok) ? 'pass' : 'fail';
    const r = { id: uid('in'), at, by, orderId: o.id, seq: op.seq, mid: op.mid, type, result, items, note };
    this.c.inspections.push(r);
    if (result === 'pass' && type === 'first') op.firstOk = true;
    if (result === 'pass' && type === 'final') op.finalOk = true;
    this.log('inspect', o, `${INSP_TYPE[type]} inspection at op ${op.seq}: ${result === 'pass' ? 'pass' : 'FAIL'}`, by, at, { seq: op.seq, mid: op.mid });
    return r;
  },

  /* ---------- lots, quality, shipping ---------- */
  receive({ matId, qty, supplier, supLot, location }, by, at = Date.now()) {
    const d = new Date(at); const tag = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const m = this.material(matId);
    const l = { id: uid('lot'), no: `RM${tag}-${String(this.next('RM')).padStart(3, '0')}`, kind: 'raw', matId, qty, init: qty, unit: m.unit, status: 'available', at, by, supplier, supLot, location };
    this.c.lots.push(l);
    this.log('receive', null, `Received ${fmtNum(qty, 2)} ${m.unit} ${m.name} from ${supplier} → lot ${l.no}`, by, at, { lotId: l.id });
    return l;
  },
  raiseNcr({ lotId, qty, defect, desc }, by, at = Date.now()) {
    const l = this.lot(lotId);
    const n = { id: uid('ncr'), no: `NCR-${woTag(at)}-${String(this.next('NCR')).padStart(3, '0')}`, lotId, orderId: l.orderId || null, seq: l.seq || null, qty, defect, desc, status: 'open', at, by, disp: null, dispNote: '', closedAt: null, closedBy: null };
    this.c.ncrs.push(n); l.status = 'hold';
    this.log('ncr', l.orderId ? this.order(l.orderId) : null, `${n.no} raised on lot ${l.no} (${fmtNum(qty)} ${l.unit}), lot on hold`, by, at, { lotId });
    return n;
  },
  dispose(n, disp, note, by, at = Date.now()) {
    const l = this.lot(n.lotId);
    Object.assign(n, { disp, dispNote: note, status: 'closed', closedAt: at, closedBy: by });
    if (disp === 'scrap' || disp === 'return') { l.qty = Math.max(0, r3(l.qty - n.qty)); if (!l.qty) l.status = disp === 'return' ? 'returned' : 'scrapped'; }
    if (l.qty && !this.c.ncrs.some(x => x.lotId === l.id && x.status === 'open')) l.status = 'available';
    this.log('ncr', l.orderId ? this.order(l.orderId) : null, `${n.no} closed: ${NCR_DISP[disp]}`, by, at, { lotId: l.id });
  },
  hold(l, on, by, at = Date.now()) { l.status = on ? 'hold' : 'available'; this.log(on ? 'hold' : 'unhold', l.orderId ? this.order(l.orderId) : null, `Lot ${l.no} ${on ? 'put on hold' : 'released from hold'}`, by, at, { lotId: l.id }); },
  ship(l, qty, customer, by, at = Date.now()) {
    this.c.ships.push({ id: uid('sh'), lotId: l.id, qty, customer, at, by });
    l.qty = r3(l.qty - qty); if (l.qty <= 0) { l.qty = 0; l.status = 'shipped'; }
    this.log('ship', l.orderId ? this.order(l.orderId) : null, `Shipped ${fmtNum(qty)} ${l.unit} of lot ${l.no} to ${customer}`, by, at, { lotId: l.id });
  },

  /* ---------- genealogy ---------- */
  backward(id, seen = new Set()) { if (seen.has(id)) return null; seen.add(id); return { lot: this.lot(id), kids: this.c.links.filter(x => x.to === id).map(x => ({ qty: x.qty, ...this.backward(x.from, seen) })).filter(x => x.lot) }; },
  forward(id, seen = new Set()) { if (seen.has(id)) return null; seen.add(id); return { lot: this.lot(id), ships: this.c.ships.filter(s => s.lotId === id), kids: this.c.links.filter(x => x.from === id).map(x => ({ qty: x.qty, ...this.forward(x.to, seen) })).filter(x => x.lot) }; },
  impact(id) { const out = []; const walk = n => { if (n.lot.kind === 'fg') out.push(n.lot); n.kids.forEach(walk); }; walk(this.forward(id)); return [...new Set(out)]; },

  /* ---------- labor ---------- */
  onClock(user) { return this.c.clock.find(x => x.user === user && !x.out); },
  clockIn(user, mid, at = Date.now()) { this.clockOut(user, at); this.c.clock.push({ id: uid('ck'), user, mid, in: at, out: null }); },
  clockOut(user, at = Date.now()) { const x = this.onClock(user); if (x) x.out = at; },

  /* ---------- finite-capacity schedule (forward, by priority then due date) ---------- */
  plan(now = Date.now()) {
    const free = {}; const ops = new Map(); const eta = new Map();
    this.c.orders.filter(mesActive).sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.due - b.due || a.createdAt - b.createdAt).forEach(o => {
      let prevS = now, prevE = now;
      o.ops.forEach((op, k) => {
        if (op.status === 'done') { prevS = op.startedAt; prevE = op.doneAt; ops.set(`${o.id}:${k}`, { s: op.startedAt, e: op.doneAt, done: true }); return; }
        const left = Math.max(0, o.qty - op.good);
        const active = op.status === 'running' || op.status === 'paused';
        const dur = (active ? 0 : op.setupMin * MIN) + left * op.cycleSec * 1000 / MES_EFF;
        const s = active ? now : Math.max(free[op.mid] || now, k ? prevS + 20 * MIN : now);
        const e = Math.max(s + dur, prevE + 10 * MIN);
        free[op.mid] = e; prevS = s; prevE = e;
        ops.set(`${o.id}:${k}`, { s: active ? op.startedAt : s, e, dur, active });
      });
      eta.set(o.id, prevE);
    });
    return { ops, eta };
  },
  loadHours(now = Date.now()) {
    const out = {};
    this.c.orders.filter(mesActive).forEach(o => o.ops.forEach(op => { if (op.status !== 'done') out[op.mid] = (out[op.mid] || 0) + Math.max(0, o.qty - op.good) * op.cycleSec / MES_EFF / 3600; }));
    return out;
  },
};
