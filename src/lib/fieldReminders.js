import { findDelayedFieldReports, isFieldOrderAssigned } from "./fieldReportWorkflow.js";

const ACTIVE_UPCOMING = new Set(["PENDING", "CONFIRMED"]);

const minutesAt = (date, time) => {
  const parsed = Date.parse(`${date || ""}T${time || "00:00"}:00`);
  return Number.isFinite(parsed) ? Math.round(parsed / 60000) : null;
};

export function buildFieldReminders({ orders = [], reports = [], employeeName, today, now = new Date(), materialsBroughtMap = {} }) {
  const reminders = [];
  const nowMinutes = Math.round(now.getTime() / 60000);
  const reported = new Set((reports || []).flatMap(row => [row.job_id, row.order_id].filter(Boolean)));
  for (const order of orders || []) {
    if (!isFieldOrderAssigned(order, employeeName)) continue;
    if (order.date === today && ACTIVE_UPCOMING.has(order.status)) {
      const start = minutesAt(order.date, order.time);
      const until = start == null ? null : start - nowMinutes;
      if (until != null && until >= 0 && until <= 45) reminders.push({
        key: `job:${order.id}:${today}`, type: "upcoming",
        message: `⏰ Job berikut ${until <= 1 ? "sekarang" : `${until} menit lagi`}: ${order.customer} (${order.time || "--:--"})`,
      });
    }
    const end = minutesAt(order.date, order.time_end || order.time);
    const materialDue = Number(materialsBroughtMap?.[order.id] || 0) > 0
      && !reported.has(order.id)
      && (order.date < today || (order.date === today && end != null && nowMinutes > end));
    if (materialDue) reminders.push({
      key: `material:${order.id}:${today}`, type: "material",
      message: `📦 Material ${order.customer} belum direkonsiliasi lewat laporan.`,
    });
  }
  const delayed = findDelayedFieldReports(orders, reports, employeeName, today)[0];
  if (delayed) reminders.push({
    key: `report:${delayed.id}:${today}`, type: "report",
    message: `📝 Laporan ${delayed.customer} (${delayed.date}) masih tertunda.`,
  });
  return reminders;
}

export function claimFieldReminder(reminder, store = globalThis.localStorage) {
  if (!reminder?.key || !store) return false;
  const key = `aclean:field-reminder:v1:${reminder.key}`;
  try {
    if (store.getItem(key)) return false;
    store.setItem(key, new Date().toISOString());
    return true;
  } catch { return false; }
}
