import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const BACKUP_TABLES = [
  'customers','user_profiles','ac_units','project_projects','quotations','orders','service_reports',
  'invoices','invoice_items','invoice_payments','payments','payment_logs','quotation_payments','team_invoice_parts',
  'inventory','inventory_units','inventory_transactions','inventory_unit_stock_log','job_materials_brought',
  'expenses','weekly_payroll','order_bonuses','kasbon_requests',
  'maintenance_clients','maintenance_units','maintenance_logs','maintenance_followups','maintenance_contracts',
  'maintenance_client_prices','maintenance_work_orders','pre_service_manifests','pre_service_manifest_items',
  'project_daily_reports','project_expenses','project_dp','project_purchases','project_materials',
  'project_alokasi','project_usage','project_material_transactions','project_harian',
  'teknisi_material_checkout','material_checkout_items','material_job_movement',
  'daily_team_slots','team_presets','team_daily_helper','technician_availability','technician_schedule',
  'price_list','ac_price_list',
];
const MAGIC = Buffer.from('ACLBK2\0');
export const backupHash = buffer => createHash('sha256').update(buffer).digest('hex');
export function backupEncryptionKey(value) {
  if (Buffer.isBuffer(value) && value.length === 32) return value;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(String(value || ''))) throw new Error('BACKUP_ENCRYPTION_KEY wajib base64 32 byte; backup tidak ditulis tanpa enkripsi');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Kunci backup tidak valid');
  return key;
}
export function validateBackup(bundle, expected = BACKUP_TABLES) {
  if (bundle?.format !== 2 || !bundle.schema || !bundle.tables || Array.isArray(bundle.tables)) throw new Error('Format bundle backup tidak valid');
  if (expected.some(t => !Array.isArray(bundle.tables[t]) || !Array.isArray(bundle.schema[t]?.columns))) throw new Error('Tabel/skema wajib hilang dari backup');
  if (Object.keys(bundle.tables).some(t => !expected.includes(t))) throw new Error('Tabel backup di luar allowlist');
  for (const table of expected) {
    const columns = new Set(bundle.schema[table].columns.map(c => c.name));
    if (!columns.size || bundle.tables[table].some(row => !row || Array.isArray(row) || Object.keys(row).some(k => !columns.has(k)))) throw new Error('Kolom backup tidak cocok: ' + table);
  }
  return Object.fromEntries(expected.map(t => [t, bundle.tables[t].length]));
}
export function packBackup(bundle, encryptionKey, keyId = 'v1') {
  const key = backupEncryptionKey(encryptionKey), counts = validateBackup(bundle);
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(keyId)) throw new Error('BACKUP_KEY_ID tidak valid');
  const json = Buffer.from(JSON.stringify(bundle));
  if (json.length > 64 * 1024 * 1024) throw new Error('Backup >64 MiB; gunakan database dump');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(json)), cipher.final()]);
  const buffer = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
  return { buffer, manifest: { format: 2, cipher: 'aes-256-gcm', compression: 'gzip', key_id: keyId,
    sha256: backupHash(buffer), plain_sha256: backupHash(json), bytes: buffer.length,
    exported_at: bundle.exported_at, schema_version: bundle.schema_version, table_counts: counts } };
}
export function unpackBackup(buffer, { encryptionKey, manifest, expected = BACKUP_TABLES } = {}) {
  if (manifest?.sha256 && backupHash(buffer) !== manifest.sha256) throw new Error('Checksum arsip backup tidak cocok');
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Arsip backup terenkripsi tidak valid');
  const ivEnd = MAGIC.length + 12, tagEnd = ivEnd + 16;
  const decipher = createDecipheriv('aes-256-gcm', backupEncryptionKey(encryptionKey), buffer.subarray(MAGIC.length, ivEnd));
  decipher.setAAD(MAGIC); decipher.setAuthTag(buffer.subarray(ivEnd, tagEnd));
  const json = gunzipSync(Buffer.concat([decipher.update(buffer.subarray(tagEnd)), decipher.final()]), { maxOutputLength: 64 * 1024 * 1024 });
  if (manifest?.plain_sha256 && backupHash(json) !== manifest.plain_sha256) throw new Error('Checksum isi backup tidak cocok');
  const bundle = JSON.parse(json.toString('utf8')), counts = validateBackup(bundle, expected);
  if (manifest?.table_counts && (Object.keys(manifest.table_counts).length !== expected.length || expected.some(t => counts[t] !== manifest.table_counts[t]))) throw new Error('Jumlah tabel/baris backup tidak cocok');
  return bundle;
}
export function readLegacyBackup(buffer) {
  const data = JSON.parse((buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer, { maxOutputLength: 64 * 1024 * 1024 }) : buffer).toString('utf8'));
  if (!Array.isArray(data.data) || data.count !== data.data.length || !BACKUP_TABLES.includes(data.table)) throw new Error('Backup lama tidak lengkap/format salah');
  return data;
}

// Row/relationship drill, not a replacement for a full schema/auth/PITR backup.
export function verifyBackupRelations(bundle) {
  validateBackup(bundle);
  let checked = 0, external = 0;
  for (const table of BACKUP_TABLES) {
    for (const fk of bundle.schema[table].foreign_keys || []) {
      if (fk.target_schema !== 'public' || !BACKUP_TABLES.includes(fk.target)) { external++; continue; }
      const signature = (row, cols) => JSON.stringify(cols.map(c => String(row[c])));
      const targets = new Set(bundle.tables[fk.target].map(row => signature(row, fk.target_columns)));
      for (const row of bundle.tables[table]) {
        if (fk.columns.some(c => row[c] == null)) continue;
        checked++;
        if (!targets.has(signature(row, fk.columns))) throw new Error('Referensi backup terputus: ' + table + ' → ' + fk.target);
      }
    }
  }
  return { checked, external };
}
