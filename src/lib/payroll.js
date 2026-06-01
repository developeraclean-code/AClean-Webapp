// Pure payroll calculation helpers — diekstrak dari TeknisiAdminView agar bisa di-unit-test.
// Tidak ada side-effect / DOM / Supabase. Mirror formula GENERATED kolom di DB (weekly_payroll).

// ── Period helpers (Senin–Sabtu, selalu local date) ──
// toISOString() return UTC → geser hari di WIB (UTC+7), jadi pakai komponen local.
export function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Senin terdekat <= dateStr ("YYYY-MM-DD")
export function getMondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Minggu
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return localDateStr(d);
}

// Sabtu (Senin + 5 hari)
export function getSaturdayOf(mondayStr) {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + 5);
  return localDateStr(d);
}

export function addWeeks(mondayStr, n) {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + n * 7);
  return localDateStr(d);
}

// ── Bonus & gross ──
export function fullWeekBonusAmt(role) { return role === "Helper" ? 75000 : 100000; }

// Total gross live (mirror kolom GENERATED di DB) → tampil tanpa nunggu reload.
export function computeGross(row) {
  return Number(row.days_worked || 0) * Number(row.daily_rate || 0)
    + (row.full_week_bonus ? fullWeekBonusAmt(row.role) : 0)
    - Number(row.late_days || 0) * 10000
    - Number(row.kasbon_deduct || 0)
    + Number(row.manual_bonus || 0);
}

// ── Kasbon ──
// Total kasbon terutang minggu ini = kasbon baru minggu ini + sisa kasbon minggu lalu (carryover).
export function kasbonOwed(row) {
  return Number(row.kasbon_total || 0) + Number(row.kasbon_carryover || 0);
}

// Sisa kasbon setelah dipotong minggu ini (di-carry ke minggu depan, tidak pernah negatif).
export function kasbonSisa(row) {
  return Math.max(0, kasbonOwed(row) - Number(row.kasbon_deduct || 0));
}
