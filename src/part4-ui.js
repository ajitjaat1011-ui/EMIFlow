/* ============================================================
   EMI Flow v3.0 — pages: splash · onboarding · auth · dashboard
   ============================================================ */
'use strict';

/* ---------------- shared UI ---------------- */
const UI = {
  openOv(id) { $('#' + id).classList.add('on'); document.body.style.overflow = 'hidden'; },
  closeOv(id) { $('#' + id).classList.remove('on'); document.body.style.overflow = ''; },
  eye(inputId, btn) {
    const i = $('#' + inputId);
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    btn.innerHTML = ic(show ? 'eyeoff' : 'eye', 'ic sm');
  },
};
document.querySelectorAll('.ov').forEach(ov => ov.addEventListener('click', (e) => { if (e.target === ov) UI.closeOv(ov.id); }));

function lenderTile(id, cls) {
  const L = LMAP[id] || LMAP.other;
  const icn = LENDER_ICONS[id];
  if (icn) return `<img class="${cls}" src="${icn}" alt="${esc(L.n)}" loading="lazy">`;
  return `<div class="${cls} ph" style="background:${L.c}">${esc(L.n.slice(0, 2).toUpperCase())}</div>`;
}

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 420); }, 2400);
}
function confirmBox(title, text, onOk) {
  $('#cf-title').textContent = title; $('#cf-text').textContent = text;
  $('#cf-ok').onclick = () => { UI.closeOv('ov-confirm'); onOk(); };
  UI.openOv('ov-confirm');
}

/* ---------------- router ---------------- */
const Route = {
  cur: 'home',
  to(name) { // top-level: splash onboard login register success app
    ['scr-splash','scr-onboard','scr-login','scr-register','scr-success'].forEach(id => $('#' + id).classList.add('hidden'));
    $('#app').classList.add('hidden'); $('#bnav').classList.add('hidden');
    if (name === 'app') {
      $('#app').classList.remove('hidden'); $('#bnav').classList.remove('hidden');
      this.go(this.cur === 'add' ? 'home' : this.cur);
      return;
    }
    const el = $('#scr-' + name);
    if (el) el.classList.remove('hidden');
    window.scrollTo(0, 0);
  },
  go(tab, hideNav) {
    this.cur = tab;

    document.querySelectorAll('.app-scr').forEach(s => s.classList.remove('on'));
    const scr = $('#scr-' + tab); if (scr) scr.classList.add('on');
    document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $('#bnav').classList.toggle('hidden', !!hideNav);
    if (tab === 'home') Render.home();
    if (tab === 'emis') EMIs.render();
    if (tab === 'insights') Render.insights();
    if (tab === 'calendar') Cal.render();
    if (tab === 'profile') Render.profile();
    window.scrollTo(0, 0);
  },
  back() { this.go('emis'); },
};

/* ---------------- onboarding ---------------- */
const OB = {
  i: 0,
  show(n) {
    this.i = n;
    document.querySelectorAll('.ob-slide').forEach(s => s.classList.toggle('on', +s.dataset.s === n));
    document.querySelectorAll('#obdots i').forEach((d, j) => d.classList.toggle('on', j === n));
    $('#obbtn').innerHTML = (n === 2 ? "Let's Go " : (n === 0 ? 'Get Started ' : 'Next ')) + ic('arrow', 'ic sm');
  },
  next() { this.i >= 2 ? this.done() : this.show(this.i + 1); },
  skip() { this.done(); },
  done() {
    Store.s.onboarded = true; Store.save();
    Route.to(Store.s.token || Store.s.demo ? 'app' : 'login');
  },
};

