import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ runs: [], calls: [], lease: false }));
vi.mock('../../../api/sentry-init.js', () => ({ initSentry() {}, setCronContext() {} }));
vi.mock('../../../api/_tasks/_shared.js', () => ({ OWNER_PHONE: '628120000001', sendWA: vi.fn(), log: vi.fn(),
  sb: { from(table) {
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
  const result=await fn();state.calls.push(name);state.runs.push({task_name:name,status:result.skipped?'SKIPPED':'SUCCESS',started_at:new Date().toISOString(),metadata:result});return result;
} }));
vi.mock('../../../api/_tasks/ops.js', () => Object.fromEntries(['taskProjectAlerts','taskBackupData','taskBackupRetention','taskPayrollWA','taskBonusEligible','taskMaintenanceContractExpiry','taskMaintenanceFollowupAlert','taskMaintenancePmDue','taskMediaGapAlert','taskDataIntegrityAudit','taskInfraUsageAlert'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/reminders.js', () => Object.fromEntries(['taskReminder','taskDaily','taskStock','taskServisReminder','taskVoucherExpiryReminder','taskLaporanStaleAlert','taskMaterialPulangReminder','taskWeeklyReport','taskMorningDispatch','taskRatingPrompt'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/cleanup.js', () => Object.fromEntries(['taskCleanup','taskR2Cleanup90d','taskExpenseFotoCleanup30d','taskPaymentProofCleanup90d','taskSnapshotCleanup','taskWaCleanup','taskLogCleanup'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/wa-ai.js', () => Object.fromEntries(['taskWaSnapshot','taskWaBackfill','taskScanBuktiBayar','taskRetryPaymentMedia','taskPaymentMediaWatchdog'].map(n=>[n,async()=>({})])));
vi.mock('../../../api/_tasks/field-reports.js', () => ({taskFieldReportReminder:async()=>({})}));
import { taskTick } from '../../../api/cron-reminder.js';

describe('real dispatcher wiring with isolated task implementations', () => {
  afterEach(()=>{vi.useRealTimers();state.runs=[];state.calls=[];state.lease=false;});
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
});
