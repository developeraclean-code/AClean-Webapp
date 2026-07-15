// Status warna & label — dipakai di Orders, Invoices, Dashboard.
// Order statuses + Invoice statuses digabung (tidak overlap).
export const statusColor = {
  PENDING: "#64748b", CONFIRMED: "#f59e0b", DISPATCHED: "#06b6d4",
  ON_SITE: "#8b5cf6", WORKING: "#a78bfa", REPORT_SUBMITTED: "#10b981",
  INVOICE_CREATED: "#3b82f6", INVOICE_APPROVED: "#6366f1",
  PAID: "#22c55e", COMPLETED: "#22c55e", CANCELLED: "#ef4444", RESCHEDULED: "#f97316",
  IN_PROGRESS: "#38bdf8",
  CONTINUED: "#f97316",
  UNPAID: "#f59e0b", OVERDUE: "#ef4444", PENDING_APPROVAL: "#a78bfa", PARTIAL: "#06b6d4",
};

export const statusLabel = {
  PENDING: "Pending", CONFIRMED: "Dikonfirmasi", DISPATCHED: "Dikirim",
  ON_SITE: "Di Lokasi", WORKING: "Sedang Kerja", REPORT_SUBMITTED: "Laporan Masuk",
  INVOICE_CREATED: "Invoice Dibuat", INVOICE_APPROVED: "Invoice Dikirim",
  PAID: "Lunas", COMPLETED: "Selesai", CANCELLED: "Dibatalkan", RESCHEDULED: "Dijadwal Ulang",
  IN_PROGRESS: "Sedang Dikerjakan",
  CONTINUED: "Lanjut Besok",
  UNPAID: "Belum Bayar", OVERDUE: "Terlambat", PENDING_APPROVAL: "Menunggu Approve", PARTIAL: "Bayar Sebagian",
};

// Order dianggap "selesai" (dipakai rekap/stats) — SATU sumber kebenaran.
// Verifikasi live DB (15 Jul 2026): orders.status TIDAK PERNAH bernilai "VERIFIED"
// (itu status service_reports, tabel berbeda) — PAID mayoritas mutlak (~87% order).
// Definisi lama yang tercecer di beberapa file kehilangan INVOICE_APPROVED/
// INVOICE_CREATED/PAID → rekap harian undercount order selesai.
export const ORDER_DONE_STATUSES = ["COMPLETED", "REPORT_SUBMITTED", "INVOICE_APPROVED", "INVOICE_CREATED", "PAID"];

// Invoice yang masih perlu ditagih (belum lunas, termasuk cicilan berjalan) —
// SATU sumber kebenaran untuk set 3-status ini (bukan varian 2-status "UNPAID/OVERDUE"
// yang sengaja mengecualikan PARTIAL_PAID di beberapa perhitungan total sisa tagihan).
export const INVOICE_UNPAID_STATUSES = ["UNPAID", "OVERDUE", "PARTIAL_PAID"];