/* ---------------- auth ---------------- */
const Auth = {
  pendingUser: null,
  err(id, msg) { const e = $('#' + id); e.textContent = msg; e.classList.toggle('hidden', !msg); },
  async login() {
    const ident = $('#li-user').value.trim().toLowerCase();
    const pass = $('#li-pass').value;
    this.err('li-err', '');
    if (/^\d{10}$/.test(ident.replace(/\D/g, '')) && !ident.includes('@')) {
      const p = ident.replace(/\D/g, '');
      if (p.length !== 10) return this.err('li-err', 'Enter a valid 10-digit mobile number.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ident)) {
      return this.err('li-err', 'Enter a valid mobile number or email.');
    }
    if (pass.length < 8) return this.err('li-err', 'Password must be at least 8 characters.');
    const btn = $('#li-go'); btn.disabled = true; btn.textContent = 'Please wait…';
    const r = await api('/auth/login', {method: 'POST', body: JSON.stringify({email: ident, password: pass})});
    btn.disabled = false; btn.innerHTML = 'Login ' + ic('arrow', 'ic sm');
    if (!r.ok) {
      const M = {bad_credentials: 'Wrong mobile/email or password.', rate_limited: 'Too many attempts — wait a few minutes.', network: 'You appear offline.'};
      return this.err('li-err', M[r.error] || ('Login failed (' + (r.error || r._status) + ')'));
    }
    Store.s.demo = false;
    Store.s.token = r.token; Store.s.user = r.user; Store.s.emis = {}; Store.s.cursor = 0; Store.save();
    toast('Welcome back, ' + r.user.name.split(' ')[0] + '!');
    this.enterApp();
    Sync.full();
  },
  async register() {
    const name = $('#rg-name').value.trim();
    const phone = $('#rg-phone').value.replace(/\D/g, '');
    const email = $('#rg-email').value.trim().toLowerCase();
    const pass = $('#rg-pass').value;
    const terms = $('#rg-terms').checked;
    this.err('rg-err', '');
    if (name.length < 2) return this.err('rg-err', 'Please enter your full name.');
    if (phone.length !== 10) return this.err('rg-err', 'Enter a valid 10-digit mobile number.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return this.err('rg-err', 'That email doesn\'t look right.');
    if (pass.length < 8) return this.err('rg-err', 'Password must be at least 8 characters.');
    if (!terms) return this.err('rg-err', 'Please agree to the Terms & Privacy Policy.');
    const btn = $('#rg-go'); btn.disabled = true; btn.textContent = 'Creating…';
    const finalEmail = email || ('user' + phone + '@emiflow.local');
    const r = await api('/auth/register', {method: 'POST', body: JSON.stringify({name, email: finalEmail, phone, password: pass})});
    btn.disabled = false; btn.innerHTML = 'Create Account ' + ic('arrow', 'ic sm');
    if (!r.ok) {
      const M = {email_taken: 'Account already exists with this mobile/email — Login instead.', bad_phone: 'Invalid mobile number.', rate_limited: 'Too many attempts — wait a bit.', network: 'You appear offline.'};
      return this.err('rg-err', M[r.error] || ('Could not create account (' + (r.error || r._status) + ')'));
    }
    Store.s.demo = false;
    Store.s.token = r.token; Store.s.user = r.user; Store.s.emis = {}; Store.s.cursor = 0; Store.save();
    this.pendingUser = r.user;
    Route.to('success');
    try { fetch('/api/analytics', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({e: 'auth', s: 'register'})}); } catch {}
  },
  finishRegister() {
    this.enterApp();
    toast('Start by adding your first EMI');
    Sync.full();
  },
  enterApp() {
    Route.cur = 'home';
    Route.to('app');
    Render.all();
    Sync.statusUI('', 'syncing…');
    if (!Store.s.demo) Sync.full();
    Remind.check();
  },
  forgotView(show = true) {
    $('#li-forgot').classList.toggle('hidden', !show);
    if (show) $('#li-forgot').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  },
  async forgotSend() {
    const email = $('#fg-email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return $('#fg-msg').textContent = 'Enter a valid email.';
    $('#fg-msg').textContent = 'Checking…';
    const r = await api('/auth/forgot-password', {method: 'POST', body: JSON.stringify({email})});
    if (r.ok) {
      $('#fg-code-wrap').classList.remove('hidden');
      $('#fg-msg').innerHTML = r.code ? `Email delivery is currently disabled — your reset code is: <b>${esc(r.code)}</b>` : 'If that account exists, a code was issued.';
      if (r.code) $('#fg-code').value = r.code;
    } else $('#fg-msg').textContent = 'Failed — try again in a bit.';
  },
  async resetDo() {
    const email = $('#fg-email').value.trim().toLowerCase();
    const code = $('#fg-code').value.trim(), pass = $('#fg-pass').value;
    if (code.length !== 6) return $('#fg-msg').textContent = 'Enter the 6-digit code.';
    if (pass.length < 8) return $('#fg-msg').textContent = 'New password must be 8+ characters.';
    const r = await api('/auth/reset-password', {method: 'POST', body: JSON.stringify({email, code, password: pass})});
    if (r.ok) { $('#fg-msg').textContent = 'Password set! Login with it now.'; setTimeout(() => this.forgotView(false), 1000); }
    else $('#fg-msg').textContent = 'Invalid or expired code.';
  },
  sessionExpired() {
    if (!Store.s.token || Store.s.demo) return;
    Store.s.token = null; Store.save();
    toast('Session expired — login again', true);
    Route.to('login');
  },
  logout() {
    const doIt = async () => {
      if (!Store.s.demo) await api('/auth/logout', {method: 'POST'});
      Store.s.token = null; Store.s.demo = false; Store.save();
      Route.to('login'); toast('Logged out');
    };
    confirmBox('Log out?', 'You can login back anytime.', doIt);
  },
};

/* ---------------- my EMIs (tabs) ---------------- */
const EMIs = {
  tab: 'active',
  switchTo(t) {
    this.tab = t;
    document.querySelectorAll('#emitabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    this.render();
  },
  render() {
  const t = today();
  const all = Object.values(Store.s.emis).filter(e => !e.deleted);
  const started = (e) => e.paid > 0 || cmpYmd(e.firstDue, t) <= 0;
  const groups = {
    active: all.filter(e => started(e) && EMI.active(e)),
    upcoming: all.filter(e => !started(e)),
    done: all.filter(e => !EMI.active(e)),
  };
  document.querySelector('#emitabs [data-t=active]').textContent = `Active (${groups.active.length})`;
  document.querySelector('#emitabs [data-t=upcoming]').textContent = `Upcoming (${groups.upcoming.length})`;
  document.querySelector('#emitabs [data-t=done]').textContent = `Completed (${groups.done.length})`;
  const list = groups[this.tab].sort((a, b) => {
    const da = (EMI.nextDue(a) || {date: a.firstDue}).date, db2 = (EMI.nextDue(b) || {date: b.firstDue}).date;
    return da < db2 ? -1 : 1;
  });
  $('#emilist').innerHTML = list.length ? list.map(e => {
    const nd = EMI.nextDue(e);
    const od = EMI.overdueCount(e);
    let st, cls;
    if (!EMI.active(e)) { st = 'Completed'; cls = 'ok'; }
    else if (od) { st = od + ' overdue'; cls = 'bad'; }
    else if (nd) {
      const diff = Math.round((parseYmd(nd.date) - parseYmd(t)) / 86400000);
      st = diff === 0 ? 'Due today' : diff <= 3 ? 'Due in ' + diff + 'd' : 'Next: ' + prettyDay(nd.date);
      cls = diff <= 3 ? 'warn' : 'mut';
    } else { st = '—'; cls = 'mut'; }
    return `<div class="emirow" onclick="Detail.open('${e.id}')">
      ${lenderTile(e.lender, 'logo')}
      <div class="grow"><div class="t">${esc(e.name)}</div><div class="s">${esc((LMAP[e.lender] || LMAP.other).n)} · ${e.paid}/${e.n} paid</div></div>
      <div style="text-align:right"><div class="amt">${fmtINR(e.amt)}</div><div class="st ${cls}">${st}</div></div>
    </div>`;
  }).join('') : `<div class="card" style="text-align:center;padding:36px 20px">
    <div style="width:56px;height:56px;border-radius:18px;background:var(--acc-soft);color:var(--acc);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">${ic('wallet', 'ic lg')}</div>
    <h3>Nothing here yet</h3><p class="small mut" style="margin-top:4px">Add an EMI and it will show up in this list.</p></div>`;
  },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('#emitabs button');
  if (b) EMIs.switchTo(b.dataset.t);
});

/* ---------------- detail sheet ---------------- */
const Detail = {
  id: null,
  open(id) {
    const e = Store.s.emis[id]; if (!e) return;
    this.id = id;
    const L = LMAP[e.lender] || LMAP.other, C = CMAP[e.cat] || CMAP.other;
    const nd = EMI.nextDue(e), od = EMI.overdueCount(e), prog = EMI.progress(e);
    const upcoming = EMI.statusOf(e).filter(r => r.state !== 'paid').slice(0, 3);
    const hist = (e.paidDates || []).slice(-4).reverse().map((d) =>
      `<div class="hrow"><div class="dd ok"><small>${parseYmd(d).toLocaleDateString('en-IN', {month: 'short'})}</small>${parseYmd(d).getDate()}</div>
       <div class="grow"><b>${fmtINR(e.amt)}</b> <span class="mut small">paid</span></div><span class="chip ok">paid</span></div>`).join('');
    $('#dt-title').textContent = e.name;
    $('#dt-body').innerHTML = `
      <div class="row" style="margin:4px 0 2px">${lenderTile(e.lender, 'logo')}
        <div class="grow" style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(L.n)}</b>
        <span class="tiny mut" style="font-weight:600">${C.n}${e.autopay ? ' · autopay' : ''}</span></div>
        <span class="chip acc">${e.paid}/${e.n}</span></div>
      <div class="dsum">
        <div><div class="k">EMI</div><div class="v">${fmtINR(e.amt)}</div></div>
        <div><div class="k">Remaining</div><div class="v">${fmtINR(EMI.outstanding(e))}</div></div>
        <div><div class="k">Progress</div><div class="v">${prog}%</div></div>
      </div>
      <div class="prog"><i style="width:${prog}%"></i></div>
      <div class="tiny mut" style="text-align:center;margin-bottom:6px">started ${prettyDate(e.firstDue)}${e.notes ? ' · ' + esc(e.notes) : ''}</div>
      ${od ? `<div class="oknote" style="background:var(--dangerbg);color:var(--danger)">${ic('alert', 'ic sm')} ${od} installment${od > 1 ? 's' : ''} overdue</div>` : ''}
      ${nd ? `<button class="pill" style="margin-top:14px" onclick="Detail.pay()">${od ? 'Clear overdue' : 'Mark paid'} · ${fmtINR(e.amt)} <svg class="ic sm"><use href="#i-arrow"/></svg></button>`
           : `<div class="oknote" style="margin-top:14px">${ic('check', 'ic sm')} Loan completed — well done!</div>`}
      ${upcoming.length ? `<label class="fl">Upcoming</label>${upcoming.map(r => `<div class="hrow"><div class="dd mut2"><small>${parseYmd(r.date).toLocaleDateString('en-IN', {month: 'short'})}</small>${parseYmd(r.date).getDate()}</div><div class="grow">${fmtINR(e.amt)} <span class="mut small">· #${r.i + 1}</span></div><span class="chip">${r.state}</span></div>`).join('')}` : ''}
      ${hist ? `<label class="fl">Recent payments</label>${hist}` : ''}
      <div class="row" style="gap:10px;margin-top:18px">
        <button class="btn2 grow" onclick="UI.closeOv('ov-detail');Edit2.open('${e.id}')">Edit</button>
        <button class="btn2 danger grow" onclick="Detail.remove()">Delete</button>
      </div>`;
    UI.openOv('ov-detail');
  },
  pay() {
    const e = Store.s.emis[this.id]; if (!e) return;
    const nd = EMI.nextDue(e); if (!nd) return;
    e.paid = Math.min(e.n, e.paid + 1);
    e.paidDates = [...(e.paidDates || []), nd.date].slice(-60);
    vib([12, 40, 12]);
    Sync.queueLocal({...e});
    toast(`Paid ${fmtINR(e.amt)} — ${e.name}`);
    if (!Store.s.demo) { try { fetch('/api/payments', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + Store.s.token}, body: JSON.stringify({emiId: e.id, amt: e.amt})}); } catch {} }
    UI.closeOv('ov-detail');
    Render.all(); Sync.full();
  },
  remove() {
    const e = Store.s.emis[this.id]; if (!e) return;
    if (Store.s.demo) return toast('Demo — nothing is deleted', true);
    confirmBox(`Delete “${e.name}”?`, 'It will be removed from all your devices.', () => {
      Sync.queueLocal({...e, deleted: true, updatedAt: Date.now()});
      delete Store.s.emis[e.id];
      UI.closeOv('ov-detail');
      toast('EMI deleted'); Render.all(); Sync.full();
    });
  },
};

