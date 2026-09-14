// Pure, deterministic SFM integrity engine.
// It has no Supabase/fetch/R2/WA dependencies, so it can be exercised with large
// synthetic datasets without consuming production/free-tier resources.

const ACTIVE_ORDER_STATUSES = new Set(["PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "IN_PROGRESS", "WORKING"]);
const REPORT_READY_STATUSES = new Set(["SUBMITTED", "VERIFIED", "APPROVED"]);
const ORDER_AFTER_REPORT_STATUSES = new Set(["REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED", "PAID", "COMPLETED"]);
const TERMINAL_ORDER_STATUSES = new Set(["REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED", "PAID", "COMPLETED", "CANCELLED"]);
const VALID_ORDER_STATUSES = new Set([
  "PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "IN_PROGRESS", "WORKING",
  "REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED", "PAID", "COMPLETED",
  "CANCELLED", "RESCHEDULED", "CONTINUED",
]);
const VALID_INVOICE_STATUSES = new Set([
  "DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "UNPAID", "PARTIAL_PAID",
  "PAID", "OVERDUE", "CANCELLED",
]);

export const ORDER_TRANSITIONS = Object.freeze({
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["DISPATCHED", "RESCHEDULED", "CANCELLED"],
  RESCHEDULED: ["CONFIRMED", "DISPATCHED", "CANCELLED"],
  DISPATCHED: ["ON_SITE", "IN_PROGRESS", "WORKING", "CONTINUED", "REPORT_SUBMITTED", "CANCELLED"],
  ON_SITE: ["IN_PROGRESS", "WORKING", "CONTINUED", "REPORT_SUBMITTED", "CANCELLED"],
  IN_PROGRESS: ["WORKING", "CONTINUED", "REPORT_SUBMITTED", "CANCELLED"],
  WORKING: ["CONTINUED", "REPORT_SUBMITTED", "CANCELLED"],
  CONTINUED: ["CONFIRMED", "DISPATCHED", "REPORT_SUBMITTED", "CANCELLED"],
  REPORT_SUBMITTED: ["INVOICE_CREATED", "INVOICE_APPROVED", "COMPLETED", "PAID"],
  INVOICE_CREATED: ["INVOICE_APPROVED", "COMPLETED", "PAID"],
  INVOICE_APPROVED: ["COMPLETED", "PAID"],
  COMPLETED: ["INVOICE_CREATED", "INVOICE_APPROVED", "PAID"],
  PAID: [],
  CANCELLED: [],
});

export function canTransitionOrderStatus(from, to, { privilegedReversal = false } = {}) {
  if (from === to) return true;
  if (privilegedReversal && (from === "PAID" || from === "CANCELLED")) return VALID_ORDER_STATUSES.has(to);
  return (ORDER_TRANSITIONS[from] || []).includes(to);
}

const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value) => Math.round(num(value));
const cloneState = (state) => ({
  orders: (state.orders || []).map(row => ({ ...row })),
  reports: (state.reports || []).map(row => ({ ...row })),
  invoices: (state.invoices || []).map(row => ({ ...row })),
  invoicePayments: (state.invoicePayments || []).map(row => ({ ...row })),
  schedules: (state.schedules || []).map(row => ({ ...row })),
});

function runLocalTransaction(input, mutate, failAt = null) {
  const before = cloneState(input);
  const draft = cloneState(input);
  const checkpoint = (name) => {
    if (name === failAt) throw new Error(`SIMULATED_FAILURE:${name}`);
  };
  try {
    mutate(draft, checkpoint);
    return { state: draft, committed: true, rolledBackCleanly: true };
  } catch (error) {
    return {
      state: before,
      committed: false,
      rolledBackCleanly: JSON.stringify(before) === JSON.stringify(input),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function issue(type, severity, entityType, entityId, message, repair = null) {
  return { type, severity, entityType, entityId, message, repair, repairable: !!repair };
}

export function auditOperationalIntegrity(input) {
  const state = cloneState(input || {});
  const issues = [];
  const orderById = new Map(state.orders.map(row => [row.id, row]));
  const invoiceById = new Map(state.invoices.map(row => [row.id, row]));
  const reportsByJob = new Map();
  const schedulesByOrder = new Map();
  const paidByInvoice = new Map();

  for (const row of state.reports) {
    if (!row.job_id) continue;
    const rows = reportsByJob.get(row.job_id) || [];
    rows.push(row);
    reportsByJob.set(row.job_id, rows);
  }
  for (const row of state.schedules) {
    if (!row.order_id) continue;
    const rows = schedulesByOrder.get(row.order_id) || [];
    rows.push(row);
    schedulesByOrder.set(row.order_id, rows);
  }
  for (const row of state.invoicePayments) {
    if (!invoiceById.has(row.invoice_id)) {
      issues.push(issue("ORPHAN_PAYMENT", "critical", "invoice_payment", row.id, `Payment ${row.id} tidak memiliki invoice ${row.invoice_id}`));
      continue;
    }
    if (row.voided_at || row.status === "VOID") continue;
    paidByInvoice.set(row.invoice_id, money((paidByInvoice.get(row.invoice_id) || 0) + num(row.amount)));
  }

  for (const order of state.orders) {
    if (!VALID_ORDER_STATUSES.has(order.status)) {
      issues.push(issue("INVALID_ORDER_STATUS", "critical", "order", order.id, `Status order ${order.status || "(kosong)"} tidak valid`));
    }
    const reports = reportsByJob.get(order.id) || [];
    if (reports.length > 1) {
      issues.push(issue("DUPLICATE_REPORT", "critical", "order", order.id, `${reports.length} laporan aktif memakai job yang sama`));
    }
    const readyReport = reports.find(row => REPORT_READY_STATUSES.has(row.status));
    if (readyReport && ACTIVE_ORDER_STATUSES.has(order.status)) {
      issues.push(issue(
        "REPORT_ORDER_STATUS_LAG", "high", "order", order.id,
        `Laporan ${readyReport.id} sudah ${readyReport.status}, tetapi order masih ${order.status}`,
        { action: "SET_ORDER_STATUS", orderId: order.id, status: "REPORT_SUBMITTED" },
      ));
    }
    if (ORDER_AFTER_REPORT_STATUSES.has(order.status) && reports.length === 0) {
      issues.push(issue("ORDER_WITHOUT_REPORT", "critical", "order", order.id, `Order ${order.status} tidak memiliki laporan`));
    }

    const schedules = schedulesByOrder.get(order.id) || [];
    const activeSchedules = schedules.filter(row => row.status === "ACTIVE");
    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      for (const schedule of activeSchedules) {
        issues.push(issue(
          "STALE_ACTIVE_SCHEDULE", "medium", "schedule", schedule.id,
          `Slot masih ACTIVE padahal order ${order.id} sudah ${order.status}`,
          { action: "SET_SCHEDULE_STATUS", scheduleId: schedule.id, status: "INACTIVE" },
        ));
      }
    } else if (ACTIVE_ORDER_STATUSES.has(order.status) && activeSchedules.length === 0) {
      issues.push(issue("ACTIVE_ORDER_WITHOUT_SCHEDULE", "high", "order", order.id, `Order aktif ${order.status} tidak memiliki slot ACTIVE`));
    }
  }

  for (const report of state.reports) {
    if (report.job_id && !orderById.has(report.job_id)) {
      issues.push(issue("ORPHAN_REPORT", "critical", "report", report.id, `Laporan menunjuk order ${report.job_id} yang tidak ada`));
    }
  }

  for (const schedule of state.schedules) {
    if (schedule.order_id && !orderById.has(schedule.order_id)) {
      issues.push(issue("ORPHAN_SCHEDULE", "high", "schedule", schedule.id, `Slot menunjuk order ${schedule.order_id} yang tidak ada`));
    }
  }

  for (const invoice of state.invoices) {
    if (!VALID_INVOICE_STATUSES.has(invoice.status)) {
      issues.push(issue("INVALID_INVOICE_STATUS", "critical", "invoice", invoice.id, `Status invoice ${invoice.status || "(kosong)"} tidak valid`));
    }
    const order = invoice.job_id ? orderById.get(invoice.job_id) : null;
    if (invoice.job_id && !order) {
      issues.push(issue("ORPHAN_INVOICE", "critical", "invoice", invoice.id, `Invoice menunjuk order ${invoice.job_id} yang tidak ada`));
    }
    if (invoice.status === "PAID" && order && order.status !== "PAID") {
      issues.push(issue(
        "PAID_ORDER_STATUS_LAG", "high", "order", order.id,
        `Invoice ${invoice.id} PAID, tetapi order masih ${order.status}`,
        { action: "SET_ORDER_STATUS", orderId: order.id, status: "PAID" },
      ));
    }

    const total = money(invoice.total);
    const ledgerPaid = money(paidByInvoice.get(invoice.id) || 0);
    if (invoice.status === "PAID" && ledgerPaid <= 0 && total > 0) {
      issues.push(issue("PAID_WITHOUT_LEDGER", "critical", "invoice", invoice.id, "Invoice PAID tidak memiliki payment ledger; nominal tidak boleh dikarang"));
      continue;
    }
    if (ledgerPaid > total && total >= 0) {
      issues.push(issue("PAYMENT_OVER_TOTAL", "critical", "invoice", invoice.id, `Payment ${ledgerPaid} melebihi total ${total}`));
      continue;
    }
    if (ledgerPaid > 0) {
      const expectedPaid = Math.min(total, ledgerPaid);
      const expectedRemaining = Math.max(0, total - expectedPaid);
      const expectedStatus = expectedRemaining === 0 ? "PAID" : "PARTIAL_PAID";
      if (money(invoice.paid_amount) !== expectedPaid
          || money(invoice.remaining_amount ?? total) !== expectedRemaining
          || invoice.status !== expectedStatus) {
        issues.push(issue(
          "INVOICE_PAYMENT_AGGREGATE_MISMATCH", "high", "invoice", invoice.id,
          `Aggregate invoice tidak sama dengan ledger pembayaran (${ledgerPaid}/${total})`,
          { action: "SYNC_INVOICE_FROM_LEDGER", invoiceId: invoice.id, paidAmount: expectedPaid, remainingAmount: expectedRemaining, status: expectedStatus },
        ));
      }
    }
  }

  const counts = issues.reduce((acc, row) => {
    acc[row.severity] = (acc[row.severity] || 0) + 1;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0 });
  const repairable = issues.filter(row => row.repairable).length;
  return { issues, counts, repairable, manualReview: issues.length - repairable, scanned: {
    orders: state.orders.length,
    reports: state.reports.length,
    invoices: state.invoices.length,
    invoicePayments: state.invoicePayments.length,
    schedules: state.schedules.length,
  } };
}

export function applySafeIntegrityRepairs(input, audit = auditOperationalIntegrity(input)) {
  const state = cloneState(input || {});
  const applied = [];
  const skipped = [];
  const seen = new Set();

  for (const row of audit.issues) {
    const repair = row.repair;
    if (!repair) { skipped.push(row); continue; }
    const key = JSON.stringify(repair);
    if (seen.has(key)) continue;
    seen.add(key);

    if (repair.action === "SET_ORDER_STATUS") {
      const target = state.orders.find(item => item.id === repair.orderId);
      if (!target) { skipped.push(row); continue; }
      target.status = repair.status;
    } else if (repair.action === "SET_SCHEDULE_STATUS") {
      const target = state.schedules.find(item => item.id === repair.scheduleId);
      if (!target) { skipped.push(row); continue; }
      target.status = repair.status;
    } else if (repair.action === "SYNC_INVOICE_FROM_LEDGER") {
      const target = state.invoices.find(item => item.id === repair.invoiceId);
      if (!target) { skipped.push(row); continue; }
      target.paid_amount = repair.paidAmount;
      target.remaining_amount = repair.remainingAmount;
      target.status = repair.status;
      if (repair.status === "PAID" && !target.paid_at) target.paid_at = "SELF_REPAIRED";
    } else {
      skipped.push(row);
      continue;
    }
    applied.push({ issueType: row.type, entityType: row.entityType, entityId: row.entityId, repair });
  }
  return { state, applied, skipped };
}

export function createSyntheticOperationalState(totalJobs = 100) {
  const state = { orders: [], reports: [], invoices: [], invoicePayments: [], schedules: [] };
  for (let index = 1; index <= totalJobs; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const orderId = `SIM-JOB-${suffix}`;
    const hasReport = index <= 80;
    const hasInvoice = index <= 70;
    const isPaid = index <= 50;
    const status = isPaid ? "PAID" : hasInvoice ? "INVOICE_APPROVED" : hasReport ? "REPORT_SUBMITTED" : "DISPATCHED";
    state.orders.push({ id: orderId, status, customer: `Sim Customer ${suffix}` });
    state.schedules.push({ id: `SIM-SLOT-${suffix}`, order_id: orderId, status: ACTIVE_ORDER_STATUSES.has(status) ? "ACTIVE" : "INACTIVE" });
    if (hasReport) state.reports.push({ id: `SIM-REPORT-${suffix}`, job_id: orderId, status: "VERIFIED" });
    if (hasInvoice) {
      const invoiceId = `SIM-INV-${suffix}`;
      const total = 100000 + index * 1000;
      state.invoices.push({ id: invoiceId, job_id: orderId, status: isPaid ? "PAID" : "UNPAID", total, paid_amount: isPaid ? total : 0, remaining_amount: isPaid ? 0 : total });
      if (isPaid) state.invoicePayments.push({ id: `SIM-PAY-${suffix}`, invoice_id: invoiceId, amount: total, status: "POSTED" });
    }
  }
  return state;
}

export function injectSyntheticIntegrityFaults(input) {
  const state = cloneState(input);
  // Deterministic, safe-repairable faults.
  for (let i = 1; i <= 5; i += 1) state.orders[i - 1].status = "INVOICE_APPROVED";
  for (let i = 6; i <= 10; i += 1) {
    const invoice = state.invoices[i - 1];
    invoice.status = "UNPAID"; invoice.paid_amount = 0; invoice.remaining_amount = invoice.total;
  }
  for (let i = 11; i <= 15; i += 1) state.schedules[i - 1].status = "ACTIVE";
  for (let i = 71; i <= 75; i += 1) state.orders[i - 1].status = "DISPATCHED";

  // Ambiguous faults: audit must quarantine, never invent/delete data.
  state.invoicePayments = state.invoicePayments.filter(row => row.invoice_id !== "SIM-INV-021");
  state.reports.push({ id: "SIM-REPORT-022-DUP", job_id: "SIM-JOB-022", status: "VERIFIED" });
  state.reports = state.reports.filter(row => row.job_id !== "SIM-JOB-076");
  state.invoices.push({ id: "SIM-INV-ORPHAN", job_id: "SIM-JOB-MISSING", status: "UNPAID", total: 100000, paid_amount: 0, remaining_amount: 100000 });
  state.schedules.push({ id: "SIM-SLOT-ORPHAN", order_id: "SIM-JOB-MISSING", status: "ACTIVE" });
  return state;
}

export function simulateOperationalIntegrity(totalJobs = 100) {
  const clean = createSyntheticOperationalState(totalJobs);
  const faulty = injectSyntheticIntegrityFaults(clean);
  const before = auditOperationalIntegrity(faulty);
  const repaired = applySafeIntegrityRepairs(faulty, before);
  const after = auditOperationalIntegrity(repaired.state);
  const secondPass = applySafeIntegrityRepairs(repaired.state, after);
  const remainingRepairable = after.issues.filter(row => row.repairable).length;
  const unexpectedMutations = secondPass.applied.length;
  // Maksimum 95: pure local model tidak boleh mengklaim 100% sebelum RPC diuji
  // terhadap PostgreSQL dengan schema yang sama seperti production.
  const confidence = Math.max(0, Math.min(95, 100 - remainingRepairable * 10 - unexpectedMutations * 10));
  return { totalJobs, before, after, applied: repaired.applied, idempotent: unexpectedMutations === 0, confidence };
}

// Reference transaction model for local load/failure simulation. This does not
// pretend to be a database integration test; it verifies the required all-or-
// nothing invariants before the equivalent RPCs are introduced in production.
export function simulateAtomicLifecycleBatch(totalJobs = 100) {
  let state = { orders: [], reports: [], invoices: [], invoicePayments: [], schedules: [] };
  let forcedFailures = 0;
  let verifiedRollbacks = 0;

  const executeWithFailureRetry = (mutate, failAt) => {
    if (failAt) {
      const failed = runLocalTransaction(state, mutate, failAt);
      forcedFailures += 1;
      if (!failed.committed && failed.rolledBackCleanly
          && JSON.stringify(failed.state) === JSON.stringify(state)) verifiedRollbacks += 1;
    }
    const committed = runLocalTransaction(state, mutate);
    if (!committed.committed) throw new Error(committed.error || "Local transaction gagal");
    state = committed.state;
  };

  for (let index = 1; index <= totalJobs; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const orderId = `LOAD-JOB-${suffix}`;
    const reportId = `LOAD-REPORT-${suffix}`;
    const invoiceId = `LOAD-INV-${suffix}`;
    const paymentId = `LOAD-PAY-${suffix}`;
    const total = 150000 + index * 1000;

    executeWithFailureRetry((draft, checkpoint) => {
      if (draft.orders.some(row => row.id === orderId)) throw new Error("DUPLICATE_ORDER");
      draft.orders.push({ id: orderId, status: "DISPATCHED", customer: `Load Customer ${suffix}` });
      checkpoint("CREATE_AFTER_ORDER");
      draft.schedules.push({ id: `LOAD-SLOT-${suffix}`, order_id: orderId, status: "ACTIVE" });
    }, index % 25 === 0 ? "CREATE_AFTER_ORDER" : null);

    if (index <= 80) executeWithFailureRetry((draft, checkpoint) => {
      if (draft.reports.some(row => row.job_id === orderId)) throw new Error("DUPLICATE_REPORT");
      draft.reports.push({ id: reportId, job_id: orderId, status: "VERIFIED" });
      checkpoint("REPORT_AFTER_INSERT");
      draft.orders.find(row => row.id === orderId).status = "REPORT_SUBMITTED";
      draft.schedules.find(row => row.order_id === orderId).status = "INACTIVE";
    }, index % 20 === 0 ? "REPORT_AFTER_INSERT" : null);

    if (index <= 70) executeWithFailureRetry((draft, checkpoint) => {
      draft.invoices.push({ id: invoiceId, job_id: orderId, status: "UNPAID", total, paid_amount: 0, remaining_amount: total });
      checkpoint("INVOICE_AFTER_INSERT");
      draft.orders.find(row => row.id === orderId).status = "INVOICE_APPROVED";
    }, index % 23 === 0 ? "INVOICE_AFTER_INSERT" : null);

    if (index <= 50) executeWithFailureRetry((draft, checkpoint) => {
      if (draft.invoicePayments.some(row => row.id === paymentId)) throw new Error("DUPLICATE_PAYMENT");
      draft.invoicePayments.push({ id: paymentId, invoice_id: invoiceId, amount: total, status: "POSTED" });
      checkpoint("PAYMENT_AFTER_LEDGER");
      const invoice = draft.invoices.find(row => row.id === invoiceId);
      invoice.status = "PAID"; invoice.paid_amount = total; invoice.remaining_amount = 0;
      draft.orders.find(row => row.id === orderId).status = "PAID";
    }, index % 17 === 0 ? "PAYMENT_AFTER_LEDGER" : null);
  }

  const audit = auditOperationalIntegrity(state);
  return {
    totalJobs,
    state,
    audit,
    forcedFailures,
    verifiedRollbacks,
    allRollbacksVerified: forcedFailures === verifiedRollbacks,
  };
}
