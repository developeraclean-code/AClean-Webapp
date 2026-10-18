import { randomUUID } from 'node:crypto';
import { sb, isCronJobEnabled } from './_shared.js';
import { hasR2Config, uploadBufferToR2, downloadBufferFromR2 } from '../_r2-upload.js';
import { backupEncryptionKey, backupHash, packBackup, unpackBackup } from '../_backup.js';

export async function taskBackupData({ db = sb, upload = uploadBufferToR2, download = downloadBufferFromR2,
  configured = hasR2Config, encryptionKey = process.env.BACKUP_ENCRYPTION_KEY, keyId = process.env.BACKUP_KEY_ID || 'v1', now = Date.now } = {}) {
  const started = Date.now();
  const budget = cap => {
    const available = Math.min(cap, 21_000 - (Date.now() - started));
    if (available < 500) throw new Error('Backup mencapai batas waktu; checkpoint akan dilanjutkan invocation berikutnya');
    return available;
  };
  const settings = await db.from('app_settings').select('key,value').in('key', ['backup_data_enabled', 'cron_jobs', 'backup_pending_archive'])
    .abortSignal(AbortSignal.timeout(budget(2000)));
  if (settings.error || !Array.isArray(settings.data)) throw new Error('Pengaturan backup tidak dapat dibaca');
  const toggles = Object.fromEntries(settings.data.map(s => [s.key, s.value]));
  if (!isCronJobEnabled(toggles, 'backup_data_enabled') || toggles.backup_data_enabled === 'false') return { skipped: true, reason: 'backup_off' };
  // Existing bucket is public for photos. Financial/staff exports MUST be encrypted.
  backupEncryptionKey(encryptionKey);
  if (!configured()) throw new Error('R2 backup belum dikonfigurasi');
  let metadata;
  try { metadata = JSON.parse(toggles.backup_pending_archive || 'null'); } catch { throw new Error('Checkpoint backup tidak valid; perlu pemeriksaan Owner'); }
  let needExport = !metadata;
  if (metadata) {
    const prefix = `backup/${metadata.date}/`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date || '') || !/^[a-f0-9-]{36}$/.test(metadata.id || '')
      || metadata.bundle_key !== `${prefix}bundle-${metadata.id}.json.gz.enc` || metadata.manifest_key !== `${prefix}manifest-${metadata.id}.json`
      || metadata.key_id !== keyId) throw new Error('Checkpoint/kunci backup berbeda; jangan timpa arsip lama');
    const existing = await download(metadata.bundle_key, { timeoutMs: budget(4000) });
    if (existing.ok) unpackBackup(existing.buffer, { encryptionKey, manifest: metadata });
    else if (existing.err === 'R2 GET 404') needExport = true;
    else throw new Error('Arsip tertunda belum dapat dibaca; tidak membuat salinan baru');
  }
  if (needExport) {
    const snapshot = await db.rpc('export_operational_backup_216').abortSignal(AbortSignal.timeout(budget(6500)));
    if (snapshot.error) throw new Error('Snapshot backup gagal: ' + snapshot.error.message);
    const { buffer, manifest } = packBackup(snapshot.data, encryptionKey, keyId);
    const date = metadata?.date || new Date(now() + 7 * 3600_000).toISOString().slice(0, 10), id = metadata?.id || randomUUID();
    metadata = { ...manifest, id, date, bundle_key: `backup/${date}/bundle-${id}.json.gz.enc`, manifest_key: `backup/${date}/manifest-${id}.json` };
    const saved = await db.from('app_settings').upsert({ key: 'backup_pending_archive', value: JSON.stringify(metadata) }, { onConflict: 'key' })
      .abortSignal(AbortSignal.timeout(budget(2000)));
    if (saved.error) throw new Error('Checkpoint backup gagal disimpan; belum ada upload');
    const archive = await upload({ key: metadata.bundle_key, buffer, mimeType: 'application/octet-stream', timeoutMs: budget(5000) });
    if (!archive.ok) throw new Error('Upload backup gagal: ' + archive.err);
    const readback = await download(metadata.bundle_key, { timeoutMs: budget(4000) });
    if (!readback.ok || backupHash(readback.buffer) !== metadata.sha256) throw new Error('Verifikasi baca ulang backup gagal; belum ditandai sukses');
  }
  const published = await upload({ key: metadata.manifest_key, buffer: Buffer.from(JSON.stringify(metadata)), mimeType: 'application/json', timeoutMs: budget(3500) });
  if (!published.ok) throw new Error('Manifest backup gagal; arsip belum lengkap');
  const recorded = await db.from('backup_log').upsert({ id: metadata.id, type: 'auto-r2-encrypted-v2', tables: Object.keys(metadata.table_counts),
    row_counts: metadata, exported_by: 'CRON', created_at: metadata.exported_at, notes: `backup/${metadata.date}/` }, { onConflict: 'id' })
    .abortSignal(AbortSignal.timeout(budget(2000)));
  if (recorded.error) throw new Error('Arsip ada, pencatatan backup gagal: ' + recorded.error.message);
  const cleared = await db.from('app_settings').upsert({ key: 'backup_pending_archive', value: 'null' }, { onConflict: 'key' })
    .abortSignal(AbortSignal.timeout(budget(2000)));
  if (cleared.error) throw new Error('Backup selesai; checkpoint belum dapat ditutup (retry aman dengan ID sama)');
  return { format: 2, dateStr: metadata.date, tables: Object.keys(metadata.table_counts).length,
    has_more: metadata.date !== new Date(now() + 7 * 3600_000).toISOString().slice(0, 10),
    items_processed: Object.values(metadata.table_counts).reduce((a, b) => a + b, 0), verified: true, encrypted: true, errors: 0 };
}