/* ---------------- add / edit page ---------------- */
const Edit2 = {
  cat: 'personal', editId: null,
  open(id) {
    this.editId = id || null;
    const e = id ? Store.s.emis[id] : null;
    $('#addTitle').textContent = id ? 'Edit EMI' : 'Add New EMI';
    this.cat = e ? (CMAP[e.cat] ? e.cat : 'other') : 'personal';
    this.lender = e ? e.lender : 'other';
    $('#addLender').innerHTML = '<option value="" disabled ' + (e ? '' : 'selected') + '>Select provider</option>' +
      LENDERS.map(l => `<option value="${l.id}" ${e && e.lender === l.id ? 'selected' : ''}>${esc(l.n)}</option>`).join('');
    $('#addLender').onchange = (ev) => { this.lender = ev.target.value || 'other'; };
    $('#addAmt').value = e ? e.amt : '';
    $('#addN').value = e ? String(e.n) : '12';
    $('#addDate').value = e ? e.firstDue : ymd(addMonths(new Date(), 1));
    $('#addRemind').checked = e ? e.remind > 0 : true;
    $('#addErr').classList.add('hidden');
    $('#addEditWrap').classList.toggle('hidden', !id);
    this.renderCats();
    Route.go('add', true);
  },
  renderCats() {
    $('#addCats').innerHTML = CATS.map(c =>
      `<div class="cattile ${c.id === this.cat ? 'on' : ''}" onclick="Edit2.cat='${c.id}';Edit2.renderCats()">
        <span class="cic" style="background:${c.c}">${ic(c.ic, 'ic sm')}</span><span>${c.n}</span></div>`).join('');
  },
  save() {
    const amt = Number($('#addAmt').value), n = Math.round(Number($('#addN').value));
    const first = $('#addDate').value;
    const err = (m) => { const el = $('#addErr'); el.textContent = m; el.classList.remove('hidden'); };
    if (!this.lender) this.lender = 'other';
    const L = this.lenderName();
    const defName = L === 'Other' ? (CATS.find(c => c.id === this.cat) || {}).n + ' EMI' : L;
    if (!(amt > 0)) return err('Enter the EMI amount.');
    if (!(n >= 1 && n <= 480)) return err('Pick a valid tenure.');
    if (!first) return err('Pick a start date.');
    const prev = this.editId ? Store.s.emis[this.editId] : null;
    const remind = $('#addRemind').checked ? 2 : 0;
    const doc = EMI.normalize({
      ...(prev || {}), id: this.editId || ('e' + Math.random().toString(36).slice(2, 10)),
      name: prev ? prev.name : defName + ' · ' + fmtINR(amt),
      lender: this.lender, cat: this.cat, amt, n,
      paid: prev ? prev.paid : 0, firstDue: first,
      autopay: prev ? prev.autopay : false, remind,
      notes: prev ? prev.notes : '', createdAt: prev ? prev.createdAt : Date.now(),
      paidDates: prev ? prev.paidDates : [],
    });
    Sync.queueLocal(doc);
    toast(this.editId ? 'EMI updated' : 'EMI added');
    vib(10);
    Route.go('emis');
    Render.all(); Sync.full();
  },
  lender: 'other',
  lenderName() { return (LMAP[this.lender] || LMAP.other).n; },
  remove() {
    if (!this.editId) return;
    Detail.id = this.editId;
    Detail.remove();
    Route.go('emis');
  },
};

