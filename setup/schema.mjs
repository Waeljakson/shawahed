// تعريف جداول قاعدة البيانات وصلاحياتها في Appwrite
// الأدوار تُدار عبر "Labels" للمستخدمين: admin / reviewer / editor / viewer
// والجهات المسؤولة: pM, pVT, pVS, pVM, pRN, pMT

export const DB_ID = 'main';
export const BUCKET_ID = 'evidence';
export const FUNCTION_ID = 'users-admin';

const L = (perm, ...labels) => labels.map((l) => `${perm}("label:${l}")`);
// القراءة لأصحاب الأدوار فقط (لا يكفي مجرد إنشاء حساب)
export const READ = L('read', 'admin', 'reviewer', 'editor', 'viewer');

export const TABLES = [
  {
    id: 'settings', name: 'الإعدادات', rowSecurity: false,
    permissions: ['read("any")', ...L('create', 'admin'), ...L('update', 'admin'), ...L('delete', 'admin')],
    columns: [{ key: 'value', type: 'string', size: 2000 }],
  },
  {
    id: 'parties', name: 'الجهات المسؤولة', rowSecurity: false, permissions: [...READ],
    columns: [{ key: 'code', type: 'string', size: 10, required: true }, { key: 'name', type: 'string', size: 100, required: true }],
  },
  {
    id: 'domains', name: 'المجالات', rowSecurity: false, permissions: [...READ],
    columns: [{ key: 'code', type: 'string', size: 10, required: true }, { key: 'name', type: 'string', size: 150, required: true }, { key: 'sort', type: 'integer' }],
  },
  {
    id: 'standards', name: 'المعايير', rowSecurity: false, permissions: [...READ],
    columns: [{ key: 'domain_id', type: 'string', size: 36, required: true }, { key: 'code', type: 'string', size: 10, required: true }, { key: 'name', type: 'string', size: 150, required: true }, { key: 'sort', type: 'integer' }],
  },
  {
    id: 'indicators', name: 'المؤشرات', rowSecurity: false, permissions: [...READ],
    columns: [{ key: 'standard_id', type: 'string', size: 36, required: true }, { key: 'code', type: 'string', size: 20, required: true }, { key: 'text', type: 'string', size: 1000, required: true }, { key: 'sort', type: 'integer' }],
  },
  {
    id: 'items', name: 'الفقرات', rowSecurity: true,
    permissions: [...READ, ...L('update', 'admin', 'reviewer')],
    columns: [
      { key: 'indicator_id', type: 'string', size: 36, required: true },
      { key: 'num', type: 'integer', required: true },
      { key: 'text', type: 'string', size: 1000, required: true },
      { key: 'parties', type: 'string', size: 100 },
      { key: 'is_pct', type: 'boolean' },
      { key: 'pct_value', type: 'float' },
      { key: 'self_level', type: 'integer' },
      { key: 'notes', type: 'string', size: 4000 },
      { key: 'updated_by_name', type: 'string', size: 150 },
      { key: 'updated_at', type: 'datetime' },
    ],
  },
  {
    id: 'records', name: 'الوثائق المطلوبة', rowSecurity: false,
    permissions: [...READ, ...L('create', 'admin'), ...L('update', 'admin', 'reviewer'), ...L('delete', 'admin')],
    columns: [
      { key: 'item_id', type: 'string', size: 36, required: true },
      { key: 'name', type: 'string', size: 255, required: true },
      { key: 'sort', type: 'integer' },
      { key: 'status', type: 'string', size: 20 },
      { key: 'review_note', type: 'string', size: 2000 },
      { key: 'reviewed_by_name', type: 'string', size: 150 },
      { key: 'reviewed_at', type: 'datetime' },
    ],
  },
  {
    id: 'evidence', name: 'الملفات المرفوعة', rowSecurity: true,
    permissions: [...READ, ...L('create', 'admin', 'reviewer', 'editor'), ...L('delete', 'admin', 'reviewer')],
    columns: [
      { key: 'record_id', type: 'string', size: 36, required: true },
      { key: 'item_id', type: 'string', size: 36, required: true },
      { key: 'file_id', type: 'string', size: 36, required: true },
      { key: 'name', type: 'string', size: 255, required: true },
      { key: 'size', type: 'integer' },
      { key: 'mime', type: 'string', size: 120 },
      { key: 'uploader_id', type: 'string', size: 36 },
      { key: 'uploader_name', type: 'string', size: 150 },
    ],
    indexes: [{ key: 'idx_record', columns: ['record_id'] }],
  },
  {
    id: 'activity', name: 'سجل النشاط', rowSecurity: false, permissions: [...READ, ...L('create', 'admin', 'reviewer', 'editor', 'viewer')],
    columns: [
      { key: 'user_name', type: 'string', size: 150 },
      { key: 'action', type: 'string', size: 40, required: true },
      { key: 'item_id', type: 'string', size: 36 },
      { key: 'item_num', type: 'integer' },
      { key: 'details', type: 'string', size: 500 },
    ],
  },
  {
    id: 'profiles', name: 'المستخدمون', rowSecurity: false, permissions: [...READ],
    columns: [
      { key: 'name', type: 'string', size: 150, required: true },
      { key: 'username', type: 'string', size: 60, required: true },
      { key: 'role', type: 'string', size: 20, required: true },
      { key: 'parties', type: 'string', size: 100 },
      { key: 'active', type: 'boolean' },
    ],
  },
];

export const BUCKET = {
  name: 'ملفات الشواهد',
  permissions: [...READ, ...L('create', 'admin', 'reviewer', 'editor'), ...L('delete', 'admin', 'reviewer')],
  maximumFileSize: 30 * 1024 * 1024,
  allowedFileExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'mp4', 'mov', 'txt', 'csv', 'zip', 'rar'],
};
