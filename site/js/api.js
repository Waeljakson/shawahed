// طبقة الاتصال بالبيانات: Appwrite في التشغيل الفعلي، أو وضع تجريبي داخل المتصفح
/* global Appwrite */
'use strict';

const ROLES = { admin: 'مدير النظام', reviewer: 'مراجع (لجنة التميز)', editor: 'مسؤول رفع الشواهد', viewer: 'مطّلع فقط' };
const DB = 'main', BUCKET = 'evidence', FN = 'users-admin';

async function fetchAllRows(db, tableId, queries = []) {
  const { Query } = Appwrite;
  const out = [];
  let cursor = null;
  for (;;) {
    const q = [Query.limit(500), ...queries];
    if (cursor) q.push(Query.cursorAfter(cursor));
    const res = await db.listRows({ databaseId: DB, tableId, queries: q });
    out.push(...res.rows);
    if (res.rows.length < 500) break;
    cursor = res.rows[res.rows.length - 1].$id;
  }
  return out;
}

function roleFromLabels(labels = []) {
  for (const r of Object.keys(ROLES)) if (labels.includes(r)) return r;
  return 'viewer';
}

/* ======================= Appwrite ======================= */
class AppwriteBackend {
  constructor(cfg) {
    const { Client, Account, TablesDB, Storage, Functions } = Appwrite;
    this.cfg = cfg;
    this.client = new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId);
    this.account = new Account(this.client);
    this.db = new TablesDB(this.client);
    this.storage = new Storage(this.client);
    this.functions = new Functions(this.client);
    this.demo = false;
  }

  emailOf(username) { return username.includes('@') ? username.trim() : `${username.trim().toLowerCase()}@${this.cfg.loginDomain}`; }

  async me() {
    try {
      const u = await this.account.get();
      return { id: u.$id, name: u.name, username: u.email.split('@')[0], role: roleFromLabels(u.labels), parties: (u.labels || []).filter((l) => /^p[A-Z]+$/.test(l)).map((l) => l.slice(1)) };
    } catch { return null; }
  }
  async login(username, password) {
    try { await this.account.deleteSession({ sessionId: 'current' }); } catch { /* لا توجد جلسة */ }
    await this.account.createEmailPasswordSession({ email: this.emailOf(username), password });
    return this.me();
  }
  async logout() { try { await this.account.deleteSession({ sessionId: 'current' }); } catch { /* */ } }
  async changePassword(oldPassword, password) { await this.account.updatePassword({ password, oldPassword }); }

  async publicSettings() {
    try {
      const rows = await fetchAllRows(this.db, 'settings');
      return Object.fromEntries(rows.map((r) => [r.$id, r.value]));
    } catch { return {}; }
  }

  async loadAll() {
    const T = ['parties', 'domains', 'standards', 'indicators', 'items', 'records', 'evidence'];
    const res = await Promise.all([...T.map((t) => fetchAllRows(this.db, t)), this.publicSettings()]);
    const data = Object.fromEntries(T.map((t, i) => [t, res[i]]));
    data.settings = res[T.length];
    return data;
  }

  async uploadFiles(record, files, me, onProgress) {
    const { ID, Permission, Role } = Appwrite;
    const done = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const up = await this.storage.createFile({
        bucketId: BUCKET, fileId: ID.unique(), file: f,
        permissions: [Permission.delete(Role.user(me.id))],
        onProgress: (p) => onProgress && onProgress(i, files.length, p.progress),
      });
      const row = await this.db.createRow({
        databaseId: DB, tableId: 'evidence', rowId: ID.unique(),
        data: { record_id: record.$id, item_id: record.item_id, file_id: up.$id, name: f.name.slice(0, 250), size: f.size, mime: f.type || '', uploader_id: me.id, uploader_name: me.name },
        permissions: [Permission.delete(Role.user(me.id)), Permission.update(Role.user(me.id))],
      });
      done.push(row);
    }
    return done;
  }
  async deleteEvidence(ev) {
    try { await this.storage.deleteFile({ bucketId: BUCKET, fileId: ev.file_id }); } catch (e) { if (e.code !== 404) throw e; }
    await this.db.deleteRow({ databaseId: DB, tableId: 'evidence', rowId: ev.$id });
  }
  async updateRecord(recordId, data) { return this.db.updateRow({ databaseId: DB, tableId: 'records', rowId: recordId, data }); }
  async updateItem(itemId, data) { return this.db.updateRow({ databaseId: DB, tableId: 'items', rowId: itemId, data }); }
  async addRecord(itemId, name, sort) {
    return this.db.createRow({ databaseId: DB, tableId: 'records', rowId: Appwrite.ID.unique(), data: { item_id: itemId, name, sort, status: 'none' } });
  }
  async deleteRecord(rec, evidence) {
    for (const ev of evidence) await this.deleteEvidence(ev);
    await this.db.deleteRow({ databaseId: DB, tableId: 'records', rowId: rec.$id });
  }
  async log(me, action, item, details) {
    try {
      await this.db.createRow({ databaseId: DB, tableId: 'activity', rowId: Appwrite.ID.unique(), data: { user_name: me?.name || '', action, item_id: item?.$id || null, item_num: item?.num ?? null, details: String(details || '').slice(0, 500) } });
    } catch { /* السجل غير حرج */ }
  }
  async activity(limit, offset, action) {
    const { Query } = Appwrite;
    const q = [Query.orderDesc('$createdAt'), Query.limit(limit), Query.offset(offset)];
    if (action) q.push(Query.equal('action', action));
    const r = await this.db.listRows({ databaseId: DB, tableId: 'activity', queries: q });
    return { rows: r.rows, total: r.total };
  }
  async profiles() { return fetchAllRows(this.db, 'profiles'); }
  async adminUsers(payload) {
    const ex = await this.functions.createExecution({ functionId: FN, body: JSON.stringify(payload), async: false });
    let out = {};
    try { out = JSON.parse(ex.responseBody || '{}'); } catch { /* */ }
    if (!out.ok) throw new Error(out.message || 'تعذر تنفيذ العملية، تأكد من نشر وظيفة إدارة المستخدمين.');
    return out;
  }
  async saveSetting(key, value) {
    try { await this.db.updateRow({ databaseId: DB, tableId: 'settings', rowId: key, data: { value } }); }
    catch (e) { if (e.code === 404) await this.db.createRow({ databaseId: DB, tableId: 'settings', rowId: key, data: { value } }); else throw e; }
  }
  async uploadLogo(file) {
    const { ID, Permission, Role } = Appwrite;
    const up = await this.storage.createFile({ bucketId: BUCKET, fileId: ID.unique(), file, permissions: [Permission.read(Role.any())] });
    return up.$id;
  }
  logoUrl(fileId) { return fileId ? String(this.storage.getFileView({ bucketId: BUCKET, fileId })) : ''; }

  // تنزيل الملفات مع الجلسة (يعمل حتى مع منع ملفات الارتباط الخارجية في المتصفح)
  async fileBlob(ev, inline) {
    const url = String(inline ? this.storage.getFileView({ bucketId: BUCKET, fileId: ev.file_id }) : this.storage.getFileDownload({ bucketId: BUCKET, fileId: ev.file_id }));
    const headers = { 'X-Appwrite-Project': this.cfg.projectId };
    const fb = localStorage.getItem('cookieFallback');
    if (fb) headers['X-Fallback-Cookies'] = fb;
    const r = await fetch(url, { credentials: 'include', headers });
    if (!r.ok) throw new Error('تعذر تنزيل الملف');
    return r.blob();
  }
}

