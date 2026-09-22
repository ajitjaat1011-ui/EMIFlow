/* ============================================================
   EMIFlow v2.1 “Aurora” UI — render · auth · sheets · calendar
   ============================================================ */
'use strict';

/* ---------------- ui helpers ---------------- */
const UI = {
  openOv(id) { $('#' + id).classList.add('on'); document.body.style.overflow = 'hidden'; },
  closeOv(id) { $('#' + id).classList.remove('on'); document.body.style.overflow = ''; },
};
document.querySelectorAll('.ov').forEach(ov => ov.addEventListener('click', (e) => { if (e.target === ov) UI.closeOv(ov.id); }));

function lenderTile(id, cls) {
  const L = LMAP[id] || LMAP.other;
  const icn = LENDER_ICONS[id];
  if (icn) return `<img class="${cls}" src="${icn}" alt="${esc(L.n)}" loading="lazy">`;
  return `<div class="${cls} ph" style="background:${L.c}">${esc(L.n.slice(0, 2).toUpperCase())}</div>`;
}
const licBig = (id) => lenderTile(id, 'lic');
const licSm = (id) => lenderTile(id, 'lic2');

function loanStatus(e) {
  const nd = EMI.nextDue(e);
  if (!nd) return {cls: 'done', txt: 'done'};
  const od = EMI.overdueCount(e);
  if (od) return {cls: 'over', txt: od + ' overdue'};
  const diff = Math.round((parseYmd(nd.date) - parseYmd(today())) / 86400000);
  if (diff === 0) return {cls: 'soon', txt: 'due today'};
  if (diff === 1) return {cls: 'soon', txt: 'due tomorrow'};
  if (diff <= 7) return {cls: 'due', txt: 'in ' + diff + ' days'};
  return {cls: 'due', txt: 'due ' + prettyDay(nd.date)};
}

