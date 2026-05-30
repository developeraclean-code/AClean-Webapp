import { normalizePhone, samePhone } from "./phone.js";

export const VALID_ORDER_STATUSES = [
  "PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "WORKING",
  "REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED",
  "COMPLETED", "PAID", "CANCELLED", "OVERDUE", "CONTINUED",
];

export const VALID_ORDER_SERVICES = [
  "Cleaning", "Install", "Repair", "Complain", "Survey", "Project",
];

const CONTINUATION_OPEN_STATUSES = [
  "PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "WORKING",
  "REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED",
];

/**
 * Detect open parent jobs for the same phone number within the last `cutoffDays` days.
 * Returns candidates sorted newest-first. Empty array if phone is too short.
 */
export function detectContinuationCandidates(ordersData, phone, { cutoffDays = 3, today = null } = {}) {
  const norm = normalizePhone(phone || "");
  if (norm.length < 8) return [];

  const base = today ? new Date(today) : new Date();
  base.setDate(base.getDate() - cutoffDays);
  const cutoffStr = base.toISOString().slice(0, 10);

  return (ordersData || [])
    .filter(o =>
      samePhone(o.phone || "", norm) &&
      CONTINUATION_OPEN_STATUSES.includes(o.status) &&
      !o.parent_job_id &&
      (o.date || "") >= cutoffStr
    )
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

/**
 * Calculate the next day number for a continuation job.
 * Counts parent + existing multi-day children, then adds 1.
 */
export function calcContinuationDayNum(ordersData, parentId) {
  if (!parentId) return 2;
  const count = (ordersData || []).filter(o =>
    o.id === parentId || (o.parent_job_id === parentId && o.is_multi_day)
  ).length;
  return count + 1;
}
