// retroMatchPayment — cari bukti bayar (payment_suggestions) yg cocok utk invoice yg
// baru di-approve (by phone, 7 hari). Diekstrak dari App.jsx (Fase 3, pola ctx).
import { findNearPhoneSuggestion } from "./phoneFuzzy.js";

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

      if (error) return;

      // Kandidat terbaik: yang paling baru dari nomor yang SAMA PERSIS.
      let best = candidates?.[0] || null;
      let fuzzy = false;

      // Jaring ke-2: nomor customer di DB salah 1 digit (kasus Bapak Ricky,
      // 22 Agu 2026). Exact match tidak akan pernah ketemu, jadi cari lewat
      // nominal yang sama persis lalu saring dgn toleransi 1 digit. Kalau
      // kandidatnya tidak tepat satu, menyerah — biar Owner cocokkan manual.
      if (!best) {
        const { data: nearCands } = await supabase
          .from("payment_suggestions")
          .select("id, phone, amount, bank, transfer_date, image_url, source, created_at")
          .is("invoice_id", null)
          .eq("status", "PENDING")
          .eq("amount", Number(inv.total) || 0)
          .gte("created_at", cutoff)
          .limit(20);
        const near = findNearPhoneSuggestion(norm, nearCands || [], inv.total);
        if (near) { best = near; fuzzy = true; }
      }

      if (!best) return;
      const now = new Date().toISOString();

      // Patch payment_suggestion → link ke invoice ini
      await supabase.from("payment_suggestions").update({
        invoice_id: inv.id,
        order_id: inv.job_id || null,
        matched_at: now,
        match_source: fuzzy ? "retro_fuzzy_1digit" : "retro",
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
      const fuzzyNote = fuzzy
        ? `\n⚠️ *Dicocokkan lewat toleransi 1 digit*\nNomor invoice ${norm} vs nomor pengirim ${best.phone} — beda 1 digit, nominal sama persis.\nMohon betulkan nomor customer setelah verifikasi.\n`
        : "";

      const invTotal = Number(inv.total) || 0;
      const paidAmt  = Number(best.amount) || 0;
      const selisih  = Math.abs(invTotal - paidAmt);
      const toleransi = 10000; // Rp 10.000 toleransi pembulatan

      // Notif ke owner via WA
      const ownerAccs = (userAccounts || []).filter(u => u.role === "Owner" && u.phone && u.active !== false);
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
          fuzzyNote +
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
          fuzzyNote +
          `\n📋 Cek & konfirmasi PAID di menu Invoice → ${inv.id}`;
        ownerAccs.forEach(u => sendWA(u.phone, okMsg));
        addAgentLog(fuzzy ? "RETRO_MATCH_FUZZY" : "RETRO_MATCH_OK", `Retro-match ${inv.id} ← ${best.id}${paidAmt > 0 ? " | Rp" + paidAmt.toLocaleString("id-ID") : " | nominal ?"}${fuzzy ? " | toleransi 1 digit (" + norm + " vs " + best.phone + ")" : ""}`, fuzzy ? "WARNING" : "SUCCESS");
      }
    } catch (e) {
      console.warn("[RETRO_MATCH] error:", e.message);
    }
}
