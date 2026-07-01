// mergedInvoiceWA — kirim invoice gabungan (PDF + link portal) via WA ke customer.
// Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function mergedInvoiceWA(invList, {
  addAgentLog, appSettings, currentUser, fmt, getPortalLink, samePhone, sendWA,
  showNotif, uploadMergedInvoicePDFForWA, writeInvoiceSendAudit,
} = {}) {
    if (!Array.isArray(invList) || invList.length < 2) {
      showNotif("⚠️ Pilih minimal 2 invoice untuk digabung");
      return { ok: false, error: "min" };
    }
    if (invList.length > 5) {
      showNotif("⚠️ Maksimal 5 invoice per gabungan");
      return { ok: false, error: "max" };
    }
    const phone = invList[0]?.phone;
    if (!phone) { showNotif("⚠️ No. HP customer tidak tersedia"); return { ok: false, error: "no_phone" }; }
    const allSamePhone = invList.every(i => samePhone(i.phone, phone));
    if (!allSamePhone) {
      showNotif("⚠️ Semua invoice harus dari customer/nomor yang sama");
      return { ok: false, error: "diff_customer" };
    }
    const sorted = [...invList].sort((a, b) =>
      new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
    const customer = sorted[0]?.customer || "";
    showNotif(`⏳ Menggabungkan ${sorted.length} invoice...`);
    const portalLink = await getPortalLink(phone, customer);
    const uploaded = await uploadMergedInvoicePDFForWA(sorted, portalLink);
    if (!uploaded) {
      showNotif("⚠️ Gagal upload PDF gabungan — fallback teks saja");
    }
    const totalAll = sorted.reduce((s, i) => s + (Number(i.total) || 0), 0);
    const sisaAll = sorted.reduce((s, i) => {
      const sisa = (i.status === "PAID") ? 0
        : (i.remaining_amount > 0 ? Number(i.remaining_amount) : Number(i.total) || 0);
      return s + sisa;
    }, 0);
    const lines = sorted.map((i, idx) => {
      const tgl = i.created_at ? new Date(i.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
      return `${idx + 1}. ${i.service || "Servis AC"} — 📅 ${tgl}`;
    }).join("\n");
    const portalLine = portalLink ? `\n\n🔗 Riwayat & invoice Anda:\n${portalLink}` : "";
    const tagihanLine = sisaAll > 0
      ? `💰 *Total Tagihan: ${fmt(sisaAll)}*${totalAll !== sisaAll ? ` _(dari ${fmt(totalAll)})_` : ""}`
      : `✅ *Semua sudah lunas — total ${fmt(totalAll)}*`;
    const msg = `Halo ${customer}, Terlampir tagihan gabungan untuk ${sorted.length} pekerjaan servis kami dalam 1 dokumen PDF:\n\n${lines}\n\n${tagihanLine}\n\nPembayaran ke:\n*${appSettings.bank_name || "BCA"} ${appSettings.bank_number || ""} a.n. ${appSettings.bank_holder || ""}*\n\nMohon kirimkan bukti transfer setelah pembayaran ya. Terima kasih! 🙏${portalLine}`;
    const sent = await sendWA(phone, msg, uploaded ? { url: uploaded.url, filename: uploaded.filename } : {});
    if (sent) {
      showNotif(`✅ ${sorted.length} invoice terkirim digabung ke ${customer}${uploaded ? " 📎" : ""}`);
      const ids = sorted.map(i => i.id);
      addAgentLog("INVOICE_MERGED_SEND",
        `${sorted.length} invoice digabung & dikirim ke ${customer} (${phone}) oleh ${currentUser?.name || "—"}: ${ids.join(", ")}`,
        "SUCCESS"
      );
      // Audit DB per-invoice
      await writeInvoiceSendAudit(ids, "merged", ids.join(","));
      return { ok: true };
    } else {
      showNotif(`⚠️ Gagal kirim WA ke ${customer} — cek koneksi Fonnte`);
      return { ok: false, error: "send_failed", retryContext: { invList: sorted } };
    }
}
