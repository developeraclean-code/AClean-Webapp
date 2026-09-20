let externalRequests = 0;
const originalFetch = globalThis.fetch;

// Hard guard: simulasi ini harus gagal bila kode yang diuji mencoba mengakses
// Supabase, Vercel, R2, WA provider, atau endpoint jaringan mana pun.
globalThis.fetch = async (...args) => {
  externalRequests += 1;
  throw new Error(`External request diblokir oleh local SFM gate: ${String(args[0])}`);
};

const { simulateAtomicLifecycleBatch, simulateOperationalIntegrity } = await import("../src/lib/sfmIntegrity.js");
const { getTeamSplitProgress } = await import("../src/lib/teamSplitWorkflow.js");

// 100 sub-order = 50 grup × 2 tim. Pastikan invoice gate tidak pernah siap
// setelah baru satu laporan verified, lalu selalu siap setelah laporan kedua.
const teamOrders = Array.from({ length: 100 }, (_, index) => {
  const group = Math.floor(index / 2);
  return { id: `TEAM-${index}`, is_team_split: true, job_group_id: `GROUP-${group}` };
});
let prematureTeamInvoices = 0;
let completedTeamGroups = 0;
for (let group = 0; group < 50; group += 1) {
  const members = teamOrders.filter(order => order.job_group_id === `GROUP-${group}`);
  const firstOnly = [{ id: `REPORT-${group}-A`, job_id: members[0].id, status: "VERIFIED" }];
  if (getTeamSplitProgress(members[0], teamOrders, firstOnly)?.allVerified) prematureTeamInvoices += 1;
  const complete = [...firstOnly, { id: `REPORT-${group}-B`, job_id: members[1].id, status: "VERIFIED" }];
  if (getTeamSplitProgress(members[0], teamOrders, complete)?.allVerified) completedTeamGroups += 1;
}

const result = simulateOperationalIntegrity(100);
const lifecycle = simulateAtomicLifecycleBatch(100);
const summary = {
  mode: "LOCAL_SYNTHETIC_ONLY",
  externalRequests,
  totalJobs: result.totalJobs,
  scannedBefore: result.before.scanned,
  findingsBefore: result.before.issues.length,
  repairableBefore: result.before.repairable,
  safeRepairsApplied: result.applied.length,
  findingsAfter: result.after.issues.length,
  repairableAfter: result.after.repairable,
  quarantinedForManualReview: result.after.manualReview,
  idempotent: result.idempotent,
  confidence: result.confidence,
  lifecycleFindings: lifecycle.audit.issues.length,
  forcedTransactionFailures: lifecycle.forcedFailures,
  verifiedAtomicRollbacks: lifecycle.verifiedRollbacks,
  allAtomicRollbacksVerified: lifecycle.allRollbacksVerified,
  teamSplitOrders: teamOrders.length,
  prematureTeamInvoices,
  completedTeamGroups,
  remainingIssueTypes: [...new Set(result.after.issues.map(row => row.type))],
};

console.log(JSON.stringify(summary, null, 2));

globalThis.fetch = originalFetch;

if (summary.externalRequests !== 0
    || summary.totalJobs !== 100
    || summary.repairableAfter !== 0
    || !summary.idempotent
    || summary.lifecycleFindings !== 0
    || !summary.allAtomicRollbacksVerified
    || summary.prematureTeamInvoices !== 0
    || summary.completedTeamGroups !== 50
    || summary.confidence < 90) {
  process.exitCode = 1;
}
