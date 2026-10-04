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
const { resolveMaintenanceReportUnits } = await import("../src/lib/maintenanceUnitResolution.js");

// 200 pekerjaan: 40 grup × 2 tim dan 40 grup × 3 tim. Jumlah aktual sengaja
// bergeser dari planning agar gate tidak pernah memakai kuantitas rencana.
const teamOrders = [];
for (let group = 0; group < 80; group += 1) {
  const teamCount = group < 40 ? 2 : 3;
  for (let member = 0; member < teamCount; member += 1) {
    teamOrders.push({ id: `TEAM-${group}-${member}`, is_team_split: true,
      job_group_id: `GROUP-${group}`, planned_units: 2 + (member % 2), actual_units: 1 + ((group + member) % 4) });
  }
}
let prematureTeamInvoices = 0;
let completedTeamGroups = 0;
let duplicateGroupsBlocked = 0;
let actualUnitMismatchesCovered = 0;
for (let group = 0; group < 80; group += 1) {
  const members = teamOrders.filter(order => order.job_group_id === `GROUP-${group}`);
  const firstOnly = [{ id: `REPORT-${group}-A`, job_id: members[0].id, status: "VERIFIED" }];
  if (getTeamSplitProgress(members[0], teamOrders, firstOnly)?.allVerified) prematureTeamInvoices += 1;
  const complete = members.map((member, index) => ({ id: `REPORT-${group}-${index}`, job_id: member.id, status: "VERIFIED", total_units: member.actual_units }));
  if (getTeamSplitProgress(members[0], teamOrders, complete)?.allVerified) completedTeamGroups += 1;
  if (!getTeamSplitProgress(members[0], teamOrders, [...complete, { ...complete[0], id: `REPORT-${group}-DUP` }])?.allVerified) duplicateGroupsBlocked += 1;
  if (members.some(member => member.planned_units !== member.actual_units)
      && complete.reduce((sum, report) => sum + report.total_units, 0) === members.reduce((sum, member) => sum + member.actual_units, 0)) {
    actualUnitMismatchesCovered += 1;
  }
}

let unitLinksValid = 0;
let ambiguousUnitsQuarantined = 0;
for (let job = 0; job < 200; job += 1) {
  const clientId = `CLIENT-${job}`;
  const registry = Array.from({ length: 4 }, (_, index) => ({ id: `UNIT-${job}-${index}`, client_id: clientId }));
  const actualCount = 1 + (job % 4);
  const units = registry.slice(0, actualCount).reverse().map(unit => ({ maint_unit_id: unit.id }));
  if (job % 10 === 0) units[0] = { ...units[0], maint_unit_id: null };
  const resolution = resolveMaintenanceReportUnits(units, registry, clientId);
  if (resolution.ok && resolution.pairs.length === actualCount) unitLinksValid += 1;
  if (!resolution.ok && resolution.pairs.length === 0) ambiguousUnitsQuarantined += 1;
}

const result = simulateOperationalIntegrity(200);
const lifecycle = simulateAtomicLifecycleBatch(200);
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
  duplicateGroupsBlocked,
  actualUnitMismatchesCovered,
  unitLinksValid,
  ambiguousUnitsQuarantined,
  remainingIssueTypes: [...new Set(result.after.issues.map(row => row.type))],
};

console.log(JSON.stringify(summary, null, 2));

globalThis.fetch = originalFetch;

if (summary.externalRequests !== 0
    || summary.totalJobs !== 200
    || summary.repairableAfter !== 0
    || !summary.idempotent
    || summary.lifecycleFindings !== 0
    || !summary.allAtomicRollbacksVerified
    || summary.prematureTeamInvoices !== 0
    || summary.completedTeamGroups !== 80
    || summary.duplicateGroupsBlocked !== 80
    || summary.actualUnitMismatchesCovered < 70
    || summary.unitLinksValid !== 180
    || summary.ambiguousUnitsQuarantined !== 20
    || summary.confidence < 90) {
  process.exitCode = 1;
}