/* ======================= وضع تجريبي ======================= */
class DemoBackend {
  constructor(cfg) { this.cfg = cfg; this.demo = true; this.key = 'shawahed-demo-v1'; }
  save() { try { sessionStorage.setItem(this.key, JSON.stringify(this.state)); } catch { /* */ } }
  id() { return Math.random().toString(36).slice(2, 12); }
  async ensure() {
    if (this.state) return;
    try { this.state = JSON.parse(sessionStorage.getItem(this.key)); } catch { this.state = null; }
    if (this.state) return;
    const seed = await (await fetch('data/seed.json')).json();
    const s = { parties: [], domains: [], standards: [], indicators: [], items: [], records: [], evidence: [], activity: [], blobs: {},
      settings: { school_name: this.cfg.schoolName || 'المدرسة', academic_year: this.cfg.academicYear || '', logo: '' },
      profiles: [{ $id: 'u1', name: 'مدير النظام (تجريبي)', username: 'admin', role: 'admin', parties: '', active: true },
        { $id: 'u2', name: 'وكيل الشؤون التعليمية (تجريبي)', username: 'vt1', role: 'editor', parties: 'VT', active: true }] };
    Object.entries(seed.parties).forEach(([code, name]) => s.parties.push({ $id: 'p' + code, code, name }));
    let ds = 0;
    const now = Date.now();
    for (const d of seed.domains) {
      const did = 'd' + d.code; s.domains.push({ $id: did, code: d.code, name: d.name, sort: ++ds });
      let ss = 0;
      for (const st of d.standards) {
        const sid = 's' + st.code; s.standards.push({ $id: sid, domain_id: did, code: st.code, name: st.name, sort: ++ss });
        let is = 0;
        for (const ind of st.indicators) {
          const iid = 'i' + ind.code; s.indicators.push({ $id: iid, standard_id: sid, code: ind.code, text: ind.text, sort: ++is });
          for (const it of ind.items) {
            const itemId = 'item' + it.num;
            s.items.push({ $id: itemId, indicator_id: iid, num: it.num, text: it.text, parties: it.parties.join(','), is_pct: it.is_pct, pct_value: it.num === 48 ? 94.5 : it.num === 49 ? 88 : null, self_level: it.num % 4 ? 1 + ((it.num * 3) % 4) : null, notes: '' });
            it.records.forEach((name, k) => {
              const rid = `rec${it.num}_${k + 1}`; const h = (it.num * 7 + k * 3) % 10;
              const rec = { $id: rid, item_id: itemId, name, sort: k + 1, status: 'none', review_note: '', reviewed_by_name: '', reviewed_at: null };
              if (h < 7) {
                const at = new Date(now - ((it.num + k) % 28) * 864e5).toISOString();
                s.evidence.push({ $id: this.id(), record_id: rid, item_id: itemId, file_id: 'demo', name: name + '.pdf', size: 180000 + it.num * 1000, mime: 'application/pdf', uploader_id: h % 2 ? 'u1' : 'u2', uploader_name: h % 2 ? 'مدير النظام (تجريبي)' : 'وكيل الشؤون التعليمية (تجريبي)', $createdAt: at });
                if (h < 3) { rec.status = 'approved'; rec.reviewed_at = new Date(now).toISOString(); rec.reviewed_by_name = 'مدير النظام (تجريبي)'; }
                else if (h === 6) { rec.status = 'rejected'; rec.review_note = 'يرجى إرفاق نسخة موقعة ومعتمدة'; rec.reviewed_at = new Date(now).toISOString(); rec.reviewed_by_name = 'مدير النظام (تجريبي)'; }
              }
              s.records.push(rec);
            });
          }
        }
      }
    }
    this.state = s; this.save();
  }
  async me() { await this.ensure(); const u = JSON.parse(sessionStorage.getItem(this.key + '-me') || 'null'); return u; }
  async login(username) {
    await this.ensure();
    const p = this.state.profiles.find((x) => x.username === username.trim().toLowerCase()) || this.state.profiles[0];
    const me = { id: p.$id, name: p.name, username: p.username, role: p.role, parties: p.parties ? p.parties.split(',') : [] };
    sessionStorage.setItem(this.key + '-me', JSON.stringify(me));
    return me;
  }
  async logout() { sessionStorage.removeItem(this.key + '-me'); }
  async changePassword() { /* تجريبي */ }
  async publicSettings() { await this.ensure(); return this.state.settings; }
  async loadAll() {
    await this.ensure();
    const s = this.state;
    return JSON.parse(JSON.stringify({ parties: s.parties, domains: s.domains, standards: s.standards, indicators: s.indicators, items: s.items, records: s.records, evidence: s.evidence, settings: s.settings }));
  }
  async uploadFiles(record, files, me, onProgress) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; const fid = this.id();
      this.state.blobs[fid] = URL.createObjectURL(f);
      this.state.evidence.push({ $id: this.id(), record_id: record.$id, item_id: record.item_id, file_id: fid, name: f.name, size: f.size, mime: f.type, uploader_id: me.id, uploader_name: me.name, $createdAt: new Date().toISOString() });
      onProgress && onProgress(i, files.length, 100);
    }
    this.save();
  }
  async deleteEvidence(ev) { this.state.evidence = this.state.evidence.filter((x) => x.$id !== ev.$id); this.save(); }
  async updateRecord(id, data) { Object.assign(this.state.records.find((r) => r.$id === id), data); this.save(); }
  async updateItem(id, data) { Object.assign(this.state.items.find((r) => r.$id === id), data); this.save(); }
  async addRecord(itemId, name, sort) { this.state.records.push({ $id: this.id(), item_id: itemId, name, sort, status: 'none' }); this.save(); }
  async deleteRecord(rec) { this.state.records = this.state.records.filter((r) => r.$id !== rec.$id); this.state.evidence = this.state.evidence.filter((e) => e.record_id !== rec.$id); this.save(); }
  async log(me, action, item, details) { this.state.activity.unshift({ $id: this.id(), user_name: me?.name, action, item_id: item?.$id, item_num: item?.num, details, $createdAt: new Date().toISOString() }); this.save(); }
  async activity(limit, offset, action) { const rows = this.state.activity.filter((a) => !action || a.action === action); return { rows: rows.slice(offset, offset + limit), total: rows.length }; }
  async profiles() { await this.ensure(); return this.state.profiles; }
  async adminUsers(p) {
    const s = this.state;
    if (p.action === 'create') s.profiles.push({ $id: this.id(), name: p.name, username: p.username, role: p.role, parties: (p.parties || []).join(','), active: true });
    if (p.action === 'update') Object.assign(s.profiles.find((x) => x.$id === p.userId), { name: p.name, role: p.role, parties: (p.parties || []).join(','), active: p.active });
    if (p.action === 'delete') s.profiles = s.profiles.filter((x) => x.$id !== p.userId);
    this.save(); return { ok: true };
  }
  async saveSetting(k, v) { this.state.settings[k] = v; this.save(); }
  async uploadLogo(file) { const fid = this.id(); this.state.blobs[fid] = URL.createObjectURL(file); return fid; }
  logoUrl(fid) { return (fid && this.state?.blobs[fid]) || ''; }
  async fileBlob(ev) {
    if (this.state.blobs[ev.file_id]) return (await fetch(this.state.blobs[ev.file_id])).blob();
    return new Blob(['ملف تجريبي — ارفع ملفاتك الحقيقية بعد ربط قاعدة البيانات.'], { type: 'text/plain;charset=utf-8' });
  }
}

window.createBackend = function (cfg) {
  const demo = !cfg.projectId || new URLSearchParams(location.search).has('demo');
  return demo ? new DemoBackend(cfg) : new AppwriteBackend(cfg);
};
window.ROLES = ROLES;
