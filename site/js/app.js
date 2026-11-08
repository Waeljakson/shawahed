// منصة الشواهد والأدلة — الواجهة
/* global Chart, createBackend, ROLES */
'use strict';

const STATUS = { pending: 'لم يُرفع', uploaded: 'بانتظار المراجعة', approved: 'معتمد', rejected: 'يحتاج تعديل' };
const LEVELS = { 4: 'متميز', 3: 'متقدم', 2: 'منجز', 1: 'يحتاج تحسين' };
const ACTIONS = { upload: 'رفع ملفات', delete_file: 'حذف ملف', approve: 'اعتماد', reject: 'طلب تعديل', evaluate: 'تقييم ذاتي', add_record: 'إضافة وثيقة', delete_record: 'حذف وثيقة', user_add: 'إضافة مستخدم', user_edit: 'تعديل مستخدم', user_delete: 'حذف مستخدم', settings: 'الإعدادات' };
const PREVIEW_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'];

const S = { cfg: null, api: null, me: null, data: null, charts: [] };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b > 0 ? Math.round((a * 100) / b) : 0);
const bar = (p, cls = '') => `<div class="progress ${cls}"><span style="width:${p}%"></span></div>`;
const badge = (s) => `<span class="badge st-${s}">${STATUS[s]}</span>`;
const fmtDate = (d, time) => { if (!d) return ''; const x = new Date(d); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}/${p(x.getMonth() + 1)}/${p(x.getDate())}${time ? ` ${p(x.getHours())}:${p(x.getMinutes())}` : ''}`; };
const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' م.ب' : b >= 1024 ? Math.round(b / 1024) + ' ك.ب' : b + ' بايت');
const ext = (n) => (n.split('.').pop() || '').toLowerCase();

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast alert alert-${type}`; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('hide'), 3500); setTimeout(() => t.remove(), 4000);
}
function errMsg(e) {
  const m = e?.message || String(e);
  if (/Invalid credentials|user_invalid_credentials/i.test(m)) return 'اسم الدخول أو كلمة المرور غير صحيحة.';
  if (/rate limit/i.test(m)) return 'محاولات كثيرة، انتظر قليلًا ثم حاول مجددًا.';
  if (/not authorized|unauthorized|missing scope/i.test(m)) return 'لا تملك صلاحية تنفيذ هذه العملية.';
  if (/storage_file_type_unsupported|extension/i.test(m)) return 'نوع الملف غير مسموح.';
  if (/storage_invalid_file_size|file size/i.test(m)) return 'حجم الملف أكبر من المسموح.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذر الاتصال بقاعدة البيانات. تحقق من الإنترنت أو من تفعيل المشروع في Appwrite.';
  return m;
}

/* ---------------- البيانات المشتقة ---------------- */
function index(data) {
  const by = (arr) => Object.fromEntries(arr.map((x) => [x.$id, x]));
  const D = data;
  D.domains.sort((a, b) => a.sort - b.sort); D.standards.sort((a, b) => (D.domains.findIndex((d) => d.$id === a.domain_id) - D.domains.findIndex((d) => d.$id === b.domain_id)) || a.sort - b.sort); D.indicators.sort((a, b) => a.sort - b.sort);
  D.items.sort((a, b) => a.num - b.num); D.records.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  D.domainById = by(D.domains); D.standardById = by(D.standards); D.indicatorById = by(D.indicators); D.itemById = by(D.items); D.recordById = by(D.records);
  D.partyByCode = Object.fromEntries(D.parties.map((p) => [p.code, p]));
  D.evByRecord = {};
  D.evidence.sort((a, b) => new Date(a.$createdAt) - new Date(b.$createdAt));
  for (const ev of D.evidence) (D.evByRecord[ev.record_id] ||= []).push(ev);
  D.recsByItem = {};
  for (const r of D.records) {
    (D.recsByItem[r.item_id] ||= []).push(r);
    const evs = D.evByRecord[r.$id] || [];
    if (!evs.length) r._st = 'pending';
    else if (r.status === 'approved') r._st = 'approved';
    else if (r.status === 'rejected') r._st = evs.some((e) => new Date(e.$createdAt) > new Date(r.reviewed_at || 0)) ? 'uploaded' : 'rejected';
    else r._st = 'uploaded';
  }
  for (const it of D.items) {
    const ind = D.indicatorById[it.indicator_id]; const st = D.standardById[ind?.standard_id]; const dm = D.domainById[st?.domain_id];
    it._ind = ind; it._std = st; it._dom = dm;
    it._parties = (it.parties || '').split(',').filter(Boolean);
    it._recs = D.recsByItem[it.$id] || [];
  }
  D.settings ||= {};
  return D;
}
function count(recs) {
  const c = { pending: 0, uploaded: 0, approved: 0, rejected: 0, total: recs.length };
  recs.forEach((r) => c[r._st]++);
  c.submitted = c.total - c.pending;
  return c;
}
function itemsFor(partyCode) { return S.data.items.filter((it) => !partyCode || it._parties.includes(partyCode)); }

/* ---------------- الصلاحيات ---------------- */
const isAdmin = () => S.me?.role === 'admin';
const canReview = () => ['admin', 'reviewer'].includes(S.me?.role);
const canEditItem = (it) => canReview() || (S.me?.role === 'editor' && it._parties.some((p) => S.me.parties.includes(p)));

