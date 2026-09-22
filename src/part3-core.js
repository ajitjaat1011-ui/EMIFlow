/* ============================================================
   EMIFlow v2.0 core — state · api · sync · emi engine
   ============================================================ */
'use strict';

const CATS = [
  {id:'personal', n:'Loan',     ic:'briefcase', c:'#565fe9'},
  {id:'consumer', n:'Phone',    ic:'phone',     c:'#8b5cf6'},
  {id:'bnpl',     n:'Shopping', ic:'bag',       c:'#f0a32f'},
  {id:'other',    n:'Other',    ic:'folder',    c:'#64748b'},
];
const CAT_ALIAS = {bike:'personal', car:'personal', home:'personal', card:'other', shopping:'bnpl', phone:'consumer'};
const LENDERS = [
  {id:'bajaj',    n:'Bajaj Finserv', c:'#2563eb'},
  {id:'paytm',    n:'Paytm',         c:'#002972'},
  {id:'phonepe',  n:'PhonePe',       c:'#5f259f'},
  {id:'gpay',     n:'Google Pay',    c:'#1a73e8'},
  {id:'cred',     n:'CRED',          c:'#0f0f0f'},
  {id:'amazonpay',n:'Amazon Pay',    c:'#232f3e'},
  {id:'navi',     n:'Navi',          c:'#7c3aed'},
  {id:'kreditbee',n:'KreditBee',     c:'#2563eb'},
  {id:'moneyview',n:'MoneyView',     c:'#16a34a'},
  {id:'lazypay',  n:'LazyPay',       c:'#e11d48'},
  {id:'simpl',    n:'Simpl',         c:'#8524e0'},
  {id:'hdfc',     n:'HDFC Bank',     c:'#004c8f'},
  {id:'icici',    n:'ICICI Bank',    c:'#ab1f24'},
  {id:'sbi',      n:'SBI',           c:'#280071'},
  {id:'axis',     n:'Axis Bank',     c:'#a51d2b'},
  {id:'snapmint', n:'Snapmint',      c:'#1e7145'},
  {id:'iblmoney', n:'IBL Money',     c:'#d92b2b'},
  {id:'branch',   n:'Branch',        c:'#16295c'},
  {id:'other',    n:'Other',         c:'#64748b'},
];
const LMAP = Object.fromEntries(LENDERS.map(l => [l.id, l]));
const CMAP = Object.fromEntries(CATS.map(c => [c.id, c]));
const APP_VERSION = '3.0.0';

