// approveKasbon + rejectKasbon — proses persetujuan/penolakan kasbon (uang) teknisi/
// helper. Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function approveKasbon(req, reviewNotes = "", {
  addAgentLog, appSettings, auditUserName, currentUser, insertExpense, sendWA,
  setExpensesData, setKasbonRequests, showNotif, supabase, updateKasbonRequest,
} = {}) {
    // ATOMIC CLAIM: update status hanya jika MASIH PENDING (.eq status filter).
    // PostgREST/Postgres update bersifat atomic per-row → hanya 1 caller konkuren yang
    // dapat baris (rows.length===1); caller kedua dapat 0 baris → skip, cegah double-expense.
    const { data: claimed, error: claimErr } = await supabase
      .from("kasbon_requests")
      .update({
        status: "APPROVED",
        reviewed_at: new Date().toISOString(),
        reviewed_by: currentUser?.name || auditUserName(),
        review_notes: reviewNotes || null,
      })
      .eq("id", req.id)
      .eq("status", "PENDING")
      .select();
    if (claimErr) { showNotif("❌ Gagal proses kasbon: " + claimErr.message); return; }
    if (!claimed || claimed.length === 0) {
      showNotif("⚠️ Kasbon ini sudah diproses sebelumnya");
      return;
    }

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
    // Tanggal Biaya = tanggal REQUEST kasbon (bukan tanggal approve) agar tidak geser kalau
    // approve-nya telat (mis. request sore, baru di-ACC besok pagi). Fallback ke hari ini.
    const kasbonDate = (req.requested_at || req.created_at)
      ? new Date(req.requested_at || req.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" })
      : today;
    // dedup_key cross-channel (migrasi 094): kasbon yang sama bisa masuk dari WA Finance
    // grup (jalur wa_group_kasbon di api/[route].js juga isi dedup_key) DAN dari approve di
    // app ini. Tanpa key yang identik, unique index expenses.dedup_key tak bisa nangkep →
    // double. Format WAJIB sama persis dengan buildExpenseDedupKey() di api/_expense-dedup.js:
    // `${lower(name)}|${date}|${amount}|${lower(subcategory)}`.
    const kasbonDedupKey = (() => {
      const name = String(req.teknisi_name || "").trim().toLowerCase();
      const amt = Number(req.amount);
      if (!name || !amt || !kasbonDate) return null;
      return `${name}|${kasbonDate}|${amt}|kasbon karyawan`;
    })();
    // id expenses dibiarkan default (UUID gen_random_uuid) — jangan kirim id custom (kolom UUID).
    const expPayload = {
      category: "petty_cash",
      subcategory: "Kasbon Karyawan",
      teknisi_name: (req.teknisi_name || "").trim(),
      amount: req.amount,
      date: kasbonDate,
      description: "Kasbon: " + (req.reason || ""),
      validation_status: "APPROVED",
      last_changed_by: auditUserName(),
      dedup_key: kasbonDedupKey,
    };
    const { data: expData, error: eErr } = await insertExpense(supabase, expPayload);
    if (eErr) {
      // 23505 = unique violation di expenses.dedup_key → kasbon yang sama SUDAH tercatat
      // via WA Finance grup. Ini BUKAN kegagalan: link ke expense yang ada, biarkan status
      // APPROVED (klaim atomic sudah jalan), JANGAN rollback ke PENDING & JANGAN gandakan.
      if (eErr.code === "23505" || /duplicate key|dedup_key/i.test(eErr.message || "")) {
        let existingId = null;
        if (kasbonDedupKey) {
          const { data: ex } = await supabase
            .from("expenses").select("id")
            .eq("dedup_key", kasbonDedupKey).is("deleted_at", null)
            .limit(1).maybeSingle();
          existingId = ex?.id || null;
        }
        if (existingId) await updateKasbonRequest(supabase, req.id, { expense_id: existingId });
        setKasbonRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "APPROVED", expense_id: existingId, reviewed_by: currentUser?.name } : r));
        if (req.teknisi_phone) sendWA(req.teknisi_phone, `✅ *Kasbon Disetujui*\n\nHalo ${req.teknisi_name},\nRequest kasbon Rp ${Number(req.amount).toLocaleString("id-ID")} sudah disetujui oleh ${currentUser?.name || "Admin"}.\n\nKeperluan: ${req.reason}\n${reviewNotes ? "Catatan: " + reviewNotes + "\n" : ""}\n— ${appSettings?.app_name || "AClean"}`);
        addAgentLog("KASBON_APPROVED", `Kasbon ${req.id} (${req.teknisi_name} Rp${Number(req.amount).toLocaleString("id-ID")}) diapprove — biaya sudah tercatat via WA grup (dedup, tidak digandakan) → expense ${existingId || "?"}`, "SUCCESS");
        showNotif(`✅ Kasbon ${req.teknisi_name} diapprove (biaya sudah tercatat via WA grup, tidak digandakan)`);
        return;
      }
      // Error lain → rollback klaim ke PENDING agar bisa diproses ulang.
      await supabase.from("kasbon_requests").update({ status: "PENDING", reviewed_at: null, reviewed_by: null, review_notes: null }).eq("id", req.id);
      showNotif("❌ Gagal catat ke Biaya: " + eErr.message);
      return;
    }
    const expId = expData?.id;  // UUID hasil generate DB
    setExpensesData(prev => [expData || expPayload, ...prev]);

    // Link expense_id ke request yang sudah diklaim
    await updateKasbonRequest(supabase, req.id, { expense_id: expId });
    setKasbonRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "APPROVED", expense_id: expId, reviewed_by: currentUser?.name } : r));

    // WA notif ke teknisi
    if (req.teknisi_phone) sendWA(req.teknisi_phone, `✅ *Kasbon Disetujui*\n\nHalo ${req.teknisi_name},\nRequest kasbon Rp ${Number(req.amount).toLocaleString("id-ID")} sudah disetujui oleh ${currentUser?.name || "Admin"}.\n\nKeperluan: ${req.reason}\n${reviewNotes ? "Catatan: " + reviewNotes + "\n" : ""}\n— ${appSettings?.app_name || "AClean"}`);
    addAgentLog("KASBON_APPROVED", `Kasbon ${req.id} (${req.teknisi_name} Rp${Number(req.amount).toLocaleString("id-ID")}) diapprove → expense ${expId}`, "SUCCESS");
    showNotif(`✅ Kasbon ${req.teknisi_name} Rp${Number(req.amount).toLocaleString("id-ID")} diapprove & dicatat ke Biaya`);
}

export async function rejectKasbon(req, reviewNotes = "", {
  addAgentLog, appSettings, auditUserName, currentUser, sendWA, setKasbonRequests,
  showNotif, supabase, updateKasbonRequest,
} = {}) {
    await updateKasbonRequest(supabase, req.id, {
      status: "REJECTED",
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentUser?.name || auditUserName(),
      review_notes: reviewNotes || null,
    });
    setKasbonRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "REJECTED", reviewed_by: currentUser?.name } : r));
    if (req.teknisi_phone) sendWA(req.teknisi_phone, `❌ *Kasbon Ditolak*\n\nHalo ${req.teknisi_name},\nRequest kasbon Rp ${Number(req.amount).toLocaleString("id-ID")} ditolak oleh ${currentUser?.name || "Admin"}.\n\nKeperluan: ${req.reason}\n${reviewNotes ? "Alasan: " + reviewNotes + "\n" : ""}\n— ${appSettings?.app_name || "AClean"}`);
    addAgentLog("KASBON_REJECTED", `Kasbon ${req.id} (${req.teknisi_name}) ditolak`, "INFO");
    showNotif(`✅ Kasbon ${req.teknisi_name} ditolak`);
}