/* ---------------- auth ---------------- */
const Auth = {
  mode: 'login',
  open(mode) { this.tab(mode || 'login'); $('#au-err').classList.add('hidden'); UI.openOv('ov-auth'); },
  tab(mode) {
    this.mode = mode;
    $('#authtab-login').classList.toggle('on', mode === 'login');
    $('#authtab-register').classList.toggle('on', mode === 'register');
    $('#authtab-login').style.cssText = mode === 'login' ? 'background:var(--acc);color:#fff' : '';
    $('#authtab-register').style.cssText = mode === 'register' ? 'background:var(--acc);color:#fff' : '';
    $('#au-name').parentElement.querySelector('label').style.display = mode === 'register' ? '' : 'none';
    $('#au-name').style.display = mode === 'register' ? '' : 'none';
    $('#au-go').textContent = mode === 'register' ? 'Create account' : 'Sign in';
    $('#au-err').classList.add('hidden');
  },
  err(msg) { const e = $('#au-err'); e.textContent = msg; e.classList.remove('hidden'); },
  async submit() {
    if (Store.s.demo) { Store.s.demo = false; Store.save(); }
    const email = $('#au-email').value.trim().toLowerCase();
    const pass = $('#au-pass').value;
    const name = $('#au-name').value.trim();
    if (this.mode === 'register' && name.length < 2) return this.err('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return this.err('That email doesn\'t look right.');
    if (pass.length < 8) return this.err('Password must be at least 8 characters.');
    const btn = $('#au-go'); btn.disabled = true; btn.textContent = 'Please wait…';
    const r = await api('/auth/' + (this.mode === 'register' ? 'register' : 'login'), {method: 'POST', body: JSON.stringify({email, password: pass, name})});
    btn.disabled = false; btn.textContent = this.mode === 'register' ? 'Create account' : 'Sign in';
    if (!r.ok) {
      const M = {email_taken: 'That email is already registered — sign in instead.', bad_credentials: 'Wrong email or password.', rate_limited: 'Too many attempts — wait a few minutes.', bad_email: 'Invalid email.', bad_name: 'Name too short.', bad_password: 'Password must be 8+ characters.', network: 'You appear offline.'};
      return this.err(M[r.error] || ('Failed (' + (r.error || r._status) + ')'));
    }
    Store.s.demo = false;
    Store.s.token = r.token; Store.s.user = r.user; Store.s.emis = {}; Store.s.cursor = 0; Store.save();
    UI.closeOv('ov-auth');
    toast('Welcome, ' + (r.user.name.split(' ')[0]) + '!');
    App.enter();
    Sync.full();
    try { fetch('/api/analytics', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({e: 'auth', s: this.mode})}); } catch {}
  },
  forgotView(show = true) {
    $('#auth-main').classList.toggle('hidden', show);
    $('#auth-forgot').classList.toggle('hidden', !show);
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
    const code = $('#fg-code').value.trim(); const pass = $('#fg-pass').value;
    if (code.length !== 6) return $('#fg-msg').textContent = 'Enter the 6-digit code.';
    if (pass.length < 8) return $('#fg-msg').textContent = 'New password must be 8+ characters.';
    const r = await api('/auth/reset-password', {method: 'POST', body: JSON.stringify({email, code, password: pass})});
    if (r.ok) { $('#fg-msg').textContent = 'Password set! Sign in with it now.'; setTimeout(() => { this.forgotView(false); this.tab('login'); }, 900); }
    else $('#fg-msg').textContent = 'Invalid or expired code.';
  },
  sessionExpired() {
    if (!Store.s.token || Store.s.demo) return;
    Store.s.token = null; Store.save();
    toast('Session expired — sign in again', true);
    App.enter();
  },
  async logout() {
    if (Store.s.demo) { Store.reset(); App.enter(); return; }
    await api('/auth/logout', {method: 'POST'});
    Store.s.token = null; Store.save(); App.enter(); toast('Logged out');
  },
  async logoutAll() {
    if (Store.s.demo) return confirmBox('Leave demo?', 'Sample data will be cleared.', () => { Store.reset(); App.enter(); });
    confirmBox('Log out everywhere?', 'All sessions on all devices will end. You\'ll sign in again here.', async () => {
      await api('/auth/logout-all', {method: 'POST'});
      Store.s.token = null; Store.save(); App.enter(); toast('Logged out of all devices');
    });
  },
  deleteAccount() {
    if (Store.s.demo) return toast('Nothing to delete in demo', true);
    confirmBox('Delete account permanently?', 'Every EMI, payment record and your account will be erased. This cannot be undone.', async () => {
      const pass = prompt('Confirm your password to delete:');
      if (pass == null) return;
      const r = await api('/account/delete', {method: 'POST', body: JSON.stringify({password: pass})});
      if (r.ok) { Store.reset(); App.enter(); toast('Account deleted. Take care!'); }
      else toast(r.error === 'bad_credentials' ? 'Wrong password.' : 'Delete failed.', true);
    });
  },
};