/* ---------------- tiny utils ---------------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ic = (n, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const fmtINR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', {maximumFractionDigits: 0});
const fmtINR2 = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', {maximumFractionDigits: 2});
const pad = (x) => String(x).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addMonths = (d, n) => { const o = new Date(d.getFullYear(), d.getMonth() + n, 1); o.setDate(Math.min(d.getDate(), new Date(o.getFullYear(), o.getMonth() + 1, 0).getDate())); return o; };
const prettyDate = (s) => parseYmd(s).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});
const prettyDay = (s) => parseYmd(s).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
const cmpYmd = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const vib = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 420); }, 2400);
}
/* animated money counter */
function countUp(el, target, prefix = '₹') {
  if (!el) return;
  if (Store.s.meta.anim === false || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = prefix + Number(target).toLocaleString('en-IN', {maximumFractionDigits: 0}); return; }
  const t0 = performance.now(), dur = 750;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + Math.round(target * e).toLocaleString('en-IN', {maximumFractionDigits: 0});
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function confirmBox(title, text, onOk) {
  $('#cf-title').textContent = title; $('#cf-text').textContent = text;
  const ok = $('#cf-ok');
  ok.onclick = () => { UI.closeOv('ov-confirm'); onOk(); };
  UI.openOv('ov-confirm');
}

/* ---------------- persistent store ---------------- */
const Store = {
  ls: 'emiflow.v2',
  s: { token: null, user: null, emis: {}, cursor: 0, meta: {theme:'system', anim:true, notify:false}, lastSync: 0, outbox: [], notifiedOn: '', onboarded: false },
  load() { try { const d = JSON.parse(localStorage.getItem(this.ls)); if (d && typeof d === 'object') Object.assign(this.s, d); } catch {} },
  save() { try { localStorage.setItem(this.ls, JSON.stringify(this.s)); } catch {} },
  reset() { try { localStorage.removeItem(this.ls); } catch {} this.s = { token: null, user: null, emis: {}, cursor: 0, meta: {theme:'system', anim:true, notify:false}, lastSync: 0, outbox: [], notifiedOn: '' }; },
};
Store.load();

/* ---------------- api ---------------- */
function api(path, opts = {}) {
  if (Store.s.demo) return Promise.resolve({ok: false, error: 'demo', _status: -1});
  const h = {'content-type': 'application/json', ...(opts.headers || {})};
  if (Store.s.token) h.authorization = 'Bearer ' + Store.s.token;
  return fetch('/api' + path, {...opts, headers: h}).then(async (r) => {
    let d = {}; try { d = await r.json(); } catch {}
    if (r.status === 401 && Store.s.token) { Auth.sessionExpired(); }
    return {...d, _status: r.status};
  }).catch(() => ({ok: false, error: 'network', _status: 0}));
}

/* ---------------- EMI engine ---------------- */
const EMI = {
  normalize(d) {
    return {
      v: 1, id: d.id, name: String(d.name || 'Untitled EMI').slice(0, 60),
      lender: LMAP[d.lender] ? d.lender : 'other',
      cat: CMAP[d.cat] ? d.cat : (CAT_ALIAS[d.cat] || 'other'),
      amt: Math.max(0, Number(d.amt) || 0),
      n: Math.max(1, Math.min(480, Math.round(Number(d.n) || 1))),
      paid: Math.max(0, Math.min(Math.round(Number(d.paid) || 0), Math.round(Number(d.n) || 1))),
      firstDue: /^\d{4}-\d{2}-\d{2}$/.test(d.firstDue || '') ? d.firstDue : today(),
      autopay: !!d.autopay,
      remind: Number(d.remind) || 0,
      notes: String(d.notes || '').slice(0, 240),
      paidDates: Array.isArray(d.paidDates) ? d.paidDates.slice(-60) : [],
      createdAt: d.createdAt || Date.now(), updatedAt: d.updatedAt || Date.now(),
    };
  },
  installmentDate(e, i) { return ymd(addMonths(parseYmd(e.firstDue), i)); },
  statusOf(e) {
    const t = today();
    const rows = [];
    for (let i = 0; i < e.n; i++) {
      const dt = this.installmentDate(e, i);
      rows.push({i, date: dt, state: i < e.paid ? 'paid' : (cmpYmd(dt, t) < 0 ? 'overdue' : 'due')});
    }
    return rows;
  },
  nextDue(e) { const r = this.statusOf(e).find(x => x.state !== 'paid'); return r || null; },
  overdueCount(e) { return this.statusOf(e).filter(x => x.state === 'overdue').length; },
  outstanding(e) { return (e.n - e.paid) * e.amt; },
  progress(e) { return Math.round((e.paid / e.n) * 100); },
  active(e) { return e.paid < e.n; },
  dueInWindow(e, days) {
    const nd = this.nextDue(e); if (!nd) return null;
    const diff = Math.round((parseYmd(nd.date) - parseYmd(today())) / 86400000);
    return diff <= days ? {date: nd.date, in: diff, amt: e.amt} : null;
  },
  /* due occurrences (unpaid) within [ym, ym] month strings */
  duesInMonth(ymStr) {
    const out = [];
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted || !EMI.active(e)) continue;
      for (const r of EMI.statusOf(e)) {
        if (r.state === 'paid') continue;
        if (r.date.startsWith(ymStr)) out.push({emi: e, date: r.date, state: r.state});
      }
    }
    return out;
  },
  monthOutflow(ymStr) { return this.duesInMonth(ymStr).reduce((s, d) => s + d.emi.amt, 0); },
  paidInMonth(ymStr) {
    let sum = 0;
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted) continue;
      for (const d of (e.paidDates || [])) if (d.startsWith(ymStr)) sum += e.amt;
    }
    return sum;
  },
  upcomingSoon() { // next installment within 3 days
    const out = [];
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted || !EMI.active(e)) continue;
      const nd = this.nextDue(e);
      if (nd) { const diff = Math.round((parseYmd(nd.date) - parseYmd(today())) / 86400000); if (diff <= 3) out.push({emi: e, date: nd.date, in: diff, amt: e.amt}); }
    }
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
  },
  summary() {
    const all = Object.values(Store.s.emis).filter(e => !e.deleted);
    const act = all.filter(e => this.active(e));
    const t = today(), ym = t.slice(0, 7);
    const overdue = act.reduce((s, e) => s + this.overdueCount(e) * e.amt, 0);
    const dueThisMonth = act.reduce((s, e) => {
      const r = this.statusOf(e).find(x => x.state !== 'paid' && x.date.startsWith(ym));
      return s + (r ? e.amt : 0);
    }, 0);
    const paidThisMonth = all.reduce((s, e) => s + (e.paidDates || []).filter(d => d.startsWith(ym)).length * e.amt, 0);
    const outstanding = act.reduce((s, e) => s + this.outstanding(e), 0);
    let next = null;
    for (const e of act) { const nd = this.nextDue(e); if (nd && (!next || nd.date < next.date)) next = {date: nd.date, amt: e.amt, emi: e}; }
    return {count: act.length, overdue, dueThisMonth, paidThisMonth, outstanding, next, total: all.length};
  },
  projection(months = 6) {
    const out = []; const now = new Date();
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const ymStr = ymd(d).slice(0, 7);
      out.push({ym: ymStr, label: d.toLocaleDateString('en-IN', {month: 'short'}), amt: this.monthOutflow(ymStr)});
    }
    return out;
  },
  byLender() {
    const m = {};
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted || !this.active(e)) continue;
      (m[e.lender] = m[e.lender] || {amt: 0, count: 0});
      m[e.lender].amt += this.outstanding(e); m[e.lender].count++;
    }
    return Object.entries(m).map(([id, v]) => ({lender: LMAP[id] || LMAP.other, ...v})).sort((a, b) => b.amt - a.amt);
  },
  byCat() {
    const m = {};
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted || !this.active(e)) continue;
      m[e.cat] = (m[e.cat] || 0) + this.outstanding(e);
    }
    return Object.entries(m).map(([id, amt]) => ({cat: CMAP[id] || CMAP.other, amt})).sort((a, b) => b.amt - a.amt);
  },
};

