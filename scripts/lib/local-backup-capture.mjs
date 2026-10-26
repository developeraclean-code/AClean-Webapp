import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { localDatabaseUrl, readKey, privateFile, digest, listMedia, encryptObject, verifyObject, publishManifest,
  requireCondition, inspectArchive } from './local-backup-archive.mjs';

export const quoteIdent = value => '"' + String(value).replaceAll('"','""') + '"';
export function databaseProcessEnv(url) {
  const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
  Object.assign(env, { PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=10000' });
  return env;
}
async function captureProcess(command, args, onOutput, env, timeoutMs = 180000) {
  const child = spawn(command, args, { env, stdio: ['ignore','pipe','pipe'] });
  const timer = setTimeout(() => {
    child.stdout.destroy(new Error('BACKUP_PROCESS_TIMEOUT')); child.kill('SIGTERM');
    const killTimer=setTimeout(()=>child.kill('SIGKILL'),2000); killTimer.unref();
  },timeoutMs); timer.unref();
  let warning = false;
  child.stderr.on('data', chunk => { if (String(chunk).trim()) warning = true; });
  const exit = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('BACKUP_PROCESS_START_FAILED')));
    child.once('close', code => code === 0 ? resolve() : reject(new Error('BACKUP_PROCESS_EXIT_FAILED')));
  });
  try {
    const [object] = await Promise.all([onOutput(child.stdout), exit]);
    requireCondition(!warning, 'BACKUP_PROCESS_WARNING_REQUIRES_REVIEW'); return object;
  } catch (error) { child.kill('SIGTERM'); throw error; }
  finally { clearTimeout(timer); }
}
async function gitCommit(repoRoot) {
  return new Promise((resolve,reject)=>{
    const child=spawn('git',['-C',repoRoot,'rev-parse','HEAD'],{stdio:['ignore','pipe','ignore']});let text='';
    const timer=setTimeout(()=>child.kill('SIGTERM'),10000);timer.unref();
    child.stdout.on('data',b=>{text+=b;});child.on('error',()=>{clearTimeout(timer);reject(new Error('BACKUP_CODE_VERSION_FAILED'));});
    child.on('close',code=>{clearTimeout(timer);code===0&&/^[a-f0-9]{40}$/.test(text.trim())?resolve(text.trim()):reject(new Error('BACKUP_CODE_VERSION_FAILED'));});
  });
}
export async function databaseBaseline(db) {
  const schemas = ['public','auth'];
  const tables = (await db.query("SELECT schemaname AS schema,tablename AS table FROM pg_tables WHERE schemaname=ANY($1) ORDER BY 1,2", [schemas])).rows;
  for (const table of tables) {
    const result = (await db.query(`SELECT count(*)::text AS rows, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${quoteIdent(table.schema)}.${quoteIdent(table.table)} t`)).rows[0];
    Object.assign(table, result);
  }
  const definitions = (await db.query(`SELECT CASE WHEN p.prokind='p' THEN 'procedure' ELSE 'function' END kind,n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' name,
    md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||coalesce(p.proconfig::text,'')||p.proowner::regrole::text) hash
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) AND p.prokind IN('f','p')
    UNION ALL SELECT 'policy',schemaname||'.'||tablename||'.'||policyname,md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||roles::text) FROM pg_policies WHERE schemaname=ANY($1)
    UNION ALL SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND NOT t.tgisinternal
    UNION ALL SELECT 'view',n.nspname||'.'||c.relname,md5(pg_get_viewdef(c.oid,true)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN('v','m')
    UNION ALL SELECT 'index',schemaname||'.'||indexname,md5(indexdef) FROM pg_indexes WHERE schemaname=ANY($1) ORDER BY 1,2`, [schemas])).rows;
  const columns = (await db.query(`SELECT n.nspname AS schema,c.relname AS table,a.attnum AS position,a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
    pg_get_expr(d.adbin,d.adrelid) AS default_expr,a.attcollation::regcollation::text AS collation
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=ANY($1) AND c.relkind IN('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3`,[schemas])).rows;
  const constraints = (await db.query(`SELECT n.nspname AS schema,c.relname AS table,k.conname AS name,md5(pg_get_constraintdef(k.oid,true)) AS hash
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) ORDER BY 1,2,3`, [schemas])).rows;
  const relationSecurity = (await db.query(`SELECT n.nspname AS schema,c.relname AS name,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text AS owner,c.relacl::text AS grants
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN('r','p','v','m','S') ORDER BY 1,2`, [schemas])).rows;
  const extensions = (await db.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
  const roles = (await db.query('SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles ORDER BY rolname')).rows;
  const version = (await db.query('SHOW server_version_num')).rows[0].server_version_num;
  const externalDataDependencies=(await db.query(`SELECT n.nspname AS schema,c.relname AS table,k.conname AS constraint,
    tn.nspname AS target_schema,tc.relname AS target_table FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class tc ON tc.oid=k.confrelid JOIN pg_namespace tn ON tn.oid=tc.relnamespace
    WHERE k.contype='f' AND n.nspname=ANY($1) AND NOT tn.nspname=ANY($1) ORDER BY 1,2,3`,[schemas])).rows;
  return { schemas, tables, definitions, columns, constraints, relationSecurity, extensions, roles, postgresMajor: Math.floor(+version / 10000),
    externalDataDependencies, rolePasswordsIncluded: false, managedProviderSchemasIncluded: false };
}

export async function captureLocalBackup({ databaseUrl, pgDump, repoRoot, output, keyFile, configFile, mediaRoot,
  mediaSnapshotAcknowledged = false, afterSnapshot, maxPayloadBytes }) {
  const url = localDatabaseUrl(databaseUrl);
  requireCondition(mediaSnapshotAcknowledged === true, 'BACKUP_MEDIA_SNAPSHOT_NOT_ACKNOWLEDGED');
  requireCondition(path.isAbsolute(pgDump) && fs.statSync(pgDump).isFile(), 'BACKUP_PG_DUMP_PATH_REQUIRED');
  const sourceConfig = privateFile(configFile);
  const config = JSON.parse(sourceConfig);
  requireCondition(config.version === 1 && config.scope === 'LOCAL_ONLY' && config.auth && config.environment && config.deployment,
    'BACKUP_CONFIG_SECTIONS_REQUIRED');
  requireCondition(fs.realpathSync(repoRoot) === path.resolve(repoRoot), 'BACKUP_REPO_SYMLINK');
  const key = readKey(keyFile, output), mediaBefore = listMedia(mediaRoot);
  const codeCommit=await gitCommit(repoRoot);
  const toolFiles = ['scripts/backup-full-local.mjs','scripts/lib/local-backup-archive.mjs','scripts/lib/local-backup-capture.mjs',
    'scripts/test-local-backup-unit.mjs','scripts/test-local-backup-native.mjs','package.json','package-lock.json','docs/FULL_LOCAL_BACKUP.md'];
  const tool=Object.fromEntries(toolFiles.map(file=>[file,fs.readFileSync(path.join(repoRoot,file),'utf8')]));
  const relativeMedia = path.relative(path.resolve(mediaRoot), path.resolve(output));
  requireCondition(relativeMedia.startsWith('..' + path.sep) || path.isAbsolute(relativeMedia), 'BACKUP_OUTPUT_INSIDE_MEDIA');
  fs.mkdirSync(output, { mode: 0o700 }); // Intentionally refuses any existing destination.
  const id = randomUUID(), objects = {}, media = []; let objectNumber = 0;
  const write = async (label, source) => {
    const object = await encryptObject(output, 'object-' + String(++objectNumber).padStart(6,'0') + '.enc', source, key, id + ':' + label, maxPayloadBytes);
    await verifyObject(output, object, key); return object;
  };
  const db = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, query_timeout: 120000 });
  try {
    await db.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL search_path TO pg_catalog; SET LOCAL statement_timeout TO '120s'; SET LOCAL lock_timeout TO '10s'");
    const snapshot = (await db.query('SELECT pg_export_snapshot() AS id,transaction_timestamp() AS at')).rows[0];
    const baseline = await databaseBaseline(db);
    requireCondition(baseline.externalDataDependencies.length===0,'BACKUP_EXTERNAL_DATA_DEPENDENCY');
    for (const table of ['public.app_settings','public.user_profiles','auth.users','auth.identities','public.operational_mutations','public.wa_outbox'])
      requireCondition(baseline.tables.some(t => t.schema + '.' + t.table === table), 'BACKUP_CRITICAL_TABLE_MISSING:' + table);
    if (afterSnapshot) await afterSnapshot(); // For isolated concurrent-write testing; not exposed in CLI.
    objects.database = await captureProcess(pgDump, ['--format=custom','--schema=public','--schema=auth','--large-objects','--snapshot=' + snapshot.id],
      source => write('database', source), databaseProcessEnv(url));
    await db.query('COMMIT');
    objects.config = await write('config', Readable.from([sourceConfig]));
    objects.application = await captureProcess('git', ['-C', repoRoot,'archive','--format=tar',codeCommit], source => write('application', source));
    // Working-copy recovery tooling accompanies the committed application archive.
    objects.tool = await write('tool', Readable.from([JSON.stringify(tool)]));
    for (const file of mediaBefore) {
      const full = path.join(mediaRoot, file.key), stat = fs.lstatSync(full);
      requireCondition(stat.ino === file.inode && stat.size === file.bytes && stat.mtimeMs === file.mtime && !stat.isSymbolicLink(), 'BACKUP_MEDIA_CHANGED');
      const object = await write('media:' + file.key, fs.createReadStream(full, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW }));
      media.push({ key: file.key, object });
    }
    requireCondition(JSON.stringify(listMedia(mediaRoot)) === JSON.stringify(mediaBefore), 'BACKUP_MEDIA_CHANGED');
    requireCondition(digest(privateFile(configFile)) === digest(sourceConfig), 'BACKUP_CONFIG_CHANGED');
    requireCondition(readKey(keyFile,output).equals(key), 'BACKUP_KEY_CHANGED');
    requireCondition(await gitCommit(repoRoot)===codeCommit && toolFiles.every(file=>fs.readFileSync(path.join(repoRoot,file),'utf8')===tool[file]), 'BACKUP_CODE_CHANGED');
    const manifest = { format: 1, id, scope: 'LOCAL_ONLY', snapshotAt: snapshot.at.toISOString(), finishedAt: new Date().toISOString(),
      mediaSnapshotAcknowledged: true, database: baseline, objects, media, codeCommit,
      productionReady: false, sourceWritesByTool: 0, sourceHost: '127.0.0.1', sourcePort: url.port,
      notes: ['public/Auth schemas + large objects; provider-global roles are inventoried, not recreated',
        'Media must be a pre-frozen local copy; database/object-store snapshots are not globally atomic',
        'Restore and secret/key rotation require a separate isolated runbook; no automatic cutover'] };
    await publishManifest(output,key,manifest);
    await inspectArchive(output,key);
    return { verified: true, localOnly: true, backupId: id, tables: baseline.tables.length,
      rows: baseline.tables.reduce((n,t)=>n + Number(t.rows),0), files: media.length, snapshotAt: manifest.snapshotAt,
      encrypted: true, sourceWrites: 0, productionReady: false };
  } catch (error) { await db.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { await db.end().catch(()=>{}); }
}
