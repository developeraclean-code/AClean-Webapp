// Explicit local-only CLI. Does not auto-load .env.local or connect to production.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureLocalBackup } from './lib/local-backup-capture.mjs';
import { readKey, inspectArchive } from './lib/local-backup-archive.mjs';

const args = process.argv.slice(2), flag = name => args.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
try {
  if (args.includes('--verify')) {
    const dir = flag('--archive'), keyFile = flag('--key-file');
    if (!dir || !keyFile) throw new Error('BACKUP_ARCHIVE_AND_KEY_PATH_REQUIRED');
    const manifest = await inspectArchive(dir,readKey(keyFile,dir));
    console.log(JSON.stringify({ verified:true, localOnly:true, tables:manifest.database.tables.length, files:manifest.media.length, snapshotAt:manifest.snapshotAt, productionReady:false }));
  } else if (args.includes('--execute')) {
    for (const name of ['--pg-dump','--output','--key-file','--config-file','--media-root']) if (!flag(name)) throw new Error('BACKUP_ARGUMENT_REQUIRED:' + name);
    const result = await captureLocalBackup({ databaseUrl:process.env.LOCAL_BACKUP_DATABASE_URL, pgDump:flag('--pg-dump'),
      repoRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), output:flag('--output'), keyFile:flag('--key-file'),
      configFile:flag('--config-file'), mediaRoot:flag('--media-root'), mediaSnapshotAcknowledged:args.includes('--media-snapshot-ready') });
    console.log(JSON.stringify(result));
  } else {
    console.log('Dry-run only. Full LOCAL backup: public/Auth schema + rows + settings + explicit config + committed source + frozen media. AES-256-GCM; key outside archive.');
    console.log('Create: LOCAL_BACKUP_DATABASE_URL=<local URL in private environment> node scripts/backup-full-local.mjs --execute --pg-dump=/absolute/pg_dump --output=/private/path/new-backup --key-file=/private/path/key --config-file=/private/path/config.json --media-root=/private/path/frozen-media --media-snapshot-ready');
    console.log('Verify: node scripts/backup-full-local.mjs --verify --archive=/private/path/backup --key-file=/private/path/key');
    console.log('Remote source/restore, production activation, uploads, cleanup and secret rotation are NOT performed.');
  }
} catch (error) {
  const code = /^BACKUP_[A-Z0-9_:.-]+$/.test(error.message) ? error.message : error.code || 'BACKUP_OPERATION_FAILED';
  console.error(JSON.stringify({ ok:false, code, note:'Tidak ada fallback plaintext; paket tanpa COMPLETE.json dianggap belum selesai. Detail kredensial tidak dicetak.' }));
  process.exitCode=1;
}
