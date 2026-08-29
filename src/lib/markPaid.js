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
      return;
    }
    if (!validatePositiveNumber(inv.total)) {
      showNotif("❌ Invoice total harus lebih dari 0");
      return;
    }
    if (!inv.customer || inv.customer.trim().length === 0) {
      showNotif("❌ Nama customer tidak valid");
      return;
    }

    const paidAt = getLocalISOString();
    // H-04: Simpan status original untuk rollback jika DB gagal
    const originalInvStatus = inv.status;
    const originalOrderStatus = ordersData.find(o => o.id === inv.job_id || o.invoice_id === inv.id)?.status;

    setInvoicesData(prev => prev.map(i =>
      i.id === inv.id ? { ...i, status: "PAID", paid_at: paidAt, ...(paymentProofUrl ? { payment_proof_url: paymentProofUrl } : {}) } : i
    ));
    // 1 order = 1 invoice (termasuk multi-hari, kebijakan Owner 11 Agu 2026): pelunasan
    // HANYA menyentuh order pemilik invoice ini. Dulu status PAID ikut di-propagate ke
    // semua child multi-hari karena 1 invoice induk mewakili seluruh hari — sekarang tiap
    // hari ditagih terpisah, jadi propagasi itu akan menandai hari lain lunas padahal
    // invoice-nya sendiri belum dibayar. Bayar sekaligus → pakai Group Payment.
    setOrdersData(prev => prev.map(o =>
      (o.id === inv.job_id || o.invoice_id === inv.id) ? { ...o, status: "PAID" } : o
    ));
    await setAuditUser();
    {
      const { error: mpErr } = await markInvoicePaid(supabase, inv.id, paidAt, auditUserName());
      if (mpErr) {
        // Guard errors dari markInvoicePaid (status conflict/race condition) — jangan fallback
        const isGuardError = mpErr.message?.includes("sudah") || mpErr.message?.includes("tidak ditemukan");
        if (isGuardError) {
          setInvoicesData(prev => prev.map(i =>
            i.id === inv.id ? { ...i, status: originalInvStatus, paid_at: inv.paid_at || null } : i
          ));
          if (originalOrderStatus) {
            setOrdersData(prev => prev.map(o =>
              (o.id === inv.job_id || o.invoice_id === inv.id) ? { ...o, status: originalOrderStatus } : o
            ));
          }
          showNotif(`❌ ${mpErr.message}`);
          return;
        }
        console.warn("mark paid with paid_at failed, trying fallback:", mpErr.message);
        const { error: fbErr } = await updateInvoice(supabase, inv.id, { status: "PAID" }, auditUserName());
        if (fbErr) {
          // H-04: Rollback state jika semua DB update gagal
          reportError("invoice.markPaid.dbFailed", fbErr, { invoiceId: inv.id, jobId: inv.job_id });
          setInvoicesData(prev => prev.map(i =>
            i.id === inv.id ? { ...i, status: originalInvStatus, paid_at: inv.paid_at || null } : i
          ));
          if (originalOrderStatus) {
            setOrdersData(prev => prev.map(o =>
              (o.id === inv.job_id || o.invoice_id === inv.id) ? { ...o, status: originalOrderStatus } : o
            ));
          }
          showNotif("❌ Gagal simpan ke database. Status dikembalikan. Coba lagi.");
          return;
        }
      }
    }
    // Sync order status ke DB — React state sudah update di atas, tapi DB perlu diupdate juga
    if (inv.job_id) {
      supabase.from("orders").update({ status: "PAID" }).eq("id", inv.job_id).then(() => {});
    }
    // Juga update order yang dilink via invoice_id (edge case AC unit sale)
    supabase.from("orders").update({ status: "PAID" }).eq("invoice_id", inv.id).then(() => {});
    // Simpan bukti bayar URL ke invoice jika ada (dari WA payment detection)
    if (paymentProofUrl) {
      supabase.from("invoices").update({ payment_proof_url: paymentProofUrl }).eq("id", inv.id).then(() => {});
    }

    // Notif WA ke customer — hanya jika admin/owner menyetujui (sendCustNotif=true)
    const shouldNotif = sendCustNotif === true ||
      (sendCustNotif === null && await showConfirm({
        icon: "📱", title: "Kirim Notif WA?",
        message: "Kirim konfirmasi WA ke customer? " + inv.customer + " Rp " + (inv.total || 0).toLocaleString("id-ID"),
        confirmText: "Kirim WA"
      }));
    if (shouldNotif && inv.phone) {
      sendWA(inv.phone,
        "Pembayaran " + inv.id + " Rp " + (inv.total || 0).toLocaleString("id-ID") + " diterima. Terima kasih! — " + (appSettings.app_name || "AClean")
      );
    }
    // GAP 1.6: Catat ke payments table untuk history + partial payment support
    // amount = sisa yang dibayar (total - paid_amount sebelumnya), bukan total — hindari double-count saat ada DP
    {
      const sisaDibayar = (inv.total || 0) - (Number(inv.paid_amount) || 0);
      const { error: pmtErr } = await supabase.from("payments").insert({
        invoice_id: inv.id,
        amount: sisaDibayar > 0 ? sisaDibayar : (inv.total || 0),
        method: method,
        notes: notes || "Lunas",
        paid_at: paidAt,
      });
      if (pmtErr?.code === "23505" && pmtErr?.message?.includes("payment_proof")) {
        showNotif("⚠️ Bukti pembayaran ini sudah pernah digunakan. Cek invoice yang terkait.");
        return;
      }
      if (pmtErr) console.warn("payments insert skip:", pmtErr?.message);
    }
    // Update customer last_service
    if (inv.phone) await supabase.from("customers").update({ last_service: paidAt.slice(0, 10) }).eq("phone", inv.phone);
    addAgentLog("PAYMENT_CONFIRMED", `Invoice ${inv.id} LUNAS — ${inv.customer} ${fmt(inv.total)} via ${method}`, "SUCCESS");
    showNotif(`💰 Invoice ${inv.id} LUNAS — ${fmt(inv.total)}`);
    // Retro-match: cari bukti bayar yang belum ter-link jika belum ada proof dari parameter
    if (!paymentProofUrl) {
      retroMatchPayment({ ...inv, status: "PAID" }).catch(e => console.warn("[RETRO_MATCH] markPaid error:", e.message));
    }
    // Tutup sisa bukti PENDING milik invoice ini. Perlu terpisah dari retro-match karena
    // retro-match DILEWATI saat buktinya sudah ditempel duluan oleh webhook — persis jalur
    // paling sering, dan itu yang membuat antrean menumpuk. Syaratnya ketat (HP + nominal),
    // best-effort, dan tidak pernah menghapus baris.
    closeSuggestionsForInvoice(inv, {
      supabase, samePhone, actorName: auditUserName ? auditUserName() : "Sistem",
    }).then(n => {
      if (n > 0) addAgentLog("PAYMENT_SUGGESTION_CLOSED", `Invoice ${inv.id} lunas — ${n} bukti bayar pending ditutup`, "INFO");
    }).catch(() => {});
}
