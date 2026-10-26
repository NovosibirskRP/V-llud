'use strict';
/* ---------- Seadistus ----------
   Täida Supabase andmed. Kui jäävad tühjaks, töötab rakendus DEMO-režiimis (andmed brauseris, ainult testimiseks). */
const CONFIG = { SUPABASE_URL: 'https://dfbvvrjpmjefzjwsnncm.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_X1tXNBa0ykRs0SsmgYbdoA_TXOD6561' };
const ADMIN_EMAIL = 'admin@seb-dashboard.local'; // kasutajanimi "Admin" teisendatakse sellele e-postile

const sb = (CONFIG.SUPABASE_URL && window.supabase) ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);
const eur = n => new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR' }).format(n || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID();
const signed = t => (t.type === 'withdrawal' ? -1 : 1) * Number(t.amount);

/* ---------- Andmekiht (Supabase või demo) ---------- */
const LS = 'seb_demo_v1';
const demo = { load: () => Object.assign({ debts: [] }, JSON.parse(localStorage.getItem(LS) || '{"goals":[],"tx":[]}')), save: d => localStorage.setItem(LS, JSON.stringify(d)) };

const api = {
  async login(u, p) {
    if (sb) {
      const email = u.trim().toLowerCase() === 'admin' ? ADMIN_EMAIL : u.trim();
      const { data, error } = await sb.auth.signInWithPassword({ email, password: p });
      if (error) throw new Error('Vale kasutajanimi või parool.');
      return { id: data.user.id, name: u.trim(), email };
    }
    if (u.trim() === 'Admin' && p === 'SEB_Admin') { sessionStorage.setItem('seb_user', 'Admin'); return { id: 'demo-admin', name: 'Admin', email: '' }; }
    throw new Error('Vale kasutajanimi või parool.');
  },
  async session() {
    if (sb) { const { data } = await sb.auth.getSession(); const u = data.session?.user; return u ? { id: u.id, name: u.email === ADMIN_EMAIL ? 'Admin' : u.email, email: u.email } : null; }
    return sessionStorage.getItem('seb_user') ? { id: 'demo-admin', name: 'Admin', email: '' } : null;
  },
  async logout() { if (sb) await sb.auth.signOut(); sessionStorage.removeItem('seb_user'); },
  async goals() {
    if (sb) { const { data, error } = await sb.from('goals').select('*').eq('user_id', state.user.id).order('created_at'); if (error) throw error; return data; }
    return demo.load().goals;
  },
  async addGoal(g) {
    if (sb) { const { data, error } = await sb.from('goals').insert({ ...g, user_id: state.user.id }).select().single(); if (error) throw error; return data; }
    const d = demo.load(); const row = { id: uid(), user_id: state.user.id, current_amount: 0, created_at: new Date().toISOString(), ...g }; d.goals.push(row); demo.save(d); return row;
  },
  async delGoal(id) {
    if (sb) { const { error } = await sb.from('goals').delete().eq('id', id); if (error) throw error; return; }
    const d = demo.load(); d.goals = d.goals.filter(g => g.id !== id); d.tx = d.tx.filter(t => t.goal_id !== id); d.debts = d.debts.filter(x => x.goal_id !== id); demo.save(d);
  },
  async tx(goalId) {
    if (sb) { const { data, error } = await sb.from('transactions').select('*').eq('goal_id', goalId).order('tx_date', { ascending: false }); if (error) throw error; return data; }
    return demo.load().tx.filter(t => t.goal_id === goalId).sort((a, b) => b.tx_date.localeCompare(a.tx_date));
  },
  async addTx(t) {
    if (sb) { const { error } = await sb.from('transactions').insert({ ...t, user_id: state.user.id }); if (error) throw error; return; }
    const d = demo.load(); d.tx.push({ id: uid(), user_id: state.user.id, created_at: new Date().toISOString(), ...t }); demo.save(d);
  },
  async delTx(id) {
    if (sb) { const { error } = await sb.from('transactions').delete().eq('id', id); if (error) throw error; return; }
    const d = demo.load(); d.tx = d.tx.filter(t => t.id !== id); demo.save(d);
  }
};

