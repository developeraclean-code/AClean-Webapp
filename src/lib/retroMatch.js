// retroMatchPayment — cari bukti bayar (payment_suggestions) yg cocok utk invoice yg
// baru di-approve (by phone, 7 hari). Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function retroMatchPayment(inv, {
  addAgentLog, normalizePhone, sendWA, setInvoicesData, supabase, userAccounts,
} = {}) {
    if (!inv.phone || !supabase) return;
    const norm = normalizePhone(inv.phone);
    if (!norm) return;

    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      // Cari semua payment_suggestions dari nomor ini, belum di-match ke invoice manapun, dalam 30 hari
      const { data: candidates, error } = await supabase
        .from("payment_suggestions")
        .select("id, amount, bank, transfer_date, image_url, source, created_at")
        .eq("phone", norm)
        .is("invoice_id", null)
        .eq("status", "PENDING")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error || !candidates?.length) return;

      // Ambil kandidat terbaik: yang paling baru
      const best = candidates[0];
      const now = new Date().toISOString();

      // Patch payment_suggestion → link ke invoice ini
      await supabase.from("payment_suggestions").update({
        invoice_id: inv.id,
        order_id: inv.job_id || null,
        matched_at: now,
        match_source: "retro",
      }).eq("id", best.id);

      // Patch invoice → simpan payment_proof_url jika ada foto
      if (best.image_url) {
        await supabase.from("invoices").update({
          payment_proof_url: best.image_url,
          updated_at: now,
        }).eq("id", inv.id);
        setInvoicesData(prev => prev.map(i =>
          i.id === inv.id ? { ...i, payment_proof_url: best.image_url } : i
        ));
      }

      // Cek selisih nominal
      const invTotal = Number(inv.total) || 0;
      const paidAmt  = Number(best.amount) || 0;
      const selisih  = Math.abs(invTotal - paidAmt);
      const toleransi = 10000; // Rp 10.000 toleransi pembulatan

      // Notif ke owner via WA
      const ownerAccs = (userAccounts || []).filter(u => u.role === "Owner" && u.phone);
      const tglBukti = best.transfer_date || best.created_at?.slice(0, 10) || "?";
      const tglInvoice = inv.date || inv.created_at?.slice(0, 10) || "?";

      if (paidAmt > 0 && selisih > toleransi) {
        // Nominal TIDAK sesuai — warning
        const warnMsg =
          `⚠️ *Bukti Bayar Ditemukan — Nominal Beda*\n` +
          `Invoice: ${inv.id}\n` +
          `Customer: ${inv.customer}\n` +
          `Tagihan: Rp${invTotal.toLocaleString("id-ID")}\n` +
          `Bukti Bayar: Rp${paidAmt.toLocaleString("id-ID")}\n` +
          `Selisih: Rp${selisih.toLocaleString("id-ID")}\n` +
          `Tgl Bukti: ${tglBukti} · Tgl Invoice: ${tglInvoice}\n` +
          (best.bank ? `Bank: ${best.bank}\n` : "") +
          `\n🔍 Cek manual di menu Invoice → ${inv.id}`;
        ownerAccs.forEach(u => sendWA(u.phone, warnMsg));
        addAgentLog("RETRO_MATCH_WARN", `Retro-match ${inv.id} ← ${best.id} | selisih Rp${selisih.toLocaleString("id-ID")}`, "WARNING");
      } else {
        // Nominal sesuai (atau tidak terbaca) — notif biasa
        const okMsg =
          `✅ *Bukti Bayar Otomatis Dicocokkan*\n` +
          `Invoice: ${inv.id}\n` +
          `Customer: ${inv.customer}\n` +
          (paidAmt > 0 ? `Nominal: Rp${paidAmt.toLocaleString("id-ID")}\n` : `Nominal: tidak terbaca dari bukti\n`) +
          `Tgl Bukti: ${tglBukti} · Tgl Invoice: ${tglInvoice}\n` +
          (best.bank ? `Bank: ${best.bank}\n` : "") +
          `\n📋 Cek & konfirmasi PAID di menu Invoice → ${inv.id}`;
        ownerAccs.forEach(u => sendWA(u.phone, okMsg));
        addAgentLog("RETRO_MATCH_OK", `Retro-match ${inv.id} ← ${best.id}${paidAmt > 0 ? " | Rp" + paidAmt.toLocaleString("id-ID") : " | nominal ?"}`, "SUCCESS");
      }
    } catch (e) {
      console.warn("[RETRO_MATCH] error:", e.message);
    }
}
