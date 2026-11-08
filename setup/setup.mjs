// سكربت إعداد قاعدة البيانات على Appwrite — يُشغَّل تلقائيًا من GitHub Actions
// آمن لإعادة التشغيل: يُنشئ الناقص فقط ولا يمسح أي بيانات موجودة.
import { Client, TablesDB, Storage, Users, Functions, Query, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { readFileSync, existsSync } from 'node:fs';
import { DB_ID, BUCKET_ID, FUNCTION_ID, TABLES, BUCKET, READ } from './schema.mjs';

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`❌ المتغير ${k} غير موجود. راجع دليل الإعداد.`); process.exit(1); } return v; };
const config = JSON.parse(readFileSync(new URL('../site/config.json', import.meta.url)));
const endpoint = process.env.APPWRITE_ENDPOINT || config.endpoint;
const projectId = process.env.APPWRITE_PROJECT_ID || config.projectId;
if (!endpoint || !projectId) { console.error('❌ أضف endpoint و projectId في site/config.json'); process.exit(1); }
const apiKey = need('APPWRITE_API_KEY');
const loginDomain = config.loginDomain || 'shawahed.example.com';

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const db = new TablesDB(client);
const storage = new Storage(client);
const users = new Users(client);
const functions = new Functions(client);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isNotFound = (e) => e?.code === 404;

async function ensureDatabase() {
  try { await db.get({ databaseId: DB_ID }); console.log('✓ قاعدة البيانات موجودة'); }
  catch (e) { if (!isNotFound(e)) throw e; await db.create({ databaseId: DB_ID, name: 'منصة الشواهد' }); console.log('＋ أُنشئت قاعدة البيانات'); }
}

async function createColumn(tableId, c) {
  const base = { databaseId: DB_ID, tableId, key: c.key, required: !!c.required };
  if (c.type === 'string') return db.createStringColumn({ ...base, size: c.size });
  if (c.type === 'integer') return db.createIntegerColumn(base);
  if (c.type === 'float') return db.createFloatColumn(base);
  if (c.type === 'boolean') return db.createBooleanColumn(base);
  if (c.type === 'datetime') return db.createDatetimeColumn(base);
  throw new Error('نوع عمود غير معروف ' + c.type);
}

async function waitColumns(tableId) {
  for (let i = 0; i < 60; i++) {
    const { columns } = await db.listColumns({ databaseId: DB_ID, tableId });
    const failed = columns.filter((c) => c.status === 'failed');
    if (failed.length) throw new Error(`فشل إنشاء الأعمدة: ${failed.map((c) => c.key).join(', ')} في ${tableId}`);
    if (columns.every((c) => c.status === 'available')) return columns;
    await sleep(1500);
  }
  throw new Error('انتهت مهلة انتظار الأعمدة في ' + tableId);
}

async function ensureTables() {
  for (const t of TABLES) {
    try {
      await db.getTable({ databaseId: DB_ID, tableId: t.id });
      await db.updateTable({ databaseId: DB_ID, tableId: t.id, name: t.name, permissions: t.permissions, rowSecurity: t.rowSecurity });
    } catch (e) {
      if (!isNotFound(e)) throw e;
      await db.createTable({ databaseId: DB_ID, tableId: t.id, name: t.name, permissions: t.permissions, rowSecurity: t.rowSecurity });
      console.log('＋ جدول', t.id);
    }
    const existing = new Set((await db.listColumns({ databaseId: DB_ID, tableId: t.id })).columns.map((c) => c.key));
    for (const c of t.columns) if (!existing.has(c.key)) { await createColumn(t.id, c); console.log(`  ＋ عمود ${t.id}.${c.key}`); }
    await waitColumns(t.id);
    if (t.indexes) {
      const idx = new Set((await db.listIndexes({ databaseId: DB_ID, tableId: t.id })).indexes.map((i) => i.key));
      for (const i of t.indexes) if (!idx.has(i.key)) { await db.createIndex({ databaseId: DB_ID, tableId: t.id, key: i.key, type: 'key', columns: i.columns }); console.log(`  ＋ فهرس ${t.id}.${i.key}`); }
    }
  }
  console.log('✓ الجداول جاهزة');
}

async function ensureBucket() {
  const params = { bucketId: BUCKET_ID, name: BUCKET.name, permissions: BUCKET.permissions, fileSecurity: true, enabled: true, maximumFileSize: BUCKET.maximumFileSize, allowedFileExtensions: BUCKET.allowedFileExtensions };
  try { await storage.getBucket({ bucketId: BUCKET_ID }); await storage.updateBucket(params); }
  catch (e) {
    if (!isNotFound(e)) throw e;
    try { await storage.createBucket(params); }
    catch (e2) { // بعض الخطط تحدّ حجم الملف؛ نعيد المحاولة بحد أقل
      if (e2?.code === 400) await storage.createBucket({ ...params, maximumFileSize: 10 * 1024 * 1024 }); else throw e2;
    }
    console.log('＋ مساحة تخزين الملفات');
  }
  console.log('✓ مساحة التخزين جاهزة');
}

async function exists(tableId, rowId) {
  try { await db.getRow({ databaseId: DB_ID, tableId, rowId }); return true; } catch (e) { if (isNotFound(e)) return false; throw e; }
}