Object.assign(api, {
  async signup(email, p, p2) {
    if (!sb) throw new Error('Registreerimine vajab Supabase\'i.');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Sisesta korrektne e-posti aadress (nt nimi@gmail.com).');
    if (p.length < 8) throw new Error('Parool peab olema vähemalt 8 märki.');
    if (p !== p2) throw new Error('Paroolid ei klapi.');
    const { data, error } = await sb.auth.signUp({ email, password: p });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error('Konto loodud. Kinnita e-post lingiga, mis sulle saadeti, ja logi siis sisse.');
    return { id: data.user.id, name: email, email };
  },
  async debts(goalId) {
    if (sb) { const { data, error } = await sb.from('debts').select('*').eq('goal_id', goalId).order('created_at', { ascending: false }); if (error) throw error; return data; }
    return demo.load().debts.filter(x => x.goal_id === goalId).reverse();
  },
  async myDebts() { // võlad, mis on antud MULLE (võlgniku e-post = minu e-post)
    if (!sb) return [];
    const { data, error } = await sb.rpc('my_debts');
    if (error) { console.error(error); return []; }
    return data || [];
  },
  async addDebt(x) {
    await api.addTx({ goal_id: x.goal_id, amount: x.amount, type: 'withdrawal', tx_date: today(), category: 'Laen', note: 'Laen: ' + x.debtor_name });
    if (sb) { const { error } = await sb.from('debts').insert({ ...x, user_id: state.user.id }); if (error) throw error; return; }
    const d = demo.load(); d.debts.push({ id: uid(), user_id: state.user.id, repaid_amount: 0, created_at: new Date().toISOString(), ...x }); demo.save(d);
  },
  async repayDebt(debt, amt) {
    await api.addTx({ goal_id: debt.goal_id, amount: amt, type: 'deposit', tx_date: today(), category: 'Võla tagasimakse', note: 'Tagasimakse: ' + debt.debtor_name });
    const r = Number(debt.repaid_amount) + amt;
    if (sb) { const { error } = await sb.from('debts').update({ repaid_amount: r }).eq('id', debt.id); if (error) throw error; return; }
    const d = demo.load(); d.debts.find(z => z.id === debt.id).repaid_amount = r; demo.save(d);
  }
});

/* ---------- Olek ---------- */
const state = { user: null, goals: [], goal: null, tx: [], debts: [], tab: 'overview' };

function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2800); }
async function guard(fn) { try { await fn(); } catch (e) { console.error(e); toast('Viga: ' + (e.message || 'tegevus ebaõnnestus')); } }

/* ---------- Autentimine ---------- */
$('mode-note').textContent = sb ? '' : 'Demo-režiim: Supabase pole seadistatud, andmed jäävad sinu brauserisse.';
let signup = false;
$('toggle-signup').hidden = !sb; $('pw-btn').hidden = !sb;
$('toggle-signup').onclick = () => {
  signup = !signup;
  $('pass2-wrap').hidden = !signup;
  $('login-pass2').required = signup;
  $('login-title').textContent = $('login-submit').textContent = signup ? 'Loo konto' : 'Logi sisse';
  $('toggle-signup').textContent = signup ? 'Mul on konto, logi sisse' : 'Pole kontot? Registreeru';
  $('login-pass').autocomplete = signup ? 'new-password' : 'current-password';
};
$('login-form').addEventListener('submit', e => {
  e.preventDefault();
  const err = $('login-error'); err.hidden = true;
  (signup ? api.signup($('login-user').value.trim(), $('login-pass').value, $('login-pass2').value) : api.login($('login-user').value, $('login-pass').value))
    .then(u => { $('login-pass').value = ''; return start(u); })
    .catch(x => { err.textContent = x.message; err.hidden = false; });
});
$('logout').onclick = async () => { await api.logout(); location.reload(); };

