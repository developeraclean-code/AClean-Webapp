import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ runs: [], calls: [], lease: false, budgets: [], elapsed: {}, claims:null, profile:null, profileError:null }));
vi.mock('../../../api/_auth.js',()=>({verifyAppToken:()=>state.claims,setCorsHeaders(){}}));
vi.mock('../../../api/sentry-init.js', () => ({ initSentry() {}, setCronContext() {} }));
vi.mock('../../../api/_tasks/_shared.js', () => ({ OWNER_PHONE: '628120000001', sendWA: vi.fn(), log: vi.fn(),
  sb: { from(table) {
    if(table==='user_profiles'){const q={select(){return q},eq(){return q},maybeSingle(){return q},abortSignal:async()=>({data:state.profile,error:state.profileError})};return q;}
    if (table !== 'cron_runs') throw new Error('Unexpected business table: ' + table);
    const q = { select(){return q;},in(_key,names){q.names=names;return q;},gte(_key,since){q.since=since;return q;},order(){return q;},range(a,b){q.bounds=[a,b];return q;},
      then(resolve){const rows=state.runs.filter(r=>q.names.includes(r.task_name)&&r.started_at>=q.since).slice(...[q.bounds[0],q.bounds[1]+1]);return Promise.resolve({data:rows}).then(resolve);} };return q;
  }, async rpc(name) {
    if(name==='claim_cron_worker_216'){const granted=!state.lease;state.lease=true;return {data:granted};}
    if(name==='release_cron_worker_216'){state.lease=false;return {data:null};}
    throw new Error('Unexpected RPC: '+name);
  } },
}));
vi.mock('../../../api/_logger.js', () => ({ closeStaleCronRuns: vi.fn(), runWithCronLogging: async(_db,name,fn,options)=>{
  expect(options.requireAudit).toBe(true);
  state.budgets.push({name,timeoutMs:options.timeoutMs});
  if(state.elapsed[name])vi.setSystemTime(Date.now()+state.elapsed[name]);
  const result=await fn();state.calls.push(name);state.runs.push({task_name:name,status:result.skipped?'SKIPPED':'SUCCESS',started_at:new Date().toISOString(),metadata:result});return result;
} }));
vi.mock('../../../api/_tasks/ops.js', () => Object.fromEntries(['taskProjectAlerts','taskBackupData','taskBackupRetention','taskPayrollWA','taskBonusEligible','taskMaintenanceContractExpiry','taskMaintenanceFollowupAlert','taskMaintenancePmDue','taskMediaGapAlert','taskDataIntegrityAudit','taskInfraUsageAlert'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/vouchers.js', () => Object.fromEntries(['taskVoucherLoyalty','taskVoucherWinback','taskVoucherExpiryReminder'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/reminders.js', () => Object.fromEntries(['taskReminder','taskDaily','taskStock','taskServisReminder','taskVoucherExpiryReminder','taskLaporanStaleAlert','taskMaterialPulangReminder','taskWeeklyReport','taskMorningDispatch','taskRatingPrompt'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/cleanup.js', () => Object.fromEntries(['taskCleanup','taskR2Cleanup90d','taskExpenseFotoCleanup30d','taskPaymentProofCleanup90d','taskSnapshotCleanup','taskWaCleanup','taskLogCleanup'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/wa-ai.js', () => Object.fromEntries(['taskWaSnapshot','taskWaBackfill','taskScanBuktiBayar','taskRetryPaymentMedia','taskPaymentMediaWatchdog'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/field-reports.js', () => ({taskFieldReportReminder:async()=>({})}));
import handler,{ taskTick } from '../../../api/cron-reminder.js';

describe('real dispatcher wiring with isolated task implementations', () => {
  afterEach(()=>{vi.useRealTimers();state.runs=[];state.calls=[];state.lease=false;state.budgets=[];state.elapsed={};state.claims=null;state.profile=null;state.profileError=null;vi.unstubAllEnvs();});
  it('gives the payment retry time for AI plus persistence, without adding tasks or changing its cadence',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T10:00:00+07:00'));
    await taskTick();
    expect(state.budgets.find(r=>r.name==='payment-media-retry')).toEqual({name:'payment-media-retry',timeoutMs:30000});
    await taskTick();
    expect(state.calls.filter(n=>n==='payment-media-retry')).toHaveLength(1);
  });
  it('defers payment work from a late tick and runs it next tick instead of interrupting the AI/persistence',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T10:00:00+07:00'));
    state.elapsed={'data-integrity-audit':2000,backup:25000};
    const first=await taskTick();
    expect(first.ran).not.toContain('payment-media-retry');
    expect(first.pending).toBeGreaterThan(0);
    expect((await taskTick()).ran).toContain('payment-media-retry');
    expect(state.calls.filter(n=>n==='payment-media-retry')).toHaveLength(1);
  });
  it('runs the missed Monday audit/backup first on Sunday, before cleanup; excludes night reminders before 20 WIB', async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T10:00:00+07:00'));
    const result=await taskTick();
    expect(result.ran).toEqual(['data-integrity-audit','backup','payment-media-retry']);
    expect(state.calls).not.toContain('field-report-reminder'); expect(state.lease).toBe(false);
  });
  it('200 ticks drain normal work without repeating weekly financial tasks or a fresh payment retry', async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T10:00:00+07:00'));
    const results=[];for(let i=0;i<200;i++)results.push(await taskTick());
    expect(state.calls.filter(n=>n==='data-integrity-audit')).toHaveLength(1);
    expect(state.calls.filter(n=>n==='backup')).toHaveLength(1);
    expect(state.calls.filter(n=>n==='payment-media-retry')).toHaveLength(1);
    expect(results.every(r=>r.ran.length<=3)).toBe(true);expect(results.at(-1).pending).toBe(0);
  });
  it('cleanup-only ticks never trigger audit, backup creation, payment retry, or WA tasks', async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T23:00:00+07:00'));
    const results=[];for(let i=0;i<8;i++)results.push(await taskTick({cleanupOnly:true}));
    expect(state.calls).not.toContain('backup');expect(state.calls).not.toContain('data-integrity-audit');
    expect(state.calls).not.toContain('payment-media-retry');expect(state.calls).not.toContain('daily');expect(results.at(-1).pending).toBe(0);
  });
  const response=()=>({setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this},end(){return this}});
  const manual=()=>({method:'POST',headers:{'x-internal-token':'fixture.jwt.token'},query:{task:'voucher-loyalty'}});
  const actorId='10000000-0000-4000-8000-000000000001';
  it.each(['Finance','Teknisi','Helper'])('manual cron rejects %s before task work',async role=>{vi.stubEnv('INTERNAL_API_SECRET','fixture');state.claims={userId:actorId,role};const res=response();await handler(manual(),res);expect(res.code).toBe(403);expect(state.calls).toHaveLength(0);});
  it('manual cron rechecks inactive profiles and dependency failures',async()=>{vi.stubEnv('INTERNAL_API_SECRET','fixture');state.claims={userId:actorId,role:'Owner'};state.profile={id:actorId,role:'Owner',active:false};const denied=response();await handler(manual(),denied);expect(denied.code).toBe(403);state.profileError={message:'down'};const unavailable=response();await handler(manual(),unavailable);expect(unavailable.code).toBe(503);expect(state.calls).toHaveLength(0);});
  it('active Owner and machine scheduler can run the same guarded voucher task',async()=>{vi.stubEnv('INTERNAL_API_SECRET','fixture');state.claims={userId:actorId,role:'Owner'};state.profile={id:actorId,role:'Owner',active:true};const ownerRes=response();await handler(manual(),ownerRes);expect(ownerRes.data.ok).toBe(true);vi.stubEnv('CRON_SECRET','fixture-cron');state.profileError={message:'must not read profile for scheduler'};const cronRes=response();await handler({method:'POST',headers:{authorization:'Bearer fixture-cron'},query:{task:'voucher-loyalty'}},cronRes);expect(cronRes.data.ok).toBe(true);expect(state.calls).toEqual(['voucher-loyalty','voucher-loyalty']);});

});