/* ---------------- add / edit sheet ---------------- */
const Sheet = { openAdd() { if (Store.s.demo) toast('Demo — sign up to add your own', true); else Edit.open(null); } };
const Edit = {
  current: null, lender: 'other', cat: 'personal',
  open(id) {
    this.current = id;
    const e = id ? Store.s.emis[id] : null;
    $('#ed-title').textContent = id ? 'Edit EMI' : 'Add EMI';
    const d = e || {};
    $('#ed-name').value = d.name || '';
    this.lender = d.lender || 'other';
    this.cat = d.cat || 'personal';
    $('#ed-amt').value = d.amt || '';
    $('#ed-n').value = d.n || '';
    $('#ed-first').value = d.firstDue || ymd(addMonths(new Date(), 1));
    $('#ed-paid').value = d.paid ?? 0;
    $('#ed-autopay').checked = !!d.autopay;
    $('#ed-remind').value = String(d.remind ?? 2);
    $('#ed-notes').value = d.notes || '';
    $('#ed-err').classList.add('hidden');
    $('#ed-save').textContent = id ? 'Save changes' : 'Save EMI';
    this.renderPickers();
    UI.openOv('ov-edit');
  },
  renderPickers() {
    $('#ed-lenders').innerHTML = LENDERS.map(l =>
      `<div class="lpick ${l.id === this.lender ? 'on' : ''}" data-id="${l.id}" onclick="Edit.pickLender('${l.id}')">${LENDER_ICONS[l.id] ? `<img src="${LENDER_ICONS[l.id]}" alt="">` : `<div style="width:34px;height:34px;border-radius:10px;background:${l.c};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:10px">${esc(l.n.slice(0, 2).toUpperCase())}</div>`}<span>${esc(l.n)}</span></div>`).join('');
    $('#ed-cats').innerHTML = CATS.map(c =>
      `<button class="cpick ${c.id === this.cat ? 'on' : ''}" onclick="Edit.pickCat('${c.id}')">${ic(c.ic, 'ic xs')} ${esc(c.n)}</button>`).join('');
  },
  pickLender(id) { this.lender = id; this.renderPickers(); vib(8); },
  pickCat(id) { this.cat = id; this.renderPickers(); vib(8); },
  save() {
    const name = $('#ed-name').value.trim();
    const amt = Number($('#ed-amt').value), n = Math.round(Number($('#ed-n').value));
    const first = $('#ed-first').value, paid = Math.max(0, Math.round(Number($('#ed-paid').value) || 0));
    const err = (m) => { const e = $('#ed-err'); e.textContent = m; e.classList.remove('hidden'); };
    if (name.length < 2) return err('Give this EMI a name.');
    if (!(amt > 0)) return err('Enter the EMI amount.');
    if (!(n >= 1 && n <= 480)) return err('Installments must be 1–480.');
    if (!first) return err('Pick the first due date.');
    if (paid > n) return err('Already-paid can\'t exceed total installments.');
    const prev = this.current ? Store.s.emis[this.current] : null;
    const doc = EMI.normalize({
      ...(prev || {}), id: this.current || ('e' + Math.random().toString(36).slice(2, 10)),
      name, lender: this.lender, cat: this.cat, amt, n, paid, firstDue: first,
      autopay: $('#ed-autopay').checked, remind: Number($('#ed-remind').value),
      notes: $('#ed-notes').value.trim(), createdAt: prev ? prev.createdAt : Date.now(),
      paidDates: prev && prev.paid !== paid ? prev.paidDates.slice(0, paid) : (prev ? prev.paidDates : []),
    });
    Sync.queueLocal(doc);
    UI.closeOv('ov-edit');
    toast(this.current ? 'EMI updated' : 'EMI added');
    vib(10);
    Remind.banner(); Render.all(); Sync.full();
  },
};