async function start(user) {
  state.user = user;
  $('user-name').textContent = user.name;
  $('login-view').hidden = true; $('app-view').hidden = false;
  await guard(loadGoals); guard(showMyDebt);
}

/* ---------- Eesmärgid ---------- */
async function loadGoals(selectId) {
  state.goals = await api.goals();
  const sel = $('goal-select');
  sel.innerHTML = state.goals.map(g => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('');
  $('empty').hidden = state.goals.length > 0;
  $('dash').hidden = !state.goals.length; $('del-goal').hidden = !state.goals.length;
  if (state.goals.length) { sel.value = selectId || state.goals[0].id; await selectGoal(sel.value); }
}
async function selectGoal(id) {
  state.goal = state.goals.find(g => g.id === id);
  state.tx = await api.tx(id); state.debts = await api.debts(id);
  render();
}
$('goal-select').onchange = e => guard(() => selectGoal(e.target.value));
$('new-goal').onclick = () => $('goal-modal').showModal();
$('del-goal').onclick = () => { if (state.goal && confirm(`Kustuta eesmärk "${state.goal.title}" ja kõik selle tehingud?`)) guard(async () => { await api.delGoal(state.goal.id); await loadGoals(); toast('Eesmärk kustutatud'); }); };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());

$('goal-form').addEventListener('submit', e => {
  if (e.submitter?.value !== 'ok') return;
  const title = $('gf-title').value.trim(), target = Number($('gf-target').value);
  if (!title || !(target > 0)) return;
  guard(async () => {
    const g = await api.addGoal({ title, target_amount: target, deadline: $('gf-deadline').value || null });
    e.target.reset(); await loadGoals(g.id); toast('Eesmärk loodud');
  });
});

/* ---------- Tehingud ---------- */
$('new-tx').onclick = () => { $('tx-form').reset(); $('tf-date').value = today(); $('tx-modal').showModal(); };
$('tx-form').addEventListener('submit', e => {
  if (e.submitter?.value !== 'ok') return;
  const amount = Number($('tf-amount').value);
  if (!(amount > 0)) return;
  guard(async () => {
    await api.addTx({ goal_id: state.goal.id, amount, type: $('tf-type').value, tx_date: $('tf-date').value, category: $('tf-cat').value, note: $('tf-note').value.trim() });
    state.tx = await api.tx(state.goal.id); render(); toast('Tehing salvestatud');
  });
});
$('tx-body').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b || !confirm('Kustuta tehing?')) return;
  guard(async () => { await api.delTx(b.dataset.del); state.tx = await api.tx(state.goal.id); render(); });
});
['f-search', 'f-type', 'f-from', 'f-to'].forEach(id => $(id).addEventListener('input', renderTable));
$('plan').addEventListener('input', renderForecast);

/* ---------- Arvutused ---------- */
function stats() {
  const tx = state.tx, total = tx.reduce((s, t) => s + signed(t), 0), target = Number(state.goal.target_amount);
  const now = new Date(), ym = now.toISOString().slice(0, 7);
  const month = tx.filter(t => t.tx_date.startsWith(ym)).reduce((s, t) => s + signed(t), 0);
  const first = tx.length ? new Date(tx[tx.length - 1].tx_date) : now;
  const months = Math.max(1, (now - first) / (30.44 * 864e5));
  const avgMonth = tx.length ? total / months : 0;
  const since = new Date(now - 28 * 864e5).toISOString().slice(0, 10);
  const week = tx.filter(t => t.tx_date >= since).reduce((s, t) => s + signed(t), 0) / 4;
  return { total, target, month, avgMonth, week, missing: Math.max(0, target - total), pct: target ? Math.min(100, Math.max(0, total / target * 100)) : 0 };
}

