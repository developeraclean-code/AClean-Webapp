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

// Status yang menandakan satu hari kerja sudah ditutup: laporan masuk, di-invoice, atau lunas.
const FINISHED_STATUSES = [
  "REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED", "COMPLETED", "PAID",
];

/**
 * Anggota grup multi-hari dari sebuah order (induk + anak lanjutan).
 * Untuk order non multi-hari → [].
 */
export function multiDayMembers(order, ordersData) {
  if (!order || !order.is_multi_day) return [];
  const parentId = order.parent_job_id || order.id;
  return (ordersData || []).filter(o =>
    o.id === parentId || (o.parent_job_id === parentId && o.is_multi_day)
  );
}

/**
 * Flag progress ringan untuk grup order multi-hari — derived, tanpa kolom DB.
 * Model multi-hari meng-anchor SATU invoice di akhir, jadi grup dianggap "selesai"
 * begitu ada member yang sudah laporan/invoice/lunas. Selama belum ada (mis. saat
 * hanya Material Harian yang masuk hari demi hari) → "belum selesai" (berjalan).
 * Returns null untuk order non multi-hari.
 */
export function multiDayProgress(order, ordersData) {
  if (!order || !order.is_multi_day) return null;
  const members = multiDayMembers(order, ordersData);
  const totalDays = members.length || 1;
  const finished = members.some(o =>
    o.invoice_id || FINISHED_STATUSES.includes(o.status)
  );
  const isParent = !(order.parent_job_id && order.is_multi_day);
  return {
    isParent,
    totalDays,
    finished,
    label: finished ? "✅ Selesai" : "🚧 Belum selesai",
    color: finished ? "#22c55e" : "#f97316",
  };
}