/* ---------------- detail sheet ---------------- */
const Detail = {
  id: null,
  open(id) {
    const e = Store.s.emis[id]; if (!e) return;
    this.id = id;
    const L = LMAP[e.lender] || LMAP.other, C = CMAP[e.cat] || CMAP.other;
    const nd = EMI.nextDue(e), od = EMI.overdueCount(e), prog = EMI.progress(e);
    const upcoming = EMI.statusOf(e).filter(r => r.state !== 'paid').slice(0, 4);
    const hist = (e.paidDates || []).slice(-5).reverse().map((d) =>
      `<div class="hrow"><div class="dd ok"><small>${parseYmd(d).toLocaleDateString('en-IN', {month: 'short'})}</small>${parseYmd(d).getDate()}</div>
       <div class="grow"><b>${fmtINR(e.amt)}</b> <span class="mut small" style="font-weight:600">paid</span></div>
       <span class="chip ok">paid</span></div>`).join('');
    $('#dt-title').textContent = e.name;
    $('#dt-body').innerHTML = `
      <div class="row" style="margin:6px 0 2px">
        ${licSm(e.lender)}
        <div class="grow" style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(L.n)}</b></div>
        <span class="chip acc">${ic(C.ic, 'ic xs')} ${esc(C.n)}</span> ${e.autopay ? `<span class="chip">${ic('bolt', 'ic xs')}autopay</span>` : ''}
      </div>
      <div class="dsumgrid">
        <div><div class="k">EMI</div><div class="v">${fmtINR(e.amt)}</div></div>
        <div><div class="k">Paid</div><div class="v">${e.paid}<span class="mut" style="font-size:12px">/${e.n}</span></div></div>
        <div><div class="k">Left</div><div class="v">${fmtINR(EMI.outstanding(e))}</div></div>
      </div>
      <div class="pbar" style="margin:2px 0 6px"><i style="width:${prog}%"></i></div>
      <div class="small mut" style="text-align:center;font-weight:600">${prog}% done · started ${prettyDate(e.firstDue)}${e.notes ? '<br><span class=mut>note:</span> ' + esc(e.notes) : ''}</div>
      ${od ? `<div class="banner">${ic('alert', 'ic sm')}<span class="grow">${od} installment${od > 1 ? 's' : ''} overdue</span></div>` : ''}
      ${nd ? `<button class="btn pri wide" style="margin-top:14px" onclick="Detail.pay()">${od ? 'Clear overdue' : 'Mark paid'} · ${fmtINR(e.amt)}</button>`
           : `<div class="chip ok" style="margin-top:14px;width:100%;justify-content:center;padding:11px">${ic('spark', 'ic xs')} Loan completed — well done!</div>`}
      ${upcoming.length ? `<label>Upcoming</label>${upcoming.map(r => `<div class="hrow"><div class="dd mut2"><small>${parseYmd(r.date).toLocaleDateString('en-IN', {month: 'short'})}</small>${parseYmd(r.date).getDate()}</div><div class="grow">${fmtINR(e.amt)} <span class="mut small">· #${r.i + 1}</span></div><span class="chip ${r.state === 'overdue' ? 'danger' : ''}">${r.state}</span></div>`).join('')}` : ''}
      ${hist ? `<label>Recent payments</label>${hist}` : ''}
      <div class="row" style="gap:10px;margin-top:20px">
        <button class="btn ghost grow" onclick="UI.closeOv('ov-detail');Edit.open('${e.id}')">Edit</button>
        <button class="btn danger grow" onclick="Detail.remove()">Delete</button>
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
    Remind.banner(); Render.all();
    UI.closeOv('ov-detail');
    Sync.full();
  },
  remove() {
    const e = Store.s.emis[this.id]; if (!e) return;
    if (Store.s.demo) return toast('Demo — nothing is deleted', true);
    confirmBox(`Delete “${e.name}”?`, 'It will be removed from all your devices.', () => {
      Sync.queueLocal({...e, deleted: true, updatedAt: Date.now()});
      delete Store.s.emis[e.id];
      UI.closeOv('ov-detail');
      toast('EMI deleted'); Remind.banner(); Render.all(); Sync.full();
    });
  },
};

/* ---------------- calendar ---------------- */
const Cal = {
  off: 0, sel: null,
  nav(d) { this.off += d; this.sel = null; $('#calday').classList.add('hidden'); this.render(); },
  render() {
    const g = $('#calgrid'); if (!g) return;
    const base = new Date(); const m = new Date(base.getFullYear(), base.getMonth() + this.off, 1);
    $('#caltitle').textContent = m.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'});
    const ymStr = ymd(m).slice(0, 7);
    const firstDow = (m.getDay() + 6) % 7;
    const dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const dues = EMI.duesInMonth(ymStr);
    const byDay = {};
    for (const d of dues) (byDay[d.date] = byDay[d.date] || []).push(d);
    const t = today(); const sel = this.sel;
    let html = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < firstDow; i++) html += '<div></div>';
    for (let day = 1; day <= dim; day++) {
      const ds = ymStr + '-' + pad(day);
      const list = byDay[ds] || [];
      const dots = list.slice(0, 3).map(x => `<i class="${x.state === 'overdue' ? 'd-red' : 'd-amb'}"></i>`).join('');
      const cls = ['day', ds === t ? 'today' : '', ds === sel ? 'sel' : ''].join(' ');
      html += `<div class="${cls}" onclick="Cal.selDay('${ds}')">${day}<div class="dots">${dots}</div></div>`;
    }
    g.innerHTML = html;
  },
  selDay(ds) {
    this.sel = ds; this.render();
    const list = EMI.duesInMonth(ds.slice(0, 7)).filter(x => x.date === ds);
    const el = $('#calday');
    if (!list.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<h3 style="margin-bottom:4px">${prettyDate(ds)}</h3>` + list.map(x => `
      <div class="hrow" style="cursor:pointer" onclick="Detail.open('${x.emi.id}')">
        ${licSm(x.emi.lender)}
        <div class="grow"><b>${esc(x.emi.name)}</b><div class="small mut" style="font-weight:600">${fmtINR(x.emi.amt)}${x.emi.autopay ? ' · autopay' : ''}</div></div>
        <span class="chip ${x.state === 'overdue' ? 'danger' : 'warn'}">${x.state}</span>
      </div>`).join('');
  },
};