/* ---------------- calendar ---------------- */
const Cal = {
  off: 0,
  nav(d) { this.off += d; this.render(); },
  render() {
    const g = $('#calgrid'); if (!g) return;
    const base = new Date(); const m = new Date(base.getFullYear(), base.getMonth() + this.off, 1);
    $('#caltitle').textContent = m.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'});
    const ymStr = ymd(m).slice(0, 7);
    const firstDow = m.getDay(); // Sun-first (mock)
    const dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const dues = EMI.duesInMonth(ymStr);
    const byDay = {};
    for (const d of dues) (byDay[d.date] = byDay[d.date] || []).push(d);
    const t = today();
    let html = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < firstDow; i++) html += '<div></div>';
    for (let day = 1; day <= dim; day++) {
      const ds = ymStr + '-' + pad(day);
      const list = byDay[ds] || [];
      const over = list.some(x => x.state === 'overdue');
      const cls = ['cday', list.length ? (over ? 'odata' : 'due') : '', ds === t ? 'today' : ''].join(' ');
      html += `<div class="${cls}" onclick="Cal.day('${ds}')"><span>${day}</span></div>`;
    }
    g.innerHTML = html;
    this.list(ymStr);
  },
  list(ymStr) {
    const dues = EMI.duesInMonth(ymStr).sort((a, b) => a.date < b.date ? -1 : 1);
    const el = $('#duelist');
    el.innerHTML = dues.length ? dues.map(x => `
      <div class="duerow" onclick="Detail.open('${x.emi.id}')">
        <div class="d">${parseYmd(x.date).getDate()} ${parseYmd(x.date).toLocaleDateString('en-IN', {month: 'short'})}</div>
        <div class="n">${esc(x.emi.name)}${x.state === 'overdue' ? ' <span class="tiny" style="color:var(--danger);font-weight:700">overdue</span>' : ''}</div>
        <div class="a">${fmtINR(x.emi.amt)}</div>
      </div>`).join('')
    : `<div class="card" style="text-align:center;color:var(--mut);font-weight:600;font-size:13.5px;padding:22px">No due dates this month 🎉</div>`;
  },
  day(ds) {
    const list = EMI.duesInMonth(ds.slice(0, 7)).filter(x => x.date === ds);
    if (list.length === 1) Detail.open(list[0].emi.id);
    else if (list.length) Detail.open(list[0].emi.id);
  },
};