/* ---------- Kuvamine ---------- */
function render() {
  const g = state.goal, s = stats();
  $('g-title').textContent = g.title;
  $('g-deadline').textContent = g.deadline ? 'Tähtaeg: ' + new Date(g.deadline).toLocaleDateString('et-EE') : 'Tähtaeg puudub';
  $('g-pct').textContent = s.pct.toFixed(1);
  $('g-left-pct').textContent = (100 - s.pct).toFixed(1);
  $('g-bar').style.width = s.pct + '%';
  document.querySelector('.bar').setAttribute('aria-valuenow', s.pct.toFixed(0));
  $('g-saved').textContent = eur(s.total); $('g-missing').textContent = eur(s.missing); $('g-target').textContent = eur(s.target);
  $('s-total').textContent = eur(s.total); $('s-month').textContent = eur(s.month); $('s-week').textContent = eur(s.week); $('s-avg').textContent = eur(s.avgMonth);
  renderForecast(); renderTable(); renderOverview(s); showTab(state.tab);
}

function renderForecast() {
  const s = stats(), planned = Number($('plan').value), pace = planned > 0 ? planned : s.avgMonth;
  const el = $('forecast-text');
  let months = null;
  if (s.missing === 0) el.textContent = 'Eesmärk on täidetud. Palju õnne!';
  else if (pace <= 0) el.textContent = 'Prognoosiks lisa sissemakseid või sisesta igakuine plaanitav summa.';
  else {
    months = Math.ceil(s.missing / pace);
    const d = new Date(); d.setMonth(d.getMonth() + months);
    el.textContent = `${planned > 0 ? 'Plaanitud' : 'Praeguse'} säästutempoga (${eur(pace)} kuus) jõuad eesmärgini ${d.toLocaleDateString('et-EE')} ehk ${months} kuu pärast.`;
    if (state.goal.deadline && d > new Date(state.goal.deadline)) el.textContent += ` Tähtajaks jääb puudu ${eur(Math.max(0, s.missing - pace * monthsUntil(state.goal.deadline)))}.`;
  }
  drawChart(s, pace, months);
}
const monthsUntil = dl => Math.max(0, (new Date(dl) - new Date()) / (30.44 * 864e5));

