import { describe, it, expect, vi, afterEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
vi.mock('../../../api/_tasks/_shared.js', () => ({ sb: {}, OWNER_PHONE: '628120000001',
  log: vi.fn(), sendWA: vi.fn(), sendWAWithResult: vi.fn(), fmt: String, deleteR2Object: vi.fn(),
  isCronJobEnabled: (s,k) => { try { const jobs=JSON.parse(s.cron_jobs || '[]'); return s[k] !== 'false' && (!Array.isArray(jobs) || !jobs.some(j => j.backendKey === k && j.active === false)); } catch { return s[k] !== 'false'; } } }));
import { dueCronTasks, pendingCronTasks } from '../../../api/_cron-result.js';
import { runCronQueue, withDispatcherLease } from '../../../api/_cron-dispatch.js';
import { taskBackupData } from '../../../api/_tasks/backup.js';
import { taskBackupRetention } from '../../../api/_tasks/ops.js';
import { taskInfraUsageAlert } from '../../../api/_tasks/infra.js';
import { taskDataIntegrityAudit } from '../../../api/_tasks/integrity.js';
import { sendOpsOwnerAlert } from '../../../api/_ops-alert.js';
import { getR2BucketUsage } from '../../../api/_r2-upload.js';
import { BACKUP_TABLES, packBackup, unpackBackup, readLegacyBackup, verifyBackupRelations } from '../../../api/_backup.js';
import { strictCronEnabled } from '../../../api/_cron-toggle.js';
import { recoveryFixture } from '../../../scripts/lib/recovery-fixture.mjs';

const KEY = Buffer.alloc(32, 7), OWNER = '628120000001', now = () => Date.parse('2026-10-18T21:00:00+07:00');
function database(options = {}) {
  const calls = [], outbox = new Map();
  const flags = { backup_data_enabled: 'true', infra_usage_alert_enabled: 'true', data_integrity_audit_enabled: 'true', ...options.flags };
  const settings = new Map(Object.entries({ ...flags, cron_jobs: JSON.stringify(Object.keys(flags).map(key => ({ backendKey: key, active: true }))), ...options.settings }));
  const logs = []; let leased = false;
  const db = {
    from(table) {
      if (!['app_settings','backup_log','user_profiles'].includes(table)) throw new Error('Forbidden business table: ' + table);
      const query = { action: 'read', select() { return query; }, in(k,v) { query.keys = v; return query; }, eq(k,v) { query.match = [k,v]; return query; },
        order(k,v) { query.sort = [k,v.ascending]; return query; }, range(a,b) { query.bounds = [a,b]; return query; },
        lt(k,v) { query.cutoff = [k,v]; return query; }, or() { return query; }, limit(n) { query.bounds = [0,n-1]; return query; },
        delete() { query.action = 'delete'; return query; },
        abortSignal() { return query; },
        upsert(v) { query.action = 'write'; query.rows = Array.isArray(v) ? v : [v]; return query; },
        insert(v) { query.action = 'insert'; query.rows = [v]; return query; },
        then(resolve, reject) {
          calls.push({ table, action: query.action });
          if (options.failTable === table && query.action !== 'read') return Promise.resolve({ error: { message: 'write failed' } }).then(resolve,reject);
          if (table === 'app_settings' && query.action === 'write') query.rows.forEach(r => settings.set(r.key, r.value));
          if (table === 'backup_log' && ['insert','write'].includes(query.action)) {
            for (const row of query.rows) { const existing=logs.find(r=>r.id===row.id); if(existing)Object.assign(existing,row);else logs.push(row); }
          }
          let data = table === 'user_profiles' ? options.inactiveOwner ? [] : [{ phone: OWNER }]
            : table === 'app_settings' ? [...settings].filter(([key]) => !query.keys || query.keys.includes(key)).map(([key,value]) => ({ key,value })) : [...(options.backupRows || [])];
          if (query.cutoff) data=data.filter(r=>r[query.cutoff[0]]<query.cutoff[1]);
          if (query.sort) data.sort((a,b)=>String(a[query.sort[0]]).localeCompare(String(b[query.sort[0]]))*(query.sort[1]?1:-1));
          if (query.bounds) data=data.slice(query.bounds[0],query.bounds[1]+1);
          return Promise.resolve({ data, error: null }).then(resolve,reject);
        },
      }; return query;
    },
    rpc(name, p = {}) {
      calls.push({ rpc: name });
      let result;
      if (options.failRpc === name) result = { error: { message: 'RPC unavailable' } };
      else if (name === 'export_operational_backup_216') result = { data: options.bundle || recoveryFixture() };
      else if (name === 'get_infra_database_size') result = { data: { bytes: options.dbBytes ?? 10000 } };
      else if (name === 'audit_operational_integrity_216') result = { data: options.findings || [] };
      else if (name === 'claim_cron_worker_216') { result = { data: !leased }; leased = true; }
      else if (name === 'release_cron_worker_216') { leased = false; result = { data: null }; }
      else if (name === 'claim_wa_send') {
        if (outbox.has(p.p_id)) result = { data: { claimed: false, row: outbox.get(p.p_id) } };
        else { const row = { id: p.p_id, ...p.p_payload, status: 'SENDING' }; outbox.set(row.id, row); result = { data: { claimed: true, row } }; }
      } else if (name === 'finish_wa_send') { const row = outbox.get(p.p_id); Object.assign(row, { status: p.p_status }); result = { data: row }; }
      else throw new Error('Unexpected RPC: ' + name);
      const promise = Promise.resolve(result); promise.abortSignal = () => promise; return promise;
    },
  }; return { db, calls, settings, logs, outbox };
}

describe('reliable bounded cron scheduling', () => {
  it('catches Monday audit/backup on Sunday and does not reuse last week success', () => {
    const tasks = dueCronTasks([{ t: 'audit', h: 7, dow: 1, catchUpWeekly: true }, { t: 'backup', h: 11, dow: 1, catchUpWeekly: true }, { t: 'normal', h: 7, dow: 1 }], now());
    expect(tasks.map(t => t.t)).toEqual(['audit','backup']);
    expect(new Date(tasks[0].dueSince).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    const old = { task_name: 'audit', status: 'SUCCESS', started_at: '2026-10-05T02:00:00Z' };
    expect(pendingCronTasks(tasks, [old], now())).toHaveLength(2);
    expect(pendingCronTasks(tasks, [{ ...old, started_at: '2026-10-12T02:00:00Z' }], now()).map(t => t.t)).toEqual(['backup']);
  });
  it('does not rerun yesterday daily success as today; retries wait 5 minutes', () => {
    const tasks = dueCronTasks([{ t: 'daily', h: 21 }], now());
    expect(pendingCronTasks(tasks, [{ task_name: 'daily', status: 'SUCCESS', started_at: '2026-10-17T15:00:00Z' }], now())).toHaveLength(1);
    expect(pendingCronTasks(tasks, [{ task_name: 'daily', status: 'TIMEOUT', started_at: new Date(now()-1000).toISOString() }], now())).toHaveLength(0);
  });
  it('gives never-run work a chance before failed work, with critical audit prioritized', () => {
    const tasks = [{ t: 'broken' }, { t: 'normal' }, { t: 'audit', priority: 0 }];
    const runs = [{ task_name: 'broken', status: 'TIMEOUT', started_at: new Date(now()-360000).toISOString() }];
    expect(pendingCronTasks(tasks,runs,now()).map(t => t.t)).toEqual(['audit','normal','broken']);
  });
  it('resumes partial infra scans only, without rerunning a finished daily scan', () => {
    const tasks = [{ t: 'infra', continuable: true }], run = { task_name:'infra',status:'SUCCESS',started_at:new Date().toISOString() };
    expect(pendingCronTasks(tasks,[{ ...run,metadata:{has_more:true} }])).toHaveLength(1);
    expect(pendingCronTasks(tasks,[{ ...run,metadata:{has_more:false} }])).toHaveLength(0);
  });
  it('runs at most 3 tasks; a regular failure does not stop later tasks', async () => {
    const run = vi.fn(async name => { if (name === 'broken') throw new Error('failed'); return {}; });
    const result = await runCronQueue(['broken','audit','daily','extra'].map(t => ({t,fn:()=>{}})), { startedAt: 0, now: () => 1000, run });
    expect(result).toMatchObject({ ran: ['broken','audit','daily'], pending: 2, ok: false }); expect(run).toHaveBeenCalledTimes(3);
  });
  it('does not start a heavy backup with insufficient budget, but can run a short task', async () => {
    const result = await runCronQueue([{t:'backup',minimumMs:36000,budgetMs:38000},{t:'short'}], { startedAt:0,now:()=>10000,run:async()=>({}) });
    expect(result.ran).toEqual(['short']); expect(result.pending).toBe(1);
  });
  it('stops on an actual timeout; preserves lease to avoid overlapping legacy work', async () => {
    const { db,calls } = database();
    const result = await withDispatcherLease(db, () => runCronQueue([{t:'slow'},{t:'next'}], {startedAt:0,now:()=>0,run:async()=>{ throw Object.assign(new Error('timeout'),{code:'CRON_TIMEOUT'}); }}));
    expect(result.timedOut).toBe('slow'); expect(calls.some(c=>c.rpc==='release_cron_worker_216')).toBe(false);
  });
  it('200 overlapping dispatcher invocations execute only one worker', async () => {
    const { db } = database(); const work = vi.fn(async () => { await new Promise(r => setTimeout(r, 5)); return {}; });
    const results = await Promise.all(Array.from({length:200},()=>withDispatcherLease(db, work)));
    expect(work).toHaveBeenCalledTimes(1); expect(results.filter(r=>r.reason==='dispatcher_busy')).toHaveLength(199);
  });
  it('fails closed when lease RPC is missing', async () => {
    const { db }=database({failRpc:'claim_cron_worker_216'}), work=vi.fn();
    await expect(withDispatcherLease(db,work)).rejects.toThrow('216'); expect(work).not.toHaveBeenCalled();
  });
});

describe('encrypted consistent recovery archive', () => {
  it('bucket lifecycle cannot override protection of the last complete backup', () => {
    const { rules } = JSON.parse(readFileSync(new URL('../../../ops/r2-lifecycle.json', import.meta.url), 'utf8'));
    expect(rules.some(rule => rule.enabled && rule.deleteObjectsTransition && 'backup/'.startsWith(rule.conditions?.prefix || ''))).toBe(false);
    expect(rules.find(rule => rule.id === 'aclean-wa-images-90d')?.enabled).toBe(true);
  });
  it('round trips all tables and 200 jobs, preserving invoice/payment values and relationships', () => {
    const fixture = recoveryFixture(), packed = packBackup(fixture,KEY);
    expect(packed.buffer.includes(Buffer.from('CUSTOMER-SIMULASI'))).toBe(false);
    const decoded = unpackBackup(packed.buffer,{encryptionKey:KEY,manifest:packed.manifest});
    expect(decoded).toEqual(fixture); expect(verifyBackupRelations(decoded)).toMatchObject({checked:600,external:0});
  });
  it('encryption is randomized, so repeated backups do not overwrite/reuse ciphertext', () => {
    const fixture=recoveryFixture(1); expect(packBackup(fixture,KEY).buffer.equals(packBackup(fixture,KEY).buffer)).toBe(false);
  });
  it('rejects wrong key, tampered ciphertext, incorrect counts and missing required tables', () => {
    const fixture=recoveryFixture(1), packed=packBackup(fixture,KEY), altered=Buffer.from(packed.buffer); altered[altered.length-1]^=1;
    expect(()=>unpackBackup(packed.buffer,{encryptionKey:Buffer.alloc(32,8)})).toThrow();
    expect(()=>unpackBackup(altered,{encryptionKey:KEY,manifest:packed.manifest})).toThrow('Checksum');
    expect(()=>unpackBackup(packed.buffer,{encryptionKey:KEY,manifest:{...packed.manifest,table_counts:{}}})).toThrow('Jumlah');
    delete fixture.tables.invoice_payments; expect(()=>packBackup(fixture,KEY)).toThrow('wajib');
    expect(()=>packBackup(recoveryFixture(),'invalid')).toThrow('ENCRYPTION_KEY');
  });
  it('reads gzip and uncompressed legacy backups but rejects truncated count', () => {
    const payload=Buffer.from(JSON.stringify({table:'orders',count:1,data:[{id:'J1'}]}));
    expect(readLegacyBackup(payload).count).toBe(1); expect(readLegacyBackup(gzipSync(payload)).count).toBe(1);
    expect(()=>readLegacyBackup(Buffer.from('{"table":"orders","count":2,"data":[]}'))).toThrow();
  });
  it('detects orphan references instead of claiming restore success', () => {
    const fixture=recoveryFixture(1); fixture.tables.customers=[]; expect(()=>verifyBackupRelations(fixture)).toThrow('Referensi');
  });
  it('uploads encrypted bundle, verifies readback and only then writes complete backup_log', async () => {
    const {db,logs}=database(), objects=new Map();
    const upload=vi.fn(async({key,buffer})=>{objects.set(key,buffer);return {ok:true};});
    const result=await taskBackupData({db,upload,download:async k=>({ok:true,buffer:objects.get(k)}),configured:()=>true,encryptionKey:KEY,now});
    expect(result).toMatchObject({verified:true,encrypted:true,tables:BACKUP_TABLES.length,errors:0});
    expect(logs).toHaveLength(1); expect(logs[0].tables).toContain('inventory_transactions'); expect(upload).toHaveBeenCalledTimes(2);
  });
  it.each(['missing-key','rpc','upload','readback','manifest','log'])('does not report partial backup as success: %s', async stage => {
    const {db,logs}=database({failRpc:stage==='rpc'?'export_operational_backup_216':null,failTable:stage==='log'?'backup_log':null});
    let buffer;
    const run=()=>taskBackupData({db,configured:()=>true,encryptionKey:stage==='missing-key'?null:KEY,
      upload:async p=>{buffer ||= p.buffer;return {ok:stage!=='upload'&&!(stage==='manifest'&&p.mimeType==='application/json'),err:'offline'};},
      download:async()=>({ok:true,buffer:stage==='readback'?Buffer.from('corrupt'):buffer}),now});
    await expect(run()).rejects.toThrow(); expect(logs).toHaveLength(0);
  });
  it('does not export/upload anything while backup is OFF', async () => {
    const {db,calls}=database({flags:{backup_data_enabled:'false'}}), upload=vi.fn();
    expect(await taskBackupData({db,upload})).toMatchObject({skipped:true}); expect(upload).not.toHaveBeenCalled(); expect(calls.some(c=>c.rpc)).toBe(false);
  });
  it('resumes an uploaded archive after failure without re-exporting or creating another R2 bundle', async () => {
    const {db,logs,calls,settings}=database(), objects=new Map(); let allowRead=false;
    const upload=vi.fn(async({key,buffer})=>{objects.set(key,buffer);return {ok:true};});
    const options={db,upload,download:async key=>allowRead?{ok:true,buffer:objects.get(key)}:{ok:false,err:'R2 GET 503'},configured:()=>true,encryptionKey:KEY,now};
    await expect(taskBackupData(options)).rejects.toThrow('baca ulang');
    expect(settings.get('backup_pending_archive')).toContain('bundle-');
    allowRead=true; expect(await taskBackupData(options)).toMatchObject({verified:true});
    expect(calls.filter(c=>c.rpc==='export_operational_backup_216')).toHaveLength(1);
    expect([...objects.keys()].filter(k=>k.endsWith('.enc'))).toHaveLength(1); expect(logs).toHaveLength(1);
  });
  it('finishes yesterday checkpoint safely, then asks scheduler for a fresh current-day backup', async () => {
    const {db}=database(), objects=new Map(); let allowManifest=false;
    const upload=async({key,buffer,mimeType})=>{if(mimeType==='application/json'&&!allowManifest)return {ok:false};objects.set(key,buffer);return {ok:true};};
    const options={db,upload,download:async key=>({ok:true,buffer:objects.get(key)}),configured:()=>true,encryptionKey:KEY,now};
    await expect(taskBackupData(options)).rejects.toThrow('Manifest');
    allowManifest=true;
    expect(await taskBackupData({...options,now:()=>now()+86400_000})).toMatchObject({verified:true,has_more:true,dateStr:'2026-10-18'});
  });
  it('retention preserves every archive in the latest complete backup folder', async () => {
    const tables=['orders','invoices','customers','service_reports'];
    const {db,calls}=database({backupRows:[
      {id:'LATEST',tables,notes:'backup/2001-01-02/',created_at:'2001-01-02T00:00:00Z'},
      {id:'SAME-FOLDER',tables,notes:'backup/2001-01-02/',created_at:'2001-01-02T00:00:00Z'},
      {id:'OLD',tables,notes:'backup/2001-01-01/',created_at:'2001-01-01T00:00:00Z'},
    ]}), remove=vi.fn(async()=>true);
    expect(await taskBackupRetention({db,remove})).toMatchObject({purgedBackups:1,protectedFolder:'2001-01-02',errors:0});
    expect(remove).toHaveBeenCalledTimes(8); expect(remove.mock.calls.every(([key])=>key.startsWith('backup/2001-01-01/'))).toBe(true);
    expect(calls.filter(c=>c.action==='delete')).toHaveLength(1);
  });
  it('retention fails closed when no complete backup can be identified', async () => {
    const {db}=database({backupRows:[]}), remove=vi.fn();
    await expect(taskBackupRetention({db,remove})).rejects.toThrow('salinan terakhir'); expect(remove).not.toHaveBeenCalled();
  });
  it('retention only deletes exact encrypted bundle/manifest keys and preserves logs after partial deletion', async () => {
    const uuid='00000000-0000-4000-a000-000000000001', tables=[...BACKUP_TABLES];
    const {db,calls}=database({backupRows:[
      {id:'LATEST',tables,notes:'backup/2001-01-02/',created_at:'2001-01-02T00:00:00Z',row_counts:{format:2,sha256:'checksum'}},
      {id:'OLD',tables,notes:'backup/2001-01-01/',created_at:'2001-01-01T00:00:00Z',row_counts:{format:2,sha256:'checksum',bundle_key:`backup/2001-01-01/bundle-${uuid}.json.gz.enc`,manifest_key:`backup/2001-01-01/manifest-${uuid}.json`}},
    ]});
    const remove=vi.fn(async key=>!key.includes('manifest'));
    expect(await taskBackupRetention({db,remove})).toMatchObject({purgedBackups:0,errors:1});
    expect(remove).toHaveBeenCalledTimes(2); expect(calls.filter(c=>c.action==='delete')).toHaveLength(0);
  });
});

describe('bounded infra scan and read-only integrity audit', () => {
  it('saves incomplete scan cursor; resumes without treating partial bytes as a healthy total', async () => {
    const {db,settings}=database(); const measureR2=vi.fn().mockResolvedValueOnce({ok:true,complete:false,bytes:100,objects:2,requests:1,continuationToken:'NEXT'})
      .mockResolvedValueOnce({ok:true,complete:true,bytes:200,objects:4,requests:2});
    const first=await taskInfraUsageAlert({db,measureR2,now});
    expect(first).toMatchObject({has_more:true,level:'unknown'}); expect(JSON.parse(settings.get('infra_usage_snapshot')).r2_storage.percent).toBeNull();
    expect(await taskInfraUsageAlert({db,measureR2,now})).toMatchObject({has_more:false,level:'ok'});
    expect(measureR2.mock.calls[1][0].checkpoint.continuationToken).toBe('NEXT');
  });
  it('measurement failures stay visible; no fake green or advancing a failed cursor', async () => {
    const {db,settings}=database({failRpc:'get_infra_database_size'});
    expect(await taskInfraUsageAlert({db,measureR2:async()=>({ok:false,err:'offline'}),now})).toMatchObject({level:'unknown',error:'RPC unavailable'});
    expect(settings.has('infra_usage_scan_checkpoint')).toBe(false);
  });
  it('warning notifies only Owner and records alert state only after acceptance', async () => {
    const {db,settings}=database({dbBytes:490*1024**2}); const alert=vi.fn(async()=>({status:'ACCEPTED'}));
    await taskInfraUsageAlert({db,measureR2:async()=>({ok:true,complete:true,bytes:1}),alert,now});
    expect(alert.mock.calls[0][1].phone).toBe(OWNER); expect(JSON.parse(settings.get('infra_usage_last_alert')).level).toBe('critical');
  });
  it('audit persists findings without writing orders, reports, money or stock', async () => {
    const findings=[{check:'inventory_negative',n:1,severity:'critical',sample:'SKU-SIMULASI'}], {db,calls,settings}=database({findings}), alert=vi.fn(async()=>({status:'ACCEPTED'}));
    expect(await taskDataIntegrityAudit({db,alert,now})).toMatchObject({anomalies:1,critical:1});
    expect(JSON.parse(settings.get('data_integrity_snapshot')).read_only).toBe(true);
    expect(calls.filter(c=>c.action==='write').every(c=>c.table==='app_settings')).toBe(true);
  });
  it('an intentional missing PM interval is informative, not a false critical alert', async () => {
    const {db}=database({findings:[{check:'unit_active_no_interval',n:52,severity:'info'}]}), alert=vi.fn();
    expect(await taskDataIntegrityAudit({db,alert,now})).toMatchObject({clean:true}); expect(alert).not.toHaveBeenCalled();
  });
  it.each(['infra_usage_alert_enabled','data_integrity_audit_enabled'])('strict gates stay OFF for %s', async key => {
    for(const settings of [{cron_jobs:'[]',[key]:'true'},{cron_jobs:'null',[key]:'true'},{cron_jobs:'{}',[key]:'true'},
      {cron_jobs:JSON.stringify([{backendKey:key,active:false}]),[key]:'true'}, {cron_jobs:JSON.stringify([{backendKey:key,active:true}]),[key]:'false'}]) {
      expect(strictCronEnabled(settings,key)).toBe(false);
      const {db,calls}=database({settings});
      const result=key.startsWith('infra')?await taskInfraUsageAlert({db,now}):await taskDataIntegrityAudit({db,now});
      expect(result.skipped).toBe(true); expect(calls.some(c=>c.rpc)).toBe(false);
    }
  });
  it('an audit RPC error is not an empty/clean result', async () => {
    const {db}=database({failRpc:'audit_operational_integrity_216'}); await expect(taskDataIntegrityAudit({db,now})).rejects.toThrow('gagal');
  });
  it('owner alerts use durable outbox dedup and reject an inactive Owner', async () => {
    const {db}=database(), deliver=vi.fn(async()=>({status:'ACCEPTED'}));
    const args={key:'integrity:2026-10-18',phone:OWNER,message:'Synthetic test',toggleKey:'data_integrity_audit_enabled'};
    await sendOpsOwnerAlert(db,args,deliver); await sendOpsOwnerAlert(db,args,deliver); expect(deliver).toHaveBeenCalledTimes(1);
    await expect(sendOpsOwnerAlert(database({inactiveOwner:true}).db,args,deliver)).rejects.toThrow('Owner aktif');
  });
  it('a toggle changed OFF before dispatch blocks the Owner alert', async () => {
    const {db}=database({flags:{data_integrity_audit_enabled:'false'}}), deliver=vi.fn();
    expect(await sendOpsOwnerAlert(db,{key:'test',phone:OWNER,toggleKey:'data_integrity_audit_enabled'},deliver)).toMatchObject({status:'SKIPPED'}); expect(deliver).not.toHaveBeenCalled();
  });
});

describe('R2 resumable listing transport', () => {
  afterEach(()=>vi.unstubAllEnvs());
  const env=()=>{vi.stubEnv('R2_ACCESS_KEY','synthetic');vi.stubEnv('R2_SECRET_KEY','synthetic');vi.stubEnv('R2_ACCOUNT_ID','synthetic');};
  const xml=(more,size,token='')=>`<ListBucketResult><Contents><Key>test</Key><Size>${size}</Size></Contents><IsTruncated>${more}</IsTruncated>${token?`<NextContinuationToken>${token}</NextContinuationToken>`:''}</ListBucketResult>`;
  it('limits pages and resumes from the exact previous token without recounting old pages', async () => {
    env(); const fetchImpl=vi.fn().mockResolvedValueOnce(new Response(xml(true,10,'NEXT'))).mockResolvedValueOnce(new Response(xml(false,20)));
    const first=await getR2BucketUsage({resumable:true,maxPages:1,fetchImpl}); expect(first).toMatchObject({ok:true,complete:false,bytes:10,continuationToken:'NEXT'});
    const second=await getR2BucketUsage({resumable:true,maxPages:1,fetchImpl,checkpoint:first});
    expect(second).toMatchObject({ok:true,complete:true,bytes:30,objects:2}); expect(fetchImpl.mock.calls[1][0]).toContain('continuation-token=NEXT');
  });
  it('keeps the abort timer active while reading the response body', async () => {
    env(); const fetchImpl=async(_url,{signal})=>({ok:true,text:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))});
    expect(await getR2BucketUsage({fetchImpl,requestTimeoutMs:5,totalTimeoutMs:10})).toMatchObject({ok:false,err:'aborted'});
  });
  it('rejects malformed XML and missing continuation token', async () => {
    env(); expect(await getR2BucketUsage({fetchImpl:async()=>new Response('<html>error</html>')})).toMatchObject({ok:false});
    expect(await getR2BucketUsage({fetchImpl:async()=>new Response(xml(true,1))})).toMatchObject({ok:false,err:'R2 pagination token missing'});
  });
});