/* ---------------- charts ---------------- */
const Charts = {
  spark(el, values) {
    const W = 320, H = 74, max = Math.max(...values, 1), min = Math.min(...values, 0);
    const pts = values.map((v, i) => [i * (W / (values.length - 1)), H - 8 - ((v - min) / (max - min || 1)) * (H - 22)]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
    }
    el.innerHTML = `<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7d86ff" stop-opacity=".38"/><stop offset="1" stop-color="#7d86ff" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${W},${H} L0,${H} Z" fill="url(#sg)"/>
      <path d="${d}" fill="none" stroke="#565fe9" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="4" fill="#565fe9"/>`;
  },
  bars(el, data) { // [{label, val, past}]
    const max = Math.max(...data.map(d => d.val), 1);
    el.innerHTML = data.map(d =>
      `<div class="b ${d.past ? 'past' : ''}"><span class="val">${d.val ? (d.val >= 1000 ? (d.val / 1000).toFixed(d.val >= 10000 ? 0 : 1) + 'k' : d.val) : ''}</span>
       <i style="height:${Math.max(4, Math.round(d.val / max * 100))}%"></i><span class="l">${d.label}</span></div>`).join('');
  },
  donut(svgEl, parts, total) { // [{label, val, color}]
    const R = 56, C = 2 * Math.PI * R;
    let off = 0, segs = '', leg = '';
    for (const p of parts) {
      const frac = p.val / (total || 1);
      const len = frac * C;
      segs += `<circle cx="66" cy="66" r="${R}" fill="none" stroke="${p.color}" stroke-width="14" stroke-dasharray="${Math.max(len - 3, 0)} ${C - Math.max(len - 3, 0)}" stroke-dashoffset="${-off}" stroke-linecap="round"/>`;
      off += len;
      leg += `<div class="li"><i style="background:${p.color}"></i>${p.label}<span class="pc">${Math.round(frac * 100)}%</span></div>`;
    }
    if (!parts.length) segs = `<circle cx="66" cy="66" r="${R}" fill="none" stroke="var(--field)" stroke-width="14"/>`;
    svgEl.innerHTML = segs;
    $('#donutLeg').innerHTML = leg || '<div class="li mut">No data yet</div>';
    $('#donutTot').textContent = fmtINR(total);
  },
  trend(el, data) { // [{label, val}]
    const W = 320, H = 110, max = Math.max(...data.map(d => d.val), 1);
    const pts = data.map((d, i) => [18 + i * ((W - 36) / (data.length - 1)), H - 22 - (d.val / max) * (H - 48)]);
    let d2 = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const mx = (x0 + x1) / 2;
      d2 += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
    }
    el.innerHTML = `<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8b7cff" stop-opacity=".3"/><stop offset="1" stop-color="#8b7cff" stop-opacity="0"/></linearGradient></defs>
      <path d="${d2} L${pts[pts.length - 1][0]},${H - 14} L${pts[0][0]},${H - 14} Z" fill="url(#tg)"/>
      <path d="${d2}" fill="none" stroke="#7c5cf0" stroke-width="2.5" stroke-linecap="round"/>
      ${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#7c5cf0"/>`).join('')}
      ${data.map((d, i) => `<text x="${pts[i][0]}" y="${H - 2}" font-size="9.5" fill="var(--mut)" text-anchor="middle" font-weight="600">${d.label}</text>`).join('')}
      <text x="${pts[pts.length - 1][0] - 4}" y="${pts[pts.length - 1][1] - 9}" font-size="10" fill="#7c5cf0" text-anchor="end" font-weight="700">${fmtINR(data[data.length - 1].val)}</text>`;
  },
};

/* ---------------- render ---------------- */
const Render = {
  all() { this.home(); EMIs.render(); this.insights(); Cal.render(); this.profile(); this.banner(); },
  home() {
    const s = EMI.summary();
    const h = new Date().getHours();
    $('#hgreet').textContent = h < 12 ? 'Good Morning,' : h < 17 ? 'Good Afternoon,' : 'Good Evening,';
    $('#hname').textContent = (Store.s.user?.name || 'Arvind').split(' ')[0] + ' 👋';
    const heroTotal = s.dueThisMonth + s.overdue;
    $('#heroAmt').innerHTML = fmtINR(heroTotal) + (s.overdue ? ` <small>overdue</small>` : '');
    Charts.spark($('#heroSpark'), EMI.projection(6).map(p => p.amt));
    $('#tUpcoming').textContent = s.next ? fmtINR(s.next.amt) : '₹0';
    $('#tUpcomingS').textContent = s.next ? prettyDay(s.next.date) : 'nothing due';
    $('#tPaid').textContent = fmtINR(s.paidThisMonth);
    $('#tActive').textContent = s.count;
    $('#tActiveS').textContent = 'in progress';
    $('#tRemain').textContent = fmtINR(s.outstanding);
    $('#belldot').classList.toggle('hidden', !EMI.upcomingSoon().length);
    this.banner();
  },
  banner() {
    const m = $('#motivate'); if (!m) return;
    const s = EMI.summary();
    if (s.overdue) {
      m.className = 'motivate warn';
      m.innerHTML = `${ic('alert', 'ic sm')} <span class="grow">${fmtINR(s.overdue)} overdue — clear them to stay on track.</span>`;
    } else {
      m.className = 'motivate';
      m.innerHTML = `${ic('spark2', 'ic sm')} <span class="grow"><b>Keep going!</b> You're one step closer to your goals.</span>`;
    }
  },
  insights() {
    const t = today();
    const ym = t.slice(0, 7);
    const paidThis = EMI.paidInMonth(ym);
    const prev = new Date(); prev.setMonth(prev.getMonth() - 1);
    const paidPrev = EMI.paidInMonth(ymd(prev).slice(0, 7));
    $('#insPaid').textContent = fmtINR(paidThis);
    const dPct = paidPrev ? Math.round((paidThis - paidPrev) / paidPrev * 100) : (paidThis ? 100 : 0);
    const dEl = $('#insDelta');
    dEl.className = 'delta ' + (dPct >= 0 ? 'up' : 'down');
    dEl.textContent = (dPct >= 0 ? '↑ ' : '↓ ') + Math.abs(dPct) + '%';
    // bars: paid last 3 + forecast next 3 (incl current)
    const months = [];
    const now = new Date();
    for (let i = -3; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const ymS = ymd(d).slice(0, 7);
      const label = d.toLocaleDateString('en-IN', {month: 'short'});
      if (i < 0) months.push({label, val: EMI.paidInMonth(ymS), past: true});
      else if (i === 0) months.push({label, val: EMI.paidInMonth(ymS) || EMI.monthOutflow(ymS), past: false});
      else months.push({label, val: EMI.monthOutflow(ymS), past: true});
    }
    Charts.bars($('#insBars'), months);
    // donut
    const colors = {personal: '#565fe9', consumer: '#8b5cf6', bnpl: '#f0a32f', other: '#94a3b8'};
    const byCat = {};
    let tot = 0;
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted || !EMI.active(e)) continue;
      byCat[e.cat] = (byCat[e.cat] || 0) + EMI.outstanding(e);
      tot += EMI.outstanding(e);
    }
    Charts.donut($('#donutSvg'), Object.entries(byCat).map(([id, val]) => ({label: (CMAP[id] || CMAP.other).n, val, color: colors[id] || '#94a3b8'})).sort((a, b) => b.val - a.val), tot);
    // trend: paid last 6 months
    const tr = [];
    for (let i = -5; i <= 0; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      tr.push({label: d.toLocaleDateString('en-IN', {month: 'short'}), val: EMI.paidInMonth(ymd(d).slice(0, 7))});
    }
    Charts.trend($('#trendSvg'), tr);
    const s = EMI.summary();
    const note = $('#insNote');
    if (s.overdue) { note.style.background = 'var(--warnbg)'; note.style.color = 'var(--warn)';
      note.innerHTML = `${ic('alert', 'ic sm')} ${fmtINR(s.overdue)} is overdue — clear it to keep your streak.`; }
    else { note.style.background = ''; note.style.color = '';
      note.innerHTML = `${ic('check', 'ic sm')} You're doing great! On track with your payments.`; }
  },
  profile() {
    const u = Store.s.user || {name: 'Arvind Choudhary', email: 'arvind@example.com'};
    $('#pava').textContent = (u.name || 'A')[0].toUpperCase();
    $('#pname').textContent = u.name;
    $('#pemail').textContent = Store.s.demo ? 'demo · local only' : u.email;
    $('#swnotify').checked = !!Store.s.meta.notify;
  },
};