/* ---------------- الهيكل العام ---------------- */
const NAV = [
  ['dashboard', '#/', 'لوحة الإحصائيات', 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'],
  ['items', '#/items', 'الفقرات والشواهد', 'M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z'],
  ['report', '#/report', 'التقرير الشامل', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z'],
  ['activity', '#/activity', 'سجل النشاط', 'M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7zm-1 5v5l4 2 .8-1.5-3.3-1.7V8z'],
  ['users', '#/users', 'المستخدمون', 'M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1a4.2 4.2 0 0 1 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z', true],
  ['settings', '#/settings', 'الإعدادات', 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 3.5-3.5 3.5 3.5 0 0 1-3.5 3.5z', true],
];
function logoUrl() { return S.api.logoUrl(S.data?.settings?.logo || S.publicSettings?.logo); }
function schoolName() { return S.data?.settings?.school_name || S.publicSettings?.school_name || S.cfg.schoolName || 'المدرسة'; }

function shell(active, title) {
  const logo = logoUrl();
  document.body.innerHTML = `
  ${S.api.demo ? '<div class="demo-bar">وضع تجريبي: البيانات محفوظة في هذا المتصفح فقط حتى يتم ربط قاعدة البيانات</div>' : ''}
  <aside class="sidebar" id="sidebar">
    <div class="brand">${logo ? `<img src="${h(logo)}" alt="الشعار">` : '<div class="brand-mark">ش</div>'}<div><strong>${h(schoolName())}</strong><small>منصة الشواهد والأدلة</small></div></div>
    <nav>${NAV.filter((n) => !n[4] || isAdmin()).map(([k, href, label, icon]) => `<a href="${href}" class="${k === active ? 'active' : ''}"><svg viewBox="0 0 24 24"><path d="${icon}"/></svg>${label}</a>`).join('')}</nav>
    <div class="sidebar-foot">
      <a href="#/profile" class="me"><span class="avatar">${h(S.me.name.slice(0, 1))}</span><span>${h(S.me.name)}<small>${ROLES[S.me.role]}</small></span></a>
      <a href="#" class="logout" id="logout">تسجيل الخروج</a>
    </div>
  </aside>
  <main class="main">
    <header class="topbar"><button class="menu-btn" id="menuBtn" aria-label="القائمة">☰</button><h1>${h(title)}</h1><span class="year">${h(S.data.settings.academic_year || '')}</span></header>
    <div id="view"></div>
    <footer class="foot">منصة الشواهد والأدلة — وفق الدليل الاسترشادي لأخصائي التقويم المدرسي (هيئة تقويم التعليم والتدريب)</footer>
  </main>`;
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#logout').onclick = async (e) => { e.preventDefault(); await S.api.logout(); S.me = null; S.data = null; location.hash = '#/'; render(); };
  return $('#view');
}

function loading(msg = 'جارٍ التحميل…') { document.body.innerHTML = `<div class="loading"><div class="spinner"></div><p>${msg}</p></div>`; }

async function refresh() { S.data = index(await S.api.loadAll()); }

/* ---------------- تسجيل الدخول ---------------- */
async function viewLogin() {
  S.publicSettings = await S.api.publicSettings();
  const logo = S.api.logoUrl(S.publicSettings.logo);
  document.body.innerHTML = `
  ${S.api.demo ? '<div class="demo-bar">وضع تجريبي: ادخل بأي كلمة مرور. جرّب "admin" أو "vt1"</div>' : ''}
  <main class="main guest"><div class="login-wrap">
    <form class="login-card card" id="loginForm">
      ${logo ? `<img src="${h(logo)}" class="login-logo" alt="الشعار">` : '<div class="brand-mark big">ش</div>'}
      <h2>${h(schoolName())}</h2><p class="muted">منصة الشواهد والأدلة للتقويم المدرسي</p>
      <div id="loginErr"></div>
      <label>اسم الدخول<input name="u" required autofocus dir="ltr" autocomplete="username"></label>
      <label>كلمة المرور<input type="password" name="p" ${S.api.demo ? '' : 'required'} dir="ltr" autocomplete="current-password"></label>
      <button class="btn btn-lg" type="submit">دخول</button>
    </form></div></main>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const b = $('button', f); b.disabled = true; b.textContent = 'جارٍ الدخول…';
    try { S.me = await S.api.login(f.u.value, f.p.value); render(); }
    catch (err) { $('#loginErr').innerHTML = `<div class="alert alert-err">${h(errMsg(err))}</div>`; b.disabled = false; b.textContent = 'دخول'; }
  };
}

/* ---------------- لوحة الإحصائيات ---------------- */
function viewDashboard(params) {
  const party = params.get('party') || '';
  const v = shell('dashboard', 'لوحة الإحصائيات وتحليل الأداء');
  const D = S.data;
  const items = itemsFor(party);
  const recs = items.flatMap((it) => it._recs);
  const t = count(recs);
  const files = recs.reduce((n, r) => n + (D.evByRecord[r.$id]?.length || 0), 0);
  let done = 0, none = 0, prog = 0;
  items.forEach((it) => { const c = count(it._recs); if (c.total && c.approved === c.total) done++; else if (c.pending === c.total) none++; else prog++; });
  const subP = pct(t.submitted, t.total), appP = pct(t.approved, t.total);

  const avg = (its) => { const l = its.map((i) => i.self_level).filter(Boolean); return l.length ? (l.reduce((a, b) => a + b, 0) / l.length).toFixed(1) : null; };
  const domainCards = D.domains.map((d) => {
    const its = items.filter((i) => i._dom?.$id === d.$id); const c = count(its.flatMap((i) => i._recs));
    if (!c.total) return '';
    const a = avg(its);
    return `<a class="card domain-card" href="#/items?domain=${d.$id}"><span class="tag">المجال ${h(d.code)}</span><h3>${h(d.name)}</h3>
      <div class="dc-row"><span>الرفع</span>${bar(pct(c.submitted, c.total))}<b>${pct(c.submitted, c.total)}%</b></div>
      <div class="dc-row"><span>الاعتماد</span>${bar(pct(c.approved, c.total), 'green')}<b>${pct(c.approved, c.total)}%</b></div>
      <small class="muted">${c.total} وثيقة · متوسط التقييم الذاتي: ${a ? a + ' من 4' : '—'}</small></a>`;
  }).join('');

  const stdRows = D.standards.map((s) => ({ s, c: count(items.filter((i) => i._std?.$id === s.$id).flatMap((i) => i._recs)) })).filter((x) => x.c.total);
  const partyRows = D.parties.map((p) => ({ p, c: count(itemsFor(p.code).flatMap((i) => i._recs)) }));
  const lv = { 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 }; items.forEach((i) => lv[i.self_level || 0]++);
  const days = [...Array(30)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (29 - i)); return d; });
  const recSet = new Set(recs.map((r) => r.$id));
  const evs = D.evidence.filter((e) => recSet.has(e.record_id));
  const timeline = days.map((d) => evs.filter((e) => { const x = new Date(e.$createdAt); return x >= d && x < new Date(d.getTime() + 864e5); }).length);
  const lagging = items.map((it) => ({ it, c: count(it._recs) })).filter((x) => x.c.approved < x.c.total)
    .sort((a, b) => a.c.submitted / a.c.total - b.c.submitted / b.c.total || b.c.rejected - a.c.rejected || a.it.num - b.it.num).slice(0, 8);
  const up = {}; D.evidence.forEach((e) => { up[e.uploader_name || '—'] = (up[e.uploader_name || '—'] || 0) + 1; });
  const top = Object.entries(up).sort((a, b) => b[1] - a[1]).slice(0, 6); const maxTop = top[0]?.[1] || 1;
  const pctItems = D.items.filter((i) => i.is_pct);

  v.innerHTML = `
  <div class="filter-bar"><label>عرض الإحصائيات حسب الجهة المسؤولة:
    <select id="partySel"><option value="">جميع الجهات</option>${D.parties.map((p) => `<option value="${p.code}" ${p.code === party ? 'selected' : ''}>${h(p.name)}</option>`).join('')}</select></label>
    <a class="btn btn-ghost" href="#/report${party ? '?party=' + party : ''}">طباعة التقرير</a></div>
  <section class="kpis">
    <div class="kpi kpi-main"><div class="ring" style="--p:${subP}"><span>${subP}%</span></div><div><h4>نسبة رفع الشواهد</h4><p>${t.submitted} من ${t.total} وثيقة مطلوبة</p></div></div>
    <div class="kpi"><div class="ring ring-green" style="--p:${appP}"><span>${appP}%</span></div><div><h4>نسبة الاعتماد</h4><p>${t.approved} وثيقة معتمدة</p></div></div>
    <div class="kpi kpi-num"><strong>${done}<small>/${items.length}</small></strong><h4>فقرات مكتملة</h4><p>${prog} قيد العمل · ${none} لم تبدأ</p></div>
    <div class="kpi kpi-num"><strong>${t.uploaded}</strong><h4>بانتظار المراجعة</h4><p>وثائق رُفعت ولم تُراجع بعد</p></div>
    <div class="kpi kpi-num kpi-warn"><strong>${t.rejected}</strong><h4>تحتاج تعديل</h4><p>أعادها المراجع بملاحظات</p></div>
    <div class="kpi kpi-num"><strong>${files}</strong><h4>ملفات مرفوعة</h4><p>إجمالي المرفقات</p></div>
  </section>
  <section class="domain-cards">${domainCards}</section>
  <section class="charts">
    <div class="card chart-card"><h3>حالة الوثائق المطلوبة</h3><div class="chart-box sm"><canvas id="chStatus"></canvas></div></div>
    <div class="card chart-card wide"><h3>الإنجاز حسب المعيار</h3><div class="chart-box"><canvas id="chStandards"></canvas></div></div>
    <div class="card chart-card wide"><h3>أداء الجهات المسؤولة (%)</h3><div class="chart-box"><canvas id="chParties"></canvas></div></div>
    <div class="card chart-card"><h3>التقييم الذاتي للفقرات</h3><div class="chart-box sm"><canvas id="chLevels"></canvas></div></div>
    <div class="card chart-card full"><h3>نشاط الرفع خلال آخر 30 يومًا</h3><div class="chart-box xs"><canvas id="chTimeline"></canvas></div></div>
  </section>
  <section class="grid-2">
    <div class="card"><h3>فقرات تحتاج متابعة</h3>${lagging.length ? `<table class="table"><thead><tr><th>#</th><th>الفقرة</th><th>الرفع</th><th></th></tr></thead><tbody>${lagging.map(({ it, c }) => { const p = pct(c.submitted, c.total); return `<tr><td>${it.num}</td><td><a href="#/item/${it.$id}">${h(it.text.length > 80 ? it.text.slice(0, 80) + '…' : it.text)}</a>${c.rejected ? ' ' + badge('rejected') : ''}</td><td style="min-width:110px">${bar(p)}</td><td>${p}%</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">كل الفقرات مكتملة ومعتمدة 🎉</p>'}</div>
    <div class="card"><h3>مؤشرات نواتج التعلم (النسب)</h3>
      ${pctItems.map((i) => `<div class="pct-item"><a href="#/item/${i.$id}">${i.num}. ${h(i.text)}</a>${i.pct_value == null ? '<span class="muted">لم تُدخل النسبة بعد</span>' : `<div class="dc-row">${bar(Math.round(i.pct_value), i.pct_value >= 90 ? 'green' : i.pct_value >= 75 ? '' : 'red')}<b>${+Number(i.pct_value).toFixed(2)}%</b></div>`}</div>`).join('')}
      <h3 style="margin-top:24px">الأكثر رفعًا للشواهد</h3>
      ${top.length ? top.map(([n, c]) => `<div class="dc-row"><span class="nm">${h(n)}</span>${bar(pct(c, maxTop))}<b>${c}</b></div>`).join('') : '<p class="muted">لا توجد ملفات مرفوعة بعد.</p>'}
    </div>
  </section>`;
  $('#partySel').onchange = (e) => { location.hash = '#/' + (e.target.value ? '?party=' + e.target.value : ''); };

  renderCharts({
    status: [t.approved, t.uploaded, t.rejected, t.pending],
    standards: { labels: stdRows.map((x) => x.s.name), approved: stdRows.map((x) => x.c.approved), uploaded: stdRows.map((x) => x.c.uploaded), rejected: stdRows.map((x) => x.c.rejected), pending: stdRows.map((x) => x.c.pending) },
    parties: { labels: partyRows.map((x) => x.p.name), submitted: partyRows.map((x) => pct(x.c.submitted, x.c.total)), approved: partyRows.map((x) => pct(x.c.approved, x.c.total)) },
    levels: { labels: ['متميز', 'متقدم', 'منجز', 'يحتاج تحسين', 'لم يُقيَّم'], values: [lv[4], lv[3], lv[2], lv[1], lv[0]] },
    timeline: { labels: days.map((d) => `${d.getDate()}/${d.getMonth() + 1}`), values: timeline },
  });
}

function renderCharts(D) {
  S.charts.forEach((c) => c.destroy()); S.charts = [];
  if (!window.Chart) return;
  const C = { approved: '#1f8a5b', uploaded: '#e3a21a', rejected: '#d0453a', pending: '#cfd8e3', ink: '#334155', grid: '#eef2f6', blue: '#2f6fb3' };
  Object.assign(Chart.defaults, { color: C.ink, maintainAspectRatio: false });
  Chart.defaults.font.family = "'Cairo', sans-serif"; Chart.defaults.font.size = 13;
  Object.assign(Chart.defaults.plugins.legend, { rtl: true }); Object.assign(Chart.defaults.plugins.legend.labels, { usePointStyle: true, boxWidth: 8 });
  Object.assign(Chart.defaults.plugins.tooltip, { rtl: true, textDirection: 'rtl' });
  const mk = (id, cfg) => S.charts.push(new Chart(document.getElementById(id), cfg));
  const sl = ['معتمد', 'بانتظار المراجعة', 'يحتاج تعديل', 'لم يُرفع'];
  mk('chStatus', { type: 'doughnut', data: { labels: sl, datasets: [{ data: D.status, backgroundColor: [C.approved, C.uploaded, C.rejected, C.pending], borderWidth: 2, borderColor: '#fff' }] }, options: { cutout: '64%', plugins: { legend: { position: 'bottom' } } } });
  const s = D.standards;
  mk('chStandards', { type: 'bar', data: { labels: s.labels, datasets: [
    { label: sl[0], data: s.approved, backgroundColor: C.approved }, { label: sl[1], data: s.uploaded, backgroundColor: C.uploaded },
    { label: sl[2], data: s.rejected, backgroundColor: C.rejected }, { label: sl[3], data: s.pending, backgroundColor: C.pending }] },
  options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, datasets: { bar: { barThickness: 18, borderRadius: 3 } },
    scales: { x: { stacked: true, reverse: true, grid: { color: C.grid }, ticks: { precision: 0 } }, y: { stacked: true, position: 'right', grid: { display: false } } } } });
  mk('chParties', { type: 'bar', data: { labels: D.parties.labels, datasets: [
    { label: 'نسبة الرفع', data: D.parties.submitted, backgroundColor: C.blue, borderRadius: 4, maxBarThickness: 26 },
    { label: 'نسبة الاعتماد', data: D.parties.approved, backgroundColor: C.approved, borderRadius: 4, maxBarThickness: 26 }] },
  options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw}%` } } },
    scales: { x: { reverse: true, grid: { display: false } }, y: { position: 'right', min: 0, max: 100, grid: { color: C.grid }, ticks: { callback: (x) => x + '%' } } } } });
  mk('chLevels', { type: 'doughnut', data: { labels: D.levels.labels, datasets: [{ data: D.levels.values, backgroundColor: ['#1f8a5b', '#5bb187', '#e3a21a', '#d0453a', '#cfd8e3'], borderWidth: 2, borderColor: '#fff' }] }, options: { cutout: '64%', plugins: { legend: { position: 'bottom' } } } });
  mk('chTimeline', { type: 'line', data: { labels: D.timeline.labels, datasets: [{ label: 'ملفات مرفوعة', data: D.timeline.values, borderColor: C.blue, backgroundColor: 'rgba(47,111,179,.12)', fill: true, tension: 0.3, pointRadius: 2 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { reverse: true, grid: { display: false } }, y: { position: 'right', beginAtZero: true, grid: { color: C.grid }, ticks: { precision: 0 } } } } });
}