/* ---------------- render ---------------- */
const Render = {
  all() { this.home(); this.stats(); Cal.render(); this.profile(); Remind.banner(); },
  home() {
    const s = EMI.summary();
    const hr = $('#herocard'); if (!hr) return;
    const hour = new Date().getHours();
    $('#greet').textContent = (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening') + ', ' + ((Store.s.user?.name || Store.s.demo ? 'Demo' : 'there')).split(' ')[0];
    $('#greet').textContent = (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening') + (Store.s.demo ? '' : ', ' + (Store.s.user?.name || 'there').split(' ')[0]);
    hr.innerHTML = `
      <div class="hlabel">${ic('wallet', 'ic sm')} Total outstanding</div>
      <div class="hamt">${fmtINR(s.outstanding)}</div>
      <div class="hsub">across ${s.count} active EMI${s.count === 1 ? '' : 's'}${s.overdue ? ` · <b>${fmtINR(s.overdue)} overdue</b>` : ''}</div>
      <div class="hrow">
        <div class="hcell"><div class="k">Due this month</div><div class="v">${fmtINR(s.dueThisMonth)}</div></div>
        <div class="hcell"><div class="k">Paid this month</div><div class="v">${fmtINR(s.paidThisMonth)}</div></div>
      </div>
      ${s.next ? `<div class="hnext"><div><div class="t">Next due · ${prettyDay(s.next.date)}</div><div class="v">${fmtINR(s.next.amt)} — ${esc(s.next.emi.name)}</div></div></div>` : ''}`;
    const list = Object.values(Store.s.emis).filter(e => !e.deleted)
      .sort((a, b) => (EMI.active(b) - EMI.active(a)) || (((EMI.nextDue(a) || {date: '9'}).date < (EMI.nextDue(b) || {date: '9'}).date) ? -1 : 1));
    const host = $('#loans');
    host.innerHTML = list.length ? list.map((e) => {
      const st = loanStatus(e), prog = EMI.progress(e);
      const L = LMAP[e.lender] || LMAP.other;
      return `<div class="loan" onclick="Detail.open('${e.id}')">
        ${licBig(e.lender)}
        <div class="grow">
          <div class="t">${esc(e.name)}${e.autopay ? ` <span class="mut tiny">· autopay</span>` : ''}</div>
          <div class="s">${esc(L.n)} · ${e.paid}/${e.n} paid</div>
          <div class="pbar"><i style="width:${prog}%"></i></div>
        </div>
        <div class="right">
          <div class="amt">${fmtINR(e.amt)}</div>
          <div class="st ${st.cls}">${st.txt}</div>
        </div>
      </div>`;
    }).join('') : `<div class="empty">
      <div class="eic">${ic('wallet', 'ic lg')}</div>
      <h3>No EMIs yet</h3><p>Tap + to add your first — pick a lender,<br>amount and due date.</p>
      <button class="btn pri" style="margin-top:16px" onclick="Sheet.openAdd()">Add your first EMI</button></div>`;
  },
  stats() {
    const s = EMI.summary();
    const tiles = [
      ['Active EMIs', s.count],
      ['Due this month', fmtINR(s.dueThisMonth)],
      ['Overdue', s.overdue ? fmtINR(s.overdue) : '₹0'],
      ['Paid this month', fmtINR(s.paidThisMonth)],
    ];
    $('#statcards').innerHTML = tiles.map(([k, v]) =>
      `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    const proj = EMI.projection(6); const max = Math.max(...proj.map(p => p.amt), 1);
    $('#projbars').innerHTML = proj.map((p, i) =>
      `<div class="b ${i === 0 ? '' : 'past'}"><span class="val">${p.amt ? (p.amt >= 100000 ? Math.round(p.amt / 1000) + 'k' : (p.amt / 1000).toFixed(1) + 'k') : '·'}</span><i style="height:${Math.max(4, Math.round(p.amt / max * 100))}%"></i><span class="l">${p.label}</span></div>`).join('');
    const lr = EMI.byLender(); const lmax = Math.max(...lr.map(x => x.amt), 1);
    $('#lenderrows').innerHTML = lr.length ? lr.slice(0, 8).map(x =>
      `<div class="lrow">${licSm(x.lender.id)}<div class="grow"><div class="row" style="justify-content:space-between"><span class="nm">${esc(x.lender.n)}</span><span class="rt">${fmtINR(x.amt)}</span></div><div class="lbar"><i style="width:${Math.round(x.amt / lmax * 100)}%"></i></div><div class="ct">${x.count} EMI${x.count > 1 ? 's' : ''} outstanding</div></div></div>`).join('')
      : '<div class="emptyst">Lender-wise outstanding shows up once you add EMIs.</div>';
    const cr = EMI.byCat(); const cmax = Math.max(...cr.map(x => x.amt), 1);
    $('#catrows').innerHTML = cr.length ? cr.map(x =>
      `<div class="lrow"><div class="lic2 ph" style="background:var(--field);color:var(--ink)">${ic(x.cat.ic, 'ic sm')}</div><div class="grow"><div class="row" style="justify-content:space-between"><span class="nm">${esc(x.cat.n)}</span><span class="rt">${fmtINR(x.amt)}</span></div><div class="lbar"><i style="width:${Math.round(x.amt / cmax * 100)}%"></i></div></div></div>`).join('')
      : '<div class="emptyst">Category split appears once you add EMIs.</div>';
  },
  profile() {
    const u = Store.s.user || {name: 'Demo User', email: 'demo · local only', created_at: Date.now()};
    $('#pavatar').textContent = (u.name || 'A')[0].toUpperCase();
    $('#pname').textContent = u.name;
    $('#pemail').textContent = u.email;
    const n = Object.values(Store.s.emis).filter(e => !e.deleted).length;
    $('#pmeta').textContent = (Store.s.demo ? 'Sample data · not synced' : `Member since ${new Date(u.created_at).toLocaleDateString('en-IN', {month: 'short', year: 'numeric'})}`) + ` · ${n} EMI${n === 1 ? '' : 's'}`;
    document.querySelectorAll('#segtheme button').forEach(b => b.classList.toggle('on', b.dataset.v === (Store.s.meta.theme || 'system')));
    $('#swanim').checked = Store.s.meta.anim !== false;
    $('#swnotify').checked = !!Store.s.meta.notify;
  },
};

/* ---------------- theme ---------------- */
function applyTheme() {
  const pref = Store.s.meta.theme || 'system';
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.body.classList.toggle('noanim', Store.s.meta.anim === false);
  document.querySelector('meta[name=theme-color]').content = dark ? '#070b14' : '#eef1f8';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------------- app shell ---------------- */
const App = {
  go(tab) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    $('#scr-' + tab).classList.add('on');
    document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    this.pill();
    if (tab === 'calendar') Cal.render();
    if (tab === 'stats') Render.stats();
    vib(6);
  },
  pill() {},
  demo() {
    const D = [
      {name: 'Smart TV 55″', lender: 'bajaj', cat: 'consumer', amt: 5499, n: 12, paid: 4, off: -4, dayOff: 0, autopay: true, notes: 'Smart TV 55″ 4K'},
      {name: 'Card bill', lender: 'phonepe', cat: 'card', amt: 2400, n: 6, paid: 2, off: -3, dayOff: 6, autopay: false, notes: ''},
      {name: 'Personal loan', lender: 'navi', cat: 'personal', amt: 8250, n: 36, paid: 9, off: -10, dayOff: 0, autopay: false, notes: ''},
      {name: 'Headphones', lender: 'simpl', cat: 'bnpl', amt: 1299, n: 3, paid: 0, off: 1, dayOff: 0, autopay: false, notes: 'Headphones'},
      {name: 'Car loan', lender: 'hdfc', cat: 'car', amt: 14750, n: 60, paid: 22, off: -22, dayOff: 0, autopay: true, notes: ''},
      {name: 'Closed loan', lender: 'kreditbee', cat: 'personal', amt: 3200, n: 6, paid: 6, off: -6, dayOff: 0, autopay: false, notes: ''},
    ];
    Store.reset();
    Store.s.demo = true;
    Store.s.user = {name: 'Demo User', email: 'demo · local only', created_at: Date.now()};
    for (const d of D) {
      const first = new Date(); first.setDate(first.getDate() + d.dayOff);
      const fd = addMonths(first, d.off);
      const e = EMI.normalize({...d, id: 'd' + Math.random().toString(36).slice(2, 8), firstDue: ymd(fd), createdAt: Date.now()});
      e.paidDates = [];
      for (let i = 0; i < e.paid; i++) { const pd = addMonths(parseYmd(e.firstDue), i); if (cmpYmd(ymd(pd), today()) < 0) e.paidDates.push(ymd(pd)); }
      Store.s.emis[e.id] = e;
    }
    Store.save();
    $('#scr-onboard').classList.add('hidden');
    this.enter();
    toast('Demo loaded — look around!');
  },
  enter() {
    const logged = !!Store.s.token || !!Store.s.demo;
    $('#scr-onboard').classList.toggle('hidden', logged);
    $('#app').classList.toggle('hidden', !logged);
    if (logged) {
      if (!Store.s.demo) $('#greet').textContent = 'Hi there';
      Render.all(); Sync.statusUI('', 'syncing…'); Sync.full(); Remind.check();
      
    }
  },
};

/* ---------------- wire settings ---------------- */
document.querySelectorAll('#segtheme button').forEach(b => b.onclick = () => { Sync.saveMeta({theme: b.dataset.v}).then(applyTheme); vib(6); });
$('#swanim').onchange = (e) => { Sync.saveMeta({anim: e.target.checked}).then(applyTheme); };
$('#swnotify').onchange = async (e) => {
  if (e.target.checked) {
    if (typeof Notification === 'undefined') { toast('Notifications not supported here', true); e.target.checked = false; return; }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('Permission denied', true); e.target.checked = false; return; }
    toast('Reminders on — we\'ll nudge you before dues');
    Sync.saveMeta({notify: true}).then(() => Remind.check());
  } else Sync.saveMeta({notify: false});
};
window.addEventListener('resize', () => App.pill());

/* ---------------- boot ---------------- */
document.getElementById('buildid').textContent = 'build ' + APP_VERSION;
applyTheme();
if (new URLSearchParams(location.search).get('demo') === '1') App.demo();
else App.enter();
setInterval(() => { if (Store.s.token && !Store.s.demo) Sync.full(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Store.s.token && !Store.s.demo) Sync.full(); });
window.addEventListener('online', () => { toast('Back online'); if (Store.s.token && !Store.s.demo) Sync.full(); });
window.addEventListener('offline', () => { Sync.statusUI(' off', 'offline — changes queued'); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
if (!Store.s.demo) { try { fetch('/api/analytics', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({e: 'open', s: APP_VERSION})}); } catch {} }