/* ---------------- profile extras ---------------- */
const Profile = {
  payHistory() {
    const rows = [];
    for (const e of Object.values(Store.s.emis)) {
      if (e.deleted) continue;
      for (const d of (e.paidDates || [])) rows.push({d, e});
    }
    rows.sort((a, b) => a.d < b.d ? 1 : -1);
    $('#gen-title').textContent = 'Payment History';
    $('#gen-body').innerHTML = rows.length ? rows.slice(0, 30).map(r => `
      <div class="hrow">${lenderTile(r.e.lender, 'logo')}<div class="grow"><b>${esc(r.e.name)}</b>
      <div class="tiny mut" style="font-weight:600">${prettyDate(r.d)}</div></div>
      <b class="num">${fmtINR(r.e.amt)}</b></div>`).join('')
    : '<p class="mut small" style="padding:10px 0">No payments recorded yet. Mark an EMI as paid to see it here.</p>';
    UI.openOv('ov-gen');
  },
  providers() {
    const used = new Set(Object.values(Store.s.emis).filter(e => !e.deleted).map(e => e.lender));
    $('#gen-title').textContent = 'Manage Providers';
    $('#gen-body').innerHTML = LENDERS.filter(l => l.id !== 'other').map(l => `
      <div class="hrow">${lenderTile(l.id, 'logo')}<div class="grow"><b>${esc(l.n)}</b></div>
      ${used.has(l.id) ? '<span class="chip acc">in use</span>' : '<span class="chip">available</span>'}</div>`).join('');
    UI.openOv('ov-gen');
  },
  appearance() {
    const cur = Store.s.meta.theme || 'system';
    const opts = [
      {v:'light', ic:'i-sun',  t:'Light',  d:'Bright and airy'},
      {v:'dark',  ic:'i-moon', t:'Dark',   d:'Easy on the eyes at night'},
      {v:'system',ic:'i-gear', t:'Auto',   d:'Follows your phone setting'}];
    $('#gen-title').textContent = 'Appearance';
    $('#gen-body').innerHTML = opts.map(o => `
      <button class="mrow" data-v="${o.v}" style="border:0;width:100%;text-align:left;background:none;padding:12px 2px">
        <span class="mic"><svg class="ic sm"><use href="#${o.ic}"/></svg></span>
        <span class="grow"><span style="font-weight:700;font-size:14.5px">${o.t}</span><div class="tiny mut" style="font-weight:600">${o.d}</div></span>
        ${cur === o.v ? '<svg class="ic sm" style="color:var(--acc)"><use href="#i-check"/></svg>' : ''}</button>`).join('');
    document.querySelectorAll('#gen-body [data-v]').forEach(b => {
      b.onclick = () => { Sync.saveMeta({theme: b.dataset.v}).then(() => { applyTheme(); Profile.appearance(); Profile.paintTheme(); }); };
    });
    UI.openOv('ov-gen');
  },
  paintTheme() {
    const c = $('#themechoice');
    if (c) c.textContent = {light:'Light', dark:'Dark'}[Store.s.meta.theme || 'system'] || 'Auto';
    if (c) c.className = 'chip' + ((Store.s.meta.theme || 'system') === 'dark' ? ' acc' : '');
  },
  settings() {
    $('#gen-title').textContent = 'App Settings';
    $('#gen-body').innerHTML = `
      <label class="fl">Theme</label>
      <div class="seg2" id="segtheme" style="margin:0">
        <button data-v="system">Auto</button><button data-v="light">Light</button><button data-v="dark">Dark</button>
      </div>
      <div class="swrow" style="margin-top:16px"><div class="t">Animations</div>
        <label class="sw"><input type="checkbox" id="swanim" checked><i></i></label></div>
      <button class="btn2 danger wfull" style="margin-top:20px" onclick="Auth.deleteAccount()">Delete account</button>`;
    document.querySelectorAll('#segtheme button').forEach(b => {
      b.classList.toggle('on', b.dataset.v === (Store.s.meta.theme || 'system'));
      b.onclick = () => { Sync.saveMeta({theme: b.dataset.v}).then(() => { applyTheme(); Profile.settings(); }); };
    });
    $('#swanim').checked = Store.s.meta.anim !== false;
    $('#swanim').onchange = (e) => Sync.saveMeta({anim: e.target.checked}).then(applyTheme);
    UI.openOv('ov-gen');
  },
  about() {
    $('#gen-title').textContent = 'About EMI Flow';
    $('#gen-body').innerHTML = `
      <div style="text-align:center;padding:8px 0 4px">
        <img src="/icons/icon-192.png" style="width:64px;height:64px;border-radius:18px" alt="">
        <div style="font-weight:800;font-size:17px;margin-top:8px">EMI Flow</div>
        <div class="tiny mut">PLAN · TRACK · PAY · GROW</div>
        <p class="small mut" style="margin-top:10px;line-height:1.6">“Financial peace isn't a dream. It's a habit.”</p>
      </div>
      <div class="dsum"><div><div class="k">Version</div><div class="v">v${APP_VERSION}</div></div>
        <div><div class="k">Sync</div><div class="v">${Store.s.demo ? 'demo' : 'cloud'}</div></div>
        <div><div class="k">EMIs</div><div class="v">${Object.values(Store.s.emis).filter(e => !e.deleted).length}</div></div></div>
      <p class="tiny mut" style="line-height:1.6">Your data lives only in your account — encrypted passwords, revocable sessions, never sold or shared. Lender names &amp; logos are trademarks of their respective owners, used as visual tags only.</p>`;
    UI.openOv('ov-gen');
  },
};