/* ---------------- قائمة الفقرات ---------------- */
function viewItems(params) {
  const v = shell('items', 'الفقرات والشواهد المطلوبة');
  const D = S.data;
  const f = { q: params.get('q') || '', domain: params.get('domain') || '', party: params.get('party') || '', status: params.get('status') || '', mine: params.get('mine') === '1' };
  const q = f.q.trim();
  const list = D.items.filter((it) => (!f.domain || it._dom?.$id === f.domain) && (!f.party || it._parties.includes(f.party))
    && (!f.mine || it._parties.some((p) => S.me.parties.includes(p))) && (!f.status || it._recs.some((r) => r._st === f.status))
    && (!q || it.text.includes(q) || String(it.num) === q || it._recs.some((r) => r.name.includes(q))));
  let html = `<form class="filter-bar wrap" id="flt">
    <input type="search" name="q" value="${h(f.q)}" placeholder="ابحث برقم الفقرة أو نصها أو اسم السجل…">
    <select name="domain"><option value="">كل المجالات</option>${D.domains.map((d) => `<option value="${d.$id}" ${f.domain === d.$id ? 'selected' : ''}>${h(d.name)}</option>`).join('')}</select>
    <select name="party"><option value="">كل الجهات</option>${D.parties.map((p) => `<option value="${p.code}" ${f.party === p.code ? 'selected' : ''}>${h(p.name)}</option>`).join('')}</select>
    <select name="status"><option value="">كل الحالات</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>فيها: ${l}</option>`).join('')}</select>
    ${S.me.parties.length ? `<label class="chk"><input type="checkbox" name="mine" value="1" ${f.mine ? 'checked' : ''}> المسندة إليّ فقط</label>` : ''}
    <button class="btn">تصفية</button><a class="btn btn-ghost" href="#/items">مسح</a></form>
    <p class="muted">عدد الفقرات: ${list.length}</p>`;
  let cd, cs, ci;
  for (const it of list) {
    if (cd !== it._dom.$id) { if (cd) html += '</section>'; cd = it._dom.$id; cs = ci = null; html += `<section class="group"><h2 class="group-title">مجال ${h(it._dom.name)}</h2>`; }
    if (cs !== it._std.$id) { cs = it._std.$id; ci = null; html += `<h3 class="std-title">معيار ${h(it._std.name)}</h3>`; }
    if (ci !== it._ind.$id) { ci = it._ind.$id; html += `<div class="ind-title"><span class="code">${h(it._ind.code)}</span>${h(it._ind.text)}</div>`; }
    const c = count(it._recs); const p = pct(c.submitted, c.total); const done = c.total && c.approved === c.total;
    const nf = it._recs.reduce((n, r) => n + (D.evByRecord[r.$id]?.length || 0), 0);
    html += `<a class="item-row ${done ? 'done' : ''}" href="#/item/${it.$id}"><span class="num">${it.num}</span>
      <span class="txt">${h(it.text)}<span class="chips">${it._parties.map((pc) => `<span class="chip">${h(D.partyByCode[pc]?.name || pc)}</span>`).join('')}</span></span>
      <span class="meta"><span class="mini-status">${['approved', 'uploaded', 'rejected', 'pending'].filter((k) => c[k]).map((k) => `<i class="dot st-${k}"></i>${c[k]}`).join(' ')}</span>
      ${bar(p, done ? 'green' : '')}<small>${c.total} وثائق · ${nf} ملف${it.self_level ? ' · ' + LEVELS[it.self_level] : ''}</small></span></a>`;
  }
  if (cd) html += '</section>';
  if (!list.length) html += '<div class="card"><p>لا توجد فقرات مطابقة.</p></div>';
  v.innerHTML = html;
  $('#flt').onsubmit = (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    new FormData(e.target).forEach((val, k) => { if (val) p.set(k, val); });
    location.hash = '#/items' + (p.toString() ? '?' + p : '');
  };
}

/* ---------------- صفحة الفقرة ---------------- */
function viewItem(id) {
  const D = S.data; const it = D.itemById[id];
  if (!it) { shell('items', 'غير موجود').innerHTML = '<div class="card">الفقرة غير موجودة.</div>'; return; }
  const v = shell('items', 'الفقرة رقم ' + it.num);
  const edit = canEditItem(it); const rev = canReview();
  const c = count(it._recs);
  const idx = D.items.indexOf(it); const prev = D.items[idx - 1]; const next = D.items[idx + 1];
  const waiting = it._recs.filter((r) => r._st === 'uploaded').length;
  v.innerHTML = `
  <div class="crumbs"><a href="#/items">الفقرات</a> › مجال ${h(it._dom.name)} › معيار ${h(it._std.name)}</div>
  <div class="card item-head">
    <div class="ind"><span class="code">${h(it._ind.code)}</span> المؤشر: ${h(it._ind.text)}</div>
    <h2><span class="num big">${it.num}</span>${h(it.text)}</h2>
    <div class="chips"><span class="muted">المسؤول:</span>${it._parties.map((p) => `<span class="chip">${h(D.partyByCode[p]?.name || p)}</span>`).join('')}</div>
    <div class="head-stats"><div><b>${c.submitted}/${c.total}</b><small>وثائق مرفوعة</small></div><div><b>${c.approved}/${c.total}</b><small>وثائق معتمدة</small></div><div style="flex:1">${bar(pct(c.submitted, c.total))}</div></div>
    <div class="pager">
      ${prev ? `<a class="btn btn-ghost" href="#/item/${prev.$id}">→ الفقرة السابقة</a>` : '<span></span>'}
      ${rev && waiting ? `<button class="btn btn-green" id="approveAll">اعتماد كل المرفوع (${waiting})</button>` : ''}
      ${next ? `<a class="btn btn-ghost" href="#/item/${next.$id}">الفقرة التالية ←</a>` : '<span></span>'}
    </div>
  </div>
  ${!edit && S.me.role === 'editor' ? '<div class="alert alert-info">هذه الفقرة غير مسندة لجهتك؛ يمكنك الاطلاع فقط.</div>' : ''}
  <div class="records">${it._recs.map((r) => recordCard(r, it, edit, rev)).join('')}</div>
  ${isAdmin() ? '<form class="card add-record" id="addRec"><input name="name" placeholder="إضافة وثيقة/سجل مطلوب إضافي لهذه الفقرة…" required><button class="btn btn-ghost">إضافة</button></form>' : ''}
  <form class="card form-grid eval" id="evalForm"><h3>التقييم الذاتي للفقرة</h3>
    <div class="levels">${[4, 3, 2, 1].map((k) => `<label class="lvl lvl-${k}"><input type="radio" name="lvl" value="${k}" ${it.self_level === k ? 'checked' : ''} ${edit ? '' : 'disabled'}><span>${k} — ${LEVELS[k]}</span></label>`).join('')}</div>
    ${it.is_pct ? `<label>النسبة المئوية المحققة (%)<input type="number" step="0.01" min="0" max="100" name="pct" value="${it.pct_value ?? ''}" ${edit ? '' : 'disabled'} dir="ltr"></label>` : ''}
    <label>ملاحظات وجوانب التحسين<textarea name="notes" rows="3" ${edit ? '' : 'disabled'}>${h(it.notes || '')}</textarea></label>
    ${it.updated_by_name ? `<small class="muted">آخر تحديث: ${h(it.updated_by_name)} — ${fmtDate(it.updated_at, true)}</small>` : ''}
    ${edit ? '<button class="btn">حفظ التقييم</button>' : ''}
  </form>`;

  const act = async (fn, okMsg, btn) => {
    if (btn) { btn.disabled = true; }
    try { await fn(); await refresh(); if (okMsg) toast(okMsg); viewItem(id); }
    catch (e) { toast(errMsg(e), 'err'); if (btn) btn.disabled = false; }
  };

  $$('.upload-form', v).forEach((form) => {
    const drop = $('.drop', form); const input = $('input[type=file]', form); const label = $('span', drop); const orig = label.innerHTML;
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.add('over')));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    input.onchange = () => {
      const n = input.files.length;
      if (!n) { label.innerHTML = orig; drop.classList.remove('has-files'); return; }
      label.textContent = (n === 1 ? 'ملف واحد: ' : n + ' ملفات: ') + [...input.files].slice(0, 3).map((x) => x.name).join('، ') + (n > 3 ? '…' : '');
      drop.classList.add('has-files');
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const rec = D.recordById[form.dataset.rec]; const files = [...input.files]; const btn = $('button', form);
      const maxMb = Number(S.data.settings.max_upload_mb || 30);
      const big = files.find((x) => x.size > maxMb * 1048576);
      if (big) { toast(`الملف «${big.name}» أكبر من ${maxMb} م.ب`, 'err'); return; }
      btn.textContent = 'جارٍ الرفع…';
      act(async () => {
        await S.api.uploadFiles(rec, files, S.me, (i, n, p) => { btn.textContent = `جارٍ الرفع ${i + 1}/${n} (${Math.round(p || 0)}%)`; });
        await S.api.log(S.me, 'upload', it, `رفع ${files.length} ملف في: ${rec.name}`);
      }, `تم رفع ${files.length} ملف في «${rec.name}»`, btn);
    };
  });
  $$('[data-del-ev]', v).forEach((b) => (b.onclick = () => {
    const ev = D.evidence.find((x) => x.$id === b.dataset.delEv);
    if (!confirm('حذف هذا الملف نهائيًا؟')) return;
    act(async () => { await S.api.deleteEvidence(ev); await S.api.log(S.me, 'delete_file', it, `حذف «${ev.name}»`); }, 'تم حذف الملف', b);
  }));
  $$('[data-open-ev]', v).forEach((a) => (a.onclick = async (e) => {
    e.preventDefault();
    const ev = D.evidence.find((x) => x.$id === a.dataset.openEv); const inline = a.dataset.inline === '1';
    const win = inline ? window.open('', '_blank') : null;
    try {
      const blob = await S.api.fileBlob(ev, inline);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url; else { const l = document.createElement('a'); l.href = url; l.download = ev.name; document.body.appendChild(l); l.click(); l.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { if (win) win.close(); toast(errMsg(err), 'err'); }
  }));
  $$('.review-form', v).forEach((form) => {
    $$('button', form).forEach((b) => (b.onclick = (e) => {
      e.preventDefault();
      const rec = D.recordById[form.dataset.rec]; const note = form.note.value.trim(); const decision = b.value;
      if (decision === 'reject' && !note) { toast('اكتب ملاحظة توضح المطلوب تعديله.', 'err'); return; }
      act(async () => {
        await S.api.updateRecord(rec.$id, { status: decision === 'approve' ? 'approved' : 'rejected', review_note: note || null, reviewed_by_name: S.me.name, reviewed_at: new Date().toISOString() });
        await S.api.log(S.me, decision, it, (decision === 'approve' ? 'اعتماد: ' : 'طلب تعديل: ') + rec.name + (note ? ' — ' + note : ''));
      }, decision === 'approve' ? 'تم اعتماد السجل' : 'تم إرسال طلب التعديل', b);
    }));
  });
  const aa = $('#approveAll', v);
  if (aa) aa.onclick = () => {
    if (!confirm('اعتماد جميع الوثائق التي بانتظار المراجعة في هذه الفقرة؟')) return;
    const list = it._recs.filter((r) => r._st === 'uploaded');
    act(async () => {
      for (const r of list) await S.api.updateRecord(r.$id, { status: 'approved', reviewed_by_name: S.me.name, reviewed_at: new Date().toISOString() });
      await S.api.log(S.me, 'approve', it, `اعتماد جماعي لـ ${list.length} سجل`);
    }, `تم اعتماد ${list.length} سجل`, aa);
  };
  $$('[data-del-rec]', v).forEach((b) => (b.onclick = () => {
    const rec = D.recordById[b.dataset.delRec];
    if (!confirm('حذف هذه الوثيقة المطلوبة وكل ملفاتها؟')) return;
    act(async () => { await S.api.deleteRecord(rec, D.evByRecord[rec.$id] || []); await S.api.log(S.me, 'delete_record', it, 'حذف وثيقة: ' + rec.name); }, 'تم حذف الوثيقة', b);
  }));
  const ar = $('#addRec', v);
  if (ar) ar.onsubmit = (e) => {
    e.preventDefault(); const name = ar.name.value.trim(); if (!name) return;
    act(async () => { await S.api.addRecord(it.$id, name.slice(0, 250), it._recs.length + 1); await S.api.log(S.me, 'add_record', it, 'إضافة وثيقة: ' + name); }, 'تمت إضافة الوثيقة', $('button', ar));
  };
  $('#evalForm', v).onsubmit = (e) => {
    e.preventDefault(); if (!edit) return;
    const f = e.target; const lvl = Number(f.lvl.value) || null;
    const pv = it.is_pct && f.pct.value !== '' ? Math.max(0, Math.min(100, Number(f.pct.value))) : null;
    act(async () => {
      await S.api.updateItem(it.$id, { self_level: lvl, pct_value: it.is_pct ? pv : it.pct_value ?? null, notes: f.notes.value.trim() || null, updated_by_name: S.me.name, updated_at: new Date().toISOString() });
      await S.api.log(S.me, 'evaluate', it, 'تحديث التقييم الذاتي' + (lvl ? ': ' + LEVELS[lvl] : ''));
    }, 'تم حفظ التقييم والملاحظات', $('button', f));
  };
}

function recordCard(r, it, edit, rev) {
  const evs = S.data.evByRecord[r.$id] || [];
  const maxMb = S.data.settings.max_upload_mb || 30;
  return `<div class="card record st-border-${r._st}" id="rec-${r.$id}">
    <div class="record-head"><h3><span class="box">□</span> ${h(r.name)}</h3>${badge(r._st)}</div>
    ${r.review_note && r._st === 'rejected' ? `<div class="alert alert-err">ملاحظة المراجع: ${h(r.review_note)}</div>` : r.review_note && r._st !== 'pending' ? `<div class="alert alert-info">ملاحظة: ${h(r.review_note)}</div>` : ''}
    ${r.reviewed_at && r._st !== 'pending' ? `<small class="muted">آخر مراجعة: ${h(r.reviewed_by_name || '')} — ${fmtDate(r.reviewed_at, true)}</small>` : ''}
    ${evs.length ? `<ul class="files">${evs.map((ev) => { const e = ext(ev.name); return `<li><span class="ext ext-${h(e)}">${h(e.toUpperCase())}</span>
      <span class="fn"><a href="#" data-open-ev="${ev.$id}" data-inline="${PREVIEW_EXT.includes(e) ? 1 : 0}">${h(ev.name)}</a><small>${size(ev.size || 0)} · ${h(ev.uploader_name || '—')} · ${fmtDate(ev.$createdAt)}</small></span>
      <a class="icon-btn" href="#" data-open-ev="${ev.$id}" data-inline="0" title="تنزيل">⬇</a>
      ${rev || (edit && ev.uploader_id === S.me.id) ? `<button class="icon-btn danger" data-del-ev="${ev.$id}" title="حذف">✕</button>` : ''}</li>`; }).join('')}</ul>` : ''}
    <div class="record-actions">
      ${edit ? `<form class="upload-form" data-rec="${r.$id}"><label class="drop"><input type="file" multiple required><span>اسحب الملفات هنا أو <u>اختر من جهازك</u><small>PDF، Word، Excel، PowerPoint، صور، فيديو — حتى ${h(maxMb)} م.ب للملف</small></span></label><button class="btn">رفع</button></form>` : ''}
      ${rev && evs.length ? `<form class="review-form" data-rec="${r.$id}"><input name="note" placeholder="ملاحظة المراجع (مطلوبة عند طلب التعديل)"><button value="approve" class="btn btn-green">اعتماد</button><button value="reject" class="btn btn-red">طلب تعديل</button></form>` : ''}
      ${isAdmin() ? `<div class="inline-del"><button class="link danger" data-del-rec="${r.$id}">حذف الوثيقة من القائمة</button></div>` : ''}
    </div></div>`;
}

/* ---------------- التقرير ---------------- */
function viewReport(params) {
  const party = params.get('party') || '';
  const v = shell('report', 'التقرير الشامل');
  const D = S.data; const items = itemsFor(party); const t = count(items.flatMap((i) => i._recs));
  let done = 0; items.forEach((i) => { const c = count(i._recs); if (c.total && c.approved === c.total) done++; });
  const logo = logoUrl(); const pName = party ? D.partyByCode[party]?.name : '';
  const stds = D.standards.map((s) => { const its = items.filter((i) => i._std?.$id === s.$id); const l = its.map((i) => i.self_level).filter(Boolean); return { s, c: count(its.flatMap((i) => i._recs)), avg: l.length ? (l.reduce((a, b) => a + b, 0) / l.length).toFixed(1) : '—' }; }).filter((x) => x.c.total);
  let last = null;
  v.innerHTML = `
  <div class="no-print filter-bar"><button class="btn" onclick="window.print()">طباعة / حفظ PDF</button><button class="btn btn-ghost" id="csv">تنزيل Excel (CSV)</button>
    <select id="rp" style="max-width:260px"><option value="">كل الجهات</option>${D.parties.map((p) => `<option value="${p.code}" ${p.code === party ? 'selected' : ''}>${h(p.name)}</option>`).join('')}</select></div>
  <div class="report card">
    <div class="report-head">${logo ? `<img src="${h(logo)}" alt="">` : ''}<div><h2>${h(schoolName())}</h2>
      <p>تقرير حالة الشواهد والأدلة وفق الدليل الاسترشادي لأخصائي التقويم المدرسي${pName ? ' — ' + h(pName) : ''}</p>
      <small>${h(D.settings.academic_year || '')} · تاريخ التقرير: ${fmtDate(new Date())}</small></div></div>
    <div class="report-kpis"><div><b>${pct(t.submitted, t.total)}%</b><span>نسبة الرفع</span></div><div><b>${pct(t.approved, t.total)}%</b><span>نسبة الاعتماد</span></div>
      <div><b>${done}/${items.length}</b><span>فقرات مكتملة</span></div><div><b>${t.rejected}</b><span>تحتاج تعديل</span></div><div><b>${t.pending}</b><span>لم تُرفع</span></div></div>
    <h3>ملخص المعايير</h3>
    <table class="table report-table"><thead><tr><th>المجال</th><th>المعيار</th><th>الوثائق</th><th>مرفوعة</th><th>معتمدة</th><th>نسبة الإنجاز</th><th>متوسط التقييم</th></tr></thead><tbody>
      ${stds.map(({ s, c, avg }) => `<tr><td>${h(D.domainById[s.domain_id]?.name)}</td><td>${h(s.name)}</td><td>${c.total}</td><td>${c.submitted}</td><td>${c.approved}</td><td><div class="dc-row">${bar(pct(c.submitted, c.total))}<b>${pct(c.submitted, c.total)}%</b></div></td><td>${avg}</td></tr>`).join('')}</tbody></table>
    <h3>تفاصيل الفقرات والوثائق</h3>
    <table class="table report-table detail"><thead><tr><th>#</th><th>الفقرة</th><th>الوثائق المطلوبة وحالتها</th><th>التقييم</th></tr></thead><tbody>
      ${items.map((it) => { let sec = ''; if (last !== it._std.$id) { last = it._std.$id; sec = `<tr class="sec"><td colspan="4">مجال ${h(it._dom.name)} — معيار ${h(it._std.name)}</td></tr>`; }
        return sec + `<tr><td>${it.num}</td><td>${h(it.text)}<br><small class="muted">المؤشر ${h(it._ind.code)}</small></td>
        <td>${it._recs.map((r) => { const n = D.evByRecord[r.$id]?.length || 0; return `<div class="rep-rec"><i class="dot st-${r._st}"></i>${h(r.name)} <small>(${STATUS[r._st]}${n ? ' · ' + n + ' ملف' : ''})</small></div>`; }).join('')}</td>
        <td class="nowrap">${it.self_level ? LEVELS[it.self_level] : '—'}${it.is_pct && it.pct_value != null ? '<br>' + +it.pct_value + '%' : ''}</td></tr>`; }).join('')}</tbody></table>
    <div class="signatures"><div>مسؤول التقويم المدرسي<br><br>..................</div><div>مدير المدرسة<br><br>..................</div></div>
  </div>`;
  $('#rp').onchange = (e) => { location.hash = '#/report' + (e.target.value ? '?party=' + e.target.value : ''); };
  $('#csv').onclick = () => exportCsv(items);
}

function exportCsv(items) {
  const D = S.data;
  const rows = [['المجال', 'المعيار', 'المؤشر', 'رقم الفقرة', 'الفقرة', 'الوثيقة المطلوبة', 'الحالة', 'عدد الملفات', 'المسؤول', 'التقييم الذاتي', 'النسبة', 'ملاحظة المراجع']];
  for (const it of items) for (const r of it._recs) rows.push([it._dom.name, it._std.name, it._ind.code, it.num, it.text, r.name, STATUS[r._st], D.evByRecord[r.$id]?.length || 0, it._parties.map((p) => D.partyByCode[p]?.name).join(' - '), it.self_level ? LEVELS[it.self_level] : '', it.pct_value ?? '', r.review_note || '']);
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `shawahed-${fmtDate(new Date()).replace(/\//g, '-')}.csv`; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------------- سجل النشاط ---------------- */
async function viewActivity(params) {
  const v = shell('activity', 'سجل النشاط');
  const page = Math.max(1, Number(params.get('p') || 1)); const type = ACTIONS[params.get('type')] ? params.get('type') : ''; const per = 50;
  v.innerHTML = '<div class="card"><div class="spinner"></div></div>';
  try {
    const { rows, total } = await S.api.activity(per, (page - 1) * per, type);
    const pages = Math.ceil(total / per);
    v.innerHTML = `<div class="filter-bar"><select id="at" style="max-width:280px"><option value="">كل العمليات</option>${Object.entries(ACTIONS).map(([k, l]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="card"><table class="table"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الفقرة</th><th>التفاصيل</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="nowrap">${fmtDate(r.$createdAt, true)}</td><td>${h(r.user_name || '—')}</td><td><span class="badge act">${ACTIONS[r.action] || h(r.action)}</span></td><td>${r.item_id ? `<a href="#/item/${h(r.item_id)}">${h(r.item_num)}</a>` : '—'}</td><td>${h(r.details)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">لا يوجد نشاط بعد.</td></tr>'}
    </tbody></table>${pages > 1 ? `<div class="pagination">${[...Array(pages)].map((_, i) => `<a class="${i + 1 === page ? 'active' : ''}" href="#/activity?p=${i + 1}&type=${type}">${i + 1}</a>`).join('')}</div>` : ''}</div>`;
    $('#at').onchange = (e) => { location.hash = '#/activity' + (e.target.value ? '?type=' + e.target.value : ''); };
  } catch (e) { v.innerHTML = `<div class="alert alert-err">${h(errMsg(e))}</div>`; }
}

/* ---------------- المستخدمون ---------------- */
async function viewUsers(params) {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const v = shell('users', 'إدارة المستخدمين');
  const D = S.data;
  const profiles = (await S.api.profiles()).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name, 'ar'));
  const editId = params.get('edit'); const ed = profiles.find((p) => p.$id === editId);
  const edParties = ed ? (ed.parties || '').split(',') : [];
  const files = {}; D.evidence.forEach((e) => { files[e.uploader_id] = (files[e.uploader_id] || 0) + 1; });
  v.innerHTML = `<div class="grid-2 users-grid">
  <div class="card"><h3>المستخدمون (${profiles.length})</h3>
    <table class="table"><thead><tr><th>الاسم</th><th>الدخول</th><th>الصلاحية</th><th>الجهات</th><th>ملفات</th><th></th></tr></thead><tbody>
    ${profiles.map((p) => `<tr class="${p.active === false ? 'inactive' : ''}"><td>${h(p.name)}${p.active === false ? ' <small>(موقوف)</small>' : ''}</td><td dir="ltr">${h(p.username)}</td><td>${ROLES[p.role] || h(p.role)}</td>
      <td><small>${h((p.parties || '').split(',').filter(Boolean).map((c) => D.partyByCode[c]?.name || c).join('، ') || '—')}</small></td><td>${files[p.$id] || 0}</td>
      <td class="nowrap"><a href="#/users?edit=${p.$id}">تعديل</a>${p.$id !== S.me.id ? ` · <button class="link danger" data-del-user="${p.$id}">حذف</button>` : ''}</td></tr>`).join('')}
    </tbody></table>
    <div class="roles-help"><h4>الصلاحيات</h4>
      <p><b>مدير النظام:</b> كل الصلاحيات، وإدارة المستخدمين والإعدادات.</p><p><b>مراجع (لجنة التميز):</b> يرفع في كل الفقرات، ويعتمد الوثائق أو يطلب تعديلها.</p>
      <p><b>مسؤول رفع الشواهد:</b> يرفع الملفات ويقيّم الفقرات المسندة لجهته فقط.</p><p><b>مطّلع فقط:</b> يشاهد الإحصائيات والملفات دون تعديل.</p></div>
  </div>
  <form class="card form-grid" id="userForm"><h3>${ed ? 'تعديل: ' + h(ed.name) : 'إضافة مستخدم جديد'}</h3>
    <label>الاسم الكامل<input name="name" value="${h(ed?.name || '')}" required></label>
    <label>اسم الدخول (بالإنجليزية)<input name="username" value="${h(ed?.username || '')}" ${ed ? 'disabled' : 'required'} dir="ltr" pattern="[A-Za-z0-9_.]{3,40}"></label>
    <label>${ed ? 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)' : 'كلمة المرور (8 أحرف فأكثر)'}<input name="password" ${ed ? '' : 'required minlength="8"'} dir="ltr" autocomplete="new-password"></label>
    <label>الصلاحية<select name="role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${(ed?.role || 'editor') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <fieldset><legend>الجهات المسؤول عنها (تحدد الفقرات التي يرفع فيها)</legend>${D.parties.map((p) => `<label class="chk"><input type="checkbox" name="parties" value="${p.code}" ${edParties.includes(p.code) ? 'checked' : ''}> ${h(p.name)}</label>`).join('')}</fieldset>
    ${ed ? `<label class="chk"><input type="checkbox" name="active" ${ed.active !== false ? 'checked' : ''}> الحساب مفعّل</label>` : ''}
    <div class="row-btns"><button class="btn">حفظ</button>${ed ? '<a class="btn btn-ghost" href="#/users">إلغاء</a>' : ''}</div>
  </form></div>`;
  $('#userForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; const b = $('button', f); b.disabled = true;
    const payload = { action: ed ? 'update' : 'create', userId: ed?.$id, name: f.name.value.trim(), username: f.username.value.trim(), password: f.password.value, role: f.role.value, parties: $$('input[name=parties]:checked', f).map((x) => x.value), active: ed ? f.active.checked : true };
    try {
      await S.api.adminUsers(payload);
      await S.api.log(S.me, ed ? 'user_edit' : 'user_add', null, (ed ? 'تعديل المستخدم: ' : 'إضافة المستخدم: ') + payload.name);
      toast('تم حفظ بيانات المستخدم'); location.hash = '#/users'; if (!ed) viewUsers(new URLSearchParams());
    } catch (err) { toast(errMsg(err), 'err'); b.disabled = false; }
  };
  $$('[data-del-user]', v).forEach((b) => (b.onclick = async () => {
    if (!confirm('حذف المستخدم؟ ستبقى ملفاته المرفوعة في المنصة.')) return;
    try { await S.api.adminUsers({ action: 'delete', userId: b.dataset.delUser }); await S.api.log(S.me, 'user_delete', null, 'حذف مستخدم'); toast('تم حذف المستخدم'); viewUsers(new URLSearchParams()); }
    catch (err) { toast(errMsg(err), 'err'); }
  }));
}

