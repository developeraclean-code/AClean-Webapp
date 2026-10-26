// markPaid — tandai invoice LUNAS (update DB + orders.status=PAID + log bayar +
// notif customer + retro-match bukti bayar). Diekstrak dari App.jsx (Fase 2, pola
// ctx). ctx = param ke-6 (setelah arg posisi bawaan). Body verbatim (behavior sama).
import { closeSuggestionsForInvoice } from "./paymentSuggestionClose.js";
import { samePhone } from "./phone.js";

export async function markPaid(inv, method = "transfer", notes = "", sendCustNotif = null, paymentProofUrl = null, {
  addAgentLog, appSettings, auditUserName, fmt, getLocalISOString, markInvoicePaid,
  ordersData, reportError, retroMatchPayment, sendWA, setAuditUser, setInvoicesData,
  setOrdersData, showConfirm, showNotif, supabase, updateInvoice, validatePositiveNumber,
} = {}) {
    // Input validation
    if (!inv.id || inv.id.trim().length === 0) {
      showNotif("❌ Invoice ID tidak valid");
      return { ok: false };
    }
    if (!validatePositiveNumber(inv.total)) {
      showNotif("❌ Invoice total harus lebih dari 0");
      return { ok: false };
    }
    if (!inv.customer || inv.customer.trim().length === 0) {
      showNotif("❌ Nama customer tidak valid");
      return { ok: false };
    }

    const paidAt = getLocalISOString();
    await setAuditUser();
    {
      const paymentId = globalThis.crypto?.randomUUID?.();
      const { data: savedInvoice, error: mpErr } = await markInvoicePaid(supabase, inv.id, paidAt, auditUserName(), {
        paymentId,
        method,
        notes: notes || "Lunas",
        paymentProofUrl,
        mutationKey: paymentId ? `invoice-settle:${paymentId}` : undefined,
      });
      if (mpErr) {
        // Jangan pernah menembus guard atomik dengan update langsung. markInvoicePaid
        // sendiri hanya memakai jalur legacy bila RPC belum terpasang; semua error lain
        // wajib menghentikan pelunasan agar double-click/race tidak mencatat dua kali.
        reportError("invoice.markPaid.dbFailed", mpErr, { invoiceId: inv.id, jobId: inv.job_id });
        showNotif(`❌ Pelunasan dibatalkan: ${mpErr.message || "gagal menyimpan ke database"}`);
        return { ok: false, error: mpErr };
      }
      setInvoicesData(prev => prev.map(i => i.id === inv.id
        ? { ...i, status: "PAID", paid_at: paidAt, paid_amount: Number(i.total) || 0,
            remaining_amount: 0, paid_method: method,
            ...(paymentProofUrl ? { payment_proof_url: paymentProofUrl } : {}),
            ...(savedInvoice && typeof savedInvoice === "object" ? savedInvoice : {}) }
        : i));
      // 1 order = 1 invoice; pelunasan hanya menyentuh order pemilik invoice ini.
      setOrdersData(prev => prev.map(o =>
        (o.id === inv.job_id || o.invoice_id === inv.id) ? { ...o, status: "PAID" } : o
      ));
    }

    // Notif WA ke customer — hanya jika admin/owner menyetujui (sendCustNotif=true)
    const shouldNotif = sendCustNotif === true ||
      (sendCustNotif === null && await showConfirm({
        icon: "📱", title: "Kirim Notif WA?",
        message: "Kirim konfirmasi WA ke customer? " + inv.customer + " Rp " + (inv.total || 0).toLocaleString("id-ID"),
        confirmText: "Kirim WA"
      }));
    if (shouldNotif && inv.phone) {
      // Pelunasan sudah tersimpan. Kegagalan notifikasi tidak boleh membatalkan
      // transaksi, tetapi harus terlihat agar dapat dikirim ulang manual.
      Promise.resolve().then(() => sendWA(inv.phone,
        "Pembayaran " + inv.id + " Rp " + (inv.total || 0).toLocaleString("id-ID") + " diterima. Terima kasih! — " + (appSettings.app_name || "AClean")
      )).then(sent => {
        if (sent) return;
        reportError("invoice.markPaid.customerWaFailed", new Error("Notifikasi WA tidak terkirim"), { invoiceId: inv.id });
        showNotif(`⚠️ Invoice ${inv.id} lunas, tetapi notifikasi WA belum terkirim. Kirim ulang manual.`);
      }).catch(error => {
        reportError("invoice.markPaid.customerWaFailed", error, { invoiceId: inv.id });
        showNotif(`⚠️ Invoice ${inv.id} lunas, tetapi notifikasi WA belum terkirim. Kirim ulang manual.`);
      });
    }
    addAgentLog("PAYMENT_CONFIRMED", `Invoice ${inv.id} LUNAS — ${inv.customer} ${fmt(inv.total)} via ${method}`, "SUCCESS");
    showNotif(`💰 Invoice ${inv.id} LUNAS — ${fmt(inv.total)}`);
    // Retro-match: cari bukti bayar yang belum ter-link jika belum ada proof dari parameter
    if (!paymentProofUrl) {
      Promise.resolve().then(() => retroMatchPayment({ ...inv, status: "PAID" })).catch(error => {
        reportError("invoice.markPaid.retroMatchFailed", error, { invoiceId: inv.id });
        showNotif(`⚠️ Invoice ${inv.id} lunas, tetapi pencocokan bukti otomatis gagal. Periksa Pending AI.`);
      });
    }
    // Tutup sisa bukti PENDING milik invoice ini. Perlu terpisah dari retro-match karena
    // retro-match DILEWATI saat buktinya sudah ditempel duluan oleh webhook — persis jalur
    // paling sering, dan itu yang membuat antrean menumpuk. Syaratnya ketat (HP + nominal),
    // best-effort, dan tidak pernah menghapus baris.
    closeSuggestionsForInvoice(inv, {
      supabase, samePhone, actorName: auditUserName ? auditUserName() : "Sistem",
    }).then(n => {
      if (n > 0) addAgentLog("PAYMENT_SUGGESTION_CLOSED", `Invoice ${inv.id} lunas — ${n} bukti bayar pending ditutup`, "INFO");
    }).catch(error => {
      reportError("invoice.markPaid.closeSuggestionsFailed", error, { invoiceId: inv.id });
      showNotif(`⚠️ Invoice ${inv.id} lunas, tetapi bukti Pending AI belum direkonsiliasi. Periksa manual.`);
    });
    return { ok: true };
}
