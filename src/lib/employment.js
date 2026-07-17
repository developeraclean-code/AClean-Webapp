// Status kepegawaian & masa kerja teknisi/helper.
// SENGAJA tanpa kolom DB: status diturunkan MURNI dari user_profiles.work_start_date,
// jadi tak ada dua sumber kebenaran yang bisa divergen (status tersimpan vs tanggal).
// Catatan: `joined` BUKAN tanggal mulai kerja — itu tanggal record dibuat di app
// (mayoritas Mar 2026 saat onboarding app), sedangkan work_start_date tanggal asli.
// Fungsi murni: tanpa efek samping, `now` bisa di-inject untuk test.

// Ambang masa percobaan (bulan penuh sejak mulai kerja).
export const PROBATION_MONTHS = 3;

// Selisih bulan PENUH dari tanggal mulai sampai `now`. null bila tanggal kosong/invalid.
export function tenureMonths(workStartDate, now = new Date()) {
  if (!workStartDate) return null;
  const start = new Date(workStartDate + "T00:00:00");
  if (isNaN(start.getTime())) return null;
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  return months < 0 ? 0 : months;
}

// "8 tahun 3 bulan" / "Baru bergabung". null bila tanggal kosong → caller tampilkan fallback.
export function fmtTenure(workStartDate, now = new Date()) {
  const months = tenureMonths(workStartDate, now);
  if (months == null) return null;
  const y = Math.floor(months / 12), m = months % 12;
  if (y === 0 && m === 0) return "Baru bergabung";
  return [y > 0 ? `${y} tahun` : "", m > 0 ? `${m} bulan` : ""].filter(Boolean).join(" ");
}

// Status kepegawaian otomatis dari masa kerja.
// Tanggal kosong → UNKNOWN (jangan tebak: Owner isi dulu tanggal mulainya).
export function employmentStatus(workStartDate, now = new Date()) {
  const months = tenureMonths(workStartDate, now);
  if (months == null) return { key: "UNKNOWN", label: "Tgl mulai belum diisi", color: "#94a3b8" };
  if (months < PROBATION_MONTHS) return { key: "PROBATION", label: "Masa Percobaan", color: "#f59e0b" };
  return { key: "PERMANENT", label: "Karyawan Tetap", color: "#22c55e" };
}