/* ---------------- الإعدادات وحسابي ---------------- */
function viewSettings() {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const v = shell('settings', 'إعدادات المنصة'); const st = S.data.settings; const logo = logoUrl();
  const total = S.data.evidence.reduce((n, e) => n + (e.size || 0), 0);
  v.innerHTML = `<div class="grid-2">
    <form class="card form-grid" id="setForm"><h3>بيانات المدرسة</h3>
      <label>اسم المدرسة<input name="school_name" value="${h(st.school_name || '')}" required></label>
      <label>العام الدراسي / الفصل<input name="academic_year" value="${h(st.academic_year || '')}"></label>
      <label>شعار المدرسة (PNG أو JPG)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>
      ${logo ? `<div class="logo-preview"><img src="${h(logo)}" alt=""><label class="chk"><input type="checkbox" name="rm"> إزالة الشعار</label></div>` : ''}
      <button class="btn">حفظ الإعدادات</button></form>
    <div class="card"><h3>البيانات والنسخ الاحتياطي</h3>
      <p>حجم الملفات المرفوعة: <b>${size(total)}</b> من 2 جيجابايت متاحة في الخطة المجانية</p>${bar(Math.min(100, pct(total, 2 * 1024 ** 3)))}
      <p style="margin-top:16px"><button class="btn btn-ghost" id="csv2">تصدير حالة كل الوثائق (Excel / CSV)</button></p>
      <p class="muted">تنبيه: مشاريع Appwrite المجانية تتوقف مؤقتًا إذا لم تُستخدم أسبوعًا كاملًا، ويمكن إعادة تشغيلها من لوحة Appwrite بضغطة زر.</p></div></div>`;
  $('#csv2').onclick = () => exportCsv(S.data.items);
  $('#setForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; const b = $('button', f); b.disabled = true;
    try {
      await S.api.saveSetting('school_name', f.school_name.value.trim());
      await S.api.saveSetting('academic_year', f.academic_year.value.trim());
      if (f.logo.files[0]) await S.api.saveSetting('logo', await S.api.uploadLogo(f.logo.files[0]));
      else if (f.rm?.checked) await S.api.saveSetting('logo', '');
      await S.api.log(S.me, 'settings', null, 'تحديث الإعدادات');
      await refresh(); toast('تم حفظ الإعدادات'); viewSettings();
    } catch (err) { toast(errMsg(err), 'err'); b.disabled = false; }
  };
}

