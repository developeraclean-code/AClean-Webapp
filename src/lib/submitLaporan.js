// submitLaporan — proses submit laporan teknisi: hitung & buat invoice (labor+
// material+jasa), potong stok, link multi-hari/project, seed registry AC, update
// order & state. Diekstrak dari App.jsx (Fase 3, pola ctx). 67 dependency via ctx.
// Body verbatim (behavior-preserving). JALUR UANG — test ketat.
export async function submitLaporan({
  INSTALL_ITEMS, _apiHeaders, addAgentLog, appSettings, auditUserName, buildInvoiceDetail,
  checkInvoiceConsistency, classifyMaterial, currentUser, customersData, deductInventory,
  deleteInvoice, describeInconsistency, fmt, hargaPerUnitFromTipe, hitungLabor,
  hitungMaterialTotal, insertInvoice, inventoryData, invoicesData, isTrackedByCode,
  isTrackedByName, isUnitDone, laporanBarangItems, laporanCatatan, laporanCleaningInRepair,
  laporanFotos, laporanInstallItems, laporanJasaItems, laporanMaterials, laporanModal,
  laporanRekomendasi, laporanRepairItems, laporanRepairType, laporanSurveyCatatan,
  laporanSurveyHasil, laporanUnits, lookupHargaGlobal, multiDayProjectKey, normalizeLines,
  normalizePhone, ordersData, priceListData, pushNotif, quotationsData,
  refreshMaterialsBroughtMap, reportError, resolveMultiDayInvoiceAction, safeArr,
  seedAcRegistry, sendWA, setInvoicesData, setLaporanModal, setLaporanReports,
  setLaporanSubmitted, setOrdersData, setQuotationsData, setTeknisiData, showConfirm,
  showNotif, submitLaporanLock, summarize, supabase, syncTrackedStock, teknisiData,
  updateOrderStatus, userAccounts,
}) {
    if (submitLaporanLock.current) { showNotif("⏳ Sedang submit, harap tunggu..."); return; }
    submitLaporanLock.current = true;
    try {
    // ── 1. Definisikan isInstall PERTAMA sebelum digunakan ──
    const isInstall = laporanModal?.service === "Install";
    const isSurvey = laporanModal?.service === "Survey";
    const incompleteUnits = laporanUnits.filter(u => !isUnitDone(u));

    // ── Survey: submit langsung, bypass 4-step wizard ──
    if (isSurvey) {
      if (!laporanSurveyHasil.trim()) {
        showNotif("⚠️ Hasil Survey wajib diisi");
        submitLaporanLock.current = false;
        return;
      }
      const now = new Date().toLocaleString("id-ID", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const reportId = "LPR_" + laporanModal.id + "_" + Date.now().toString(36).slice(-4).toUpperCase();
      const surveyFotoUrls = laporanFotos.filter(f => f.url).map(f => f.url);
      const surveyReport = {
        id: reportId, job_id: laporanModal.id, teknisi: laporanModal.teknisi,
        helper: laporanModal.helper || null, customer: laporanModal.customer,
        service: "Survey", date: laporanModal.date, submitted: now,
        status: "SUBMITTED", total_units: 0, units: [], materials: [],
        fotos: laporanFotos.filter(f => f.url).map(f => ({ id: f.id, label: f.label, url: f.url, unit_no: f.unit_no || null })),
        foto_urls: surveyFotoUrls,
        total_freon: 0, rekomendasi: "", catatan_global: "",
        hasil_survey: laporanSurveyHasil.trim(),
        catatan_rekomendasi: laporanSurveyCatatan.trim(),
        editLog: [],
      };
      setLaporanReports(prev => [...prev.filter(r => r.job_id !== laporanModal.id), surveyReport]);
      showNotif("⏳ Menyimpan laporan survey...");
      try {
        await supabase.from("service_reports").delete().eq("job_id", reportId).neq("id", reportId);
      } catch { /* hapus laporan duplikat best-effort */ }
      const { error: sErr } = await supabase.from("service_reports").upsert({
        id: reportId, job_id: laporanModal.id, teknisi: laporanModal.teknisi,
        helper: laporanModal.helper || null, customer: laporanModal.customer,
        service: "Survey", date: laporanModal.date, status: "SUBMITTED",
        total_units: 0, total_freon: 0, submitted_at: new Date().toISOString(),
        foto_urls: surveyFotoUrls, rekomendasi: "", catatan_global: "",
        hasil_survey: laporanSurveyHasil.trim(),
        catatan_rekomendasi: laporanSurveyCatatan.trim(),
        submitted: now,
      }, { onConflict: "id" });
      if (sErr) { showNotif("⚠️ Tersimpan lokal, sync gagal: " + sErr.message); }
      else { showNotif("✅ Laporan Survey terkirim!"); }
      const admR2 = userAccounts.filter(u => u.role === "Admin" || u.role === "Owner");
      admR2.forEach(u => { if (u.phone) sendWA(u.phone, "Laporan Survey\nJob: " + laporanModal.id + "\nCustomer: " + laporanModal.customer + "\nTeknisi: " + laporanModal.teknisi + "\n\nHasil: " + laporanSurveyHasil.trim().slice(0, 200)); });
      setLaporanSubmitted(true);
      submitLaporanLock.current = false;
      return;
    }

    // ── 2. Validasi unit untuk non-Install ──
    if (!isInstall && incompleteUnits.length > 0) {
      showNotif(`${incompleteUnits.length} unit belum diisi pekerjaan!`);
      return;
    }

    // ── 3. Cek foto gagal upload ──
    const fotoGagal = laporanFotos.filter(f => !f.url).length;
    if (fotoGagal > 0) {
      const lanjut = await showConfirm({
        icon: "⚠️", title: "Ada Foto Belum Tersimpan",
        message: `${fotoGagal} foto belum tersimpan ke cloud (ditandai ⏳).\n\nLanjutkan submit laporan tanpa foto tersebut?`,
        confirmText: "Lanjutkan Submit"
      });
      if (!lanjut) return;
    }

    // ── 4. Siapkan materials yang efektif ──
    // Install: pakai laporanInstallItems, lainnya: pakai laporanMaterials
    // Only jasa items here — barang items are now consolidated into laporanBarangItems
    const jasaAsMaterials = [
      ...laporanJasaItems.map(j => ({
        id: "jasa_" + j.id, nama: j.nama, jumlah: j.jumlah || 1,
        satuan: j.satuan || "pcs", harga_satuan: j.harga_satuan || 0, keterangan: "jasa"
      })),
    ];
    // Mapping INSTALL_ITEMS key → inventory code untuk deduct stok spesifik
    const INSTALL_INV_MAP = {
      "pipa_1pk": "SKU022",  // Pipa AC Hoda 1PK
      "pipa_2pk": "SKU023",  // Pipa AC Hoda 2PK
      "pipa_25pk": "SKU024",  // Pipa AC Hoda 2,5PK
      "pipa_3pk": "SKU057",  // Pipa AC Hoda 3PK
      "kabel_15": "SKU025",  // Kabel Listrik 3x1,5
      "kabel_25": "SKU026",  // Kabel Listrik 3x2,5
      "ducttape_biasa": "SKU031",
      "ducttape_lem": "SKU030",
      "dinabolt": "SKU058",
      "karet_mounting": "SKU059",
      "breket_outdoor": "SKU041",
    };

    // ✨ CHANGE: tambah laporanBarangItems ke effectiveMaterials dengan keterangan="barang"
    const barangAsMaterials = laporanBarangItems
      .filter(b => b.nama)
      .map(b => ({
        id: b.id,
        nama: b.nama,
        jumlah: b.jumlah || 1,
        satuan: b.satuan || "pcs",
        harga_satuan: b.harga_satuan || 0,
        subtotal: (b.harga_satuan || 0) * (b.jumlah || 1),
        keterangan: "barang" // marking barang dari price_list, bukan material stok
      }));

    // ✨ Cleaning-in-Repair → baris jasa "[+Repair]" DIPERSIST ke materials laporan.
    // Kalau tidak, saat invoice dibuat ulang di jalur VERIFY (LaporanTimView, yang baca
    // r.materials) cleaning-in-repair hilang — verify tak punya logika checkbox ini.
    // Tidak dobel di submit: invoice submit dibangun buildInvoiceDetail (param cleaningInRepair,
    // bukan dari effectiveMaterials untuk non-install).
    const cleaningInRepairRows = (laporanModal?.service === "Repair" && Array.isArray(laporanCleaningInRepair) && laporanCleaningInRepair.length > 0)
      ? (laporanUnits || [])
        .filter(u => u && u.tipe && laporanCleaningInRepair.includes(u.unit_no))
        .map(u => {
          const hargaUnit = hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData);
          const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
          return {
            id: "cir_" + (u.unit_no || Math.random().toString(36).slice(2, 6)),
            nama: "Cleaning " + u.tipe + " (" + unitLabel + ") [+Repair]",
            jumlah: 1, satuan: "unit", harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa",
          };
        })
        .filter(r => r.harga_satuan > 0)
      : [];

    const effectiveMaterials = isInstall
      ? INSTALL_ITEMS
        .filter(item => parseFloat(laporanInstallItems[item.key] || 0) > 0)
        .map(item => {
          const hargaSat = lookupHargaGlobal(item.label, item.satuan);
          const qty = parseFloat(laporanInstallItems[item.key] || 0);
          return {
            id: item.key, nama: item.label, jumlah: qty, satuan: item.satuan,
            harga_satuan: hargaSat, subtotal: hargaSat * qty, keterangan: "",
            // _useCode: untuk deduct stok by kode inventori yang spesifik
            _useCode: INSTALL_INV_MAP[item.key] || null,
          };
        })
      : [...jasaAsMaterials, ...barangAsMaterials, ...laporanMaterials, ...cleaningInRepairRows];

    const now = new Date().toLocaleString("id-ID", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
    const totalFreonLocal = laporanUnits.reduce((s, u) => s + (parseFloat(u.freon_ditambah) || 0), 0);

    // ── 5. Buat objek laporan ──
    const newReport = {
      id: laporanModal._rewriteId || ("LPR_" + laporanModal.id + "_" + Date.now().toString(36).slice(-4).toUpperCase()),
      job_id: laporanModal.id,
      teknisi: laporanModal.teknisi,
      helper: laporanModal.helper || null,
      is_substitute: (currentUser?.role === "Helper" &&
        currentUser?.name === laporanModal.helper &&
        !teknisiData.find(t => t.role === "Teknisi" && t.name === laporanModal.helper)),
      customer: laporanModal.customer,
      service: laporanModal?.service,
      date: laporanModal.date,
      submitted: now,
      status: "SUBMITTED",
      total_units: laporanUnits.length,
      units: laporanUnits,
      materials: effectiveMaterials,
      fotos: laporanFotos.filter(f => f.url).map(f => ({ id: f.id, label: f.label, url: f.url, unit_no: f.unit_no || null })),
      total_freon: totalFreonLocal,
      rekomendasi: laporanRekomendasi,
      catatan_global: laporanCatatan,
      unit_mismatch: laporanUnits.length !== (laporanModal.units || 1),
      editLog: laporanModal._rewriteId ? [{
        by: currentUser?.name || "Teknisi",
        at: new Date().toLocaleString("id-ID"),
        field: "full_rewrite",
        old: "(laporan lama)",
        new: "Laporan ditulis ulang dari awal",
      }] : [],
    };

    setLaporanReports(prev => [...prev.filter(r => r.job_id !== laporanModal.id), newReport]);

    // ── 6. WA notif ke Admin/Owner ──
    const adminUsers = userAccounts.filter(u => u.role === "Owner");
    const matCount = isInstall
      ? INSTALL_ITEMS.filter(it => parseFloat(laporanInstallItems[it.key] || 0) > 0).length
      : laporanMaterials.length;
    const notifMsg =
      "Laporan Selesai\nJob: " + laporanModal.id
      + "\nCustomer: " + laporanModal.customer
      + "\nTeknisi: " + laporanModal.teknisi + (laporanModal.helper ? " + " + laporanModal.helper : "")
      + "\nLayanan: " + laporanModal?.service + " - " + laporanUnits.length + " unit"
      + "\nMaterial: " + matCount + " item  Foto: " + laporanFotos.filter(f => f.url).length + " foto"
      + "\n\nSilakan cek invoice di menu Invoice.";
    adminUsers.forEach(u => { if (u.phone) sendWA(u.phone, notifMsg); });

    // ── 7. Simpan laporan ke Supabase (multi-attempt with fallback fields) ──
    showNotif("⏳ Menyimpan laporan ke server...");
    // ✨ DEDUP: hapus ghost rows dgn job_id yg sama tapi id berbeda (prevent double laporan)
    try {
      await supabase.from("service_reports")
        .delete()
        .eq("job_id", newReport.job_id)
        .neq("id", newReport.id);
    } catch (dx) { console.warn("[LAPORAN_DEDUP] cleanup ghost rows failed:", dx.message); }
    const basePayload = {
      id: newReport.id,
      job_id: newReport.job_id,
      teknisi: newReport.teknisi,
      helper: newReport.helper || null,
      customer: newReport.customer,
      service: newReport.service,
      date: newReport.date,
      status: "SUBMITTED",
      total_units: newReport.total_units,
      total_freon: newReport.total_freon,
      submitted_at: new Date().toISOString(),
      foto_urls: laporanFotos.filter(f => f.url).map(f => f.url) || [],
      rekomendasi: newReport.rekomendasi || "",
      catatan_global: newReport.catatan_global || "",
      submitted: new Date().toLocaleString("id-ID"),
    };

    let savedOk = false;
    let lastError = null;
    { // Attempt 1: dengan materials_json & units_json & units (jsonb)
      try {
        const { error: e1 } = await supabase.from("service_reports").upsert({
          ...basePayload,
          materials_json: JSON.stringify(effectiveMaterials),
          materials_used: effectiveMaterials,
          units_json: JSON.stringify(laporanUnits),
          units: laporanUnits,
          fotos: laporanFotos.filter(f => f.url).map(f => ({ url: f.url, label: f.label || "", unit_no: f.unit_no || null })),
        }, { onConflict: "id" });
        if (!e1) { savedOk = true; }
        else { lastError = e1; console.warn("❌ Attempt 1 failed:", e1.message); }
      } catch (ex) { lastError = ex; console.warn("❌ Attempt 1 error:", ex.message); }
    }
    if (!savedOk) { // Attempt 2: dengan units_json & materials_json (skip units jsonb)
      try {
        const { error: e2 } = await supabase.from("service_reports").upsert({
          ...basePayload,
          units_json: JSON.stringify(laporanUnits),
          materials_json: JSON.stringify(effectiveMaterials),
          materials_used: effectiveMaterials,
        }, { onConflict: "id" });
        if (!e2) { savedOk = true; }
        else { lastError = e2; console.warn("❌ Attempt 2 failed:", e2.message); }
      } catch (ex) { lastError = ex; console.warn("❌ Attempt 2 error:", ex.message); }
    }
    if (!savedOk) { // Attempt 3: minimal
      try {
        const { error: e3 } = await supabase.from("service_reports").upsert({
          id: newReport.id, job_id: newReport.job_id,
          teknisi: newReport.teknisi, customer: newReport.customer,
          service: newReport.service, date: newReport.date,
          status: "SUBMITTED", total_units: newReport.total_units,
          submitted_at: new Date().toISOString(),
        }, { onConflict: "id" });
        if (!e3) { savedOk = true; }
        else { lastError = e3; console.warn("❌ Attempt 3 failed:", e3.message); }
      } catch (ex) { lastError = ex; console.warn("❌ Attempt 3 error:", ex.message); }
    }

    // Fallback: If upsert failed, explicitly DELETE old laporan (if rewriting) then try INSERT
    if (!savedOk && laporanModal._rewriteId) {
      console.warn("🔄 Upsert failed, trying DELETE + INSERT fallback for rewrite:", newReport.id);
      try {
        // First, try to delete the old laporan
        await supabase.from("service_reports").delete().eq("id", newReport.id).select();
        // Then insert the new one
        const { error: insertErr } = await supabase.from("service_reports").insert(basePayload).select().single();
        if (!insertErr) {
          savedOk = true;
          } else {
          lastError = insertErr;
          console.error("❌ DELETE+INSERT fallback failed:", insertErr.message);
        }
      } catch (fx) {
        lastError = fx;
        console.error("❌ Fallback error:", fx.message);
      }
    }

    // Final error handling
    if (!savedOk) {
      const errMsg = lastError?.message || "Unknown error";
      reportError("laporan.save.allAttemptsFailed", lastError || new Error(errMsg), { jobId: newReport?.job_id, reportId: newReport?.id });
      showNotif("❌ Gagal simpan laporan: " + errMsg + ". Coba lagi atau hubungi admin.");
      return; // Don't proceed to reload/notify if save failed
    }

    // ── 8. Reload laporan (backup, realtime juga akan trigger) ──
    const reloadLaporan = async () => {
      const { data } = await supabase.from("service_reports")
        .select("*").order("submitted_at", { ascending: false });
      if (data?.length > 0) {
        setLaporanReports(data.map(r => ({
          ...r,
          units: r.units_json ? (() => { try { return JSON.parse(r.units_json); } catch (_) { return r.units || []; } })() : (r.units || []),
          materials: r.materials_json ? (() => { try { return JSON.parse(r.materials_json); } catch (_) { return r.materials_used || []; } })() : (r.materials_used || []),
          fotos: r.fotos || (r.foto_urls || []).map((url, i) => ({ id: i, label: `Foto ${i + 1}`, url })),
          editLog: safeArr(r.edit_log ?? r.editLog),
        })));
      }
    };
    setTimeout(reloadLaporan, 800);
    setTimeout(reloadLaporan, 3000);

    // ── 9. Update order status ──
    setOrdersData(prev => prev.map(o =>
      o.id === laporanModal.id ? { ...o, status: "REPORT_SUBMITTED" } : o
    ));
    {
      const { error: ordErr } = await supabase.from("orders")
        .update({ status: "REPORT_SUBMITTED" }).eq("id", laporanModal.id);
      if (ordErr) {
        console.warn("REPORT_SUBMITTED rejected — fallback COMPLETED:", ordErr.message);
        await updateOrderStatus(supabase, laporanModal.id, "COMPLETED", auditUserName());
      }
    }

    // ── 10. Update status teknisi & helper → active ──
    ["teknisi", "helper"].forEach(role => {
      const name = role === "teknisi" ? laporanModal.teknisi : laporanModal.helper;
      if (!name) return;
      const tek = teknisiData.find(t => t.name === name);
      if (!tek?.id) return;
      setTeknisiData(prev => prev.map(t => t.name === name ? { ...t, status: "active" } : t));
      if (/^[0-9a-f-]{36}$/.test(tek.id)) {
        supabase.from("user_profiles").update({ status: "active" }).eq("id", tek.id);
      }
    });

    // ── 10b. Notif WA ke helper — laporan otomatis tercatat atas namanya ──
    if (laporanModal.helper && currentUser?.name !== laporanModal.helper) {
      const helperData = teknisiData.find(t => t.name === laporanModal.helper);
      if (helperData?.phone) {
        sendWA(helperData.phone,
          `✅ *Laporan ${laporanModal.id} Selesai*\n`
          + `Customer: ${laporanModal.customer}\n`
          + `Teknisi: ${laporanModal.teknisi}\n\n`
          + `Laporan pekerjaan sudah disubmit oleh ${currentUser?.name || laporanModal.teknisi}. `
          + `Kamu tercatat sebagai helper. Cek di menu Laporan Saya. — ${appSettings.app_name || "AClean"}`
        );
      }
    }

    // ── 11. Stok material tracked (pipa/freon): idempotent sync ──
    // syncTrackedStock: hapus usage lama → insert baru → recalculate dari DB.
    // Berlaku submit pertama DAN rewrite — input terakhir selalu yang menang.
    const isRewriteLaporan = !!laporanModal._rewriteId;
    const syncReportId = newReport.id; // selalu pakai ID laporan final (sama untuk rewrite)
    // Opsi A: kalau material_confirm_deduct ON, stok pipa/kabel/freon dipotong lewat Material Harian (confirm Owner),
    // BUKAN dari submit laporan. Jadi keluarkan kategori itu dari deduct laporan (cegah dobel).
    const confirmDeductOn = appSettings?.material_confirm_deduct_enabled === "true";
    const isHarianManaged = (m) => ["pipa", "kabel", "freon"].includes(classifyMaterial(m?.nama || ""));
    const dropHarian = (arr) => confirmDeductOn ? (arr || []).filter((m) => !isHarianManaged(m)) : (arr || []);
    const materialsForSync = dropHarian(isInstall ? effectiveMaterials : laporanMaterials);
    await syncTrackedStock(
      syncReportId,
      laporanModal.id,
      materialsForSync,
      laporanModal?.customer || null,
      laporanModal?.teknisi || null,
      laporanModal?.date || null
    );

    // ── 11b. Material non-tracked: deduct via deductInventory (lama, hanya sekali saat submit baru) ──
    const barangAsDeducts = laporanBarangItems.filter(b => b.nama && parseFloat(b.jumlah || 0) > 0)
      .map(b => ({ nama: b.nama, jumlah: parseFloat(b.jumlah) || 1, satuan: b.satuan || "pcs", keterangan: "barang" }));
    const materialsToDeduct = dropHarian(isInstall ? effectiveMaterials : [...laporanMaterials, ...barangAsDeducts]);
    const nonTrackedToDeduct = materialsToDeduct.filter(m =>
      !isTrackedByCode(m.inv_code || m._useCode) && !isTrackedByName(m.nama) && !m.freon_tabung_code
    );

    if (!isRewriteLaporan && nonTrackedToDeduct.length > 0) {
      deductInventory(
        nonTrackedToDeduct,
        laporanModal?.id || null,
        null,
        laporanModal?.customer || null,
        laporanModal?.teknisi || null,
        laporanModal?.date || null
      );
      setTimeout(() => {
        const kritisItems = inventoryData.filter(i =>
          nonTrackedToDeduct.some(m => i.name.toLowerCase().includes((m.nama || "").toLowerCase())) &&
          (i.status === "CRITICAL" || i.status === "OUT")
        );
        if (kritisItems.length > 0) {
          const warnings = kritisItems.map(i => `${i.name} sisa ${i.stock} ${i.unit}`);
          showNotif("⚠️ Stok kritis: " + warnings.join(", "));
          const ownerAccs = userAccounts.filter(u => u.role === "Owner");
          const lowMsg = `⚠️ *Stok Material Kritis*\nSetelah job ${laporanModal.id}:\n` + warnings.map(w => "• " + w).join("\n");
          ownerAccs.forEach(u => { if (u.phone) sendWA(u.phone, lowMsg); });
        }
      }, 800);
    }

    // ── 12. Auto-generate invoice ──
    // Hitung labor & material — harga freon dari inventory DULU, fallback PRICE_LIST
    // Untuk Install: labor = 0 karena semua jasa sudah masuk INSTALL_ITEMS → materials_detail
    // Untuk service lain: hitung dari PRICE_LIST
    const isInstallSvc = laporanModal.service === "Install";
    const jasaNamesSet2 = new Set(
      priceListData.filter(r => r.service !== "Material").map(r => r.type && r.type.trim())
    );
    const repairNamesInMat = new Set(laporanRepairItems.map(r => r.nama));
    const jasaFromMat = laporanMaterials.filter(m =>
      m.nama && jasaNamesSet2.has(m.nama.trim())
    );
    const matOnly = laporanMaterials.filter(m =>
      m.nama && !jasaNamesSet2.has(m.nama.trim()) &&
      !repairNamesInMat.has(m.nama) && parseFloat(m.jumlah || 0) > 0
    );
    // ✨ NEW: Cleaning-in-Repair — hitung total tambahan cleaning saat job Repair
    const cleaningInRepairTotal = (laporanModal?.service === "Repair" && Array.isArray(laporanCleaningInRepair) && laporanCleaningInRepair.length > 0)
      ? (laporanUnits || [])
        .filter(u => u && u.tipe && laporanCleaningInRepair.includes(u.unit_no))
        .reduce((s, u) => s + hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData), 0)
      : 0;

    const laborTotalInv = isInstallSvc ? 0 : (() => {
      const svc = laporanModal?.service;
      const jasaSumForm = laporanJasaItems.filter(j => j.nama)
        .reduce((s, j) => s + ((j.harga_satuan || 0) * (parseFloat(j.jumlah) || 1)), 0);

      // Base labor per service type:
      // - Cleaning/Maintenance: service fee baseline per-unit dari Card 1/4 tipe PK
      // - Repair: NO baseline — hanya dari form jasa + cleaning-in-repair
      // - Complain: handle via garansi logic (skip baseline)
      const isCleaningMaint = svc === "Cleaning" || svc === "Maintenance";
      // Skip baseline hanya jika jasa items sudah mengandung cleaning/maintenance jasa.
      // Bug lama: transport/biaya-cek jadi jasa → baseline Cleaning ke-skip → total = transport saja.
      const hasCleaningJasa = laporanJasaItems.some(j => {
        const n = (j.nama || "").toLowerCase();
        return n.includes("cleaning") || n.includes("maintenance") || n.includes("cuci");
      });
      let svcFeeBaseline = 0;
      if (isCleaningMaint && !hasCleaningJasa) {
        const unitsWithTipe = (laporanUnits || []).filter(u => u && u.tipe);
        svcFeeBaseline = unitsWithTipe.length > 0
          ? unitsWithTipe.reduce((s, u) => s + hargaPerUnitFromTipe(svc, u.tipe, priceListData), 0)
          : hitungLabor(svc, laporanModal.type, laporanUnits.length);
      }

      return svcFeeBaseline + jasaSumForm + cleaningInRepairTotal;
    })();
    // ✨ CHANGE: matTotalInv dari laporanBarangItems (price_list category=Barang), bukan dari laporanMaterials
    const barangTotalInv = laporanBarangItems
      .filter(b => b.nama)
      .reduce((s, b) => s + ((b.harga_satuan || 0) * (b.jumlah || 1)), 0);
    const matTotalInv = isInstallSvc
      ? hitungMaterialTotal(effectiveMaterials)
      : barangTotalInv; // gunakan barangTotal, bukan material total
    const invoiceTotal = laborTotalInv + matTotalInv;
    const todayInv = new Date().toISOString().slice(0, 10);
    const isComplainSvc = laporanModal.service === "Complain";
    const isZeroTotal = invoiceTotal === 0;

    // ── GARANSI CHECK: selalu cek untuk Complain, terlepas dari total ──
    // Cek apakah customer punya garansi AKTIF (belum expired)
    const prevGaransiActive = isComplainSvc
      ? invoicesData
        .filter(inv =>
          inv.customer === laporanModal.customer &&
          inv.service !== "Complain" &&
          inv.garansi_expires &&
          inv.garansi_expires >= todayInv &&
          ["PAID", "UNPAID", "APPROVED", "PENDING_APPROVAL"].includes(inv.status)
        )
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null
      : null;

    // Cek garansi EXPIRED (pernah punya garansi tapi sudah habis)
    const prevGaransiExpired = isComplainSvc && !prevGaransiActive
      ? invoicesData
        .filter(inv =>
          inv.customer === laporanModal.customer &&
          inv.service !== "Complain" &&
          inv.garansi_expires &&
          inv.garansi_expires < todayInv &&
          ["PAID", "UNPAID", "APPROVED", "PENDING_APPROVAL"].includes(inv.status)
        )
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null
      : null;

    const BIAYA_CEK = (() => {
      const pl = priceListData.find(r => r.service === "Repair" && r.type === "Biaya Pengecekan AC");
      return (pl && pl.price > 0) ? pl.price : 0;
    })();

    // ── FINAL LABOR/TOTAL untuk Complain ──────────────────────────────
    // Garansi AKTIF → jasa gratis (labor=0), material tetap dicharge
    // Garansi EXPIRED + tidak ada input → biaya cek 100rb
    // Tidak ada garansi + tidak ada input → biaya cek 100rb
    // Ada input jasa/material → harga normal (garansi hanya cover jasa)
    const noGaransiComplain = isComplainSvc && !prevGaransiActive && !prevGaransiExpired;
    let finalLabor = laborTotalInv;
    let finalTotal = invoiceTotal;

    // ✨ FIX #1 (CORRECTED): Repair service tanpa items → conditional BIAYA_CEK based on repair type
    const isRepairServiceNoItems = laporanModal?.service === "Repair" &&
      laporanBarangItems.filter(b => b.nama).length === 0 &&
      laporanJasaItems.filter(j => j.nama).length === 0 &&
      laporanMaterials.filter(m => m.nama).length === 0 &&
      cleaningInRepairTotal === 0;
    let isRepairGratis = false;

    if (isRepairServiceNoItems) {
      // If teknisi selected "Berbayar" (standard paid repair) → inject BIAYA_CEK
      if (laporanRepairType === "berbayar" && (!finalLabor || finalLabor === 0)) {
        finalLabor = BIAYA_CEK;
        finalTotal = BIAYA_CEK;
        addAgentLog("REPAIR_BIAYA_CEK_INJECTED", `Repair ${laporanModal.id} (berbayar) tanpa items → inject BIAYA_CEK ${BIAYA_CEK}`, "INFO");
      }
      // If teknisi selected "Gratis" (garansi atau customer arrangement) → allow Rp 0
      else if ((laporanRepairType === "gratis-garansi" || laporanRepairType === "gratis-customer") && invoiceTotal === 0) {
        isRepairGratis = true;
        finalLabor = 0;
        finalTotal = 0;
        const alasan = laporanRepairType === "gratis-garansi" ? "garansi aktif" : "arrangement customer";
        addAgentLog("REPAIR_GRATIS_CREATED", `Repair ${laporanModal.id} (${alasan}) tanpa items/material → invoice Rp 0, awaiting approval`, "INFO");
      }
    }

    if (isComplainSvc) {
      if (prevGaransiActive) {
        // Garansi aktif: jasa gratis, material tetap bayar
        finalLabor = 0;
        finalTotal = matTotalInv; // hanya material
      } else if (isZeroTotal) {
        // Tidak ada garansi aktif DAN teknisi tidak input apapun → biaya cek
        finalLabor = BIAYA_CEK;
        finalTotal = BIAYA_CEK;
      }
      // Jika ada input (isZeroTotal=false) tapi garansi expired/no-garansi → harga normal
    }

    if (isComplainSvc && prevGaransiActive && finalTotal === 0) {
      // SKIP invoice — dalam garansi
      setOrdersData(prev => prev.map(o =>
        o.id === laporanModal.id ? { ...o, status: "COMPLETED" } : o
      ));
      try { await updateOrderStatus(supabase, laporanModal.id, "COMPLETED", auditUserName()); } catch (e) { reportError("order.complete.statusSync", e, { jobId: laporanModal.id }); }
      addAgentLog("GARANSI_SKIP_INVOICE",
        `Complain ${laporanModal.id} — dalam garansi s/d ${prevGaransiActive.garansi_expires} ` +
        `(ref: ${prevGaransiActive.id}) → invoice di-skip`, "SUCCESS");

    } else {
      // BUAT invoice
      // Team-split: invoice B2B tunggal per project, di-key ke job_group_id untuk SEMUA
      // anggota grup. Tim mana pun yang diverifikasi duluan membuat invoice; sisanya menemukan
      // invoice itu via job_id = job_group_id → skip (anti invoice ganda).
      // Multi-hari TIDAK ditangani di sini — diproses dengan AKUMULASI di bawah (setelah mDetail
      // dibangun) lewat resolveMultiDayInvoiceAction(): 1 invoice induk, item tiap hari digabung.
      const isTeamSplit = !!laporanModal.is_team_split && !!laporanModal.job_group_id;
      if (isTeamSplit) {
        const groupInv = invoicesData.find(i => i.job_id === laporanModal.job_group_id);
        if (groupInv && !["CANCELLED", "PAID"].includes(groupInv.status)) {
          // Invoice grup sudah ada & masih aktif — notif saja, jangan buat invoice baru
          showNotif(`ℹ️ Laporan tim project terkirim. Invoice grup ${groupInv.id} sudah ada — minta Admin/Owner update total jika ada tambahan.`);
          addAgentLog("GROUP_CHILD_LAPORAN",
            `Laporan ${laporanModal.id} (tim project) — invoice grup ${groupInv.id} sudah ada, skip buat invoice baru`,
            "INFO");
          setLaporanModal(null);
          return;
        }
      }

      const invSeq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
      const invId = "INV-" + todayInv.replace(/-/g, "").slice(0, 8) + "-" + invSeq;
      const gDays = 30; // Semua service: garansi 30 hari dari terbit invoice
      const gExpires = new Date(Date.now() + gDays * 86400000).toISOString().slice(0, 10);

      // garansi_status: hanya untuk state lokal (tidak ada kolom ini di DB)
      const garansiStatusLocal = isComplainSvc
        ? (prevGaransiActive ? (matTotalInv > 0 ? 'GARANSI_DENGAN_MATERIAL' : 'GARANSI_AKTIF')
          : prevGaransiExpired ? 'GARANSI_EXPIRED' : 'NO_GARANSI')
        : null;

      // ── mDetail = single source of truth baris invoice — diekstrak ke lib/laporanInvoice.js ──
      // buildInvoiceDetail murni (no DB/setState). Warranty discount line (Complain dalam garansi)
      // ikut dibangun di dalamnya. Orkestrasi (skip/multi-hari/insert) tetap di submitLaporan.
      const { mDetail } = buildInvoiceDetail({
        order: laporanModal, units: laporanUnits,
        jasaItems: laporanJasaItems, repairItems: laporanRepairItems, barangItems: laporanBarangItems,
        effectiveMaterials, cleaningInRepair: laporanCleaningInRepair,
        finalLabor, isRepairGratis, prevGaransiActive,
        priceListData, lookupHargaGlobal, hitungLabor,
      });

      // ── SINGLE SOURCE OF TRUTH: ringkasan DITURUNKAN dari mDetail via lib/invoicing ──
      // Dulu labor=finalLabor & material=matTotalInv dihitung dari variabel terpisah → desync
      // (transport/biaya-cek/barang inject tak terhitung). Sekarang summarize() = satu-satunya
      // perhitungan: jasa/repair = labor, sisanya (barang/freon/material) = material,
      // total = jumlah semua baris. Konsisten di semua jalur invoice.
      const _summary = summarize(mDetail);
      const finalTotalFromDetail = _summary.lineTotal;
      const laborFromDetail = _summary.labor;
      const matFromDetail = _summary.material;

      // ── MULTI-HARI: akumulasi ke 1 invoice INDUK, bukan invoice ganda ───────────────
      // Hanya untuk laporan is_multi_day. Flow normal & team-split tidak terpengaruh sama sekali.
      // Cek invoice grup langsung ke DB (race-safe) → MERGE / CREATE / CREATE_SEPARATE.
      let didMergeMultiDay = false;
      let multiDayAnchorJobId = null;
      // ── Anti-duplikat invoice (defense-in-depth) ──
      // (a) order SUDAH tertaut invoice aktif (gabungan manual job_id=null / edit ulang), atau
      // (b) order hari ke-2+ (day_number>1) yang TIDAK ter-flag is_multi_day (data cacat) →
      // JANGAN buat invoice baru; cukup tautkan + COMPLETED. (Multi-hari ter-flag benar lanjut
      // ke resolver di bawah.) Laporan tetap tersimpan — hanya pembuatan invoice yang di-skip.
      {
        const _ordDup = ordersData.find(o => o.id === laporanModal.id);
        const _linkedDup = _ordDup?.invoice_id
          ? invoicesData.find(i => i.id === _ordDup.invoice_id && String(i.status || "").toUpperCase() !== "CANCELLED")
          : null;
        const _orphanMD = laporanModal.is_multi_day !== true && _ordDup?.is_multi_day !== true
          && Number(laporanModal.day_number || _ordDup?.day_number) > 1;
        if (laporanModal.service !== "Survey" && (_linkedDup || _orphanMD)) {
          const _tgt = _linkedDup?.id || _ordDup?.invoice_id || null;
          setOrdersData(prev => prev.map(o => o.id === laporanModal.id ? { ...o, status: "COMPLETED", ...(_tgt ? { invoice_id: _tgt } : {}) } : o));
          try { await updateOrderStatus(supabase, laporanModal.id, "COMPLETED", auditUserName(), _tgt ? { invoice_id: _tgt } : {}); } catch (e) { reportError("order.complete.statusSync", e, { jobId: laporanModal.id }); }
          addAgentLog("INVOICE_DUP_GUARD",
            `Laporan ${laporanModal.id} (hari ke-${laporanModal.day_number || "?"}) — ${_linkedDup ? "tertaut invoice " + _linkedDup.id : "day_number>1 tanpa flag multi-hari"}, TIDAK buat invoice baru`, "INFO");
          showNotif(_linkedDup
            ? `ℹ️ Laporan masuk & ditautkan ke invoice ${_linkedDup.id}. Tidak ada invoice baru — edit invoice induk bila perlu.`
            : `ℹ️ Laporan hari ke-${laporanModal.day_number || "?"} masuk. Tidak buat invoice baru (multi-hari) — tautkan/edit invoice induk manual.`);
          didMergeMultiDay = true;
        }
      }
      if (!didMergeMultiDay && laporanModal.is_multi_day === true) {
        const projectKey = multiDayProjectKey(laporanModal);
        const { data: grpRows, error: grpErr } = await supabase
          .from("invoices")
          .select("id,job_id,status,materials_detail,labor,material,total,garansi_days,garansi_expires,created_at")
          .eq("job_id", projectKey)
          .neq("status", "CANCELLED")
          .order("created_at", { ascending: true });
        if (grpErr) {
          console.error("[MULTIDAY_PRECHECK]", grpErr.message);
          showNotif("❌ Gagal cek invoice grup multi-hari — submit dibatalkan, coba lagi.");
          return;
        }
        const mdAction = resolveMultiDayInvoiceAction({ report: laporanModal, invoices: grpRows || [] });
        multiDayAnchorJobId = mdAction.anchorJobId;

        if (mdAction.type === "SKIP") {
          // Multi-hari: invoice induk SUDAH ADA & belum lunas → JANGAN buat invoice baru
          // DAN JANGAN tambah nilai otomatis (SOP: laporan harian tumpang-tindih → cegah
          // dobel-hitung). Cukup tautkan order ini ke invoice induk; Owner edit manual.
          const existing = mdAction.existing;
          setOrdersData(prev => prev.map(o => o.id === laporanModal.id ? { ...o, status: "COMPLETED", invoice_id: existing.id } : o));
          try { await updateOrderStatus(supabase, laporanModal.id, "COMPLETED", auditUserName(), { invoice_id: existing.id }); } catch (e) { reportError("order.complete.statusSync", e, { jobId: laporanModal.id }); }
          addAgentLog("MULTIDAY_SKIP_INVOICE",
            `Laporan ${laporanModal.id} (hari ke-${laporanModal.day_number || "?"}) — invoice induk ${existing.id} sudah ada, tidak buat/menambah (edit manual bila perlu)`,
            "INFO");
          showNotif(`ℹ️ Laporan hari ke-${laporanModal.day_number || "?"} masuk & ditautkan ke invoice induk ${existing.id} (${fmt(existing.total)}). Tidak ada invoice baru — edit invoice induk bila ada tambahan.`);
          didMergeMultiDay = true;
        }
        // CREATE / CREATE_SEPARATE → lanjut ke pembuatan invoice di bawah (anchor = multiDayAnchorJobId).
      }

      if (!didMergeMultiDay) {
      // P1: simpan kategori billing eksplisit per baris (bukan tebak nama saat baca).
      const _normDetail = normalizeLines(mDetail);
      // Multi-hari (CREATE): tag tiap baris dgn source_job_id agar idempotent untuk akumulasi berikutnya.
      const detailToStore = laporanModal.is_multi_day === true
        ? _normDetail.map(r => ({ ...r, source_job_id: laporanModal.id }))
        : _normDetail;
      const newInvoice = {
        id: invId,
        // Multi-hari → anchor dari resolveMultiDayInvoiceAction (induk utk CREATE, id order sendiri
        // utk CREATE_SEPARATE saat invoice grup sudah lunas). Team-split → job_group_id. Sisanya → id sendiri.
        job_id: (laporanModal.is_multi_day === true && multiDayAnchorJobId)
          ? multiDayAnchorJobId
          : (laporanModal.is_team_split && laporanModal.job_group_id)
            ? laporanModal.job_group_id
            : laporanModal.id,
        customer: laporanModal.customer,
        phone: laporanModal.phone || customersData.find(c => c.name === laporanModal.customer)?.phone || "",
        service: laporanModal.service + (laporanModal.type ? " - " + laporanModal.type : ""),
        units: laporanUnits.length,
        labor: laborFromDetail,
        material: matFromDetail,
        materials_detail: detailToStore,     // array untuk state/display (tagged source_job_id utk multi-hari)
        garansi_status: garansiStatusLocal,  // hanya state, tidak ke DB
        repair_gratis: isRepairGratis ? laporanRepairType : undefined,  // NEW: store repair type (gratis-garansi/gratis-customer)
        discount: 0,
        trade_in: false,
        trade_in_amount: 0,
        total: finalTotalFromDetail || finalTotal,
        status: "PENDING_APPROVAL",
        garansi_days: gDays,
        garansi_expires: gExpires,
        created_at: new Date().toISOString(),
      };

      // Status override
      if (isRepairGratis && finalTotal === 0) {
        // FREE REPAIR (garansi atau arrangement) → stays PENDING_APPROVAL (requires Owner/Admin approval)
        newInvoice.status = "PENDING_APPROVAL";
        addAgentLog("REPAIR_GRATIS_APPROVAL_NEEDED",
          `Invoice ${invId} Repair Rp 0 (${laporanRepairType}) — PENDING_APPROVAL (awaiting Owner/Admin approval)`,
          "WARNING");
      } else if (isComplainSvc && finalTotal === 0) {
        newInvoice.status = "PAID";
        newInvoice.paid_at = new Date().toISOString();
        addAgentLog("GARANSI_AUTO_PAID", `Invoice ${invId} Rp 0 → auto PAID`, "SUCCESS");
      } else if (isComplainSvc && prevGaransiExpired) {
        addAgentLog("GARANSI_EXPIRED_FEE",
          `Invoice ${invId} — garansi expired (ref: ${prevGaransiExpired.id}) → biaya cek Rp ${BIAYA_CEK.toLocaleString("id-ID")}`,
          "WARNING");
      }

      // ── Auto-discount membership tier (Gold: jasa 5%, Platinum: jasa 5% + material 5%) ──
      {
        const custPhone = laporanModal.phone || customersData.find(c => c.name === laporanModal.customer)?.phone;
        const custData = custPhone ? customersData.find(c => c.phone === custPhone || c.phone === normalizePhone(custPhone)) : null;
        const custTier = custData?.membership_tier;
        if (custTier === "gold" || custTier === "platinum") {
          const laborDisc = Math.round((newInvoice.labor || 0) * 0.05);
          const matDisc = custTier === "platinum" ? Math.round((newInvoice.material || 0) * 0.05) : 0;
          const memberDisc = laborDisc + matDisc;
          if (memberDisc > 0 && newInvoice.total > 0 && newInvoice.status === "PENDING_APPROVAL") {
            newInvoice.discount = (newInvoice.discount || 0) + memberDisc;
            newInvoice.member_discount = memberDisc;
            newInvoice.total = Math.max(0, newInvoice.total - memberDisc);
          }
        }
      }

      // Simpan invoice ke Supabase — exclude fields yang tidak ada di DB schema
      const { garansi_status: _gs, ...invBase } = newInvoice;
      const invPayload = {
        ...invBase,
        materials_detail: detailToStore.length > 0 ? JSON.stringify(detailToStore) : null,
        repair_gratis: invBase.repair_gratis || undefined,
      };
      // ── 1 invoice per job: query DB langsung untuk cegah race condition ──
      const { data: existingDB, error: fetchExistingErr } = await supabase
        .from("invoices").select("id").eq("job_id", laporanModal.id);
      if (fetchExistingErr) {
        reportError("invoice.precheck.fetchExisting", fetchExistingErr, { jobId: laporanModal.id });
        showNotif("❌ Gagal verifikasi invoice existing — submit dibatalkan. Coba lagi.");
        return;
      }
      if (existingDB && existingDB.length > 0) {
        // Hapus semua dulu — update local state HANYA setelah semua delete sukses
        for (const old of existingDB) {
          const { error: delErr } = await deleteInvoice(supabase, old.id, auditUserName(), "TEKNISI_REWRITE_LAPORAN");
          if (delErr) {
            reportError("invoice.rewrite.deleteOld", delErr, { jobId: laporanModal.id, oldInvoiceId: old.id });
            showNotif("❌ Gagal hapus invoice lama — submit dibatalkan. Coba lagi.");
            return;
          }
        }
        // Semua delete sukses baru update local state
        setInvoicesData(prev => prev.filter(i => i.job_id !== laporanModal.id));
        addAgentLog("INVOICE_REWRITE", `${existingDB.length} invoice lama dihapus untuk ${laporanModal.id} (rewrite)`, "INFO");
      }
      // ── GUARD INVARIAN (observasional, non-blocking): pastikan total = Σ line item ──
      // Garansi kini dimodelkan sbg baris diskon (P3), jadi invarian konsisten tanpa waiver.
      {
        const _chk = checkInvoiceConsistency(newInvoice);
        if (!_chk.ok) {
          console.warn("[INVOICE_INVARIANT]", describeInconsistency(_chk, newInvoice.id));
          addAgentLog("INVOICE_INVARIANT", describeInconsistency(_chk, newInvoice.id) + " (submit laporan)", "WARNING");
        }
      }
      const { error: invErr } = await insertInvoice(supabase, invPayload);
      if (invErr) {
        console.warn("Invoice insert failed:", invErr.message, "— retrying minimal");
        let retryOk = false;
        for (const st of ["PENDING_APPROVAL", "UNPAID"]) {
          const { error: e2 } = await insertInvoice(supabase, {
            id: newInvoice.id, job_id: newInvoice.job_id,
            customer: newInvoice.customer, service: newInvoice.service,
            units: newInvoice.units, labor: newInvoice.labor,
            material: newInvoice.material, total: newInvoice.total,
            status: st,
          });
          if (!e2) { retryOk = true; break; }
        }
        if (!retryOk) {
          showNotif("❌ Gagal simpan invoice — laporan tersimpan, cek menu Invoice manual.");
          addAgentLog("INVOICE_INSERT_FAILED", `Invoice ${newInvoice.id} gagal disimpan setelah retry`, "ERROR");
        }
      }
      // Update local state SETELAH DB insert sukses (atau retry sukses)
      setInvoicesData(prev => prev.some(i => i.id === newInvoice.id) ? prev : [...prev, newInvoice]);

      // P1: Link invoice ↔ quotation — jika ADA penawaran yang job_id-nya = order ini.
      // Berlaku baik order dari Approve quotation MAUPUN job manual yang ditautkan via
      // tab Maintenance → Quotasi → "Tautkan Job". (Dulu syarat source==="quotation" memblok
      // job manual sehingga invoice tak pernah ter-link ke penawaran.)
      const linkedQuo = quotationsData.find(q => q.job_id === laporanModal.id);
      if (linkedQuo) {
        // Patch invoice.quotation_id
        supabase.from("invoices").update({ quotation_id: linkedQuo.id }).eq("id", invId).then(() => {});
        // Patch quotation.invoice_id
        supabase.from("quotations").update({ invoice_id: invId, updated_at: new Date().toISOString() }).eq("id", linkedQuo.id).then(() => {});
        setQuotationsData(prev => prev.map(q => q.id === linkedQuo.id ? { ...q, invoice_id: invId } : q));
        setInvoicesData(prev => prev.map(i => i.id === invId ? { ...i, quotation_id: linkedQuo.id } : i));
        addAgentLog("QUOTATION_INVOICE_LINKED", `Invoice ${invId} ↔ Quotation ${linkedQuo.id} ter-link`, "SUCCESS");
      }

      addAgentLog("INVOICE_CREATED", `Invoice ${invId} dibuat — ${laporanModal.customer} ${fmt(newInvoice.total)}`, "SUCCESS");

      // WA notif ke Owner
      const ownerAccounts = userAccounts.filter(u => u.role === "Owner");
      const ownerMsg =
        "Invoice Menunggu Approval\n"
        + "Job: " + laporanModal.id + "\n"
        + "Customer: " + laporanModal.customer + "\n"
        + "Layanan: " + laporanModal.service + " - " + laporanUnits.length + " unit\n"
        + "Teknisi: " + laporanModal.teknisi + (laporanModal.helper ? " + " + laporanModal.helper : "") + "\n"
        + "Total: " + fmt(newInvoice.total) + " Jasa: " + fmt(newInvoice.labor) + " Mat: " + fmt(newInvoice.material) + "\n"
        + "Invoice: " + invId + " Silakan approve di menu Invoice. — ARA";
      // Notify owner accounts
      await Promise.all(ownerAccounts.map(u => {
        if (u.phone) return sendWA(u.phone, ownerMsg);
        return Promise.resolve();
      }));

      // Fallback if no owner accounts (notify default phone)
      if (ownerAccounts.length === 0) {
        try {
          const r = await fetch("/api/send-wa", {
            method: "POST", headers: await _apiHeaders(),
            body: JSON.stringify({ phone: "6281299898937", message: ownerMsg, currentUserRole: currentUser?.role || "Unknown" })
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            console.warn("[ARA_NOTIFY_OWNER_FAILED]", d.error || r.status);
          }
        } catch (err) {
          console.warn("[ARA_NOTIFY_OWNER_FAILED]", err.message);
        }
      }
      } // ── tutup if (!didMergeMultiDay) — pembuatan invoice baru ──
    }

    // ── Sync job_materials_brought: tandai USED / RETURNED ──
    // Item barang yang masih dipakai → USED + qty_used
    // Item brought yang tidak ke-laporan lagi → RETURNED (balik ke stok, tidak deduct)
    try {
      const broughtIdsUsed = new Map(); // id → qty_used
      for (const b of laporanBarangItems) {
        if (b._broughtId) broughtIdsUsed.set(b._broughtId, Number(b.jumlah) || 0);
      }
      const { data: existingBrought } = await supabase.from("job_materials_brought")
        .select("id, status, qty_used")
        .eq("job_id", laporanModal.id);
      const now = new Date().toISOString();
      for (const row of (existingBrought || [])) {
        if (broughtIdsUsed.has(row.id)) {
          const newQty = broughtIdsUsed.get(row.id);
          if (row.status !== "USED" || Number(row.qty_used || 0) !== newQty) {
            await supabase.from("job_materials_brought")
              .update({ status: "USED", qty_used: newQty, used_at: now, updated_at: now })
              .eq("id", row.id);
          }
        } else if (row.status === "BROUGHT") {
          // Brought tapi tidak ke-laporan → returned
          await supabase.from("job_materials_brought")
            .update({ status: "RETURNED", updated_at: now })
            .eq("id", row.id);
        }
      }
      refreshMaterialsBroughtMap();
    } catch (e) { console.warn("[BROUGHT_SYNC]", e?.message || e); }

    setLaporanSubmitted(true);
    // Seed-by-confirm registry unit AC (non-blocking, idempotent, forward-only)
    seedAcRegistry(laporanModal, laporanUnits);
    pushNotif(appSettings.app_name || "AClean", "Laporan berhasil dikirim ke Admin ✅");
    showNotif(`✅ Laporan ${laporanModal.id} terkirim! Laporan dikirim ke Owner/Admin untuk verifikasi.`);
    } catch (err) {
      reportError("laporan.submit.fatal", err, { jobId: laporanModal?.id });
      showNotif("❌ Submit error: " + (err?.message || String(err)));
    } finally {
      submitLaporanLock.current = false;
    }
}
