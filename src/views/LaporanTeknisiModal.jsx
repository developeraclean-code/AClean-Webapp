import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { getBracketKey, hargaPerUnitFromTipe } from "../lib/pricing.js";
import { categoryFromCatalog } from "../lib/invoicing.js";
import {
  KONDISI_SBL, KONDISI_SDH, PEKERJAAN_OPT, MATERIAL_PRESET,
  INSTALL_ITEMS, TIPE_AC_OPT, mkUnit, isUnitDone, maintUnitToHist, acUnitToHist,
} from "../lib/laporanConstants.js";

// Debounce lokal (disalin dari App.jsx module-level) — untuk search material
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// safeArr lokal (disalin dari App.jsx) — parse array yang mungkin string JSON
const safeArr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_) { return []; }
  }
  return [];
};

export default function LaporanTeknisiModal({
  open, laporanSubmitted,
  laporanModal, setLaporanModal,
  setLaporanSubmitted, setActiveMenu,
  materialConfirmDeductOn = false,
  // form state
  laporanStep, setLaporanStep,
  laporanUnits, setLaporanUnits,
  laporanMaterials, setLaporanMaterials,
  laporanJasaItems, setLaporanJasaItems,
  laporanBarangItems, setLaporanBarangItems,
  laporanInstallItems, setLaporanInstallItems,
  laporanCleaningInRepair, setLaporanCleaningInRepair,
  laporanFotos, setLaporanFotos,
  laporanRekomendasi, setLaporanRekomendasi,
  laporanCatatan, setLaporanCatatan,
  laporanSurveyHasil, setLaporanSurveyHasil,
  laporanSurveyCatatan, setLaporanSurveyCatatan,
  activeUnitIdx, setActiveUnitIdx,
  showUnitPresetModal, setShowUnitPresetModal,
  unitPresetHistory, setUnitPresetHistory,
  unitPresetSelected, setUnitPresetSelected,
  maintUnitPool,
  acUnitPool = [],
  // refs
  fotoInputRef, fotoUnitInputRef, fotoTargetUnitRef,
  // data
  ordersData, laporanReports, invoicesData, customersData,
  priceListData, inventoryData, invUnitsData, userAccounts,
  // callbacks
  submitLaporan, handleFotoUpload, buildCustomerHistory, fotoSrc,
  showNotif, addAgentLog, sendWA, findCustomer, insertOrder,
  setOrdersData, supabase,
  _apiFetch, _apiHeaders, currentUser, isMobile,
}) {
  // ── State UI internal (murni tampilan, tidak dibaca submitLaporan) ──
  const [showMatPreset, setShowMatPreset] = useState(false);
  const [matSearchId, setMatSearchId] = useState(null);
  const [matSearchQuery, setMatSearchQuery] = useState("");
  const debouncedMatSearchQuery = useDebounce(matSearchQuery, 200);
  const [jasaManualText, setJasaManualText] = useState({});
  const [repairManualText, setRepairManualText] = useState({});
  const [showAddMaintUnitModal, setShowAddMaintUnitModal] = useState(false);
  const [addMaintSelected, setAddMaintSelected] = useState(new Set());
  // Picker registry unit AC (customer reguler) — cermin maint
  const [showAddAcUnitModal, setShowAddAcUnitModal] = useState(false);
  const [addAcSelected, setAddAcSelected] = useState(new Set());

  // ── Layar sukses (setelah submit) ──
  if (laporanModal && laporanSubmitted) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 600, display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: cs.surface, border: "1px solid " + cs.green + "44", borderRadius: 20, padding: 32, textAlign: "center", maxWidth: 360, width: "100%" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: cs.text, marginBottom: 8 }}>Laporan Terkirim!</div>
          <div style={{ fontSize: 13, color: cs.muted, marginBottom: 6 }}>{laporanModal.id} · {laporanModal.customer}</div>
          <div style={{ fontSize: 12, color: cs.green, marginBottom: 4 }}>{laporanUnits.length} unit AC · {laporanMaterials.length} material · {laporanFotos.filter(f => f.url).length} foto</div>
          <div style={{ fontSize: 12, color: cs.muted, marginBottom: 20 }}>Laporan sedang diproses Admin/Owner untuk verifikasi.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button onClick={() => { setActiveMenu("myreport"); setLaporanModal(null); setLaporanSubmitted(false); }}
              style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              Lihat Laporan
            </button>
            <button onClick={() => { setLaporanModal(null); setLaporanSubmitted(false); }}
              style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
              Selesai
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Guard: hanya render form jika modal terbuka & bukan project
  if (!open || !laporanModal || laporanModal.project_id) return null;

  // ── Computed (single source) ──
  const incompleteUnits = laporanUnits.filter(u => !isUnitDone(u));
  const totalFreon = laporanUnits.reduce((s, u) => s + (parseFloat(u.freon_ditambah) || 0), 0);
  const presets = MATERIAL_PRESET[laporanModal?.service] || MATERIAL_PRESET.Cleaning;
  const isInstallJob = laporanModal?.service === "Install";
  const STEP_LABELS = ["", "Konfirmasi Unit",
    isInstallJob ? "(skip)" : "Detail Per Unit",
    isInstallJob ? "Form Instalasi" : "Material & Foto",
    "Submit"];

  const updateUnit = (idx, updated) => setLaporanUnits(prev => prev.map((u, i) => i === idx ? updated : u));
  const toggleArr = (arr, val) => arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];

  // Commit teks manual jasa/barang yang belum ter-blur ke item.nama. Dipanggil sebelum
  // pindah ke Step 4 → cegah nama "__manual__" tak tersimpan (blur kadang tak jalan di
  // macOS saat klik tombol / unmount) → item hilang senyap dari invoice (kurang tagih).
  const flushManualText = () => {
    setLaporanJasaItems(p => p.map(j => {
      const t = (jasaManualText[j.id] || "").trim();
      return (j._isManual && t) ? { ...j, nama: t } : j;
    }));
    setLaporanBarangItems(p => p.map(b => {
      const t = (repairManualText[b.id] || "").trim();
      return (b._isManual && t) ? { ...b, nama: t } : b;
    }));
  };

  const tagStyle = (active, color) => ({
    display: "flex", alignItems: "center", gap: 6, background: cs.card,
    border: `1px solid ${active ? color : cs.border}44`, borderRadius: 8,
    padding: "7px 10px", cursor: "pointer", fontSize: 12,
    color: active ? color : cs.muted, userSelect: "none",
  });

  // Helper retry upload foto — dipakai Step 2 (per unit) & Step 3 (umum)
  const retryFoto = async (f) => {
    setLaporanFotos(prev => prev.map(x => x.id === f.id ? { ...x, uploading: true, errMsg: "" } : x));
    showNotif("⏳ Retry upload...");
    const reportId = laporanModal?.id || "tmp";
    try {
      const r = await _apiFetch("/api/upload-foto", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          base64: f.data_url,
          filename: f.hash ? `${f.hash}.jpg` : `retry_${f.id}.jpg`,
          reportId, mimeType: "image/jpeg", hash: f.hash,
          currentUserRole: currentUser?.role || "Unknown",
        }),
      });
      const d = await r.json();
      setLaporanFotos(prev => prev.map(x => x.id === f.id
        ? { ...x, uploading: false, url: d.success ? d.url : null, errMsg: d.success ? "" : (d.error || "gagal") } : x));
      showNotif(d.success ? "✅ Retry berhasil!" : "❌ Masih gagal: " + (d.error || "unknown"));
    } catch (err) {
      setLaporanFotos(prev => prev.map(x => x.id === f.id ? { ...x, uploading: false, errMsg: err.message } : x));
      showNotif("❌ " + err.message);
    }
  };

  // ── UNIT PRESET MODAL (pilih AC dari history) ──
  const UnitPresetModal = () => {
    if (!showUnitPresetModal || !unitPresetHistory || unitPresetHistory.length === 0) return null;
    const selectedUnits = Array.from(unitPresetSelected).map(idx => unitPresetHistory[idx]);
    const orderUnitCount = laporanModal?.units || 1;
    const newUnitsNeeded = Math.max(0, orderUnitCount - selectedUnits.length);

    const handleConfirm = () => {
      const newUnits = selectedUnits.map((hist, idx) => mkUnit(idx + 1, hist));
      for (let i = 0; i < newUnitsNeeded; i++) newUnits.push(mkUnit(selectedUnits.length + i + 1));
      setLaporanUnits(newUnits);
      setShowUnitPresetModal(false);
      setUnitPresetHistory(null);
      setUnitPresetSelected(new Set());
    };

    return (
      <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 710, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setShowUnitPresetModal(false); setUnitPresetHistory(null); }}>
        <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, width: "100%", maxWidth: 500, maxHeight: "80vh", overflowY: "auto", padding: 20 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontWeight: 800, fontSize: 16, color: cs.text, margin: 0 }}>📋 Pilih AC Unit dari History</h3>
            <button onClick={() => { setShowUnitPresetModal(false); setUnitPresetHistory(null); }} style={{ background: "none", border: "none", color: cs.muted, fontSize: 20, cursor: "pointer" }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: cs.muted, marginBottom: 14 }}>
            Order: <b>{orderUnitCount} unit AC</b>
            {selectedUnits.length > 0 && <span> · Dipilih: <b style={{ color: cs.accent }}>{selectedUnits.length}/{orderUnitCount}</b></span>}
          </div>
          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            {unitPresetHistory.map((h, idx) => {
              const isSelected = unitPresetSelected.has(idx);
              return (
                <div key={idx} style={{ display: "flex", gap: 10, alignItems: "center", background: cs.card, border: "1px solid " + (isSelected ? cs.accent : cs.border), borderRadius: 10, padding: 12, cursor: "pointer", transition: "all 0.2s" }} onClick={() => {
                  const newSet = new Set(unitPresetSelected);
                  if (isSelected) newSet.delete(idx);
                  else if (newSet.size < orderUnitCount) newSet.add(idx);
                  setUnitPresetSelected(newSet);
                }}>
                  <input type="checkbox" checked={isSelected} onChange={() => { }} style={{ cursor: "pointer", width: 18, height: 18 }} />
                  <div style={{ flex: 1, display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 600, color: cs.text, fontSize: 12 }}>
                      {h.label || `Unit ${h.unit_no}`} — {h.merk || "?"} {h.tipe || "?"}
                    </div>
                    <div style={{ fontSize: 10, color: cs.muted }}>
                      {h.pk && <span>{h.pk}</span>}
                      {h.model && <span> · Model: {h.model}</span>}
                      {h.history_date && <span> · {h.history_date}</span>}
                      {h.history_service && <span> · {h.history_service}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {newUnitsNeeded > 0 && (
            <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 11, color: cs.accent }}>
              ℹ️ Perlu {newUnitsNeeded} unit baru (totalnya {selectedUnits.length} dari history + {newUnitsNeeded} baru)
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { setShowUnitPresetModal(false); setUnitPresetHistory(null); }} style={{ flex: 1, background: cs.border, color: cs.muted, border: "none", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              Batal
            </button>
            <button onClick={handleConfirm} style={{ flex: 1, background: cs.accent, color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }} disabled={selectedUnits.length === 0}>
              Gunakan {selectedUnits.length} Unit {newUnitsNeeded > 0 ? `+ ${newUnitsNeeded} Baru` : ""}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── TAMBAH UNIT DARI DAFTAR MAINTENANCE ──
  const AddMaintUnitModal = () => {
    if (!showAddMaintUnitModal) return null;
    const available = maintUnitPool.filter(mu => !laporanUnits.some(u => u.maint_unit_id === mu.id));

    const handleAdd = () => {
      const toAdd = available.filter(mu => addMaintSelected.has(mu.id));
      if (toAdd.length === 0) return;
      setLaporanUnits(prev => {
        const next = [...prev];
        toAdd.forEach(mu => next.push(mkUnit(next.length + 1, maintUnitToHist(mu))));
        return next.map((u, i) => ({ ...u, unit_no: i + 1 }));
      });
      setActiveUnitIdx(laporanUnits.length);
      setShowAddMaintUnitModal(false);
      setAddMaintSelected(new Set());
    };

    return (
      <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 710, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowAddMaintUnitModal(false)}>
        <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, width: "100%", maxWidth: 500, maxHeight: "80vh", overflowY: "auto", padding: 20 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontWeight: 800, fontSize: 16, color: cs.text, margin: 0 }}>🏢 Tambah Unit dari Daftar Maintenance</h3>
            <button onClick={() => setShowAddMaintUnitModal(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 20, cursor: "pointer" }}>×</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: cs.muted }}>
              Unit terdaftar yang belum ada di laporan. Centang yang dikerjakan di lapangan — data langsung terisi otomatis.
            </div>
            {available.length > 0 && (
              <button onClick={() => setAddMaintSelected(addMaintSelected.size === available.length ? new Set() : new Set(available.map(mu => mu.id)))}
                style={{ flexShrink: 0, background: cs.border, color: cs.text, border: "none", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontWeight: 600, fontSize: 11 }}>
                {addMaintSelected.size === available.length ? "Hapus semua" : "Pilih semua"}
              </button>
            )}
          </div>
          {available.length === 0 ? (
            <div style={{ fontSize: 12, color: cs.muted, fontStyle: "italic", marginBottom: 16 }}>Semua unit terdaftar sudah ada di laporan.</div>
          ) : (
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              {available.map(mu => {
                const isSelected = addMaintSelected.has(mu.id);
                return (
                  <div key={mu.id} style={{ display: "flex", gap: 10, alignItems: "center", background: cs.card, border: "1px solid " + (isSelected ? cs.green : cs.border), borderRadius: 10, padding: 12, cursor: "pointer" }} onClick={() => {
                    const newSet = new Set(addMaintSelected);
                    if (isSelected) newSet.delete(mu.id); else newSet.add(mu.id);
                    setAddMaintSelected(newSet);
                  }}>
                    <input type="checkbox" checked={isSelected} onChange={() => { }} style={{ cursor: "pointer", width: 18, height: 18 }} />
                    <div style={{ flex: 1, display: "grid", gap: 4 }}>
                      <div style={{ fontWeight: 600, color: cs.text, fontSize: 12 }}>
                        {mu.unit_code}{mu.location ? ` — ${mu.location}` : ""}
                      </div>
                      <div style={{ fontSize: 10, color: cs.muted }}>
                        {mu.brand && <span>{mu.brand}</span>}
                        {mu.capacity_pk && <span> · {mu.capacity_pk}PK</span>}
                        {mu.ac_type && <span> · {mu.ac_type}</span>}
                        {mu.refrigerant && <span> · {mu.refrigerant}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowAddMaintUnitModal(false)} style={{ flex: 1, background: cs.border, color: cs.muted, border: "none", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              Batal
            </button>
            <button onClick={handleAdd} disabled={addMaintSelected.size === 0} style={{ flex: 1, background: addMaintSelected.size === 0 ? cs.border : cs.green, color: addMaintSelected.size === 0 ? cs.muted : "#fff", border: "none", borderRadius: 8, padding: "10px 14px", cursor: addMaintSelected.size === 0 ? "default" : "pointer", fontWeight: 600, fontSize: 12 }}>
              Tambah {addMaintSelected.size > 0 ? `${addMaintSelected.size} Unit` : ""}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── TAMBAH UNIT DARI REGISTRY (customer reguler — ac_units) ──
  const AddAcUnitModal = () => {
    if (!showAddAcUnitModal) return null;
    const available = acUnitPool.filter(au => !laporanUnits.some(u => u.ac_unit_id === au.id));

    const handleAdd = () => {
      const toAdd = available.filter(au => addAcSelected.has(au.id));
      if (toAdd.length === 0) return;
      setLaporanUnits(prev => {
        const next = [...prev];
        toAdd.forEach(au => next.push(mkUnit(next.length + 1, acUnitToHist(au))));
        return next.map((u, i) => ({ ...u, unit_no: i + 1 }));
      });
      setActiveUnitIdx(laporanUnits.length);
      setShowAddAcUnitModal(false);
      setAddAcSelected(new Set());
    };

    return (
      <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 710, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowAddAcUnitModal(false)}>
        <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, width: "100%", maxWidth: 500, maxHeight: "80vh", overflowY: "auto", padding: 20 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontWeight: 800, fontSize: 16, color: cs.text, margin: 0 }}>🔧 Tambah dari Unit Tersimpan</h3>
            <button onClick={() => setShowAddAcUnitModal(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 20, cursor: "pointer" }}>×</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: cs.muted }}>
              Unit AC milik customer ini yang belum ada di laporan. Centang yang dikerjakan — identitas terisi otomatis.
            </div>
            {available.length > 0 && (
              <button onClick={() => setAddAcSelected(addAcSelected.size === available.length ? new Set() : new Set(available.map(au => au.id)))}
                style={{ flexShrink: 0, background: cs.border, color: cs.text, border: "none", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontWeight: 600, fontSize: 11 }}>
                {addAcSelected.size === available.length ? "Hapus semua" : "Pilih semua"}
              </button>
            )}
          </div>
          {available.length === 0 ? (
            <div style={{ fontSize: 12, color: cs.muted, fontStyle: "italic", marginBottom: 16 }}>Semua unit tersimpan sudah ada di laporan.</div>
          ) : (
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              {available.map(au => {
                const isSelected = addAcSelected.has(au.id);
                return (
                  <div key={au.id} style={{ display: "flex", gap: 10, alignItems: "center", background: cs.card, border: "1px solid " + (isSelected ? cs.green : cs.border), borderRadius: 10, padding: 12, cursor: "pointer" }} onClick={() => {
                    const newSet = new Set(addAcSelected);
                    if (isSelected) newSet.delete(au.id); else newSet.add(au.id);
                    setAddAcSelected(newSet);
                  }}>
                    <input type="checkbox" checked={isSelected} onChange={() => { }} style={{ cursor: "pointer", width: 18, height: 18 }} />
                    <div style={{ flex: 1, display: "grid", gap: 4 }}>
                      <div style={{ fontWeight: 600, color: cs.text, fontSize: 12 }}>📍 {au.lokasi || "(tanpa posisi)"}</div>
                      <div style={{ fontSize: 10, color: cs.muted }}>
                        {au.merk && <span>{au.merk}</span>}
                        {(au.pk || au.kapasitas) && <span> · {au.pk || au.kapasitas}</span>}
                        {au.tipe && <span> · {au.tipe}</span>}
                        {au.terakhir_service && <span> · terakhir {au.terakhir_service}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowAddAcUnitModal(false)} style={{ flex: 1, background: cs.border, color: cs.muted, border: "none", borderRadius: 8, padding: "10px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              Batal
            </button>
            <button onClick={handleAdd} disabled={addAcSelected.size === 0} style={{ flex: 1, background: addAcSelected.size === 0 ? cs.border : cs.green, color: addAcSelected.size === 0 ? cs.muted : "#fff", border: "none", borderRadius: 8, padding: "10px 14px", cursor: addAcSelected.size === 0 ? "default" : "pointer", fontWeight: 600, fontSize: 12 }}>
              Tambah {addAcSelected.size > 0 ? `${addAcSelected.size} Unit` : ""}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <UnitPresetModal />
      <AddMaintUnitModal />
      <AddAcUnitModal />
      <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 600, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={() => setLaporanModal(null)}>
        <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 560, maxHeight: "94vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📝 Laporan Servis</div>
              <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{laporanModal.id} · {laporanModal.customer} · {laporanModal.service}</div>
            </div>
            <button onClick={() => setLaporanModal(null)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
          </div>

          {/* ── SURVEY: form 2-field sederhana (bypass wizard 4-step) ── */}
          {laporanModal.service === "Survey" ? (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px", fontSize: 12, color: cs.muted }}>
                📋 Survey — tidak ada invoice. Isi hasil survey dan catatan/rekomendasi untuk Owner/Admin.
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 6 }}>Hasil Survey *</div>
                <textarea value={laporanSurveyHasil} onChange={e => setLaporanSurveyHasil(e.target.value)}
                  rows={4} placeholder="Kondisi AC, temuan, kendala, dll..."
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 6 }}>Catatan / Rekomendasi</div>
                <textarea value={laporanSurveyCatatan} onChange={e => setLaporanSurveyCatatan(e.target.value)}
                  rows={3} placeholder="Rekomendasi tindak lanjut, jenis pekerjaan yang disarankan, dll..."
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>

              {/* ── FOTO DOKUMENTASI SURVEY ── */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.text }}>
                    📸 Foto Dokumentasi
                    {laporanFotos.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: laporanFotos.filter(f => f.url).length === laporanFotos.length ? cs.green : cs.yellow, marginLeft: 6 }}>
                        {laporanFotos.filter(f => f.url).length}/{laporanFotos.length} tersimpan
                      </span>
                    )}
                  </div>
                  {laporanFotos.length < 20 && (
                    <button onClick={() => fotoInputRef.current?.click()}
                      style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                      + Tambah Foto
                    </button>
                  )}
                </div>
                <input ref={fotoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={handleFotoUpload} style={{ display: "none" }} />
                {laporanFotos.length === 0 ? (
                  <div onClick={() => fotoInputRef.current?.click()}
                    style={{ border: "2px dashed " + cs.border, borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer", color: cs.muted, fontSize: 13 }}>
                    📷 Ketuk untuk tambah foto dokumentasi (opsional)
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    {laporanFotos.map(f => (
                      <div key={f.id} style={{ position: "relative", aspectRatio: "1/1", borderRadius: 8, overflow: "hidden", border: "1px solid " + cs.border }}>
                        <img src={f.preview || f.url} alt={f.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                          {f.uploading ? "⏳" : f.url ? "" : f.errMsg ? "❌" : "⏳"}
                        </div>
                        <button onClick={() => setLaporanFotos(p => p.filter(x => x.id !== f.id))}
                          style={{ position: "absolute", top: 4, right: 4, background: "#000a", border: "none", color: "#fff", borderRadius: "50%", width: 22, height: 22, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                    {laporanFotos.length < 20 && (
                      <div onClick={() => fotoInputRef.current?.click()}
                        style={{ aspectRatio: "1/1", border: "2px dashed " + cs.border, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: cs.muted, fontSize: 22 }}>+</div>
                    )}
                  </div>
                )}
              </div>

              <button onClick={() => {
                  const up = laporanFotos.filter(f => f.uploading).length;
                  if (up > 0) { showNotif(`⏳ Tunggu ${up} foto selesai upload dulu`); return; }
                  const fail = laporanFotos.filter(f => !f.uploading && !f.url && f.errMsg).length;
                  if (fail > 0 && !window.confirm(`⚠️ ${fail} foto GAGAL upload dan tidak akan masuk laporan.\n\nLanjut submit? (Batal untuk retry / hapus dulu)`)) return;
                  submitLaporan();
                }} disabled={!laporanSurveyHasil.trim()}
                style={{ background: laporanSurveyHasil.trim() ? "linear-gradient(135deg," + cs.green + ",#059669)" : cs.surface,
                  border: "none", color: laporanSurveyHasil.trim() ? "#fff" : cs.muted,
                  padding: "13px", borderRadius: 10, cursor: laporanSurveyHasil.trim() ? "pointer" : "not-allowed",
                  fontWeight: 800, fontSize: 14 }}>
                ✓ Submit Laporan Survey
              </button>
            </div>
          ) : (<>

          {/* Step bar */}
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {[1, 2, 3, 4].map(s => <div key={s} style={{ flex: 1, height: 3, borderRadius: 99, background: laporanStep >= s ? cs.accent : cs.border }} />)}
          </div>
          <div style={{ fontSize: 11, color: cs.muted, marginBottom: 18, textAlign: "center" }}>Step {laporanStep}/4: {STEP_LABELS[laporanStep]}</div>

          {/* ── STEP 1: Konfirmasi Unit ── */}
          {laporanStep === 1 && (
            <div style={{ display: "grid", gap: 14 }}>

              {/* ── History AC Customer (referensi teknisi) ── */}
              {(() => {
                const custHistRef = buildCustomerHistory(
                  { name: laporanModal.customer, phone: laporanModal.phone },
                  ordersData.filter(o => o.id !== laporanModal.id),
                  laporanReports,
                  invoicesData,
                  customersData
                ).filter(h => h.laporan_id || h.status === "COMPLETED");
                if (custHistRef.length === 0) return null;
                const lastJob = custHistRef[0];
                const allUnits = custHistRef.flatMap(h => h.unit_detail || []);
                const acPernah = [...new Map(allUnits.map(u => [u.label || u.merk || "AC", u])).values()];
                return (
                  <div style={{ background: "#0ea5e908", border: "1px solid #0ea5e933", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, color: "#7dd3fc", fontSize: 12, marginBottom: 8 }}>
                      📋 Referensi History AC — {laporanModal.customer}
                      <span style={{ fontSize: 10, color: cs.muted, marginLeft: 8, fontWeight: 400 }}>
                        ({custHistRef.length} kunjungan sebelumnya)
                      </span>
                    </div>
                    <div style={{ background: cs.surface, borderRadius: 8, padding: "8px 10px", marginBottom: 8, fontSize: 11 }}>
                      <div style={{ fontWeight: 700, color: cs.text, marginBottom: 4 }}>
                        Terakhir dikunjungi: <span style={{ color: cs.accent }}>{lastJob.date}</span>
                        <span style={{ color: cs.muted, marginLeft: 8 }}>{lastJob.service} · {lastJob.teknisi}</span>
                      </div>
                      {(lastJob.unit_detail || []).map((u, ui) => (
                        <div key={ui} style={{
                          marginBottom: ui < (lastJob.unit_detail.length - 1) ? 8 : 0,
                          paddingBottom: ui < (lastJob.unit_detail.length - 1) ? 8 : 0,
                          borderBottom: ui < (lastJob.unit_detail.length - 1) ? "1px dashed " + cs.border : "none"
                        }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                            <span style={{ color: cs.accent, fontWeight: 700, fontSize: 12 }}>Unit {u.unit_no}</span>
                            <span style={{ color: cs.text, fontWeight: 600, fontSize: 12 }}>{u.label}</span>
                            {u.merk && <span style={{ color: cs.muted, fontSize: 11 }}>{u.merk}</span>}
                            {u.pk && <span style={{ fontSize: 10, background: cs.accent + "12", color: cs.accent, padding: "1px 6px", borderRadius: 99 }}>{u.pk}</span>}
                            {parseFloat(u.freon_ditambah) > 0 && (
                              <span style={{ fontSize: 10, background: cs.yellow + "12", color: cs.yellow, padding: "1px 6px", borderRadius: 99 }}>🧊 {u.freon_ditambah} psi freon</span>
                            )}
                            {u.ampere_akhir && (
                              <span style={{ fontSize: 10, background: cs.green + "12", color: cs.green, padding: "1px 6px", borderRadius: 99 }}>⚡ {u.ampere_akhir}A</span>
                            )}
                          </div>
                          {safeArr(u.kondisi_sebelum).length > 0 && (
                            <div style={{ fontSize: 11, marginBottom: 2 }}>
                              <span style={{ color: cs.muted }}>Kondisi masuk: </span>
                              {safeArr(u.kondisi_sebelum).map((k, ki) => (
                                <span key={ki} style={{ background: cs.yellow + "15", color: cs.yellow, fontSize: 10, padding: "1px 6px", borderRadius: 99, marginRight: 4 }}>{k}</span>
                              ))}
                            </div>
                          )}
                          {safeArr(u.pekerjaan).length > 0 && (
                            <div style={{ fontSize: 11, marginBottom: 2 }}>
                              <span style={{ color: cs.muted }}>Dikerjakan: </span>
                              {safeArr(u.pekerjaan).map((p, pi) => (
                                <span key={pi} style={{ background: cs.accent + "15", color: cs.accent, fontSize: 10, padding: "1px 6px", borderRadius: 99, marginRight: 4 }}>{p}</span>
                              ))}
                            </div>
                          )}
                          <div style={{ fontSize: 11 }}>
                            <span style={{ color: cs.muted }}>Setelah: </span>
                            {safeArr(u.kondisi_setelah).length > 0
                              ? safeArr(u.kondisi_setelah).map((k, ki) => (
                                <span key={ki} style={{ background: cs.green + "15", color: cs.green, fontSize: 10, padding: "1px 6px", borderRadius: 99, marginRight: 4 }}>{k}</span>
                              ))
                              : <span style={{ color: cs.muted, fontStyle: "italic" }}>tidak direkam</span>
                            }
                          </div>
                          {u.catatan_unit && <div style={{ fontSize: 11, color: "#7dd3fc", marginTop: 3 }}>💬 {u.catatan_unit}</div>}
                        </div>
                      ))}
                      {lastJob.rekomendasi && (
                        <div style={{ color: "#7dd3fc", marginTop: 4, fontStyle: "italic" }}>
                          💡 Rekomendasi lalu: {lastJob.rekomendasi}
                        </div>
                      )}
                    </div>
                    {acPernah.length > 0 && (
                      <div style={{ fontSize: 11, color: cs.muted }}>
                        <span style={{ fontWeight: 700, color: cs.text }}>AC di lokasi ini: </span>
                        {acPernah.map((u, ui) => (
                          <span key={ui} style={{ marginRight: 8 }}>
                            {u.label || u.merk || `Unit ${u.unit_no}`}
                            {u.merk && u.label ? ` (${u.merk})` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {custHistRef.length > 1 && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 11, color: cs.accent, cursor: "pointer", fontWeight: 700 }}>
                          Lihat semua {custHistRef.length} kunjungan ▾
                        </summary>
                        <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                          {custHistRef.map((h, hi) => (
                            <div key={hi} style={{ fontSize: 11, color: cs.muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ color: cs.text, fontFamily: "monospace" }}>{h.job_id}</span>
                              <span>{h.date}</span>
                              <span style={{ color: cs.accent }}>{h.service}</span>
                              <span>{h.units}unit</span>
                              <span>{h.teknisi}</span>
                              {h.laporan_id && <span style={{ color: cs.green }}>✅ lap</span>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}

              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 12, color: cs.muted, marginBottom: 10 }}>Order tercatat <b style={{ color: cs.text }}>{laporanModal.units || 1} unit</b> AC. Isi detail tipe & PK untuk setiap unit — penting untuk invoice!</div>

                <div style={{ background: cs.accent + "08", border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 10, color: cs.accent }}>
                  ⚠️ <strong>Wajib isi Tipe AC, Nama Ruangan & Merk</strong> — PK sudah termasuk dalam pilihan Tipe AC. Data ini langsung masuk invoice!
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {laporanUnits.map((u, idx) => (
                    <div key={idx} style={{ background: cs.surface, borderRadius: 10, border: "1px solid " + (TIPE_AC_OPT.includes(u.tipe) && u.label && u.label.trim() && u.merk && u.merk.trim() ? cs.green + "33" : cs.border), overflow: "hidden" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: cs.accent, padding: "8px 12px", background: cs.card + "33", borderBottom: "1px solid " + cs.border + "22", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span>Unit {u.unit_no}</span>
                        {u.maint_unit_id && (
                          <span style={{ fontSize: 10, background: cs.green + "18", color: cs.green, padding: "1px 8px", borderRadius: 99, fontWeight: 700 }}>
                            🏢 {u.label || "Unit Maintenance"}
                          </span>
                        )}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: "10px 12px" }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>Nama Ruangan *</span>
                          <input value={u.label} onChange={e => updateUnit(idx, { ...u, label: e.target.value })} placeholder="Posisi: Kamar Utama / Ruang Tamu / Kantor"
                            list="ruangan-preset"
                            style={{ background: cs.card, border: "1px solid " + (u.label && u.label.trim() ? cs.green + "44" : "#ef444430"), borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                          <datalist id="ruangan-preset">
                            <option value="Lantai 1 : Ruangan Depan" />
                            <option value="Lantai 1 : Ruangan Tamu 1" />
                            <option value="Lantai 1 : Ruangan Tamu 2" />
                            <option value="Lantai 1 : Ruangan Kamar" />
                            <option value="Lantai 1 : Ruang Makan" />
                            <option value="Lantai 1 : Dapur" />
                            <option value="Lantai 2 : Kamar Utama" />
                            <option value="Lantai 2 : Ruangan Ganti Baju Utama" />
                            <option value="Lantai 2 : Kamar Tidur 1" />
                            <option value="Lantai 2 : Kamar Tidur 2" />
                            <option value="Lantai 2 : Kamar Tidur 3" />
                            <option value="Lantai 2 : Ruang Tamu" />
                            <option value="Lantai 2 : Ruang Keluarga" />
                            <option value="Lantai 2 : Ruangan Gym" />
                            <option value="Lantai 2 : Ruangan Serbaguna" />
                            <option value="Lantai 1 - Ruangan Depan" />
                            <option value="Lantai 1 - Ruangan Belakang" />
                            <option value="Lantai 2 - Ruangan Depan" />
                            <option value="Lantai 2 - Ruangan Belakang" />
                            <option value="Lantai 3 - Ruangan Depan" />
                            <option value="Lantai 3 - Ruangan Belakang" />
                            <option value="Ruang Kantor" />
                            <option value="Ruang Rapat" />
                            <option value="Lobby / Resepsionis" />
                            <option value="Gudang" />
                          </datalist>
                        </div>

                        {laporanUnits.length > 1 && (
                          <button onClick={() => {
                            const deletedNo = idx + 1;
                            const nu = laporanUnits.filter((_, i) => i !== idx).map((u2, i) => ({ ...u2, unit_no: i + 1 }));
                            setLaporanUnits(nu); setActiveUnitIdx(Math.max(0, idx - 1));
                            setLaporanFotos(prev => prev.map(f => {
                              if (f.unit_no == null) return f;
                              if (f.unit_no === deletedNo) return { ...f, unit_no: null };
                              if (f.unit_no > deletedNo) return { ...f, unit_no: f.unit_no - 1 };
                              return f;
                            }));
                            // Cleaning-in-repair menyimpan unit_no → ikut remap saat unit dihapus,
                            // agar centang cuci tak salah-unit / hilang senyap.
                            setLaporanCleaningInRepair(prev => prev
                              .filter(n => n !== deletedNo)
                              .map(n => n > deletedNo ? n - 1 : n));
                          }}
                            style={{ background: "#ef444415", border: "1px solid #ef444430", color: "#ef4444", borderRadius: 6, padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700, lineHeight: 1, alignSelf: "flex-end" }}>×</button>
                        )}
                      </div>

                      <div style={{ padding: "0 12px 10px 12px", borderTop: "1px solid " + cs.border + "22" }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>Tipe AC *</span>
                          <select value={u.tipe} onChange={e => { const newTipe = e.target.value; const pkMatch = newTipe.match(/(\d[\d.,]*PK)/i); updateUnit(idx, { ...u, tipe: newTipe, pk: pkMatch ? pkMatch[1] : u.pk }); }}
                            style={{ background: cs.card, border: "1px solid " + (TIPE_AC_OPT.includes(u.tipe) ? cs.green + "44" : "#ef444430"), borderRadius: 6, padding: "8px 10px", color: TIPE_AC_OPT.includes(u.tipe) ? cs.text : cs.muted, fontSize: 11, outline: "none", fontWeight: TIPE_AC_OPT.includes(u.tipe) ? 600 : 400, boxSizing: "border-box", width: "100%" }}>
                            <option value="">-- Pilih Tipe AC --</option>
                            {TIPE_AC_OPT.map(t => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>

                      <div style={{ padding: "0 12px 10px 12px", borderTop: "1px solid " + cs.border + "22" }}>
                        <div style={{ display: "grid", gap: 4, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>Merk AC *</span>
                          <input value={u.merk || ""} onChange={e => updateUnit(idx, { ...u, merk: e.target.value })} placeholder="Contoh: Daikin, Panasonic, Mitsubishi"
                            style={{ background: cs.card, border: "1px solid " + (u.merk && u.merk.trim() ? cs.green + "44" : "#ef444430"), borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 11, outline: "none", fontWeight: u.merk && u.merk.trim() ? 600 : 400, boxSizing: "border-box" }} />
                        </div>
                      </div>

                      <div style={{ padding: "0 12px 10px 12px", borderTop: "1px solid " + cs.border + "22" }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span style={{ fontSize: 10, color: cs.muted, fontWeight: 600 }}>Model (opsional)</span>
                          <input value={u.model || ""} onChange={e => updateUnit(idx, { ...u, model: e.target.value })} placeholder="Kode Unit Indoor / Outdoor"
                            style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 11, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        {u.from_history_job_id && (
                          <div style={{ fontSize: 9, color: cs.muted, marginTop: 6, fontStyle: "italic" }}>
                            ✓ Dari history: {u.from_history_job_id}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {laporanUnits.length < 30 && (
                  <button onClick={() => { setLaporanUnits(p => [...p, mkUnit(p.length + 1)]); setActiveUnitIdx(laporanUnits.length); }}
                    style={{ marginTop: 10, width: "100%", background: cs.accent + "12", border: "1px dashed " + cs.accent + "44", color: cs.accent, borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                    + Tambah Unit AC
                  </button>
                )}
                {(() => {
                  if (!laporanModal?.maintenance_client_id) return null;
                  const available = maintUnitPool.filter(mu => !laporanUnits.some(u => u.maint_unit_id === mu.id));
                  if (available.length === 0) return null;
                  return (
                    <button onClick={() => { setAddMaintSelected(new Set()); setShowAddMaintUnitModal(true); }}
                      style={{ marginTop: 8, width: "100%", background: cs.green + "12", border: "1px dashed " + cs.green + "55", color: cs.green, borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      🏢 Tambah dari Daftar Maintenance ({available.length} unit belum dipilih)
                    </button>
                  );
                })()}
                {(() => {
                  // Registry customer reguler — tombol pilih unit tersimpan
                  if (laporanModal?.maintenance_client_id) return null;
                  const available = acUnitPool.filter(au => !laporanUnits.some(u => u.ac_unit_id === au.id));
                  if (available.length === 0) return null;
                  return (
                    <button onClick={() => { setAddAcSelected(new Set()); setShowAddAcUnitModal(true); }}
                      style={{ marginTop: 8, width: "100%", background: cs.accent + "12", border: "1px dashed " + cs.accent + "55", color: cs.accent, borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      🔧 Tambah dari Unit Tersimpan ({available.length} unit)
                    </button>
                  );
                })()}
              </div>
              {laporanUnits.length !== (laporanModal.units || 1) && (
                <div style={{ background: cs.yellow + "10", border: "1px solid " + cs.yellow + "22", borderRadius: 9, padding: "9px 13px", fontSize: 11, color: cs.yellow }}>
                  ⚠ Jumlah unit berbeda dari order. Admin akan dinotifikasi untuk verifikasi.
                </div>
              )}

              {(() => {
                const incomplete = laporanUnits.filter(u =>
                  !TIPE_AC_OPT.includes(u.tipe) ||
                  !u.label || !u.label.trim() ||
                  !u.merk || !u.merk.trim()
                );
                return incomplete.length > 0 ? (
                  <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 9, padding: "10px 13px", fontSize: 11, color: "#ef4444", fontWeight: 600 }}>
                    ❌ Lengkapi dulu: {incomplete.map(u => `Unit ${u.unit_no}`).join(", ")} — Pastikan Tipe AC dipilih dari daftar, Nama Ruangan & Merk terisi!
                  </div>
                ) : null;
              })()}

              <button onClick={() => {
                const incomplete = laporanUnits.filter(u => !TIPE_AC_OPT.includes(u.tipe) || !u.label || !u.label.trim() || !u.merk || !u.merk.trim());
                if (incomplete.length > 0) {
                  showNotif(`⚠️ Lengkapi: ${incomplete.map(u => `Unit ${u.unit_no}`).join(", ")} — Tipe AC harus dipilih dari daftar, Nama Ruangan & Merk wajib diisi!`);
                  return;
                }
                setLaporanStep(laporanModal?.service === "Install" ? 3 : 2);
              }} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "13px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                Lanjut — Isi Detail Unit →
              </button>
            </div>
          )}
          {/* ── STEP 2: Detail Per Unit ── */}
          {laporanStep === 2 && (
            <div style={{ display: "grid", gap: 14 }}>
              <input ref={fotoUnitInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={handleFotoUpload} style={{ display: "none" }} />
              <div style={{ background: cs.green + "08", border: "1px solid " + cs.green + "33", borderRadius: 10, padding: "10px 12px", fontSize: 11, color: cs.green, lineHeight: 1.6 }}>
                ✅ <strong>Step 1 selesai!</strong> Sekarang isi detail kondisi & pekerjaan untuk setiap unit. Step 3 (Material) opsional — hanya jika ada tambahan biaya.
              </div>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                {laporanUnits.map((u, idx) => {
                  const done = isUnitDone(u);
                  return (
                    <button key={idx} onClick={() => setActiveUnitIdx(idx)}
                      style={{
                        flexShrink: 0, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, border: "none",
                        background: activeUnitIdx === idx ? "linear-gradient(135deg," + cs.accent + ",#3b82f6)" : done ? cs.green + "18" : cs.card,
                        color: activeUnitIdx === idx ? "#0a0f1e" : done ? cs.green : cs.muted,
                        outline: activeUnitIdx !== idx && !done ? "1px solid " + cs.border : "none"
                      }}>
                      {done ? "✓ " : ""}{u.label || `Unit ${u.unit_no}`}
                    </button>
                  );
                })}
              </div>

              {laporanUnits[activeUnitIdx] && (() => {
                const u = laporanUnits[activeUnitIdx];
                const upd = (f) => updateUnit(activeUnitIdx, { ...u, ...f });
                return (
                  <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14, display: "grid", gap: 12 }}>
                    <div style={{ background: cs.surface, border: "1px solid " + cs.accent + "22", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{u.tipe}</span>
                        {u.merk && <span style={{ fontSize: 12, color: cs.muted }}>🏷 {u.merk}</span>}
                        {u.model && <span style={{ fontSize: 11, color: cs.muted }}>{u.model}</span>}
                        {u.label && <span style={{ fontSize: 11, color: cs.accent }}>📍 {u.label}</span>}
                      </div>
                      <button onClick={() => setLaporanStep(1)}
                        style={{ fontSize: 11, color: cs.accent, background: cs.accent + "12", border: "1px solid " + cs.accent + "33", borderRadius: 6, padding: "4px 10px", cursor: "pointer", flexShrink: 0, fontWeight: 600 }}>
                        ✏️ Edit Info
                      </button>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow, marginBottom: 6 }}>⚠ Kondisi Sebelum</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                        {KONDISI_SBL.map(k => (
                          <label key={k} style={tagStyle(u.kondisi_sebelum.includes(k), cs.yellow)}>
                            <input type="checkbox" checked={u.kondisi_sebelum.includes(k)} onChange={() => upd({ kondisi_sebelum: toggleArr(u.kondisi_sebelum, k) })} style={{ accentColor: cs.yellow }} />{k}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent, marginBottom: 6 }}>🔧 Pekerjaan Dilakukan</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                        {PEKERJAAN_OPT(laporanModal?.service || "Cleaning").map(k => (
                          <label key={k} style={tagStyle(u.pekerjaan.includes(k), cs.accent)}>
                            <input type="checkbox" checked={u.pekerjaan.includes(k)} onChange={() => upd({ pekerjaan: toggleArr(u.pekerjaan, k) })} style={{ accentColor: cs.accent }} />{k}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.green, marginBottom: 6 }}>✓ Kondisi Sesudah</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                        {KONDISI_SDH.map(k => (
                          <label key={k} style={tagStyle(u.kondisi_setelah.includes(k), cs.green)}>
                            <input type="checkbox" checked={u.kondisi_setelah.includes(k)} onChange={() => upd({ kondisi_setelah: toggleArr(u.kondisi_setelah, k) })} style={{ accentColor: cs.green }} />{k}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Tekanan Freon (psi)</div>
                        <input type="number" value={u.freon_ditambah} onChange={e => upd({ freon_ditambah: e.target.value })} placeholder="0" min="0" step="0.1"
                          style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Ampere Akhir (A)</div>
                        <input type="number" value={u.ampere_akhir} onChange={e => upd({ ampere_akhir: e.target.value })} placeholder="0.0" min="0" step="0.1"
                          style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Catatan Unit (Opsional)</div>
                      <textarea value={u.catatan_unit} onChange={e => upd({ catatan_unit: e.target.value })} rows={2} placeholder="Catatan khusus unit ini..."
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
                    </div>
                    {(() => {
                      const unitFotos = laporanFotos.filter(f => f.unit_no === u.unit_no);
                      return (
                        <div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#0ea5e9" }}>📸 Foto Unit Ini ({unitFotos.length})</div>
                            <button onClick={() => { fotoTargetUnitRef.current = u.unit_no; fotoUnitInputRef.current?.click(); }}
                              disabled={laporanFotos.length >= 20}
                              style={{ fontSize: 11, color: "#0ea5e9", background: "#0ea5e912", border: "1px solid #0ea5e944", borderRadius: 6, padding: "4px 10px", cursor: laporanFotos.length >= 20 ? "not-allowed" : "pointer", opacity: laporanFotos.length >= 20 ? 0.5 : 1, fontWeight: 600 }}>
                              + Tambah Foto Unit
                            </button>
                          </div>
                          {unitFotos.length === 0 ? (
                            <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic" }}>Belum ada foto khusus unit ini (opsional — boleh juga foto umum di Step 3).</div>
                          ) : (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {unitFotos.map(f => {
                                const failed = !f.uploading && !f.url;
                                return (
                                <div key={f.id} style={{ position: "relative", width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: "1px solid " + (failed ? cs.red : f.url ? "#22c55e66" : cs.border) }}>
                                  <img src={f.data_url || fotoSrc(f.url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: f.uploading ? 0.5 : 1 }} />
                                  {f.uploading && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", background: "#000a" }}>⏳</div>}
                                  {!f.uploading && f.url && <div style={{ position: "absolute", bottom: 2, left: 2, background: "#22c55e", color: "#fff", fontSize: 8, padding: "0 4px", borderRadius: 99, fontWeight: 700 }}>☁️</div>}
                                  {failed && (
                                    <div title="Upload gagal — ketuk untuk coba lagi"
                                      onClick={() => retryFoto(f)}
                                      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 2, fontSize: 9, color: "#fff", background: cs.red + "cc", cursor: "pointer", fontWeight: 700 }}>
                                      <span style={{ fontSize: 14 }}>⚠️</span>Retry
                                    </div>
                                  )}
                                  <button onClick={() => setLaporanFotos(prev => prev.filter(x => x.id !== f.id))}
                                    style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: 9, background: cs.red, color: "#fff", border: "none", fontSize: 11, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
                                </div>
                              );})}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <button onClick={() => setLaporanStep(1)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>← Kembali</button>
                <div style={{ textAlign: "center", fontSize: 11, color: cs.muted, alignSelf: "center" }}>{laporanUnits.filter(isUnitDone).length}/{laporanUnits.length} unit ✓</div>
                <button onClick={() => {
                  if (!isInstallJob && incompleteUnits.length > 0) {
                    const incomplete = incompleteUnits.map(u => `Unit ${u.unit_no}`).join(", ");
                    showNotif(`⚠️ Lengkapi dulu: ${incomplete} — Pastikan Tipe AC & PK sudah diisi untuk semua unit`);
                    setActiveUnitIdx(laporanUnits.findIndex(u => !isUnitDone(u)));
                    return;
                  }
                  setLaporanStep(3);
                }} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>Lanjut →</button>
              </div>
            </div>
          )}
          {/* ── STEP 3: Material & Foto ── */}
          {laporanStep === 3 && (
            <div style={{ display: "grid", gap: 14 }}>

              {/* ══ REPORT INSTALL FORM ══ */}
              {isInstallJob && (
                <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, marginBottom: 2 }}>🔧 Detail Pekerjaan Instalasi</div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Isi 0 jika tidak dikerjakan.</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: cs.muted, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 }}>Jasa Pemasangan</div>
                  {INSTALL_ITEMS.filter(it => ["jasa_ganti_instalasi", "pasang_05_1pk", "pasang_15_2pk", "bongkar_05_1pk", "bongkar_15_25pk", "bongkar_pasang_indoor", "bongkar_pasang_outdoor", "vacum_05_25pk"].includes(it.key)).map(item => (
                    <div key={item.key} style={{
                      display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                      background: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.accent + "08" : cs.card,
                      border: "1px solid " + (parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.accent + "44" : cs.border),
                      borderRadius: 8, padding: "8px 10px"
                    }}>
                      <div style={{ fontSize: 12, color: cs.text, fontWeight: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? 700 : 400 }}>
                        {item.label}<span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({item.satuan})</span>
                      </div>
                      <input type="number" min="0" step={item.satuan === "Meter" ? "0.5" : "1"}
                        value={laporanInstallItems[item.key] ?? ""}
                        onChange={e => setLaporanInstallItems(prev => ({ ...prev, [item.key]: e.target.value }))}
                        placeholder="0"
                        style={{ width: 64, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 8px", color: cs.text, fontSize: 13, outline: "none", textAlign: "center" }} />
                    </div>
                  ))}
                  <div style={{ fontSize: 10, fontWeight: 700, color: cs.muted, letterSpacing: 1, textTransform: "uppercase", marginTop: 6 }}>Material</div>
                  {INSTALL_ITEMS.filter(it => ["pipa_1pk", "pipa_2pk", "pipa_25pk", "pipa_3pk", "kabel_15", "kabel_25", "ducttape_biasa", "ducttape_lem", "jasa_pipa_ac", "jasa_pipa_ruko", "dinabolt", "karet_mounting", "breket_outdoor", "paralon", "selang_flexibel_drain"].includes(it.key)).map(item => (
                    <div key={item.key} style={{
                      display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                      background: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.green + "08" : cs.card,
                      border: "1px solid " + (parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.green + "44" : cs.border),
                      borderRadius: 8, padding: "8px 10px"
                    }}>
                      <div style={{ fontSize: 12, color: cs.text, fontWeight: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? 700 : 400 }}>
                        {item.label}<span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({item.satuan})</span>
                      </div>
                      <input type="number" min="0" step={item.satuan === "Meter" ? "0.5" : "1"}
                        value={laporanInstallItems[item.key] ?? ""}
                        onChange={e => setLaporanInstallItems(prev => ({ ...prev, [item.key]: e.target.value }))}
                        placeholder="0"
                        style={{ width: 64, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 8px", color: cs.text, fontSize: 13, outline: "none", textAlign: "center" }} />
                    </div>
                  ))}
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#38bdf8", letterSpacing: 1, textTransform: "uppercase", marginTop: 6 }}>❄️ Freon & Vacum</div>
                  {INSTALL_ITEMS.filter(it => ["kuras_vacum_r32", "kuras_vacum_r22", "freon_r22", "freon_r32", "freon_r410"].includes(it.key)).map(item => (
                    <div key={item.key} style={{
                      display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                      background: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? "#38bdf808" : cs.card,
                      border: "1px solid " + (parseFloat(laporanInstallItems[item.key] || 0) > 0 ? "#38bdf844" : cs.border),
                      borderRadius: 8, padding: "8px 10px"
                    }}>
                      <div style={{ fontSize: 12, color: cs.text, fontWeight: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? 700 : 400 }}>
                        {item.label}<span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({item.satuan})</span>
                      </div>
                      <input type="number" min="0" step={item.satuan === "KG" ? "0.5" : "1"}
                        value={laporanInstallItems[item.key] ?? ""}
                        onChange={e => setLaporanInstallItems(prev => ({ ...prev, [item.key]: e.target.value }))}
                        placeholder="0"
                        style={{ width: 64, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 8px", color: cs.text, fontSize: 13, outline: "none", textAlign: "center" }} />
                    </div>
                  ))}
                  {Object.values(laporanInstallItems).some(v => parseFloat(v || 0) > 0) && (
                    <div style={{ background: cs.green + "10", border: "1px solid " + cs.green + "33", borderRadius: 9, padding: "8px 12px", fontSize: 11, color: cs.green, marginTop: 4 }}>
                      ✅ {INSTALL_ITEMS.filter(it => parseFloat(laporanInstallItems[it.key] || 0) > 0).length} item diisi
                    </div>
                  )}
                </div>
              )}

              {/* ══ CLEANING-IN-REPAIR CHECKBOX (Repair only) ══ */}
              {laporanModal?.service === "Repair" && (laporanUnits || []).some(u => u && u.tipe) && (
                <div style={{ background: "#06b6d408", border: "1px solid #06b6d433", borderRadius: 10, padding: "12px 14px", display: "grid", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#06b6d4" }}>🧽 Tambahan Cleaning (opsional)</div>
                    <div style={{ fontSize: 11, color: cs.muted, marginTop: 3, lineHeight: 1.4 }}>
                      Centang unit yang juga dicuci. Harga otomatis dari PRICE_LIST berdasarkan PK unit.
                      <br /><strong style={{ color: "#06b6d4" }}>Isi hanya jika job Repair ini berubah / menambah pekerjaan Cleaning.</strong>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {(laporanUnits || []).filter(u => u && u.tipe).map(u => {
                      const hargaUnit = hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData);
                      const bracket = getBracketKey("Cleaning", u.tipe) || u.tipe;
                      const checked = laporanCleaningInRepair.includes(u.unit_no);
                      const unitLabel = u.label || u.merk || ("Unit " + u.unit_no);
                      return (
                        <label key={u.unit_no} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          background: checked ? "#06b6d412" : cs.surface,
                          border: "1px solid " + (checked ? "#06b6d466" : cs.border),
                          borderRadius: 8, padding: "8px 12px", cursor: "pointer"
                        }}>
                          <input type="checkbox" checked={checked} onChange={() => {
                            setLaporanCleaningInRepair(prev => checked
                              ? prev.filter(n => n !== u.unit_no)
                              : [...prev, u.unit_no]);
                          }} style={{ cursor: "pointer" }} />
                          <div style={{ flex: 1, fontSize: 12, color: cs.text }}>
                            <div style={{ fontWeight: 700 }}>Unit {u.unit_no} — {unitLabel}</div>
                            <div style={{ fontSize: 10, color: cs.muted }}>{bracket} · {u.tipe}</div>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#06b6d4", fontFamily: "monospace" }}>
                            Rp {hargaUnit.toLocaleString("id-ID")}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {laporanCleaningInRepair.length > 0 && (
                    <div style={{ fontSize: 11, color: "#06b6d4", fontWeight: 700, textAlign: "right" }}>
                      Total tambahan cleaning: Rp {((laporanUnits || [])
                        .filter(u => u && u.tipe && laporanCleaningInRepair.includes(u.unit_no))
                        .reduce((s, u) => s + hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData), 0)
                      ).toLocaleString("id-ID")}
                    </div>
                  )}
                </div>
              )}

              {/* ══ UNIFIED ITEM PICKER ══ */}
              {!isInstallJob && (() => {
                const dedupe = (arr) => arr.filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i);
                const isJasaCat = (r) => {
                  if (r.category === "Jasa") return true;
                  const c = (r.category || "").toLowerCase(); if (c.startsWith("freon")) return true;
                  const t = (r.type || "").toLowerCase();
                  return t.includes("kuras vacum") || t.includes("tambah freon") || t.includes("penambahan freon") || t.includes("biaya transport") || t.includes("biaya pengecekan");
                };
                const isBarangCat = (r) => {
                  if (r.category === "Barang") return true;
                  const c = (r.category || "").toLowerCase(); if (c.startsWith("freon")) return true;
                  const t = (r.type || "").toLowerCase();
                  return ["kapasitor", "naple", "breket", "dinabolt", "armaflex", "freon r-", "freon r3", "freon r4", "freon r2", "pipa ac", "kabel listrik", "duct tape"].some(k => t.includes(k));
                };
                const jasaOpt = dedupe(priceListData.filter(r => isJasaCat(r) && parseInt(r.price || 0) > 0).map(r => ({ nama: r.type, satuan: r.unit || "pcs", harga: parseInt(r.price || 0) }))).slice(0, 150);
                const barangOpt = dedupe(priceListData.filter(r => isBarangCat(r) && parseInt(r.price || 0) > 0).map(r => ({ nama: r.type, satuan: r.unit || "pcs", harga: parseInt(r.price || 0) }))).slice(0, 150);
                return (
                  <div style={{ display: "grid", gap: 6, background: cs.surface, borderRadius: 10, padding: "10px 12px", border: "1px solid " + cs.border }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.text }}>➕ Tambah Item</div>
                    <select value="" onChange={e => {
                      const v = e.target.value; if (!v) return;
                      if (v === "__manual_jasa__") setLaporanJasaItems(p => [...p, { id: Date.now(), nama: "__manual__", _isManual: true, jumlah: 1, satuan: "pcs", harga_satuan: 0 }]);
                      else if (v === "__manual_barang__") setLaporanBarangItems(p => [...p, { id: Date.now(), nama: "__manual__", _isManual: true, jumlah: 1, satuan: "pcs", harga_satuan: 0 }]);
                      else {
                        const sel = [...jasaOpt, ...barangOpt].find(x => x.nama === v);
                        if (sel) {
                          const cat = categoryFromCatalog(v, priceListData);
                          const row = { id: Date.now() + Math.floor(Math.random() * 1000), nama: sel.nama, jumlah: 1, satuan: sel.satuan, harga_satuan: sel.harga, _isManual: false, category: cat };
                          if (cat === "LABOR" || cat === "FEE") setLaporanJasaItems(p => [...p, row]);
                          else setLaporanBarangItems(p => [...p, row]);
                        }
                      }
                      e.target.value = "";
                    }} style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 10px", color: cs.text, fontSize: 13 }}>
                      <option value="">— Pilih item dari katalog —</option>
                      <optgroup label="⚡ Jasa / Layanan">{jasaOpt.map(o => <option key={"j_" + o.nama} value={o.nama}>{o.nama}</option>)}</optgroup>
                      <optgroup label="📦 Sparepart & Material">{barangOpt.map(o => <option key={"b_" + o.nama} value={o.nama}>{o.nama}</option>)}</optgroup>
                      <option value="__manual_jasa__">✏️ Jasa manual…</option>
                      <option value="__manual_barang__">✏️ Barang manual…</option>
                    </select>
                    <div style={{ fontSize: 11, color: cs.muted }}>💡 Kategori item terdeteksi dari katalog → otomatis masuk grup yang tepat di bawah. Tak perlu pilih section.</div>
                  </div>
                );
              })()}

              {/* ══ JASA SECTION ══ */}
              {!isInstallJob && (
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>⚡ Jasa / Layanan ({laporanJasaItems.length})</div>
                    </div>
                    <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 8, padding: "8px 10px", lineHeight: "1.4" }}>
                      💡 <strong>Pekerjaan yang ditagih.</strong> Contoh: Biaya cek AC, kuras vacum, pasang kompresor, jasa pemasangan, dll.
                    </div>
                  </div>
                  {laporanJasaItems.length === 0 && (
                    <div style={{
                      textAlign: "center", padding: "10px 0", fontSize: 12, color: cs.muted,
                      background: cs.surface, borderRadius: 8, border: "1px dashed " + cs.border
                    }}>
                      Belum ada jasa. Pakai "➕ Tambah Item" di atas untuk input biaya layanan.
                    </div>
                  )}
                  {laporanJasaItems.map((item) => {
                    const _isJasaItem = (r) => {
                      if (r.category === "Jasa") return true;
                      const cat = (r.category || "").toLowerCase();
                      if (cat.startsWith("freon")) return true;
                      const t = (r.type || "").toLowerCase();
                      return t.includes("kuras vacum") || t.includes("tambah freon") || t.includes("penambahan freon")
                        || t.includes("biaya transport") || t.includes("biaya pengecekan");
                    };
                    const allJasaOpt = priceListData
                      .filter(r => _isJasaItem(r) && parseInt(r.price || 0) > 0)
                      .map(r => ({ nama: r.type, satuan: r.unit || "pcs", harga: parseInt(r.price || 0) }))
                      .filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i)
                      .slice(0, 100);
                    return (
                      <div key={item.id} style={{
                        background: cs.card, border: "1px solid " + (item.nama ? cs.accent + "44" : cs.border),
                        borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <select
                            value={item._isManual ? "__manual__" : item.nama}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === "__manual__") {
                                setLaporanJasaItems(p => p.map(j => j.id === item.id
                                  ? { ...j, nama: "__manual__", _isManual: true, harga_satuan: 0, satuan: "pcs" } : j));
                                setJasaManualText(p => ({ ...p, [item.id]: "" }));
                              } else {
                                const sel = allJasaOpt.find(x => x.nama === val);
                                setLaporanJasaItems(p => p.map(j => j.id === item.id
                                  ? { ...j, nama: val, _isManual: false, harga_satuan: sel?.harga || 0, satuan: sel?.satuan || "pcs" } : j));
                              }
                            }}
                            style={{
                              flex: 1, background: cs.surface, border: "1px solid " + cs.border,
                              borderRadius: 8, padding: "8px 10px", color: item.nama ? cs.text : cs.muted, fontSize: 13
                            }}>
                            <option value="">-- Pilih jasa --</option>
                            {allJasaOpt.map(o => (
                              <option key={o.nama} value={o.nama}>{o.nama}</option>
                            ))}
                            <option value="__manual__">✏️ Input manual...</option>
                          </select>
                          <button onMouseDown={() => setLaporanJasaItems(p => p.filter(j => j.id !== item.id))}
                            style={{
                              background: "#ef444420", border: "none", color: "#ef4444",
                              borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 14, fontWeight: 700, flexShrink: 0
                            }}>
                            ×
                          </button>
                        </div>
                        {item._isManual && (
                          <input
                            value={jasaManualText[item.id] ?? ""}
                            onChange={e => setJasaManualText(p => ({ ...p, [item.id]: e.target.value }))}
                            onBlur={() => {
                              const txt = (jasaManualText[item.id] || "").trim();
                              if (txt) setLaporanJasaItems(p => p.map(j => j.id === item.id
                                ? { ...j, nama: txt, _isManual: true } : j));
                            }}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                const txt = (jasaManualText[item.id] || "").trim();
                                if (txt) setLaporanJasaItems(p => p.map(j => j.id === item.id
                                  ? { ...j, nama: txt, _isManual: true } : j));
                                e.target.blur();
                              }
                            }}
                            placeholder="Ketik nama jasa..."
                            autoFocus
                            style={{
                              width: "100%", background: cs.surface, border: "1px solid " + cs.accent + "55",
                              borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, outline: "none"
                            }} />
                        )}
                        <div>
                          <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Jumlah Unit</div>
                          <input type="number" min="1" step="1" value={item.jumlah || 1}
                            onChange={e => setLaporanJasaItems(p => p.map(j => j.id === item.id
                              ? { ...j, jumlah: parseFloat(e.target.value) || 1 } : j))}
                            style={{
                              width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                              borderRadius: 8, padding: "7px 10px", color: cs.text, fontSize: 13, outline: "none"
                            }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* ══ BARANG / SPAREPART SECTION ══ */}
              {!isInstallJob && (
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: cs.cyan }}>📦 Sparepart & Material ({laporanBarangItems.length})</div>
                    </div>
                    <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 8, padding: "8px 10px", lineHeight: "1.4" }}>
                      💡 <strong>Barang fisik yang ditagih.</strong> Contoh: Kapasitor, pipa AC, kabel, NAPLE, paralon, armaplex, dll.
                    </div>
                  </div>

                  {laporanBarangItems.length === 0 && (
                    <div style={{
                      textAlign: "center", padding: "10px 0", fontSize: 12, color: cs.muted,
                      background: cs.surface, borderRadius: 8, border: "1px dashed " + cs.border
                    }}>
                      Belum ada barang. Pakai "➕ Tambah Item" di atas untuk input sparepart/material yang ditagih.
                    </div>
                  )}
                  {laporanBarangItems.map((bItem) => {
                    const _isBarangItem = (r) => {
                      if (r.category === "Barang") return true;
                      const cat = (r.category || "").toLowerCase();
                      if (cat.startsWith("freon")) return true;
                      const t = (r.type || "").toLowerCase();
                      return t.includes("kapasitor") || t.includes("naple") || t.includes("breket")
                        || t.includes("dinabolt") || t.includes("armaflex") || t.includes("freon r-")
                        || t.includes("freon r3") || t.includes("freon r4") || t.includes("freon r2")
                        || t.includes("pipa ac") || t.includes("kabel listrik") || t.includes("duct tape");
                    };
                    const barangOpt = priceListData
                      .filter(r => _isBarangItem(r) && parseInt(r.price || 0) > 0)
                      .map(r => ({ nama: r.type, satuan: r.unit || "pcs", harga: parseInt(r.price || 0) }));
                    const allBarangOpt = barangOpt
                      .filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i).slice(0, 100);
                    return (
                      <div key={bItem.id} style={{
                        background: cs.card, border: "1px solid " + (bItem.nama ? cs.cyan + "44" : cs.border),
                        borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <select
                            value={bItem._isManual ? "__manual__" : bItem.nama}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === "__manual__") {
                                setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                  ? { ...b, nama: "__manual__", _isManual: true, harga_satuan: 0, satuan: "pcs" } : b));
                                setRepairManualText(p => ({ ...p, [bItem.id]: "" }));
                              } else {
                                const sel = allBarangOpt.find(x => x.nama === val);
                                setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                  ? { ...b, nama: val, _isManual: false, harga_satuan: sel?.harga || 0, satuan: sel?.satuan || "pcs" } : b));
                              }
                            }}
                            style={{
                              flex: 1, background: cs.surface, border: "1px solid " + cs.border,
                              borderRadius: 8, padding: "8px 10px", color: bItem.nama && !bItem._isManual ? cs.text : cs.muted, fontSize: 13
                            }}>
                            <option value="">-- Pilih barang/material --</option>
                            {allBarangOpt.map(o => (
                              <option key={o.nama} value={o.nama}>{o.nama}</option>
                            ))}
                            <option value="__manual__">✏️ Input manual...</option>
                          </select>
                          <button onMouseDown={() => setLaporanBarangItems(p => p.filter(b => b.id !== bItem.id))}
                            style={{
                              background: "#ef444420", border: "none", color: "#ef4444",
                              borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 14, fontWeight: 700, flexShrink: 0
                            }}>
                            ×
                          </button>
                        </div>
                        {bItem._isManual && (
                          <input
                            value={repairManualText[bItem.id] ?? ""}
                            onChange={e => setRepairManualText(p => ({ ...p, [bItem.id]: e.target.value }))}
                            onBlur={() => {
                              const txt = (repairManualText[bItem.id] || "").trim();
                              if (txt) setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                ? { ...b, nama: txt, _isManual: true } : b));
                            }}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                const txt = (repairManualText[bItem.id] || "").trim();
                                if (txt) setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                  ? { ...b, nama: txt, _isManual: true } : b));
                                e.target.blur();
                              }
                            }}
                            placeholder="Ketik nama barang/material..."
                            autoFocus
                            style={{
                              width: "100%", background: cs.surface, border: "1px solid " + cs.cyan + "55",
                              borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, outline: "none"
                            }} />
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Jumlah</div>
                            <input type="number" min="1" step="1" value={bItem.jumlah || 1}
                              onChange={e => setLaporanBarangItems(p => p.map(b => b.id === bItem.id
                                ? { ...b, jumlah: parseFloat(e.target.value) || 1 } : b))}
                              style={{
                                width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                                borderRadius: 8, padding: "7px 10px", color: cs.text, fontSize: 13, outline: "none"
                              }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>Satuan</div>
                            <div style={{
                              background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8,
                              padding: "8px 10px", color: cs.muted, fontSize: 13, textAlign: "center"
                            }}>
                              {bItem.satuan || "pcs"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* ══ NORMAL MATERIAL FORM (Service/Repair/Complain) ══ */}
              {!isInstallJob && (
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted }}>📊 Stok Terpakai (Tracking) ({laporanMaterials.length}/20)</div>
                        <button onClick={() => setShowMatPreset(v => !v)}
                          style={{ fontSize: 11, background: cs.muted + "15", border: "1px solid " + cs.muted + "33", color: cs.muted, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
                          {showMatPreset ? "✕ Tutup" : "📦 Preset"}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 8, padding: "8px 10px", lineHeight: "1.4", marginBottom: 8 }}>
                        ℹ️ <strong>Hanya tracking stok, TIDAK masuk invoice.</strong>{" "}
                        {materialConfirmDeductOn
                          ? <>Stok <strong>pipa/kabel/freon dipotong lewat menu Material Harian</strong> (konfirmasi Owner) — di sini hanya catatan pemakaian, tidak memotong stok saat submit.</>
                          : <>Pilih material yang dipakai (freon tabung, pipa roll, kabel). Harga otomatis terdebit dari stok internal saat submit.</>}
                      </div>
                    </div>
                    {showMatPreset && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        <div style={{ fontSize: 11, color: cs.muted, width: "100%", marginBottom: 2 }}>Klik untuk tambah material tracking:</div>
                        {presets.map(p => (
                          <button key={p.nama || p} onClick={() => { if (laporanMaterials.length < 20) setLaporanMaterials(prev => [...prev, { id: Date.now(), nama: p.nama || p, jumlah: "", satuan: p.satuan || "pcs", keterangan: "" }]); setShowMatPreset(false); }}
                            style={{ fontSize: 11, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                            {p.nama || p}
                          </button>
                        ))}
                      </div>
                    )}
                    {laporanMaterials.length === 0 && <div style={{ textAlign: "center", padding: "14px 0", fontSize: 12, color: cs.muted, fontStyle: "italic" }}>Belum ada. Klik + Tambah atau pakai Preset untuk catat stok yang terpakai.</div>}
                    {laporanMaterials.map(mat => {
                      const matLookup = [
                        ...inventoryData.map(r => ({ nama: r.name, satuan: r.unit || "pcs" })),
                        ...priceListData.filter(r => r.service === "Material").map(r => ({ nama: r.type, satuan: r.unit || "pcs" }))
                      ].filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i);
                      const isSearching = matSearchId === mat.id;
                      const query = isSearching ? debouncedMatSearchQuery : "";
                      const filtered = matLookup.filter(x =>
                        x.nama.toLowerCase().includes(query.toLowerCase())
                      ).slice(0, 12);
                      return (
                        <div key={mat.id} style={{ background: cs.card, border: "1px solid " + (mat.nama ? cs.accent + "44" : cs.border), borderRadius: 10, padding: "10px 12px", marginBottom: 6 }}>
                          <div style={{ position: "relative", marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{ flex: 1, position: "relative" }}>
                                <input
                                  id={"mat_search_" + mat.id}
                                  value={isSearching ? matSearchQuery : mat.nama}
                                  placeholder="Cari material..."
                                  onFocus={() => { setMatSearchId(mat.id); setMatSearchQuery(mat.nama); }}
                                  onChange={e => { setMatSearchQuery(e.target.value); }}
                                  onBlur={() => setTimeout(() => { setMatSearchId(null); setMatSearchQuery(""); }, 200)}
                                  style={{
                                    width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                                    borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, outline: "none"
                                  }}
                                />
                                {isSearching && (
                                  <div style={{
                                    position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999,
                                    background: cs.surface, border: "1px solid " + cs.accent + "55",
                                    borderRadius: "0 0 10px 10px", maxHeight: 200, overflowY: "auto",
                                    boxShadow: "0 8px 24px #0006"
                                  }}>
                                    {filtered.length > 0 ? filtered.map((item, idx) => (
                                      <div key={idx}
                                        onMouseDown={() => {
                                          setLaporanMaterials(p => p.map(m => m.id === mat.id
                                            ? { ...m, nama: item.nama, satuan: item.satuan } : m));
                                          setMatSearchId(null); setMatSearchQuery("");
                                        }}
                                        style={{
                                          padding: "9px 12px", cursor: "pointer", fontSize: 13,
                                          color: cs.text, borderBottom: "1px solid " + cs.border + "33",
                                          display: "flex", justifyContent: "space-between", alignItems: "center"
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = cs.accent + "18"}
                                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                      >
                                        <span style={{ fontWeight: 600 }}>{item.nama}</span>
                                        <span style={{ fontSize: 11, color: cs.muted, marginLeft: 8 }}>{item.satuan}</span>
                                      </div>
                                    )) : (
                                      <div style={{ padding: "10px 12px", color: cs.muted, fontSize: 12 }}>
                                        Tidak ditemukan — ketik manual
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <button onMouseDown={() => setLaporanMaterials(p => p.filter(m => m.id !== mat.id))}
                                style={{
                                  background: "#ef444420", border: "none", color: "#ef4444",
                                  borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 14, fontWeight: 700, flexShrink: 0
                                }}>
                                ×
                              </button>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <input type="number" min="0" step="0.5" value={mat.jumlah}
                              onChange={e => setLaporanMaterials(p => p.map(m => m.id === mat.id ? { ...m, jumlah: parseFloat(e.target.value) || 0 } : m))}
                              placeholder="Jumlah"
                              style={{
                                background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8,
                                padding: "7px 10px", color: cs.text, fontSize: 13, outline: "none"
                              }} />
                            <div style={{
                              background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8,
                              padding: "8px 10px", color: cs.muted, fontSize: 13, textAlign: "center",
                              display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                              {mat.satuan || "pcs"}
                            </div>
                          </div>
                          {(() => {
                            const n = (mat.nama || "").toLowerCase();
                            const isFreon = n.includes("freon") || n.includes("kuras vacum") ||
                              n.includes("r-22") || n.includes("r-32") || n.includes("r-410") ||
                              n.includes("r22") || n.includes("r32") || n.includes("r410");
                            const isPipa = n.includes("pipa") || n.includes("hoda");
                            const isKabel = n.includes("kabel");
                            if (!isFreon && !isPipa && !isKabel) return null;
                            // Opti A (Material Harian aktif): pemilihan tabung/roll di sini TIDAK dipakai
                            // (stok dipotong via Material Harian). Tampilkan info, bukan picker mati.
                            if (materialConfirmDeductOn) return (
                              <div style={{ marginTop: 6, padding: "7px 10px", background: cs.muted + "10", border: "1px dashed " + cs.border, borderRadius: 8, fontSize: 10, color: cs.muted }}>
                                ℹ️ Potong stok {isFreon ? "freon" : isPipa ? "pipa" : "kabel"} dilakukan di menu <strong>Material Harian</strong> (pilih tabung/roll + konfirmasi Owner). Di sini cukup catat pemakaian.
                              </div>
                            );

                            const matchedInvItem = inventoryData.find(item => {
                              const nm = (item.name || "").toLowerCase();
                              return nm.includes(n) || n.includes(nm.replace(/\s+/g, "").substring(0, 6));
                            }) || inventoryData.find(item => {
                              const nm = (item.name || "").toLowerCase();
                              if (isFreon) return item.freon_type && n.includes(item.freon_type.toLowerCase().replace("r", "r-"));
                              if (isPipa) return nm.includes("pipa") && nm.includes(n.replace("pipa", "").replace("hoda", "").trim().split(" ")[0]);
                              if (isKabel) return nm.includes("kabel") && n.includes(nm.substring(nm.indexOf("3x"), nm.indexOf("3x") + 6));
                              return false;
                            });

                            const isAdminRole = currentUser?.role === "Owner" || currentUser?.role === "Admin";
                            const availableUnits = invUnitsData.filter(u => {
                              if (!matchedInvItem) return false;
                              if (u.inventory_code !== matchedInvItem.code) return false;
                              if (!u.is_active) return false;
                              if (!isAdminRole && u.stock < (u.min_visible || 3)) return false;
                              return true;
                            });

                            const icon = isFreon ? "❄️" : isPipa ? "🔧" : "⚡";
                            const unitWord = isFreon ? "tabung" : isPipa ? "roll pipa" : "roll kabel";
                            const borderCol = isFreon ? cs.accent : isPipa ? "#f59e0b" : "#22c55e";

                            return (
                              <div style={{
                                marginTop: 6, padding: "8px 10px",
                                background: borderCol + "08", border: "1px solid " + borderCol + "33", borderRadius: 8
                              }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: borderCol, marginBottom: 5 }}>
                                  {icon} Dari {unitWord} mana?
                                  {matchedInvItem && (
                                    <span style={{ fontWeight: 400, color: cs.muted, marginLeft: 6 }}>
                                      ({matchedInvItem.name})
                                    </span>
                                  )}
                                </div>
                                {availableUnits.length === 0 ? (
                                  <div style={{ fontSize: 11, color: cs.red, padding: "4px 0" }}>
                                    ⚠️ Tidak ada {unitWord} tersedia (stok habis atau semua &lt; batas minimum).
                                    {isAdminRole && " Tambah unit baru di menu Stok Material."}
                                  </div>
                                ) : (
                                  <select
                                    value={mat.freon_tabung_code || ""}
                                    onChange={e => {
                                      const unitId = e.target.value;
                                      const unit = invUnitsData.find(u => u.id === unitId);
                                      setLaporanMaterials(p => p.map(m => m.id === mat.id
                                        ? {
                                          ...m,
                                          freon_tabung_code: unitId,
                                          freon_unit_label: unit?.unit_label || "",
                                          freon_inv_code: unit?.inventory_code || "",
                                        } : m));
                                    }}
                                    style={{
                                      width: "100%", background: cs.surface,
                                      border: "1px solid " + borderCol + "55", borderRadius: 7,
                                      padding: "7px 10px", color: cs.text, fontSize: 12
                                    }}>
                                    <option value="">— Pilih {unitWord} —</option>
                                    {availableUnits.map(unit => (
                                      <option key={unit.id} value={unit.id}>
                                        {unit.unit_label} — Sisa: {unit.stock} {matchedInvItem?.unit || ""}
                                        {unit.stock < (unit.min_visible || 3) * 2 ? " ⚠️" : ""}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {mat.freon_tabung_code && mat.freon_unit_label && (
                                  <div style={{ fontSize: 10, color: cs.green, marginTop: 4, display: "flex", gap: 8 }}>
                                    <span>✅ {mat.freon_unit_label}</span>
                                    <span style={{ color: cs.muted }}>→ stok berkurang {mat.jumlah} {mat.satuan || matchedInvItem?.unit || ""} saat submit</span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                    {laporanMaterials.length < 20 && (
                      <button onClick={() => setLaporanMaterials(p => [...p, { id: Date.now(), nama: "", jumlah: 1, satuan: "pcs", keterangan: "" }])}
                        style={{ marginTop: 8, width: "100%", background: cs.green + "10", border: "1px dashed " + cs.green + "33", color: cs.green, borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                        + Tambah Material
                      </button>
                    )}
                  </div>
                </div>
              )}{/* end !isInstallJob */}
              {/* ── Foto: tampil untuk semua service ── */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted }}>📸 Foto Dokumentasi ({laporanFotos.length}/20)
                    {laporanFotos.length > 0 && (() => {
                      const uploadingN = laporanFotos.filter(f => f.uploading).length;
                      const savedN = laporanFotos.filter(f => f.url).length;
                      const failedN = laporanFotos.filter(f => !f.uploading && !f.url && f.errMsg).length;
                      return (
                        <span style={{ marginLeft: 8, fontSize: 11 }}>
                          {uploadingN > 0 && (
                            <span style={{ color: cs.accent, fontWeight: 700 }}>⏳ {uploadingN} upload...</span>
                          )}
                          {savedN > 0 && (
                            <span style={{ color: cs.green, marginLeft: uploadingN > 0 ? 6 : 0 }}>☁️ {savedN} tersimpan</span>
                          )}
                          {failedN > 0 && (
                            <span style={{ color: cs.yellow, marginLeft: 6 }}>⚠️ {failedN} gagal — retry / hapus</span>
                          )}
                        </span>
                      );
                    })()}
                  </div>
                  {laporanFotos.length < 20 && (
                    <button onClick={() => fotoInputRef.current?.click()}
                      style={{ fontSize: 11, background: cs.accent + "15", border: "1px solid " + cs.accent + "33", color: cs.accent, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>+ Foto</button>
                  )}
                </div>
                <input ref={fotoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={handleFotoUpload} style={{ display: "none" }} />
                {laporanFotos.length === 0 ? (
                  <div onClick={() => fotoInputRef.current?.click()}
                    style={{ border: "1px dashed " + cs.border, borderRadius: 10, padding: "20px", textAlign: "center", cursor: "pointer", color: cs.muted, fontSize: 12 }}>
                    📷 Tap untuk upload foto<br /><span style={{ fontSize: 11 }}>Sebelum &amp; sesudah servis, kondisi material</span>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {laporanFotos.map(f => (
                      <div key={f.id} style={{ position: "relative" }}>
                        <img src={f.data_url} alt={f.label} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: 8, border: "1px solid " + cs.border, opacity: f.uploading ? 0.5 : 1 }} />
                        {f.uploading && (
                          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                            <div style={{ background: cs.accent, color: "#0a0f1e", fontSize: 11, padding: "4px 10px", borderRadius: 99, fontWeight: 800 }}>⏳ Upload...</div>
                          </div>
                        )}
                        {!f.uploading && f.url ? (
                          <div style={{ position: "absolute", top: 4, right: 4, background: "#22c55e", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 99, fontWeight: 700, pointerEvents: "none" }}>
                            {f.restored ? "☁️ Lama" : "☁️ OK"}
                          </div>
                        ) : !f.uploading ? (
                          <div
                            title="Tap untuk retry upload"
                            onClick={() => retryFoto(f)}
                            style={{ position: "absolute", top: 4, right: 4, background: "#f59e0b", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 99, fontWeight: 700, cursor: "pointer" }}>
                            ⏳ Retry
                          </div>
                        ) : null}
                        <button onClick={() => setLaporanFotos(p => p.filter(x => x.id !== f.id))}
                          style={{ position: "absolute", top: 4, left: 4, background: "#ef4444cc", border: "none", color: "#fff", borderRadius: 99, width: 18, height: 18, cursor: "pointer", fontSize: 10, lineHeight: 1, padding: 0 }}>×</button>
                        <input value={f.label} onChange={e => setLaporanFotos(p => p.map(x => x.id === f.id ? { ...x, label: e.target.value } : x))}
                          placeholder="Label foto..." style={{ marginTop: 3, width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 6px", color: cs.text, fontSize: 10, outline: "none", boxSizing: "border-box" }} />
                        {laporanUnits.length > 1 && (
                          <select value={f.unit_no || ""} onChange={e => setLaporanFotos(p => p.map(x => x.id === f.id ? { ...x, unit_no: e.target.value ? parseInt(e.target.value) : null } : x))}
                            style={{ marginTop: 3, width: "100%", background: cs.card, border: "1px solid " + (f.unit_no ? "#0ea5e966" : cs.border), borderRadius: 5, padding: "4px 6px", color: f.unit_no ? "#0ea5e9" : cs.muted, fontSize: 10, outline: "none", boxSizing: "border-box" }}>
                            <option value="">📷 Umum</option>
                            {laporanUnits.map(un => <option key={un.unit_no} value={un.unit_no}>Unit {un.unit_no}{un.tipe ? " · " + un.tipe : ""}</option>)}
                          </select>
                        )}
                      </div>
                    ))}
                    {laporanFotos.length < 20 && (
                      <div onClick={() => fotoInputRef.current?.click()}
                        style={{ aspectRatio: "1/1", border: "1px dashed " + cs.border, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 22, color: cs.muted }}>+</div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Rekomendasi & Catatan ── */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Rekomendasi untuk Customer</div>
                <textarea value={laporanRekomendasi} onChange={e => setLaporanRekomendasi(e.target.value)} rows={2} placeholder="cth: Disarankan servis berkala tiap 3 bulan..."
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Catatan ke Admin (Opsional)</div>
                <textarea value={laporanCatatan} onChange={e => setLaporanCatatan(e.target.value)} rows={2} placeholder="Catatan lain untuk Admin..."
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>

              {/* Gate tombol Next saat foto masih upload */}
              {(() => {
                const uploadingCount = laporanFotos.filter(f => f.uploading).length;
                const failedCount = laporanFotos.filter(f => !f.uploading && !f.url && f.errMsg).length;
                const canProceed = uploadingCount === 0;
                const btnLabel = uploadingCount > 0
                  ? `⏳ Tunggu ${uploadingCount} foto upload...`
                  : failedCount > 0
                    ? `⚠️ ${failedCount} foto gagal — retry atau hapus`
                    : "Lanjut → Ringkasan";
                const btnBg = canProceed
                  ? "linear-gradient(135deg," + cs.accent + ",#3b82f6)"
                  : cs.border;
                const btnColor = canProceed ? "#0a0f1e" : cs.muted;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                    <button onClick={() => setLaporanStep(laporanModal?.service === "Install" ? 1 : 2)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>← Kembali</button>
                    <button
                      onClick={() => {
                        if (!canProceed) return;
                        if (failedCount > 0 && !window.confirm(`⚠️ ${failedCount} foto GAGAL upload dan tidak akan masuk laporan.\n\nLanjut tanpa foto tersebut? (Batal untuk retry / hapus dulu)`)) return;
                        flushManualText(); setLaporanStep(4);
                      }}
                      disabled={!canProceed}
                      style={{
                        background: btnBg,
                        border: "none",
                        color: btnColor,
                        padding: "12px",
                        borderRadius: 10,
                        cursor: canProceed ? "pointer" : "not-allowed",
                        fontWeight: 800,
                        fontSize: 14,
                        opacity: canProceed ? 1 : 0.6,
                      }}>{btnLabel}</button>
                  </div>
                );
              })()}
            </div>
          )}
          {/* ── STEP 4: Ringkasan & Submit ── */}
          {laporanStep === 4 && (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14, fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12 }}>📋 Ringkasan Laporan</div>
                <div style={{ display: "grid", gap: 5, marginBottom: 12 }}>
                  <div><span style={{ color: cs.muted }}>Job: </span><span style={{ color: cs.accent, fontWeight: 700 }}>{laporanModal.id}</span> · <span style={{ color: cs.text }}>{laporanModal.customer}</span></div>
                  <div><span style={{ color: cs.muted }}>Teknisi: </span><span style={{ fontWeight: 600, color: cs.text }}>{laporanModal.teknisi}{laporanModal.helper ? " + " + laporanModal.helper + " (Helper)" : ""}</span></div>
                  <div>
                    <span style={{ color: cs.muted }}>Total: </span>
                    <span style={{ fontWeight: 700, color: cs.text }}>{laporanUnits.length} unit AC</span>
                    {totalFreon > 0 && <span style={{ color: cs.muted }}> · Tekanan Freon: <span style={{ color: cs.yellow }}>{totalFreon.toFixed(0)} psi</span></span>}
                    {laporanFotos.filter(f => f.url).length > 0 && <span style={{ color: cs.muted }}> · <span style={{ color: cs.green }}>{laporanFotos.filter(f => f.url).length} foto</span></span>}
                    {laporanMaterials.length > 0 && <span style={{ color: cs.muted }}> · <span style={{ color: cs.accent }}>{laporanMaterials.length} material</span></span>}
                  </div>
                </div>
                {isInstallJob && (
                  <div style={{ background: cs.card, border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, color: cs.accent, marginBottom: 8, fontSize: 12 }}>🔧 Detail Instalasi</div>
                    {INSTALL_ITEMS.filter(it => parseFloat(laporanInstallItems[it.key] || 0) > 0).map(it => (
                      <div key={it.key} style={{
                        display: "flex", justifyContent: "space-between", fontSize: 12,
                        color: cs.text, marginBottom: 3, paddingBottom: 3, borderBottom: "1px solid " + cs.border + "33"
                      }}>
                        <span>{it.label}</span>
                        <span style={{ fontWeight: 700, color: cs.accent }}>{laporanInstallItems[it.key]} {it.satuan}</span>
                      </div>
                    ))}
                    {!INSTALL_ITEMS.some(it => parseFloat(laporanInstallItems[it.key] || 0) > 0) && (
                      <div style={{ color: cs.muted, fontSize: 12, textAlign: "center" }}>Belum ada item diisi</div>
                    )}
                  </div>
                )}

                {!isInstallJob && (
                  <div style={{ display: "grid", gap: 8 }}>
                    {laporanUnits.map((u, i) => (
                      <div key={i} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 9, padding: "10px 12px" }}>
                        <div style={{ fontWeight: 700, color: cs.accent, marginBottom: 5 }}>Unit {u.unit_no} — {u.label} {u.merk ? `(${u.merk})` : ""}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 3 }}>
                          {u.kondisi_sebelum.map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.yellow + "18", color: cs.yellow, padding: "1px 6px", borderRadius: 99 }}>{k}</span>)}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 3 }}>
                          {u.pekerjaan.map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.accent + "18", color: cs.accent, padding: "1px 6px", borderRadius: 99 }}>{k}</span>)}
                        </div>
                        <div style={{ fontSize: 11, color: cs.muted }}>
                          {u.ampere_akhir ? `Ampere: ${u.ampere_akhir}A` : ""}{u.ampere_akhir && parseFloat(u.freon_ditambah) > 0 ? " · " : ""}
                          {parseFloat(u.freon_ditambah) > 0 ? `Tekanan: ${u.freon_ditambah} psi` : ""}
                          {u.catatan_unit ? ` · ${u.catatan_unit}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isInstallJob && INSTALL_ITEMS.some(it => parseFloat(laporanInstallItems[it.key] || 0) > 0) && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, color: cs.text, marginBottom: 5, fontSize: 11 }}>Material Instalasi:</div>
                    {INSTALL_ITEMS.filter(it => parseFloat(laporanInstallItems[it.key] || 0) > 0).map((it, mi) => (
                      <div key={mi} style={{ fontSize: 11, color: cs.muted, marginBottom: 2 }}>• {it.label}: {laporanInstallItems[it.key]} {it.satuan}</div>
                    ))}
                  </div>
                )}
                {!isInstallJob && laporanMaterials.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, color: cs.text, marginBottom: 5, fontSize: 11 }}>Material:</div>
                    {laporanMaterials.map((m, mi) => (
                      <div key={mi} style={{ fontSize: 11, color: cs.muted, marginBottom: 2 }}>• {m.nama}: {m.jumlah} {m.satuan}{m.keterangan ? ` — ${m.keterangan}` : ""}</div>
                    ))}
                  </div>
                )}
                {laporanRekomendasi && <div style={{ marginTop: 8, fontSize: 11 }}><span style={{ color: cs.muted }}>Rekomendasi: </span><span style={{ color: cs.text }}>{laporanRekomendasi}</span></div>}
                {laporanUnits.length !== (laporanModal.units || 1) && (
                  <div style={{ marginTop: 10, background: cs.yellow + "10", border: "1px solid " + cs.yellow + "22", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: cs.yellow }}>⚠ Unit tidak sama dengan order asal — Admin akan dikonfirmasi</div>
                )}
              </div>
              <div style={{ background: cs.green + "10", border: "1px solid " + cs.green + "22", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: cs.green }}>
                Setelah submit, laporan dikirim ke Owner/Admin untuk verifikasi dan pembuatan invoice.
              </div>
              {/* Upgrade Complain → Repair */}
              {laporanModal?.service === "Complain" && (
                <div style={{ background: cs.yellow + "0d", border: "1px solid " + cs.yellow + "33", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow, marginBottom: 5 }}>⚠️ Perlu Perbaikan Tambahan?</div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>Jika AC ternyata butuh repair (bukan sekadar komplain garansi), buat job Repair terpisah agar ada invoice perbaikan.</div>
                  <button onClick={async () => {
                    const rId = "JOB" + Date.now().toString(36).slice(-5).toUpperCase();
                    const rJob = {
                      id: rId, customer: laporanModal.customer,
                      phone: laporanModal.phone || customersData.find(c => c.name === laporanModal.customer)?.phone || "",
                      address: laporanModal.address || "", service: "Repair", type: "Pengecekan AC",
                      units: laporanModal.units || 1, teknisi: laporanModal.teknisi, helper: laporanModal.helper || null,
                      date: laporanModal.date, time: laporanModal.time || "09:00", status: "CONFIRMED",
                      parent_job_id: laporanModal.id, dispatch: true,
                      notes: "Upgrade dari Complain " + laporanModal.id
                    };
                    const rCust = findCustomer(customersData, rJob.phone, rJob.customer);
                    if (rCust?.id) rJob.customer_id = rCust.id;
                    setOrdersData(prev => prev.some(o => o.id === rJob.id) ? prev : [...prev, rJob]);
                    const { error: rErr } = await insertOrder(supabase, rJob);
                    if (!rErr) {
                      addAgentLog("COMPLAIN_UPGRADED", `Complain ${laporanModal.id} → Repair ${rId}`, "SUCCESS");
                      showNotif(`✅ Job Repair ${rId} dibuat! Admin dinotifikasi.`);
                      const admR = userAccounts.filter(u => u.role === "Admin" || u.role === "Owner");
                      admR.forEach(a => {
                        if (a?.phone) sendWA(a.phone,
                          "Upgrade Complain Repair\nComplain: " + laporanModal.id
                          + "\nRepair Baru: " + rId + "\nCustomer: " + laporanModal.customer
                          + "\nTeknisi: " + laporanModal.teknisi
                          + "\n\nSilakan approve. — ARA");
                      });
                    } else showNotif("❌ Gagal buat Repair: " + rErr.message);
                  }} style={{
                    background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow,
                    padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", width: "100%"
                  }}>
                    🔧 Upgrade ke Job Repair (Buat Invoice Perbaikan Terpisah)
                  </button>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                <button onClick={() => setLaporanStep(3)} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>← Kembali</button>
                <button onClick={submitLaporan} style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>✓ Submit Laporan</button>
              </div>
            </div>
          )}
          </>)}
        </div>
      </div>
    </>
  );
}