function viewProfile() {
  const v = shell('', 'حسابي'); const D = S.data;
  v.innerHTML = `<div class="grid-2">
    <div class="card"><h3>بياناتي</h3><dl class="dl"><dt>الاسم</dt><dd>${h(S.me.name)}</dd><dt>اسم الدخول</dt><dd dir="ltr">${h(S.me.username)}</dd><dt>الصلاحية</dt><dd>${ROLES[S.me.role]}</dd>
      <dt>الجهات المسؤول عنها</dt><dd>${h(S.me.parties.map((p) => D.partyByCode[p]?.name || p).join('، ') || '—')}</dd></dl></div>
    <form class="card form-grid" id="pwForm"><h3>تغيير كلمة المرور</h3>
      <label>كلمة المرور الحالية<input type="password" name="old" required dir="ltr"></label>
      <label>كلمة المرور الجديدة<input type="password" name="n1" required minlength="8" dir="ltr"></label>
      <label>تأكيد كلمة المرور الجديدة<input type="password" name="n2" required dir="ltr"></label><button class="btn">حفظ</button></form></div>`;
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.n1.value !== f.n2.value) { toast('تأكيد كلمة المرور غير مطابق', 'err'); return; }
    try { await S.api.changePassword(f.old.value, f.n1.value); toast('تم تغيير كلمة المرور'); f.reset(); } catch (err) { toast(errMsg(err), 'err'); }
  };
}

