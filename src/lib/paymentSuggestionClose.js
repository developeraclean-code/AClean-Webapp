// Penutupan baris payment_suggestions saat invoice ditandai LUNAS.
//
// MASALAH (audit 29 Agu 2026): 341 baris menumpuk berstatus PENDING, tertua 22 April.
// Dua sebabnya:
//   1. retroMatchPayment() menautkan suggestion ke invoice (mengisi invoice_id/matched_at)
//      tapi TIDAK PERNAH mengubah `status` — barisnya tetap PENDING walau sudah cocok.
//   2. Kalau bukti sudah ditempel otomatis oleh webhook, markPaid() melewati retro-match
//      sama sekali, jadi tidak ada yang menutup barisnya.
// Akibatnya antrean tinjauan jadi 96% sampah dan bukti baru tenggelam di dalamnya.
//
// ATURAN KETAT YANG DISENGAJA — nomor HP saja TIDAK CUKUP:
// satu customer bisa punya beberapa invoice belum lunas (mis. IBU MARISKA punya 1 invoice
// sekaligus keluhan berjalan). Menutup hanya berdasar nomor HP berisiko menutup bukti milik
// invoice LAIN, dan bukti itu hilang dari antrean tanpa pernah ditinjau. Karena itu penutupan
// mensyaratkan nominal cocok dalam toleransi kecil.
//
// Penutupan TIDAK PERNAH menghapus baris: hanya set status CONFIRMED + isi invoice_id +
// match_source, supaya tetap bisa ditelusuri dan dibalik kalau salah.

// Toleransi selisih nominal (rupiah). Kecil saja — biaya admin transfer antarbank
// biasanya di bawah ini, tapi tidak cukup lebar untuk menyamakan dua invoice berbeda.
export const CLOSE_AMOUNT_TOLERANCE = 1000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Pilih baris suggestion yang BOLEH ditutup untuk sebuah invoice.
 *
 * Syarat (semua harus terpenuhi):
 *   - masih PENDING;
 *   - belum tertaut invoice lain (invoice_id kosong, atau sudah menunjuk invoice ini);
 *   - nomor HP sama persis (pencocokan fuzzy diserahkan ke retroMatchPayment yang
 *     punya penjaga tersendiri — di sini sengaja konservatif);
 *   - nominal cocok dalam CLOSE_AMOUNT_TOLERANCE.
 *
 * Return array (bisa lebih dari satu kalau customer mengirim bukti berulang kali
 * untuk nominal yang sama — semuanya memang layak ditutup oleh invoice ini).
 */
export function pickSuggestionsToClose(invoice, suggestions = [], samePhoneFn) {
  const total = num(invoice?.total);
  if (!invoice?.id || !invoice?.phone || total <= 0) return [];

  const cocokHp = typeof samePhoneFn === "function"
    ? (a, b) => samePhoneFn(a, b)
    : (a, b) => String(a || "") === String(b || "");

  return (suggestions || []).filter(s => {
    if (!s || s.status !== "PENDING") return false;
    if (s.invoice_id && s.invoice_id !== invoice.id) return false;
    if (!cocokHp(s.phone, invoice.phone)) return false;
    const amt = num(s.amount);
    if (amt <= 0) return false;
    return Math.abs(amt - total) <= CLOSE_AMOUNT_TOLERANCE;
  });
}

/**
 * Tutup suggestion yang cocok untuk invoice ini. Best-effort: kegagalan di sini tidak
 * boleh menggagalkan pencatatan lunas yang sudah berhasil.
 * Return jumlah baris yang ditutup.
 */
export async function closeSuggestionsForInvoice(invoice, {
  supabase, samePhone, actorName = "Sistem", matchSource = "auto_on_paid",
} = {}) {
  if (!supabase || !invoice?.id || !invoice?.phone) return 0;
  try {
    // Ambil kandidat dari DB (bukan dari state global yang di-cap 20 baris) supaya
    // bukti lama tetap terjangkau.
    const { data, error } = await supabase
      .from("payment_suggestions")
      .select("id, phone, amount, status, invoice_id")
      .eq("status", "PENDING")
      .limit(500);
    if (error || !Array.isArray(data)) return 0;

    const kena = pickSuggestionsToClose(invoice, data, samePhone);
    if (kena.length === 0) return 0;

    const now = new Date().toISOString();
    const { error: updErr } = await supabase.from("payment_suggestions").update({
      status: "CONFIRMED",
      invoice_id: invoice.id,
      order_id: invoice.job_id || null,
      matched_at: now,
      match_source: matchSource,
      resolved_at: now,
      resolved_by: actorName,
    }).in("id", kena.map(k => k.id));
    if (updErr) return 0;
    return kena.length;
  } catch (_) {
    return 0;
  }
}