/* ---------------- sync ---------------- */
const Sync = {
  busy: false,
  statusUI(state, txt) {
    const dot = $('#syncdot'), t = $('#synctext'), t2 = $('#syncline2');
    if (dot) dot.className = 'syncdot' + state;
    if (t) t.textContent = txt;
    if (t2) t2.textContent = txt + (Store.s.lastSync ? ' · ' + new Date(Store.s.lastSync).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'}) : '');
  },
  async full(force) {
    if (Store.s.demo) { this.statusUI('', 'demo — sample data'); return; }
    if (this.busy || !Store.s.token) return;
    if (navigator.onLine === false) { this.statusUI(' off', 'offline — changes queued'); return; }
    this.busy = true; this.statusUI('', 'syncing…');
    const ok = await this.push() && await this.pull();
    this.busy = false;
    const pending = Store.s.outbox.length;
    if (ok) { Store.s.lastSync = Date.now(); Store.save(); this.statusUI(' on', pending ? pending + ' pending' : 'all synced'); }
    else this.statusUI(' off', 'offline — changes queued');
    Render.all();
  },
  async push() {
    if (!Store.s.outbox.length) return true;
    const batch = Store.s.outbox.slice(0, 200);
    const r = await api('/sync', {method: 'POST', body: JSON.stringify({changes: batch, cursor: Store.s.cursor})});
    if (r._status === 200 && r.ok) {
      const ids = new Set(batch.map(c => c.id + ':' + c.updatedAt));
      Store.s.outbox = Store.s.outbox.filter(c => !ids.has(c.id + ':' + c.updatedAt));
      Store.s.cursor = Math.max(Store.s.cursor, r.cursor || 0);
      Store.save(); return true;
    }
    return r._status === 0; // network error → keep queued, retry later
  },
  async pull() {
    const r = await api('/sync?cursor=' + encodeURIComponent(Store.s.cursor));
    if (!(r._status === 200 && r.ok)) return false;
    for (const c of r.changes) {
      if (c.deleted) delete Store.s.emis[c.id];
      else Store.s.emis[c.id] = EMI.normalize({...c.json, id: c.id, updatedAt: c.updatedAt});
    }
    Store.s.cursor = r.cursor || Store.s.cursor;
    Store.save(); return true;
  },
  queueLocal(doc) { // local-first write + outbox
    doc.updatedAt = Date.now();
    Store.s.emis[doc.id] = doc;
    Store.s.outbox.push({id: doc.id, json: doc, updatedAt: doc.updatedAt, deleted: !!doc.deleted});
    if (Store.s.outbox.length > 600) Store.s.outbox = Store.s.outbox.slice(-600);
    Store.save();
  },
  async saveMeta(meta) {
    Store.s.meta = {...Store.s.meta, ...meta}; Store.save();
    Render.profile();
    await api('/meta', {method: 'POST', body: JSON.stringify({json: Store.s.meta})});
  },
  async exportCloud() {
    if (Store.s.demo) {
      const dump = {exported_at: new Date().toISOString(), app: 'EMIFlow (demo)', emis: Object.values(Store.s.emis), meta: Store.s.meta};
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], {type: 'application/json'}));
      a.download = 'emiflow-demo-' + today() + '.json'; a.click();
      return toast('Demo backup downloaded');
    }
    const r = await fetch('/api/account/export', {headers: {authorization: 'Bearer ' + Store.s.token}});
    if (!r.ok) return toast('Export failed', true);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'emiflow-backup-' + today() + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('Backup downloaded');
  },
};