/* ---------------- theme ---------------- */
function applyTheme() {
  const pref = Store.s.meta.theme || 'system';
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.body.classList.toggle('noanim', Store.s.meta.anim === false);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0e101c' : '#f3f4fb';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------------- demo ---------------- */
const App = {};
App.demo = function() {
  const D = [
    {name: 'Phone EMI', lender: 'paytm', cat: 'consumer', amt: 612, n: 9, paid: 4, off: -4, d: 3},
    {name: 'TV EMI', lender: 'phonepe', cat: 'consumer', amt: 1370, n: 12, paid: 7, off: -7, d: 14},
    {name: 'Fridge EMI', lender: 'bajaj', cat: 'consumer', amt: 409, n: 10, paid: 3, off: -3, d: 20},
    {name: 'Personal loan', lender: 'kreditbee', cat: 'personal', amt: 1250, n: 6, paid: 2, off: -2, d: 11},
    {name: 'Laptop EMI', lender: 'navi', cat: 'consumer', amt: 1200, n: 18, paid: 9, off: -9, d: 3},
    {name: 'BNPL order', lender: 'simpl', cat: 'bnpl', amt: 167, n: 3, paid: 1, off: -1, d: 26},
  ];
  Store.reset();
  Store.s.demo = true; Store.s.onboarded = true;
  Store.s.user = {name: 'Arvind Choudhary', email: 'arvind@example.com', created_at: Date.now()};
  for (const x of D) {
    const fd = addMonths(new Date(), x.off); fd.setDate(Math.min(x.d, 28));
    const e = EMI.normalize({...x, id: 'd' + Math.random().toString(36).slice(2, 8), firstDue: ymd(fd), autopay: false, remind: 2, notes: '', createdAt: Date.now()});
    e.paidDates = [];
    for (let i = 0; i < e.paid; i++) {
      const pd = addMonths(parseYmd(e.firstDue), i);
      if (cmpYmd(ymd(pd), today()) < 0) e.paidDates.push(ymd(pd));
    }
    Store.s.emis[e.id] = e;
  }
  Store.save();
  Auth.enterApp();
  toast('Demo loaded — look around!');
};

/* ---------------- boot ---------------- */
document.getElementById('buildid').textContent = 'EMI Flow v' + APP_VERSION + ' · cloud-synced';
applyTheme();

function firstRoute() {
  if (!Store.s.onboarded && !Store.s.token) { Route.to('onboard'); return; }
  if (Store.s.token || Store.s.demo) { Route.cur = 'home'; Route.to('app'); Render.all(); Sync.statusUI('', Store.s.demo ? 'demo — sample data' : 'syncing…'); Profile.paintTheme(); Remind.check(); if (!Store.s.demo) Sync.full(); return; }
  const sr = $('#syncrow'); if (sr) sr.style.display = 'none';
  Route.to('login');
}
setTimeout(() => { $('#scr-splash').classList.add('hidden'); $('#scr-splash').style.display = 'none'; firstRoute(); }, 1500);
if (new URLSearchParams(location.search).get('demo') === '1') { $('#scr-splash').style.display = 'none'; $('#scr-splash').classList.add('hidden'); firstRoute(); App.demo(); }

/* reminders toggle */
$('#swnotify').onchange = async (e) => {
  if (e.target.checked) {
    if (typeof Notification === 'undefined') { toast('Notifications not supported here', true); e.target.checked = false; return; }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('Permission denied', true); e.target.checked = false; return; }
    toast('Reminders on');
    Sync.saveMeta({notify: true}).then(() => Remind.check());
  } else Sync.saveMeta({notify: false});
};

/* background sync */
setInterval(() => { if (Store.s.token && !Store.s.demo) Sync.full(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Store.s.token && !Store.s.demo) Sync.full(); });
window.addEventListener('online', () => { toast('Back online'); if (Store.s.token && !Store.s.demo) Sync.full(); });
window.addEventListener('offline', () => { Sync.statusUI(' off', 'offline — queued'); });

/* SW: network-first + auto reload */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing) { refreshing = true; location.reload(); } });
}
if (!Store.s.demo) { try { fetch('/api/analytics', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({e: 'open', s: APP_VERSION})}); } catch {} }
