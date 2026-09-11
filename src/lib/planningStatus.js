import { ORDER_DONE_STATUSES } from "../constants/status.js";

// Status tambahan yang pernah dipakai data lama/antar-tahap, tetapi tetap berarti
// pekerjaan lapangan sudah ditutup untuk kebutuhan audit Planning Order.
const LEGACY_DONE_STATUSES = ["VERIFIED", "INVOICED"];

export function isSubmittedServiceReport(report) {
  if (!report?.job_id) return false;
  const status = String(report.status || "").toUpperCase();
  return Boolean(status) && status !== "PENDING";
}

export function submittedReportJobIds(reports) {
  return new Set((reports || []).filter(isSubmittedServiceReport).map(report => report.job_id));
}

export function planningDisplayStatus(order, reportJobIds = new Set()) {
  if (!order) return "PENDING";
  if (order.status === "CANCELLED") return "CANCELLED";

  if (
    reportJobIds.has(order.id) ||
    ORDER_DONE_STATUSES.includes(order.status) ||
    LEGACY_DONE_STATUSES.includes(order.status)
  ) {
    return "COMPLETED";
  }

  return order.status || "PENDING";
}
