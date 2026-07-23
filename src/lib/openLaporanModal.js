// openLaporanModal — prefill & buka modal Laporan Teknisi untuk sebuah order
// (seed unit dari registry AC/maintenance, riwayat customer, reset step/form).
// TIDAK memutasi DB — hanya set state UI. Diekstrak dari App.jsx (Fase 2, pola ctx).
// ctx = param ke-2. Body verbatim (behavior-preserving).
export function openLaporanModal(order, {
  AC_REGISTRY_CUTOFF, _apiFetch, acUnitToHist, buildCustomerHistory, currentUser,
  customersData, fetchAcUnitsByCustomer, findCustomer, inventoryData, invoicesData,
  laporanReports, maintUnitToHist, mkUnit, ordersData, priceListData, setAcUnitPool,
  setActiveUnitIdx, setJasaManualText, setJasaSearchQ,
  setLaporanBarangItems, setLaporanCatatan, setLaporanCleaningInRepair, setLaporanFotos,
  setLaporanInstallItems, setLaporanJasaItems, setLaporanMaterials, setLaporanModal,
  setLaporanRekomendasi, setLaporanRepairItems, setLaporanStep, setLaporanSubmitted,
  setLaporanSurveyCatatan, setLaporanSurveyHasil, setLaporanUnits, setMaintLogsPool, setMaintUnitPool,
  setMatSearchQ2, setRepairManualText, setRepairSearchQ,
  setShowJasaSearch, setShowMatPreset, setShowMatSearch, setShowRepairSearch,
  setShowUnitPresetModal, setUnitPresetHistory, setUnitPresetSelected, showNotif,
  submitLaporanLock, supabase,
} = {}) {
    // ANTI-DUPLIKAT: cek apakah sudah ada laporan untuk job ini
    const existingReport = laporanReports.find(r => r.job_id === (order._rewriteId ? order.id : order.id) && r.status !== "PENDING");
    if (existingReport && !order._rewriteId) {
      const isOwner = existingReport.teknisi === currentUser?.name;
      const isHelper = existingReport.helper === currentUser?.name;
      if (!isOwner && !isHelper) {
        showNotif("⚠️ Laporan untuk job ini sudah dibuat oleh tim lain");
        return;
      }
      if (!isOwner) {
        // Helper mencoba buat laporan padahal teknisi sudah isi
        showNotif(`⚠️ Laporan sudah dibuat oleh ${existingReport.teknisi}. Kamu bisa lihat di menu Laporan Saya.`);
        return;
      }
    }
    const count = Math.min(order.units || 1, 30);
    // Order maintenance memakai grid-picker unit → grid ADALAH sumber unit. Jangan
    // pra-buat slot kosong dari order.units: untuk order dari Planning Order (tertaut
    // otomatis, tanpa maintenance_unit_ids), slot itu tampil "Unit 1 (kosong) — belum
    // terhubung registry" dan MEMBLOKIR submit sampai dihapus manual (temuan 23 Jul).
    // Kalau ada prefill unit spesifik (order dari panel Maintenance), diisi di bawah.
    setLaporanUnits(order.maintenance_client_id ? [] : Array.from({ length: count }, (_, i) => mkUnit(i + 1)));

    // Reset pool unit maintenance & registry AC — diisi ulang di bawah sesuai jenis order
    setMaintUnitPool([]); setMaintLogsPool?.([]);
    setAcUnitPool([]);

    // Pre-fill unit label/tipe/merk/PK dari maintenance preset (jika order corporate)
    const mUnitIds = Array.isArray(order.maintenance_unit_ids) ? order.maintenance_unit_ids : [];
    if (order.maintenance_client_id) {
      (async () => {
        try {
          const r = await _apiFetch("/api/maintenance", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list-units", client_id: order.maintenance_client_id }),
          });
          if (!r.ok) return;
          const { units: allUnits = [] } = await r.json().catch(() => ({}));
          // Simpan seluruh unit terdaftar klien → dipakai picker "Tambah dari Daftar Maintenance"
          setMaintUnitPool(allUnits);
          if (mUnitIds.length > 0) {
            // Cap 30 juga di jalur prefill — order B2B bisa menugaskan 40-50 unit
            // sekaligus; tanpa slice, laporan langsung melebihi batas dan teknisi
            // tak bisa menambah unit apa pun (pesan "maksimal 30" muncul terus).
            const filled = mUnitIds.slice(0, 30).map((uid, i) => {
              const mu = allUnits.find(u => u.id === uid);
              if (!mu) return mkUnit(i + 1);
              return mkUnit(i + 1, maintUnitToHist(mu));
            });
            setLaporanUnits(filled);
            if (mUnitIds.length > 30) {
              showNotif(`⚠️ Order ini menugaskan ${mUnitIds.length} unit — dimuat ${filled.length} (batas 1 laporan). Sisanya buat laporan terpisah.`);
            }
          }
        } catch (_) { /* non-blocking — default units tetap dipakai */ }
      })();
      // Riwayat servis ringkas → badge kesehatan di grid picker unit (Step 1).
      // Fetch TERPISAH & non-blocking: gagal di sini tidak boleh menghalangi unit pool
      // (badge cukup fallback "belum ada riwayat"). Pakai action sempit list-unit-health
      // (tanpa kolom biaya) — list-logs di-gate Owner/Admin karena memuat data finansial.
      (async () => {
        try {
          const r = await _apiFetch("/api/maintenance", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list-unit-health", client_id: order.maintenance_client_id }),
          });
          if (!r.ok) return;
          const { logs = [] } = await r.json().catch(() => ({}));
          setMaintLogsPool?.(logs);
        } catch (_) { /* non-blocking — badge kesehatan cukup kosong */ }
      })();
    } else {
      // Customer REGULER. Prioritas pre-fill: (1) registry unit AC permanen bila order
      // >= cutoff & ada di registry; (2) fallback #1A laporan terakhir; (3) default kosong.
      // #1A — pre-fill identitas dari laporan terakhir (field kerja tetap kosong tiap visit).
      const prefillFromLastReport = () => {
        const nm = (s) => (s || "").trim().toLowerCase();
        const custOrderIds = new Set(
          ordersData.filter(o => o.id !== order.id &&
            ((order.customer_id && o.customer_id === order.customer_id) ||
             (!o.customer_id && nm(o.customer) === nm(order.customer)))
          ).map(o => o.id)
        );
        const lastReport = laporanReports
          .filter(r => custOrderIds.has(r.job_id) && r.status && r.status !== "PENDING" && Array.isArray(r.units) && r.units.length > 0)
          .sort((a, b) => (b.date || b.submitted || "").localeCompare(a.date || a.submitted || ""))[0];
        if (lastReport) {
          const prefilled = Array.from({ length: count }, (_, i) => {
            const pu = lastReport.units[i];
            return pu ? mkUnit(i + 1, { label: pu.label, tipe: pu.tipe, merk: pu.merk, pk: pu.pk, model: pu.model, from_history_job_id: lastReport.job_id }) : mkUnit(i + 1);
          });
          setLaporanUnits(prefilled);
          showNotif(`ℹ️ ${Math.min(count, lastReport.units.length)} unit di-prefill dari servis terakhir — cek & sesuaikan`);
        }
      };
      // Registry forward-only: hanya order >= cutoff & punya customer_id.
      if (order.customer_id && (order.date || "") >= AC_REGISTRY_CUTOFF) {
        (async () => {
          try {
            const { data: acUnits } = await fetchAcUnitsByCustomer(supabase, order.customer_id);
            if (acUnits && acUnits.length > 0) {
              setAcUnitPool(acUnits);
              const filled = acUnits.slice(0, 30).map((au, i) => mkUnit(i + 1, acUnitToHist(au)));
              setLaporanUnits(filled);
              showNotif(`ℹ️ ${filled.length} unit di-prefill dari registry customer — cek & sesuaikan`);
              return; // registry dipakai → skip #1A
            }
          } catch (_) { /* non-blocking */ }
          prefillFromLastReport(); // registry kosong/gagal → fallback
        })();
      } else {
        prefillFromLastReport();
      }
    }

    setLaporanMaterials([]);
    setLaporanJasaItems([]); setJasaManualText({});
    setLaporanRepairItems([]); setRepairManualText({});
    setLaporanBarangItems([]); // ✨ NEW: reset barang items
    // ── Pre-fill dari materials_brought (Bawa Material) ──
    // Kalau teknisi pagi sudah declare bawa tabung/roll → auto-add ke section barang
    (async () => {
      try {
        const { data: brought } = await supabase.from("job_materials_brought")
          .select("id, unit_id, inventory_code, inventory_name, unit_label, material_type, qty_estimate, qty_used")
          .eq("job_id", order.id)
          .in("status", ["BROUGHT", "USED"])
          .order("brought_at", { ascending: true });
        if (brought && brought.length > 0) {
          const inv = inventoryData;
          const prefill = brought.map((b, i) => {
            const invItem = inv.find(x => x.code === b.inventory_code);
            const hargaSatuan = (() => {
              const pl = priceListData.find(p => p.type && b.inventory_name && p.type.toLowerCase().includes((b.inventory_name || "").toLowerCase()));
              return pl ? parseInt(pl.price || 0) : 0;
            })();
            return {
              id: Date.now() + i,
              nama: b.inventory_name || invItem?.name || "",
              jumlah: Number(b.qty_used || b.qty_estimate || 1),
              satuan: invItem?.unit || (b.material_type === "freon" ? "kg" : "m"),
              harga_satuan: hargaSatuan,
              _isManual: false,
              unit_id: b.unit_id,
              unit_label: b.unit_label,
              inv_code: b.inventory_code,
              _broughtId: b.id,
              _fromBrought: true,
            };
          });
          setLaporanBarangItems(prefill);
        }
      } catch (e) { console.warn("[BROUGHT_PREFILL]", e?.message || e); }
    })();
    setLaporanCleaningInRepair([]); // ✨ NEW: reset cleaning-in-repair checkboxes
    setShowJasaSearch(false); setJasaSearchQ("");
    setShowRepairSearch(false); setRepairSearchQ("");
    setShowMatSearch(false); setMatSearchQ2("");
    // ── LAYER 2 (lintas sesi): Load foto existing dari service_reports ──
    // Jika sudah ada laporan untuk job ini, tampilkan foto yang sudah tersimpan
    // sehingga teknisi tidak bisa upload ulang foto yang sama
    const existingRep = laporanReports.find(r =>
      r.job_id === order.id && r.status !== "REJECTED"
    );
    if (existingRep && existingRep.foto_urls && existingRep.foto_urls.length > 0) {
      // Rebuild laporanFotos dari foto_urls yang sudah ada di DB
      // hash dibuat dari URL (sebagai identifier unik per sesi)
      // Tag unit_no & label dipulihkan dari existingRep.fotos (match by url) jika ada.
      const metaByUrl = Object.fromEntries((existingRep.fotos || []).filter(m => m && m.url).map(m => [m.url, m]));
      const restoredFotos = existingRep.foto_urls.map((url, idx) => {
        const hashFromUrl = url.split("/").pop().replace(".jpg", "").slice(0, 16); // ambil hash dari nama file
        const meta = metaByUrl[url] || {};
        return {
          id: Date.now() + idx,
          label: meta.label || `Foto ${idx + 1}`,
          data_url: url,      // tampilkan dari URL R2 (sudah tersimpan)
          url: url,      // sudah tersimpan = ☁️ OK
          errMsg: "",
          hash: hashFromUrl,
          restored: true,     // flag: ini foto lama, bukan baru diupload
          unit_no: meta.unit_no || null,
        };
      });
      setLaporanFotos(restoredFotos);
    } else {
      setLaporanFotos([]);
    }
    // Auto-fill install items berdasarkan jumlah unit order
    const _installDefaults = {};
    if (order.service === "Install") {
      const _u = Math.min(order.units || 1, 30);
      // Auto-fill pasang AC berdasarkan jumlah unit
      _installDefaults.pasang_05_1pk = String(_u);
      _installDefaults.vacum_unit = String(_u);
      _installDefaults.vacum_unit = String(_u);
    }
    setLaporanInstallItems(_installDefaults);
    setLaporanRekomendasi("");
    setLaporanCatatan("");
    setLaporanSurveyHasil("");
    setLaporanSurveyCatatan("");
    setActiveUnitIdx(0);
    setShowMatPreset(false);

    // ── Smart Unit Preset: Cek customer history ──
    // Order maintenance B2B: unit sudah pasti dari registry (di-preset di blok corporate
    // di atas, lengkap dengan unit_code + maint_unit_id). History-picker malah mubazir &
    // membingungkan (unit history tak punya kode unit) → lewati untuk order maintenance.
    const customer = order.maintenance_client_id ? null : findCustomer(customersData, order.phone, order.customer);
    if (customer) {
      const custHistory = buildCustomerHistory(customer, ordersData, laporanReports, invoicesData, customersData);
      // Ambil unit detail dari job sebelumnya (terbaru)
      const historyUnits = custHistory.flatMap((h, idx) =>
        (h.unit_detail || []).map((u, uidx) => ({
          ...u,
          from_history_job_id: h.job_id,
          history_job_idx: idx,
          history_unit_idx: uidx,
          history_date: h.date,
          history_service: h.service
        }))
      );

      // Jika ada history units, tampilkan unit preset modal
      if (historyUnits.length > 0) {
        setUnitPresetHistory(historyUnits);
        setUnitPresetSelected(new Set());
        setShowUnitPresetModal(true);
      }
    }

    setLaporanModal(order);
    setLaporanStep(1);
    setLaporanSubmitted(false);
    submitLaporanLock.current = false; // reset lock setiap kali modal dibuka
}
