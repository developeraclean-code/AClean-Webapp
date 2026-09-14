let externalRequests = 0;
const originalFetch = globalThis.fetch;

// Hard guard: simulasi ini harus gagal bila kode yang diuji mencoba mengakses
// Supabase, Vercel, R2, WA provider, atau endpoint jaringan mana pun.
globalThis.fetch = async (...args) => {
  externalRequests += 1;
  throw new Error(`External request diblokir oleh local SFM gate: ${String(args[0])}`);
};

const { simulateAtomicLifecycleBatch, simulateOperationalIntegrity } = await import("../src/lib/sfmIntegrity.js");

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
    || summary.confidence < 90) {
  process.exitCode = 1;
}
