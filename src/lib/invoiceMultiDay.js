// Multi-day job invoice — pure logic (no React, no Supabase).
//
// Aturan bisnis (direvisi Owner 2026-06-14):
//  - 1 pekerjaan multi-hari = 1 invoice, di-anchor ke order INDUK (hari-1).
//  - Laporan harian BERIKUTNYA TIDAK membuat invoice baru DAN TIDAK menambah nilai
//    otomatis → aksi SKIP. Alasannya: SOP mewajibkan teknisi input ulang pekerjaan
//    aktual tiap hari, jadi laporan harian saling tumpang-tindih; akumulasi otomatis
//    akan SELALU dobel-hitung. Owner menentukan nilai final lewat edit manual.
//  - Jika invoice grup sudah LUNAS (PAID) → pekerjaan dianggap job baru → invoice terpisah.
//  - Selama belum PAID (PENDING_APPROVAL/APPROVED/UNPAID/dst) → SKIP (cukup ditautkan).
//
// Dipakai oleh submitLaporan() (App.jsx) & verifikasi di LaporanTimView.
// Lihat unit test di __tests__/invoiceMultiDay.test.js.

// Status invoice yang masih boleh menerima penggabungan (belum final/lunas).
export const MERGEABLE_STATUSES = [
  "PENDING_APPROVAL", "APPROVED", "UNPAID", "OVERDUE", "PARTIAL_PAID", "DRAFT", "SENT",
];

// Kunci project multi-hari yang stabil: parent_job_id (anak) atau id sendiri (induk).
// Mengembalikan null bila bukan laporan multi-hari.
export function multiDayProjectKey(report) {
  if (!report || report.is_multi_day !== true) return null;
  return report.parent_job_id || report.id;
}

// Tentukan aksi invoice untuk satu laporan.
// return {
//   type: 'CREATE' | 'SKIP' | 'CREATE_SEPARATE',
//   anchorJobId,   // job_id yang dipakai saat membuat invoice
//   projectKey,    // kunci grup multi-hari (null kalau non multi-hari)
//   existing,      // invoice grup yang ditemukan (untuk SKIP/CREATE_SEPARATE)
//   reason,
// }
export function resolveMultiDayInvoiceAction({ report, invoices }) {
  // Non multi-hari → selalu buat invoice biasa (anchor id order sendiri).
  if (!report || report.is_multi_day !== true) {
    return {
      type: "CREATE",
      anchorJobId: report ? report.id : null,
      projectKey: null, existing: null, reason: "not_multi_day",
    };
  }

  const projectKey = multiDayProjectKey(report);
  const list = Array.isArray(invoices) ? invoices : [];
  // Invoice grup = invoice non-CANCELLED dengan job_id = projectKey (terlama dulu = jangkar).
  const groupInvoices = list
    .filter(i => i && i.job_id === projectKey && String(i.status || "").toUpperCase() !== "CANCELLED")
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const existing = groupInvoices[0] || null;

  if (!existing) {
    // Belum ada invoice grup (hari-1, atau anak diverifikasi duluan) → buat, anchor ke induk.
    return { type: "CREATE", anchorJobId: projectKey, projectKey, existing: null, reason: "first_in_group" };
  }

  if (String(existing.status || "").toUpperCase() === "PAID") {
    // Invoice grup sudah lunas → job baru → invoice terpisah (anchor id order sendiri).
    return { type: "CREATE_SEPARATE", anchorJobId: report.id, projectKey, existing, reason: "group_paid" };
  }

  // Invoice grup masih aktif → JANGAN buat/tambah. Cukup tautkan; Owner edit manual.
  return { type: "SKIP", anchorJobId: projectKey, projectKey, existing, reason: "skip_existing_active" };
}

// Gabung baris detail secara IDEMPOTENT: baris dari sumber yang sama (source_job_id)
// di-replace, bukan ditambah dobel. Aman untuk re-submit laporan hari yang sama.
export function mergeInvoiceDetail(existingDetail, newRows, sourceJobId) {
  const base = Array.isArray(existingDetail) ? existingDetail : [];
  const incoming = Array.isArray(newRows) ? newRows : [];
  const kept = base.filter(r => r && r.source_job_id !== sourceJobId);
  const tagged = incoming.map(r => ({ ...r, source_job_id: sourceJobId }));
  return [...kept, ...tagged];
}

// Tandai tiap baris dengan source_job_id (untuk invoice grup hari-1 agar idempotent ke depan).
// Baris yang sudah punya source_job_id tidak ditimpa.
export function tagDetailSource(detail, sourceJobId) {
  const rows = Array.isArray(detail) ? detail : [];
  return rows.map(r => ({ ...r, source_job_id: (r && r.source_job_id != null) ? r.source_job_id : sourceJobId }));
}

// Hitung ulang labor/material/total dari gabungan detail.
// labor = baris berketerangan jasa/repair; material = sisanya (freon/material/barang).
const LABOR_KETERANGAN = new Set(["jasa", "repair"]);
export function recomputeInvoiceTotals(detail) {
  const rows = Array.isArray(detail) ? detail : [];
  let labor = 0, material = 0, total = 0;
  for (const r of rows) {
    const sub = Number(r && r.subtotal) || 0;
    total += sub;
    if (LABOR_KETERANGAN.has(String((r && r.keterangan) || "").toLowerCase())) labor += sub;
    else material += sub;
  }
  return { labor, material, total };
}
