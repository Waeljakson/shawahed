// وظيفة Appwrite: إدارة المستخدمين (إنشاء/تعديل/حذف) — لا يستدعيها إلا مدير النظام
import { Client, Users, TablesDB, ID, Query } from 'node-appwrite';
import { readFileSync } from 'node:fs';

let cfg = {};
try { cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url))); } catch { /* افتراضي */ }
const LOGIN_DOMAIN = cfg.loginDomain || 'shawahed.example.com';
const DB_ID = 'main';
const ROLES = ['admin', 'reviewer', 'editor', 'viewer'];
const PARTIES = ['M', 'VT', 'VS', 'VM', 'RN', 'MT'];

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key'] || '');
  const users = new Users(client);
  const db = new TablesDB(client);
  const fail = (message, status = 400) => res.json({ ok: false, message }, status);

  const callerId = req.headers['x-appwrite-user-id'];
  if (!callerId) return fail('يجب تسجيل الدخول', 401);
  const caller = await users.get({ userId: callerId });
  if (!caller.labels?.includes('admin')) return fail('هذه العملية لمدير النظام فقط', 403);

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.bodyJson || req.body || {}); } catch { return fail('طلب غير صالح'); }
  const { action } = body;

  const clean = (b) => {
    const role = ROLES.includes(b.role) ? b.role : 'editor';
    const parties = (Array.isArray(b.parties) ? b.parties : []).filter((p) => PARTIES.includes(p));
    return { name: String(b.name || '').trim().slice(0, 150), username: String(b.username || '').trim().toLowerCase(), role, parties, active: b.active !== false };
  };
  const labelsOf = (u) => [u.role, ...u.parties.map((p) => 'p' + p)];

  try {
    if (action === 'create') {
      const u = clean(body);
      if (!u.name || !/^[a-z0-9_.]{3,40}$/.test(u.username)) return fail('أدخل الاسم، واسم دخول بالإنجليزية أو الأرقام (3 أحرف فأكثر)');
      if (String(body.password || '').length < 8) return fail('كلمة المرور يجب ألا تقل عن 8 أحرف');
      const email = `${u.username}@${LOGIN_DOMAIN}`;
      if ((await users.list({ queries: [Query.equal('email', email)] })).total) return fail('اسم الدخول مستخدم مسبقًا');
      const created = await users.create({ userId: ID.unique(), email, password: body.password, name: u.name });
      await users.updateLabels({ userId: created.$id, labels: labelsOf(u) });
      await db.upsertRow({ databaseId: DB_ID, tableId: 'profiles', rowId: created.$id, data: { name: u.name, username: u.username, role: u.role, parties: u.parties.join(','), active: true } });
      log(`created ${u.username}`);
      return res.json({ ok: true, userId: created.$id });
    }

    if (action === 'update') {
      const userId = String(body.userId || '');
      const u = clean(body);
      if (!userId) return fail('المستخدم غير محدد');
      if (userId === callerId) { u.role = 'admin'; u.active = true; }
      if (!u.name) return fail('أدخل الاسم');
      await users.updateName({ userId, name: u.name });
      await users.updateLabels({ userId, labels: labelsOf(u) });
      await users.updateStatus({ userId, status: u.active });
      if (body.password) {
        if (String(body.password).length < 8) return fail('كلمة المرور يجب ألا تقل عن 8 أحرف');
        await users.updatePassword({ userId, password: body.password });
      }
      const current = await users.get({ userId });
      const username = current.email.split('@')[0];
      await db.upsertRow({ databaseId: DB_ID, tableId: 'profiles', rowId: userId, data: { name: u.name, username, role: u.role, parties: u.parties.join(','), active: u.active } });
      if (!u.active) await users.deleteSessions({ userId });
      return res.json({ ok: true });
    }

    if (action === 'delete') {
      const userId = String(body.userId || '');
      if (!userId || userId === callerId) return fail('لا يمكن حذف هذا الحساب');
      await users.delete({ userId });
      try { await db.deleteRow({ databaseId: DB_ID, tableId: 'profiles', rowId: userId }); } catch { /* غير موجود */ }
      return res.json({ ok: true });
    }

    return fail('عملية غير معروفة');
  } catch (e) {
    error(e?.message || String(e));
    return fail(e?.message || 'حدث خطأ غير متوقع', 500);
  }
};