/* ---------------- الموجّه ---------------- */
async function render() {
  if (!S.me) { await viewLogin(); return; }
  if (!S.data) {
    loading('جارٍ تحميل البيانات…');
    try { await refresh(); }
    catch (e) {
      document.body.innerHTML = `<div class="loading"><div class="alert alert-err">${h(errMsg(e))}</div><p class="muted">إن كانت هذه أول مرة، تأكد من تشغيل إعداد قاعدة البيانات (GitHub Actions ← إعداد قاعدة البيانات).</p><button class="btn" onclick="location.reload()">إعادة المحاولة</button> <button class="btn btn-ghost" id="lo">تسجيل الخروج</button></div>`;
      $('#lo').onclick = async () => { await S.api.logout(); location.reload(); };
      return;
    }
  }
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  switch (parts[0]) {
    case undefined: return viewDashboard(params);
    case 'items': return viewItems(params);
    case 'item': return viewItem(parts[1]);
    case 'report': return viewReport(params);
    case 'activity': return viewActivity(params);
    case 'users': return viewUsers(params);
    case 'settings': return viewSettings();
    case 'profile': return viewProfile();
    default: location.hash = '#/';
  }
}

(async function start() {
  loading();
  try { S.cfg = await (await fetch('config.json', { cache: 'no-store' })).json(); } catch { S.cfg = {}; }
  S.cfg.loginDomain ||= 'shawahed.example.com';
  S.api = createBackend(S.cfg);
  S.me = await S.api.me();
  window.addEventListener('hashchange', render);
  render();
})();