function drawChart(s, pace, months) {
  const W = 700, H = 260, P = { l: 56, r: 16, t: 14, b: 28 };
  const asc = [...state.tx].reverse(); let run = 0;
  const hist = asc.map(t => ({ x: new Date(t.tx_date).getTime(), y: (run += signed(t)) }));
  const now = Date.now(), x0 = hist.length ? Math.min(hist[0].x, now) : now;
  const horizon = months ? months : 6, x1 = now + horizon * 30.44 * 864e5;
  const proj = pace > 0 ? [{ x: now, y: s.total }, { x: x1, y: s.total + pace * horizon }] : [];
  const yMax = Math.max(s.target, s.total, proj.length ? proj[1].y : 0) * 1.05 || 1;
  const X = v => P.l + (v - x0) / (x1 - x0 || 1) * (W - P.l - P.r), Y = v => H - P.b - Math.max(0, v) / yMax * (H - P.t - P.b);
  const path = pts => pts.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
  let h = '';
  for (let i = 0; i <= 4; i++) { const v = yMax * i / 4; h += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e1e6e3"/><text x="${P.l - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="#6b7580">${Math.round(v)}</text>`; }
  h += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(s.target)}" y2="${Y(s.target)}" stroke="#2b3036" stroke-dasharray="5 4"/>`;
  const xd = [x0, (x0 + x1) / 2, x1]; xd.forEach((v, i) => h += `<text x="${X(v)}" y="${H - 8}" font-size="11" fill="#6b7580" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${new Date(v).toLocaleDateString('et-EE', { month: 'short', year: '2-digit' })}</text>`);
  if (hist.length) h += `<path d="${path(hist)}" fill="none" stroke="#00a152" stroke-width="2.5"/>`;
  if (proj.length) h += `<path d="${path(proj)}" fill="none" stroke="#00B0FF" stroke-width="2.5" stroke-dasharray="6 4"/>`;
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${h}</svg>`;
}

function renderTable() {
  const q = $('f-search').value.trim().toLowerCase(), ty = $('f-type').value, from = $('f-from').value, to = $('f-to').value;
  const rows = state.tx.filter(t => (!ty || t.type === ty) && (!from || t.tx_date >= from) && (!to || t.tx_date <= to) &&
    (!q || `${t.note || ''} ${t.category || ''}`.toLowerCase().includes(q)));
  $('tx-body').innerHTML = rows.map(t => {
    const v = signed(t);
    return `<tr><td>${new Date(t.tx_date).toLocaleDateString('et-EE')}</td><td>${esc(t.category)}</td><td>${esc(t.note)}</td>
    <td class="num ${v < 0 ? 'neg' : 'pos'}">${v < 0 ? '−' : '+'}${eur(Math.abs(v))}</td>
    <td><button class="icon" data-del="${esc(t.id)}" aria-label="Kustuta tehing">✕</button></td></tr>`;
  }).join('');
  $('tx-empty').hidden = rows.length > 0;
}

/* ---------- Navigatsioon, kiirnupud ---------- */
function showTab(t) {
  state.tab = t;
  $('empty').style.display = t === 'overview' ? '' : 'none';
  document.querySelector('.toolbar').style.display = t === 'mine' ? 'none' : '';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('[data-tab]:not(button)').forEach(x => x.hidden = x.dataset.tab !== t);
}
$('tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { $('tx-form').reset(); $('tf-date').value = today(); $('tf-type').value = b.dataset.q; $('tx-modal').showModal(); });
$('export').onclick = () => {
  const rows = [['Kuupäev', 'Tüüp', 'Kategooria', 'Märkus', 'Summa'], ...state.tx.map(t => [t.tx_date, t.type, t.category || '', t.note || '', signed(t)])];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = 'tehingud.csv'; a.click();
};

/* ---------- Parool ja "Minu võlad" ---------- */
$('pw-btn').onclick = () => { $('pw-form').reset(); $('pw-modal').showModal(); };
$('pw-form').addEventListener('submit', e => {
  if (e.submitter?.value !== 'ok') return;
  const a = $('pw-new').value;
  if (a !== $('pw-new2').value) return toast('Paroolid ei klapi');
  if (a.length < 8) return toast('Parool on liiga lühike');
  guard(async () => { const { error } = await sb.auth.updateUser({ password: a }); if (error) throw error; toast('Parool muudetud'); });
});
$('my-debt').onclick = () => showTab('mine');
function renderMine(list) {
  const left = d => Number(d.amount) - Number(d.repaid_amount);
  $('mine-body').innerHTML = list.map(d => `<tr><td>${new Date(d.created_at).toLocaleDateString('et-EE')}</td><td>${esc(d.creditor)}</td><td>${esc(d.note)}</td><td class="num">${eur(d.amount)}</td><td class="num pos">${eur(d.repaid_amount)}</td><td class="num ${left(d) > 0.001 ? 'neg' : ''}">${left(d) > 0.001 ? eur(left(d)) : 'Tasutud'}</td></tr>`).join('');
  $('mine-empty').hidden = list.length > 0;
}

/* ---------- Võlad ---------- */
$('new-debt').onclick = () => { $('debt-form').reset(); $('debt-modal').showModal(); };
$('q-loan').onclick = $('new-debt').onclick;
$('debt-form').addEventListener('submit', e => {
  if (e.submitter?.value !== 'ok') return;
  const amount = Number($('df-amount').value), name = $('df-name').value.trim();
  if (!name || !(amount > 0)) return;
  if (amount > stats().total) return toast('Kogutud summa ei kata seda laenu.');
  guard(async () => {
    await api.addDebt({ goal_id: state.goal.id, debtor_name: name, debtor_email: $('df-email').value.trim() || null, amount, note: $('df-note').value.trim() });
    await selectGoal(state.goal.id); toast(`${name} võlgneb nüüd ${eur(amount)}`);
  });
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-repay]'); if (!b) return;
  const d = state.debts.find(x => x.id === b.dataset.repay), left = Number(d.amount) - Number(d.repaid_amount);
  const v = Number((prompt(`Tagasimakse summa (võlg ${eur(left)}):`, left) || '').replace(',', '.'));
  if (!(v > 0) || v > left + 0.001) return toast('Vigane summa');
  guard(async () => { await api.repayDebt(d, v); await selectGoal(state.goal.id); toast('Tagasimakse registreeritud'); });
});
async function showMyDebt() {
  const mine = await api.myDebts(), sum = mine.reduce((a, d) => a + Number(d.amount) - Number(d.repaid_amount), 0);
  const el = $('my-debt'); el.hidden = !(sum > 0); renderMine(mine);
  if (sum > 0) el.textContent = `Sul on tasumata võlg ${eur(sum)} (${mine.length} laen${mine.length > 1 ? 'i' : ''}).`;
}

function renderOverview(s) {
  const left = d => Number(d.amount) - Number(d.repaid_amount);
  const open = state.debts.filter(d => left(d) > 0.001), lent = open.reduce((a, d) => a + left(d), 0);
  $('o-lent').textContent = eur(lent); $('o-worth').textContent = eur(s.total + lent);
  $('o-days').textContent = state.goal.deadline ? Math.max(0, Math.ceil((new Date(state.goal.deadline) - new Date()) / 864e5)) : '–';
  $('recent').innerHTML = state.tx.slice(0, 5).map(t => `<li><span>${esc(t.note || t.category || 'Tehing')}<small>${new Date(t.tx_date).toLocaleDateString('et-EE')}</small></span><b class="${t.type === 'withdrawal' ? 'neg' : 'pos'}">${t.type === 'withdrawal' ? '−' : '+'}${eur(t.amount)}</b></li>`).join('') || '<li class="muted">Tehinguid pole.</li>';
  const c = {}; state.tx.forEach(t => { const k = t.category || 'Muu'; c[k] = (c[k] || 0) + Number(t.amount); });
  const mx = Math.max(1, ...Object.values(c));
  $('cats').innerHTML = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="cat"><span>${esc(k)}</span><i style="width:${v / mx * 100}%"></i><b>${eur(v)}</b></div>`).join('') || '<p class="muted">Andmeid pole.</p>';
  const by = {}; open.forEach(d => by[d.debtor_name] = (by[d.debtor_name] || 0) + left(d));
  $('people').innerHTML = Object.entries(by).map(([n, v]) => `<div class="person"><span class="avatar">${esc(n[0].toUpperCase())}</span><div><strong>${esc(n)}</strong><span class="label">Konto: võlgu ${eur(v)}</span></div></div>`).join('');
  $('debt-body').innerHTML = state.debts.map(d => `<tr><td>${new Date(d.created_at).toLocaleDateString('et-EE')}</td><td>${esc(d.debtor_name)}</td><td>${esc(d.note)}</td><td class="num">${eur(d.amount)}</td><td class="num pos">${eur(d.repaid_amount)}</td><td class="num ${left(d) > 0.001 ? 'neg' : ''}">${left(d) > 0.001 ? eur(left(d)) : 'Tasutud'}</td><td>${left(d) > 0.001 ? `<button class="btn ghost small" data-repay="${esc(d.id)}">Tagasimakse</button>` : ''}</td></tr>`).join('');
  $('debt-empty').hidden = state.debts.length > 0;
}

/* ---------- Käivitus ---------- */
api.session().then(u => u && start(u));