async function seed() {
  const count = (await db.listRows({ databaseId: DB_ID, tableId: 'items', queries: [Query.limit(1)] })).total;
  if (count > 0) { console.log(`✓ الفقرات موجودة مسبقًا (${count}) — لن تُضاف مرة أخرى`); return; }
  const data = JSON.parse(readFileSync(new URL('./seed-data.json', import.meta.url)));
  const put = (tableId, rowId, row, permissions) => db.upsertRow({ databaseId: DB_ID, tableId, rowId, data: row, ...(permissions ? { permissions } : {}) });
  for (const [code, name] of Object.entries(data.parties)) await put('parties', 'p' + code, { code, name });
  let ds = 0, n = 0;
  for (const d of data.domains) {
    const did = 'd' + d.code; await put('domains', did, { code: d.code, name: d.name, sort: ++ds });
    let ss = 0;
    for (const s of d.standards) {
      const sid = 's' + s.code.replace(/-/g, '_'); await put('standards', sid, { domain_id: did, code: s.code, name: s.name, sort: ++ss });
      let is = 0;
      for (const ind of s.indicators) {
        const iid = 'i' + ind.code.replace(/-/g, '_'); await put('indicators', iid, { standard_id: sid, code: ind.code, text: ind.text, sort: ++is });
        for (const it of ind.items) {
          const itemId = 'item' + String(it.num).padStart(2, '0');
          const perms = [...READ, ...it.parties.map((p) => `update("label:p${p}")`)];
          await put('items', itemId, { indicator_id: iid, num: it.num, text: it.text, parties: it.parties.join(','), is_pct: !!it.is_pct }, perms);
          let k = 0;
          for (const rec of it.records) await put('records', `rec${String(it.num).padStart(2, '0')}_${++k}`, { item_id: itemId, name: rec, sort: k, status: 'none' });
          n++;
        }
      }
    }
  }
  console.log(`＋ أُضيفت ${n} فقرة بوثائقها`);
}

async function ensureSettings() {
  const defaults = { school_name: config.schoolName || 'المدرسة', academic_year: config.academicYear || '', logo: '' };
  for (const [k, v] of Object.entries(defaults)) if (!(await exists('settings', k))) await db.createRow({ databaseId: DB_ID, tableId: 'settings', rowId: k, data: { value: v } });
  console.log('✓ الإعدادات');
}

async function ensureAdmin() {
  const username = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!username) { console.log('… لم يُحدَّد ADMIN_USERNAME — تخطّي إنشاء المدير'); return; }
  const email = `${username}@${loginDomain}`;
  const found = (await users.list({ queries: [Query.equal('email', email)] })).users[0];
  let user = found;
  if (!found) {
    if (password.length < 8) { console.error('❌ ADMIN_PASSWORD يجب ألا تقل عن 8 أحرف'); process.exit(1); }
    user = await users.create({ userId: ID.unique(), email, password, name: process.env.ADMIN_NAME || 'مدير النظام' });
    console.log('＋ حساب المدير:', username);
  } else if (password.length >= 8 && process.env.RESET_ADMIN_PASSWORD === 'true') {
    await users.updatePassword({ userId: user.$id, password }); console.log('↻ تم تحديث كلمة مرور المدير');
  }
  await users.updateLabels({ userId: user.$id, labels: ['admin'] });
  await db.upsertRow({ databaseId: DB_ID, tableId: 'profiles', rowId: user.$id, data: { name: user.name, username, role: 'admin', parties: '', active: true } });
  console.log('✓ المدير جاهز');
}

async function pickRuntime() {
  const { runtimes } = await functions.listRuntimes();
  const nodes = runtimes.map((r) => r.key || r.$id).filter((k) => /^node-\d+(\.\d+)?$/.test(k));
  const pref = ['node-22', 'node-20', 'node-21', 'node-23', 'node-24', 'node-18.0', 'node-19.0'];
  return pref.find((p) => nodes.includes(p)) || nodes.sort().pop() || 'node-22';
}

async function ensureFunction() {
  const archive = new URL('./function.tar.gz', import.meta.url);
  if (!existsSync(archive)) { console.log('… لا يوجد function.tar.gz — تخطّي نشر وظيفة المستخدمين'); return; }
  const opts = {
    functionId: FUNCTION_ID, name: 'إدارة المستخدمين', execute: ['label:admin'], timeout: 30, enabled: true, logging: true,
    entrypoint: 'src/main.js', commands: 'npm install --omit=dev',
    scopes: ['users.read', 'users.write', 'rows.read', 'rows.write'],
  };
  let fn;
  try { fn = await functions.get({ functionId: FUNCTION_ID }); await functions.update({ ...opts, runtime: fn.runtime }); }
  catch (e) {
    if (!isNotFound(e)) throw e;
    const runtime = await pickRuntime();
    fn = await functions.create({ ...opts, runtime });
    console.log('＋ وظيفة إدارة المستخدمين (', runtime, ')');
  }
  const dep = await functions.createDeployment({ functionId: FUNCTION_ID, code: InputFile.fromPath(archive.pathname, 'function.tar.gz'), activate: true, entrypoint: 'src/main.js', commands: 'npm install --omit=dev' });
  for (let i = 0; i < 90; i++) {
    const d = await functions.getDeployment({ functionId: FUNCTION_ID, deploymentId: dep.$id });
    if (d.status === 'ready') { console.log('✓ تم نشر وظيفة إدارة المستخدمين'); return; }
    if (d.status === 'failed') throw new Error('فشل بناء الوظيفة:\n' + (d.buildLogs || ''));
    await sleep(3000);
  }
  console.log('… الوظيفة ما زالت تُبنى، ستعمل خلال دقائق');
}

try {
  console.log(`الاتصال بـ ${endpoint} — المشروع ${projectId}`);
  await ensureDatabase();
  await ensureTables();
  await ensureBucket();
  await seed();
  await ensureSettings();
  await ensureAdmin();
  await ensureFunction();
  console.log('\n🎉 اكتمل إعداد قاعدة البيانات بنجاح');
} catch (e) {
  console.error('\n❌ خطأ:', e?.message || e);
  if (e?.response) console.error(typeof e.response === 'string' ? e.response : JSON.stringify(e.response));
  process.exit(1);
}