/* ---------------- reminders ---------------- */
const Remind = {
  async check() {
    if (!Store.s.meta.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const t = today(); if (Store.s.notifiedOn === t) return;
    const msgs = [];
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted || !EMI.active(e)) continue;
      const w = EMI.dueInWindow(e, Math.max(e.remind, 0));
      if (w && w.in >= 0) msgs.push(`${fmtINR(w.amt)} · ${e.name} — due ${w.in === 0 ? 'today' : w.in === 1 ? 'tomorrow' : 'in ' + w.in + ' days'}${w.in < 0 ? ' (OVERDUE)' : ''}`);
    }
    if (msgs.length) {
      try { new Notification('EMIFlow — ' + msgs.length + ' payment' + (msgs.length > 1 ? 's' : '') + ' coming up', {body: msgs.slice(0, 3).join('\n'), icon: '/icons/icon-192.png'}); } catch {}
      Store.s.notifiedOn = t; Store.save();
    }
  },
  banner() {
    const host = $('#duobanner'); if (!host) return;
    const urgent = [];
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted || !EMI.active(e)) continue;
      const od = EMI.overdueCount(e);
      if (od > 0) urgent.push({e, txt: `${e.name} — ${od} overdue (${fmtINR(od * e.amt)})`, act: 'pay', id: e.id});
      else { const w = EMI.dueInWindow(e, 2); if (w && w.in >= 0) urgent.push({e, txt: `${e.name} — ${fmtINR(w.amt)} due ${w.in === 0 ? 'today' : 'tomorrow'}${e.autopay ? ' · autopay' : ''}`, act: 'pay', id: e.id}); }
    }
    if (!urgent.length) { host.innerHTML = ''; return; }
    const u = urgent.sort((a, b) => a.e.name.localeCompare(b.e.name))[0];
    host.innerHTML = `<div class="banner">${ic('alert', 'ic sm')}<span class="grow">${esc(u.txt)}</span>
      <button class="bpay" onclick="Detail.open('${u.id}')">Pay →</button></div>`;
  },
};
