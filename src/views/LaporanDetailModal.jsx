import React from "react";
import { cs } from "../theme/cs.js";

// Detail/Edit Laporan modal — diekstrak dari App.jsx (Tahap 2 refactor, lazy-loaded).
// Semua dependensi level-komponen dilewatkan via satu prop `ctx` (lihat App.jsx).
export default function LaporanDetailModal({ ctx }) {
  const {
    INSTALL_ITEMS, KONDISI_SBL, KONDISI_SDH, PEKERJAAN_OPT, SATUAN_OPT, TIPE_AC_OPT,
    _apiFetch, _apiHeaders, activeEditUnitIdx, addAgentLog, auditUserName, currentUser,
    downloadServiceReportPDF, editGratisAlasan, editLaporanForm, editLaporanFotos, editLaporanMode, editPhotoMode,
    editRepairType, editStockMats, getBracketKey, hargaPerUnitFromTipe, hitungLabor, invUnitsData,
    inventoryData, invoicesData, isMobile, laporanBarangItems, laporanInstallItems, lookupHargaGlobal,
    ordersData, priceListData, safeArr, selectedLaporan, setActiveEditUnitIdx, setEditGratisAlasan,
    setEditLaporanForm, setEditLaporanFotos, setEditLaporanMode, setEditPhotoMode, setEditRepairType, setEditStockMats,
    setInvoicesData, setLaporanInstallItems, setLaporanReports, setModalLaporanDetail, showNotif, supabase,
    syncTrackedStock, updateInvoice, updateServiceReport,
  } = ctx;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setModalLaporanDetail(false); setEditLaporanMode(false); setEditPhotoMode(false); setEditLaporanFotos([]); }}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: isMobile ? "16px 16px 0 0" : 20, width: "100%", maxWidth: isMobile ? "100%" : 640, maxHeight: "90vh", overflowY: "auto", padding: 28 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>{editLaporanMode ? "Edit Laporan" : "Detail Laporan"}</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{selectedLaporan.job_id} — {selectedLaporan.customer}</div>
          </div>
          <button onClick={() => { setModalLaporanDetail(false); setEditLaporanMode(false); setEditPhotoMode(false); setEditLaporanFotos([]); }} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}>x</button>
        </div>

        {editLaporanMode ? (
          /* EDIT MODE — FULL FORM */
          <div style={{ display: "grid", gap: 14 }}>
            {/* Photo Re-Upload Option */}
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <input type="checkbox" id="editPhotoCheck" checked={editPhotoMode} onChange={e => { setEditPhotoMode(e.target.checked); if (!e.target.checked) setEditLaporanFotos([]); }}
                  style={{ marginTop: 2, cursor: "pointer", width: 18, height: 18, accentColor: cs.accent }} />
                <label htmlFor="editPhotoCheck" style={{ fontSize: 12, color: cs.text, cursor: "pointer", flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>📸 Input Ulang Foto</div>
                  <div style={{ fontSize: 11, color: cs.muted }}>
                    {editPhotoMode
                      ? "Foto lama akan dihapus & diganti dengan foto baru"
                      : "Foto tetap sama, hanya data yang diedit"}
                  </div>
                </label>
              </div>
              {editPhotoMode && (
                <div style={{ background: cs.card, border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "10px", fontSize: 11, color: cs.accent }}>
                  ⚠️ Pilih foto baru di bawah. Foto lama akan dihapus saat save.
                </div>
              )}
            </div>

            {/* ══ UBAH JENIS LAYANAN — Owner/Admin only ══ */}
            {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
              <div style={{ background: cs.surface, border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "12px", display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent }}>
                  🔄 Jenis Layanan
                </div>
                <select value={editLaporanForm.editService || selectedLaporan?.service}
                  onChange={e => setEditLaporanForm(f => ({ ...f, editService: e.target.value }))}
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }}>
                  {["Cleaning", "Install", "Repair", "Complain", "Maintenance", "Survey"].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {editLaporanForm.editService && editLaporanForm.editService !== selectedLaporan?.service && (
                  <div style={{ fontSize: 10, color: cs.yellow, background: cs.yellow + "15", border: "1px solid " + cs.yellow + "33", borderRadius: 6, padding: "6px 8px" }}>
                    ⚠️ Layanan akan diubah dari <b>{selectedLaporan?.service}</b> ke <b>{editLaporanForm.editService}</b>.
                    {editLaporanForm.editService === "Complain" && " Invoice akan di-recalculate sebagai Complain (Rp 0 jika garansi aktif)."}
                  </div>
                )}
              </div>
            )}

            {/* ══ REPAIR/COMPLAIN TYPE SELECTOR ══ */}
            {((editLaporanForm.editService || selectedLaporan?.service) === "Repair" || (editLaporanForm.editService || selectedLaporan?.service) === "Complain") && (
              <div style={{ background: cs.surface, border: "1px solid " + cs.yellow + "33", borderRadius: 10, padding: "12px", display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow }}>
                  💵 Tipe Layanan — {selectedLaporan?.service}
                </div>
                <select value={editRepairType} onChange={e => setEditRepairType(e.target.value)}
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }}>
                  <option value="berbayar">💰 Berbayar (Standard)</option>
                  <option value="gratis-garansi">🎁 Gratis - Garansi Aktif</option>
                  <option value="gratis-customer">🎁 Gratis - Arrangement Customer</option>
                </select>
                {editRepairType !== "berbayar" && (
                  <input
                    placeholder="Alasan gratis (wajib diisi)..."
                    value={editGratisAlasan}
                    onChange={e => setEditGratisAlasan(e.target.value)}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.yellow + "44", borderRadius: 8, padding: "7px 10px", color: cs.text, fontSize: 11, outline: "none" }} />
                )}
                <div style={{ fontSize: 10, color: cs.muted }}>
                  {editRepairType === "berbayar" && "Invoice akan dihitung normal dari material + jasa."}
                  {editRepairType !== "berbayar" && "Invoice Rp 0 akan langsung dicatat LUNAS. Tidak dikirim ke customer."}
                </div>
              </div>
            )}

            {/* ══ SURVEY FORM — identik dengan form teknisi/helper ══ */}
            {(editLaporanForm.editService || selectedLaporan?.service) === "Survey" && (
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px", fontSize: 12, color: cs.muted }}>
                  📋 Survey — tidak ada invoice. Isi hasil survey dan catatan/rekomendasi untuk Owner/Admin.
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 6 }}>Hasil Survey *</div>
                  <textarea
                    value={editLaporanForm.hasil_survey || ""}
                    onChange={e => setEditLaporanForm(f => ({ ...f, hasil_survey: e.target.value }))}
                    rows={4} placeholder="Kondisi AC, temuan, kendala, dll..."
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 6 }}>Catatan / Rekomendasi</div>
                  <textarea
                    value={editLaporanForm.catatan_rekomendasi || ""}
                    onChange={e => setEditLaporanForm(f => ({ ...f, catatan_rekomendasi: e.target.value }))}
                    rows={3} placeholder="Rekomendasi tindak lanjut, jenis pekerjaan yang disarankan, dll..."
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
                </div>
              </div>
            )}

            {/* UNIT TABS — disembunyikan untuk Survey */}
            {(editLaporanForm.editService || selectedLaporan?.service) !== "Survey" &&
            ((editLaporanForm.editUnits || []).length > 1 || currentUser?.role === "Owner") && (
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, borderBottom: "1px solid " + cs.border, alignItems: "center" }}>
                {(editLaporanForm.editUnits || []).map((_, idx) => (
                  <button key={idx} onClick={() => setActiveEditUnitIdx(idx)}
                    style={{ padding: "8px 12px", borderRadius: 7, background: activeEditUnitIdx === idx ? cs.accent : cs.card, color: activeEditUnitIdx === idx ? "#fff" : cs.text, border: "1px solid " + (activeEditUnitIdx === idx ? cs.accent : cs.border), cursor: "pointer", fontSize: 12, fontWeight: activeEditUnitIdx === idx ? 700 : 500, whiteSpace: "nowrap" }}>
                    Unit {idx + 1}
                  </button>
                ))}
                {/* Tambah Unit — Owner only */}
                {currentUser?.role === "Owner" && (
                  <button onClick={() => {
                    const nextNo = (editLaporanForm.editUnits || []).length + 1;
                    const newUnit = { unit_no: nextNo, tipe: "", merk: "", pk: "", kondisi_sebelum: [], pekerjaan: [], kondisi_setelah: [], freon_ditambah: "", ampere_akhir: "", catatan_unit: "", label: "" };
                    const newIdx = (editLaporanForm.editUnits || []).length;
                    setEditLaporanForm(f => ({ ...f, editUnits: [...(f.editUnits || []), newUnit] }));
                    setActiveEditUnitIdx(newIdx);
                  }}
                    style={{ padding: "8px 14px", borderRadius: 7, background: cs.green + "18", color: cs.green, border: "1px dashed " + cs.green + "55", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
                    + Tambah
                  </button>
                )}
              </div>
            )}

            {/* PER-UNIT FORM — disembunyikan untuk Survey */}
            {(editLaporanForm.editService || selectedLaporan?.service) !== "Survey" &&
            editLaporanForm.editUnits && editLaporanForm.editUnits[activeEditUnitIdx] && (() => {
              const u = editLaporanForm.editUnits[activeEditUnitIdx];
              const updateU = (field, val) => setEditLaporanForm(f => { const units = [...f.editUnits]; units[activeEditUnitIdx] = { ...u, [field]: val }; return { ...f, editUnits: units }; });
              const toggleUArr = (field, val) => { const arr = u[field] || []; updateU(field, arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]); };
              return (
                <div style={{ background: cs.card, borderRadius: 10, border: "1px solid " + cs.border, padding: "14px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Tipe AC</div>
                      <select value={u.tipe || ""} onChange={e => updateU("tipe", e.target.value)} style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none" }}>
                        <option value="">Pilih...</option>
                        {TIPE_AC_OPT.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Merk</div>
                      <input type="text" value={u.merk || ""} onChange={e => updateU("merk", e.target.value)} placeholder="Daikin..." style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>PK</div>
                      <input type="text" value={u.pk || ""} onChange={e => updateU("pk", e.target.value)} placeholder="0.5, 1, 1.5..." style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>

                  {/* Kondisi Sebelum */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Kondisi Sebelum</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {KONDISI_SBL.map(k => (
                        <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                          <input type="checkbox" checked={(u.kondisi_sebelum || []).includes(k)} onChange={() => toggleUArr("kondisi_sebelum", k)} style={{ cursor: "pointer" }} />
                          <span style={{ fontSize: 11, color: cs.text }}>{k}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Pekerjaan */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Pekerjaan Dilakukan</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {PEKERJAAN_OPT(selectedLaporan.service || "Cleaning").map(p => (
                        <label key={p} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                          <input type="checkbox" checked={(u.pekerjaan || []).includes(p)} onChange={() => toggleUArr("pekerjaan", p)} style={{ cursor: "pointer" }} />
                          <span style={{ fontSize: 11, color: cs.text }}>{p}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Kondisi Sesudah */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Kondisi Sesudah</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {KONDISI_SDH.map(k => (
                        <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                          <input type="checkbox" checked={(u.kondisi_setelah || []).includes(k)} onChange={() => toggleUArr("kondisi_setelah", k)} style={{ cursor: "pointer" }} />
                          <span style={{ fontSize: 11, color: cs.text }}>{k}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Freon & Ampere */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Tekanan Freon (psi)</div>
                      <input type="number" value={u.freon_ditambah || ""} onChange={e => updateU("freon_ditambah", e.target.value)} style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Ampere Akhir (A)</div>
                      <input type="number" value={u.ampere_akhir || ""} onChange={e => updateU("ampere_akhir", e.target.value)} style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>

                  {/* Catatan Unit */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 3 }}>Catatan Unit</div>
                    <textarea value={u.catatan_unit || ""} onChange={e => updateU("catatan_unit", e.target.value)} rows={2} style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }} />
                  </div>

                  {/* Hapus Unit — Owner only, min 1 unit */}
                  {currentUser?.role === "Owner" && (editLaporanForm.editUnits || []).length > 1 && (() => {
                    const hasFreon = u.freon_ditambah && String(u.freon_ditambah).trim() !== "" && String(u.freon_ditambah) !== "0";
                    const hasMatFreon = (editLaporanForm.editMatItems || []).some(m => {
                      const n = (m.nama || "").toLowerCase();
                      return n.includes("freon") || n.includes("r-22") || n.includes("r-32") || n.includes("r-410") || n.includes("r22") || n.includes("r32") || n.includes("r410");
                    });
                    const hasStockFreon = (editStockMats || []).some(m => {
                      const n = (m.nama || "").toLowerCase();
                      return n.includes("freon") || n.includes("r-22") || n.includes("r-32") || n.includes("r-410");
                    });
                    const hasWarning = hasFreon || hasMatFreon || hasStockFreon;
                    return (
                      <div style={{ marginTop: 14, borderTop: "1px dashed " + cs.red + "33", paddingTop: 10 }}>
                        {hasWarning && (
                          <div style={{ fontSize: 11, color: cs.yellow, background: cs.yellow + "10", border: "1px solid " + cs.yellow + "33", borderRadius: 7, padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>
                            ⚠️ Unit ini memiliki data freon atau material. Stok tidak otomatis dikembalikan saat unit dihapus — periksa Material Harian jika perlu koreksi stok.
                          </div>
                        )}
                        <button onClick={() => {
                          const newUnits = (editLaporanForm.editUnits || [])
                            .filter((_, i) => i !== activeEditUnitIdx)
                            .map((u, i) => ({ ...u, unit_no: i + 1 }));
                          setEditLaporanForm(f => ({ ...f, editUnits: newUnits }));
                          setActiveEditUnitIdx(Math.max(0, activeEditUnitIdx - 1));
                        }}
                          style={{ background: cs.red + "15", border: "1px solid " + cs.red + "44", color: cs.red, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                          🗑️ Hapus Unit {activeEditUnitIdx + 1}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* ══ INSTALL ITEMS FORM (Edit Mode) ══ */}
            {selectedLaporan?.service === "Install" && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: cs.accent, textTransform: "uppercase", letterSpacing: "0.5px" }}>🔧 Detail Pekerjaan Instalasi</div>
                {INSTALL_ITEMS.map(item => (
                  <div key={item.key} style={{
                    display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center",
                    background: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.green + "08" : cs.card,
                    border: "1px solid " + (parseFloat(laporanInstallItems[item.key] || 0) > 0 ? cs.green + "44" : cs.border),
                    borderRadius: 8, padding: "8px 10px"
                  }}>
                    <div style={{ fontSize: 12, color: cs.text, fontWeight: parseFloat(laporanInstallItems[item.key] || 0) > 0 ? 700 : 400 }}>
                      {item.label}<span style={{ fontSize: 10, color: cs.muted, marginLeft: 4 }}>({item.satuan})</span>
                    </div>
                    <input type="number" min="0" step={item.satuan === "Meter" || item.satuan === "KG" ? "0.5" : "1"}
                      value={laporanInstallItems[item.key] ?? ""}
                      onChange={e => setLaporanInstallItems(prev => ({ ...prev, [item.key]: e.target.value }))}
                      placeholder="0"
                      style={{ width: 64, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 8px", color: cs.text, fontSize: 13, outline: "none", textAlign: "center" }} />
                  </div>
                ))}
              </div>
            )}

            {/* JASA SECTION (non-Install, non-Survey only) */}
            {(editLaporanForm.editService || selectedLaporan?.service) !== "Survey" && selectedLaporan?.service !== "Install" && (() => {
              // Include: category="Jasa", OR category starts with "freon", OR service matches laporan
              const jasaLookup = priceListData
                .filter(r => {
                  if (parseInt(r.price || 0) <= 0) return false; // exclude zero price
                  if (r.category === "Jasa") return true; // standard jasa category
                  const cat = (r.category || "").toLowerCase();
                  if (cat.startsWith("freon")) return true; // freon_R22, freon_R32, freon_R410
                  if (r.service === selectedLaporan?.service) return true; // items dari laporan service
                  return false;
                })
                .map(r => ({ nama: r.type, satuan: r.unit || "pcs", harga: parseInt(r.price || 0) }))
                .filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i)
                .slice(0, 100);
              return (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: cs.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>⚡ Jasa / Layanan ({(editLaporanForm.editJasaItems || []).length})</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {(editLaporanForm.editJasaItems || []).map((j, ji) => (
                      <div key={j.id || ji} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 6, alignItems: "center", background: cs.card, padding: "10px", borderRadius: 7 }}>
                        <select value={j.nama || ""} onChange={e => { const jasa = jasaLookup.find(x => x.nama === e.target.value); setEditLaporanForm(f => ({ ...f, editJasaItems: f.editJasaItems.map((x, i) => i === ji ? { ...x, nama: e.target.value, satuan: jasa?.satuan || "pcs", harga_satuan: jasa?.harga || 0 } : x) })); }} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }}>
                          <option value="">Pilih Jasa...</option>
                          {jasaLookup.map(jl => <option key={jl.nama} value={jl.nama}>{jl.nama}</option>)}
                        </select>
                        <input type="number" value={j.jumlah || 1} onChange={e => setEditLaporanForm(f => ({ ...f, editJasaItems: f.editJasaItems.map((x, i) => i === ji ? { ...x, jumlah: parseInt(e.target.value) || 1 } : x) }))} placeholder="Qty" style={{ width: "60px", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }} />
                        <button onClick={() => setEditLaporanForm(f => ({ ...f, editJasaItems: f.editJasaItems.filter((_, i) => i !== ji) }))} style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "6px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🗑️</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEditLaporanForm(f => ({ ...f, editJasaItems: [...(f.editJasaItems || []), { id: Date.now(), nama: "", jumlah: 1, satuan: "pcs", harga_satuan: 0, keterangan: "jasa" }] }))} style={{ marginTop: 8, background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent, padding: "8px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>+ Tambah Jasa</button>
                </div>
              );
            })()}

            {/* MATERIAL SECTION (non-Install, non-Survey only) */}
            {(editLaporanForm.editService || selectedLaporan?.service) !== "Survey" && selectedLaporan?.service !== "Install" && (() => {
              const matLookup = [...inventoryData.map(r => ({ nama: r.name, satuan: r.unit || "pcs" })), ...priceListData.filter(r => r.service === "Material").map(r => ({ nama: r.type, satuan: r.unit || "pcs" }))].filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i);
              return (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: cs.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>🔧 Material Terpakai ({(editLaporanForm.editMatItems || []).length}/20)</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {(editLaporanForm.editMatItems || []).map((m, mi) => (
                      <div key={m.id || mi} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 6, alignItems: "center", background: cs.card, padding: "10px", borderRadius: 7 }}>
                        <input list="matOpts" value={m.nama || ""} onChange={e => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.map((x, i) => i === mi ? { ...x, nama: e.target.value } : x) }))} placeholder="Nama material" style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }} />
                        <datalist id="matOpts">
                          {matLookup.map(ml => <option key={ml.nama} value={ml.nama} />)}
                        </datalist>
                        <input type="number" value={m.jumlah || ""} onChange={e => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.map((x, i) => i === mi ? { ...x, jumlah: e.target.value } : x) }))} placeholder="Qty" style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }} />
                        <select value={m.satuan || "pcs"} onChange={e => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.map((x, i) => i === mi ? { ...x, satuan: e.target.value } : x) }))} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }}>
                          {SATUAN_OPT.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input type="text" value={m.keterangan || ""} onChange={e => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.map((x, i) => i === mi ? { ...x, keterangan: e.target.value } : x) }))} placeholder="Ket" style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "6px", color: cs.text, fontSize: 11, outline: "none" }} />
                        <button onClick={() => setEditLaporanForm(f => ({ ...f, editMatItems: f.editMatItems.filter((_, i) => i !== mi) }))} style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "6px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🗑️</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEditLaporanForm(f => ({ ...f, editMatItems: [...(f.editMatItems || []), { id: Date.now(), nama: "", jumlah: "", satuan: "pcs", keterangan: "" }] }))} style={{ marginTop: 8, background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent, padding: "8px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>+ Tambah Material</button>
                </div>
              );
            })()}

            {/* ══ STOK MATERIAL TERPAKAI — disembunyikan untuk Survey ══ */}
            {(editLaporanForm.editService || selectedLaporan?.service) !== "Survey" && (() => {
              const addStockMat = () => setEditStockMats(p => [...p, { id: Date.now(), nama: "", jumlah: 1, satuan: "pcs", freon_tabung_code: "", freon_unit_label: "", freon_inv_code: "" }]);
              const updateMat = (id, patch) => setEditStockMats(p => p.map(m => m.id === id ? { ...m, ...patch } : m));
              const removeMat = (id) => setEditStockMats(p => p.filter(m => m.id !== id));
              // Include inventory_code so unit picker can do exact match
              const matLookupStock = [
                ...inventoryData.map(r => ({ nama: r.name, satuan: r.unit || "pcs", inv_code: r.code })),
                ...priceListData.filter(r => r.service === "Material").map(r => ({ nama: r.type, satuan: r.unit || "pcs", inv_code: null }))
              ].filter((v, i, a) => a.findIndex(x => x.nama === v.nama) === i);
              return (
                <div style={{ background: cs.card, border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: cs.accent, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
                    📦 Stok Material Terpakai ({editStockMats.length})
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 7, padding: "7px 10px", marginBottom: 10, lineHeight: 1.5 }}>
                    ℹ️ Pilih tabung freon, roll pipa, atau kabel yang dipakai. Stok internal akan otomatis berkurang saat disimpan.
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {editStockMats.map(mat => {
                      const n = (mat.nama || "").toLowerCase();
                      const isFreon = n.includes("freon") || n.includes("kuras vacum") || n.includes("r-22") || n.includes("r-32") || n.includes("r-410") || n.includes("r22") || n.includes("r32") || n.includes("r410");
                      const isPipa = n.includes("pipa") || n.includes("hoda");
                      const isKabel = n.includes("kabel");
                      const hasUnit = isFreon || isPipa || isKabel;
                      const matchedInvItem = (mat.inv_code ? inventoryData.find(i => i.code === mat.inv_code) : null)
                        || inventoryData.find(item => {
                          const nm = (item.name || "").toLowerCase();
                          return nm === n || nm.includes(n) || n.includes(nm);
                        }) || inventoryData.find(item => {
                          const nm = (item.name || "").toLowerCase();
                          if (isFreon) return item.freon_type && n.includes(item.freon_type.toLowerCase().replace("r", "r-"));
                          if (isPipa) return nm.includes("pipa") && nm.includes(n.replace("pipa", "").replace("hoda", "").trim().split(" ")[0]);
                          if (isKabel) return nm.includes("kabel");
                          return false;
                        });
                      const availableUnits = invUnitsData.filter(u => {
                        if (!matchedInvItem) return false;
                        if (u.inventory_code !== matchedInvItem.code) return false;
                        if (!u.is_active) return false;
                        return true;
                      });
                      const icon = isFreon ? "❄️" : isPipa ? "🔧" : "⚡";
                      const unitWord = isFreon ? "tabung" : isPipa ? "roll pipa" : "roll kabel";
                      const borderCol = isFreon ? cs.accent : isPipa ? "#f59e0b" : "#22c55e";
                      return (
                        <div key={mat.id} style={{ background: cs.surface, border: "1px solid " + (mat.nama ? cs.accent + "33" : cs.border), borderRadius: 9, padding: "10px 12px" }}>
                          {/* Row 1: Nama + Qty + Hapus */}
                          <div style={{ display: "grid", gridTemplateColumns: "2fr 80px auto", gap: 6, alignItems: "center", marginBottom: hasUnit ? 8 : 0 }}>
                            <select value={mat.nama} onChange={e => { const item = matLookupStock.find(x => x.nama === e.target.value); updateMat(mat.id, { nama: e.target.value, satuan: item?.satuan || "pcs", inv_code: item?.inv_code || null, freon_tabung_code: "", freon_unit_label: "", freon_inv_code: "" }); }}
                              style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 9px", color: mat.nama ? cs.text : cs.muted, fontSize: 12, outline: "none" }}>
                              <option value="">— Pilih material —</option>
                              {matLookupStock.map(ml => <option key={ml.nama} value={ml.nama}>{ml.nama}</option>)}
                            </select>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <input type="number" min="0" step="0.5" value={mat.jumlah} onChange={e => updateMat(mat.id, { jumlah: parseFloat(e.target.value) || 0 })}
                                style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 6px", color: cs.text, fontSize: 12, outline: "none", textAlign: "center" }} />
                              <span style={{ fontSize: 10, color: cs.muted, whiteSpace: "nowrap" }}>{mat.satuan}</span>
                            </div>
                            <button onClick={() => removeMat(mat.id)} style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>🗑️</button>
                          </div>
                          {/* Row 2: Unit fisik selector */}
                          {hasUnit && (
                            <div style={{ padding: "8px 10px", background: borderCol + "08", border: "1px solid " + borderCol + "33", borderRadius: 7 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: borderCol, marginBottom: 5 }}>
                                {icon} Dari {unitWord} mana?
                                {matchedInvItem && <span style={{ fontWeight: 400, color: cs.muted, marginLeft: 6 }}>({matchedInvItem.name})</span>}
                              </div>
                              {availableUnits.length === 0 ? (
                                <div style={{ fontSize: 11, color: cs.red }}>⚠️ Tidak ada {unitWord} tersedia di stok.</div>
                              ) : (
                                <select value={mat.freon_tabung_code || ""} onChange={e => { const uid = e.target.value; const unit = invUnitsData.find(u => u.id === uid); updateMat(mat.id, { freon_tabung_code: uid, freon_unit_label: unit?.unit_label || "", freon_inv_code: unit?.inventory_code || "" }); }}
                                  style={{ width: "100%", background: cs.card, border: "1px solid " + borderCol + "55", borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12, outline: "none" }}>
                                  <option value="">— Pilih {unitWord} —</option>
                                  {availableUnits.map(unit => (
                                    <option key={unit.id} value={unit.id}>{unit.unit_label} — Sisa: {unit.stock} {matchedInvItem?.unit || ""}</option>
                                  ))}
                                </select>
                              )}
                              {mat.freon_unit_label && (
                                <div style={{ fontSize: 10, color: cs.green, marginTop: 4 }}>✅ {mat.freon_unit_label} → stok berkurang {mat.jumlah} {mat.satuan} saat disimpan</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {editStockMats.length < 20 && (
                    <button onClick={addStockMat} style={{ marginTop: 8, width: "100%", background: cs.accent + "10", border: "1px dashed " + cs.accent + "44", color: cs.accent, borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                      + Tambah Material Stok
                    </button>
                  )}
                </div>
              );
            })()}

            {/* REKOMENDASI & CATATAN — disembunyikan untuk Survey (pakai field khusus survey) */}
            {(editLaporanForm.editService || selectedLaporan?.service) !== "Survey" && [["Rekomendasi", "rekomendasi"], ["Catatan Tambahan", "catatan_global"]].map(([lbl, key]) => (
              <div key={key}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>{lbl}</div>
                <textarea value={editLaporanForm[key] || ""} onChange={e => setEditLaporanForm(f => ({ ...f, [key]: e.target.value }))} rows={3} style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
            ))}

            {/* PHOTO RE-UPLOAD SECTION */}
            {editPhotoMode && (
              <div style={{ background: cs.card, border: "2px solid " + cs.accent + "44", borderRadius: 10, padding: "14px", display: "grid", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>📸 Pilih Foto Baru</div>
                <input type="file" multiple accept="image/*"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    const newFotos = [];
                    for (const file of files) {
                      const url = URL.createObjectURL(file);
                      newFotos.push({ id: Date.now() + Math.random(), label: file.name, file: file, url: url, uploaded: false });
                    }
                    setEditLaporanFotos([...editLaporanFotos, ...newFotos]);
                  }}
                  style={{ padding: "10px", background: cs.surface, border: "1px dashed " + cs.accent + "66", borderRadius: 8, cursor: "pointer", fontSize: 12 }} />

                {editLaporanFotos.length > 0 && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 11, color: cs.muted }}>Foto dipilih: {editLaporanFotos.length}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(80px,1fr))", gap: 8 }}>
                      {editLaporanFotos.map((f) => (
                        <div key={f.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid " + cs.border }}>
                          <img src={f.url} style={{ width: "100%", height: 80, objectFit: "cover" }} alt={f.label} />
                          <button onClick={() => setEditLaporanFotos(editLaporanFotos.filter(x => x.id !== f.id))}
                            style={{ position: "absolute", top: 2, right: 2, background: cs.red, color: "#fff", border: "none", borderRadius: "50%", width: 24, height: 24, padding: 0, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* BUTTONS */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
              <button onClick={() => { setEditLaporanMode(false); setEditPhotoMode(false); setEditLaporanFotos([]); }} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Batal</button>
              <button onClick={async () => {
                const now = new Date().toLocaleString("id-ID", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-");
                const newService = editLaporanForm.editService || selectedLaporan.service;
                const serviceChanged = newService !== selectedLaporan.service;
                const changeDesc = serviceChanged
                  ? `Service changed ${selectedLaporan.service} → ${newService}, unit & material edited`
                  : "Admin edited unit & material details";
                const newLogs = [{ by: currentUser?.name || "?", at: now, field: serviceChanged ? "service+units+materials" : "units+materials", old: serviceChanged ? selectedLaporan.service : "previous", new: changeDesc }];
                const allLogs = [...safeArr(selectedLaporan.editLog), ...newLogs];
                const newStatus = selectedLaporan.status === "REVISION" ? "SUBMITTED" : selectedLaporan.status;

                // Recombine jasa + barang + material items
                // Install service: pakai laporanInstallItems (form grid), bukan editMatItems
                const isEditInstall = newService === "Install";
                const combinedMats = isEditInstall
                  ? INSTALL_ITEMS
                      .filter(item => parseFloat(laporanInstallItems[item.key] || 0) > 0)
                      .map(item => {
                        const hSat = lookupHargaGlobal(item.label, item.satuan);
                        const qty = parseFloat(laporanInstallItems[item.key] || 0);
                        return { id: item.key, nama: item.label, jumlah: qty, satuan: item.satuan, harga_satuan: hSat, subtotal: hSat * qty, keterangan: "" };
                      })
                  : [
                      ...(editLaporanForm.editJasaItems || []).map(j => ({ ...j, keterangan: "jasa" })),
                      ...(laporanBarangItems || []).filter(b => b.nama).map(b => ({ ...b, keterangan: "barang" })),
                      ...(editLaporanForm.editMatItems || [])
                    ];

                const isSurveyEdit = newService === "Survey";
                const updatePayload = { status: newStatus, service: newService, catatan_global: editLaporanForm.catatan_global || "", rekomendasi: editLaporanForm.rekomendasi || "", units_json: JSON.stringify(editLaporanForm.editUnits || []), total_units: (editLaporanForm.editUnits || []).length || selectedLaporan.total_units || 1, materials_json: JSON.stringify(combinedMats), edit_log: JSON.stringify(allLogs), ...(isSurveyEdit && { hasil_survey: editLaporanForm.hasil_survey || "", catatan_rekomendasi: editLaporanForm.catatan_rekomendasi || "" }) };

                // ✨ NEW: Handle photo re-upload option
                if (editPhotoMode && editLaporanFotos.length > 0) {
                  // Upload new photos to R2 and get URLs
                  const uploadedUrls = [];
                  for (const foto of editLaporanFotos.filter(f => f.file)) {
                    try {
                      const base64 = await new Promise((res, rej) => {
                        const reader = new FileReader();
                        reader.onload = e => res(e.target.result);
                        reader.onerror = rej;
                        reader.readAsDataURL(foto.file);
                      });
                      const uploadRes = await _apiFetch("/api/upload-foto", {
                        method: "POST",
                        headers: await _apiHeaders(),
                        body: JSON.stringify({ base64, filename: foto.file.name || `foto_${Date.now()}.jpg`, reportId: selectedLaporan.job_id, mimeType: foto.file.type || "image/jpeg" }),
                      });
                      if (uploadRes.ok) {
                        const uploadData = await uploadRes.json();
                        if (uploadData.url) uploadedUrls.push(uploadData.url);
                      }
                    } catch (uploadErr) {
                      console.warn("Photo upload failed:", uploadErr.message);
                    }
                  }
                  // Also include blob URLs that are already uploaded (from file selection display)
                  const existingUrls = editLaporanFotos.filter(f => !f.file && f.url).map(f => f.url);
                  if (uploadedUrls.length > 0 || existingUrls.length > 0) {
                    updatePayload.foto_urls = [...uploadedUrls, ...existingUrls]; // Replace old fotos with new ones
                  }
                }
                // If editPhotoMode = false, skip foto_urls → keep old photos
                const { error: elErr } = await updateServiceReport(supabase, selectedLaporan.id, updatePayload, auditUserName());
                if (elErr) { console.warn("❌ update service_reports failed:", elErr.message, "payload:", updatePayload); addAgentLog("LAPORAN_UPDATE_ERROR", `Laporan ${selectedLaporan.job_id} update error: ${elErr.message.slice(0, 100)}`, "WARNING"); }

                // Update local state
                setLaporanReports(prev => prev.map(r => r.id === selectedLaporan.id ? { ...r, service: newService, rekomendasi: editLaporanForm.rekomendasi, catatan_global: editLaporanForm.catatan_global, units: editLaporanForm.editUnits, total_units: (editLaporanForm.editUnits || []).length || selectedLaporan.total_units || 1, materials: combinedMats, status: newStatus, editLog: allLogs } : r));
                if (serviceChanged) selectedLaporan.service = newService;

                if (!elErr) {
                  // Rule: admin edit = sumber invoice paling benar → regenerate invoice jika ada
                  const existInv = invoicesData.find(i => i.job_id === selectedLaporan.job_id);
                  if (existInv) {
                    const ord = ordersData.find(o => o.id === selectedLaporan.job_id);
                    const vMats = combinedMats.filter(m => m.nama && parseFloat(m.jumlah || 0) > 0);
                    const vMDetail = vMats.map(m => {
                      const nama2 = (m.nama || "").toLowerCase();
                      const isF = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => nama2.includes(k));
                      const rawQ = parseFloat(m.jumlah) || 0;
                      const qty = isF ? Math.max(1, Math.ceil(rawQ)) : rawQ;
                      // ✨ PHASE 2: Use unified lookupHargaGlobal instead of inline lookup
                      let hSat = parseFloat(m.harga_satuan) || 0;
                      if (!hSat) {
                        hSat = lookupHargaGlobal(m.nama, m.satuan);
                      }
                      return { nama: m.nama, jumlah: qty, satuan: m.satuan || "pcs", harga_satuan: hSat, subtotal: hSat * qty, keterangan: m.keterangan || "" };
                    });

                    // Inject service fee — per-unit dari Card 1/4 tipe.
                    // FIX paritas (samakan dgn submit laporanInvoice.js & verify LaporanTimView):
                    // guard cleaning WAJIB name-based. Dulu `!vMDetail.some(keterangan==="jasa")` →
                    // begitu ada jasa lain (mis. Kapasitor) SELURUH cleaning per-unit ikut hilang dari
                    // invoice (kasus IBU LISA RENATA: cleaning 3 unit 290k hilang, sisa kapasitor 400k).
                    // Kini utk Cleaning/Maintenance cek khusus baris CLEANING; service lain pertahankan
                    // guard lama. Install: semua item sudah include jasa dalam INSTALL_ITEMS → skip inject.
                    const alreadyHasCleaningRow = vMDetail.some(m => {
                      if (m.keterangan !== "jasa") return false;
                      const n = (m.nama || "").toLowerCase();
                      return n.includes("cleaning") || n.includes("maintenance") || n.includes("cuci");
                    });
                    const isCleaningOrMaintEdit = selectedLaporan.service === "Cleaning" || selectedLaporan.service === "Maintenance";
                    const shouldInjectServiceFee = isCleaningOrMaintEdit
                      ? !alreadyHasCleaningRow
                      : !vMDetail.some(m => m.keterangan === "jasa");
                    if (!isEditInstall && shouldInjectServiceFee) {
                      const editUnits = editLaporanForm.editUnits || [];
                      const unitsWithTipe = editUnits.filter(u => u && u.tipe);
                      if (unitsWithTipe.length > 0) {
                        unitsWithTipe.forEach((u) => {
                          const hargaUnit = hargaPerUnitFromTipe(selectedLaporan.service, u.tipe, priceListData);
                          if (hargaUnit > 0) {
                            const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
                            const bracketLabel = getBracketKey(selectedLaporan.service, u.tipe) || u.tipe;
                            vMDetail.unshift({
                              nama: selectedLaporan.service + " " + bracketLabel + " (" + unitLabel + ")",
                              jumlah: 1, satuan: "unit",
                              harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa"
                            });
                          }
                        });
                      } else {
                        const svcFee = hitungLabor(selectedLaporan.service, ord?.type, editLaporanForm.editUnits?.length || selectedLaporan.total_units || 1);
                        if (svcFee > 0) {
                          const uCount = Math.max(1, editLaporanForm.editUnits?.length || selectedLaporan.total_units || 1);
                          vMDetail.unshift({ nama: selectedLaporan.service + (ord?.type ? " - " + ord.type : "") + " (Servis)", jumlah: uCount, satuan: "unit", harga_satuan: Math.round(svcFee / uCount), subtotal: svcFee, keterangan: "jasa" });
                        }
                      }
                    }

                    // Install: labor = 0, semua item (termasuk jasa pasang) masuk ke material
                    const laborV = isEditInstall ? 0 : (vMDetail.filter(m => m.keterangan === "jasa").reduce((s, m) => s + m.subtotal, 0) || hitungLabor(selectedLaporan.service, ord?.type, editLaporanForm.editUnits?.length || selectedLaporan.total_units || 1));
                    const matV = isEditInstall
                      ? vMDetail.reduce((s, m) => s + m.subtotal, 0)
                      : vMDetail.filter(m => m.keterangan !== "jasa").reduce((s, m) => s + m.subtotal, 0);

                    // ✨ FIX #3: Add garansi logic ke edit handler
                    const todayInv3 = new Date().toISOString().slice(0, 10);
                    const isComplainSvc3 = selectedLaporan.service === "Complain";

                    let finalLabor3 = laborV;
                    let finalMat3 = matV;
                    let finalTotal3 = laborV + matV;
                    let newInvoiceStatus3 = existInv.status === "PAID" ? "PAID" : "PENDING_APPROVAL";

                    if (isComplainSvc3) {
                      const prevGaransiActive3 = invoicesData.filter(inv =>
                        inv.customer === selectedLaporan.customer && inv.service !== "Complain" &&
                        inv.garansi_expires && inv.garansi_expires >= todayInv3 &&
                        ["PAID", "UNPAID", "APPROVED", "PENDING_APPROVAL"].includes(inv.status)
                      ).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null;

                      if (prevGaransiActive3) {
                        finalLabor3 = 0;
                        finalTotal3 = finalMat3;
                        newInvoiceStatus3 = finalTotal3 === 0 ? "PAID" : "PENDING_APPROVAL";
                      }
                    }

                    // ✨ NEW: Admin edit repair type selector → override repair_gratis
                    const isEditGratis = editRepairType === "gratis-garansi" || editRepairType === "gratis-customer";
                    const newRepairGratis = isEditGratis ? editRepairType : (existInv?.repair_gratis || undefined);

                    // If admin explicitly chose gratis → force total=0, status=PAID, proof=verified-no-proof
                    if (isEditGratis) {
                      finalLabor3 = 0;
                      finalMat3 = 0;
                      finalTotal3 = 0;
                      newInvoiceStatus3 = "PAID";
                      const alasan = editGratisAlasan.trim() || "(tidak ada alasan)";
                      addAgentLog("ADMIN_EDIT_GRATIS_APPROVED",
                        `Invoice ${existInv.id} | Customer: ${existInv.customer || "-"} | diedit ke GRATIS (${editRepairType}) oleh ${currentUser?.name}. Alasan: ${alasan}`,
                        "WARNING");
                    }

                    const totalInv = finalTotal3;

                    // Update invoice langsung (bukan delete+insert) untuk hindari constraint issue
                    const invUpdFields = {
                      service: newService,
                      materials_detail: JSON.stringify(vMDetail),
                      labor: finalLabor3, material: finalMat3, total: totalInv,
                      status: newInvoiceStatus3,
                      repair_gratis: newRepairGratis ?? null,
                      // Gratis → tidak butuh bukti bayar, tandai agar tidak masuk filter "Tanpa Bukti"
                      ...(isEditGratis ? { payment_proof_url: "verified-no-proof", paid_at: new Date().toISOString() } : {}),
                      updated_at: new Date().toISOString(),
                    };
                    const { error: invUpdErr } = await updateInvoice(supabase, existInv.id, invUpdFields, auditUserName());
                    if (!invUpdErr) {
                      setInvoicesData(prev => prev.map(i => i.id === existInv.id ? { ...i, ...invUpdFields } : i));
                      addAgentLog("INVOICE_REGEN", `Invoice ${existInv.id} diupdate dari edit laporan oleh ${currentUser?.name}`, "SUCCESS");
                      showNotif(`✅ Laporan + Invoice ${existInv.id} diperbarui dari data admin`);
                    } else {
                      console.warn("❌ updateInvoice gagal:", invUpdErr.message);
                      showNotif(`❌ Gagal update invoice: ${invUpdErr.message.slice(0, 60)}`);
                    }
                  }
                }

                // ── Idempotent sync stok tracked (pipa/freon) dari input admin ──
                // syncTrackedStock: hapus usage tracked lama → insert baru → recalculate dari DB
                const stockMatsToDeduct = editStockMats.filter(m => m.nama && parseFloat(m.jumlah) > 0);
                if (selectedLaporan.id) {
                  await syncTrackedStock(
                    selectedLaporan.id,
                    selectedLaporan.job_id,
                    stockMatsToDeduct,
                    selectedLaporan.customer || null,
                    selectedLaporan.teknisi || null,
                    selectedLaporan.date || null
                  );
                }

                const photoMsg = editPhotoMode && editLaporanFotos.length > 0 ? "+foto" : "";
                const svcMsg = serviceChanged ? ` [${selectedLaporan.service}]` : "";
                const stockMsg = stockMatsToDeduct.length > 0 ? `+${stockMatsToDeduct.length} stok` : "";
                addAgentLog("LAPORAN_EDITED", `Laporan ${selectedLaporan.job_id} diedit oleh ${currentUser?.name}${serviceChanged ? ` (service: ${selectedLaporan.service})` : ""}${stockMsg ? ` (${stockMsg})` : ""} ${photoMsg ? '(+foto)' : ''}`, "SUCCESS");
                showNotif(`✅ Laporan ${selectedLaporan.job_id} diupdate${svcMsg} (unit+material+catatan${photoMsg ? '+foto' : ''}${stockMsg ? '+'+stockMsg : ''})`);
                setModalLaporanDetail(false); setEditLaporanMode(false); setEditPhotoMode(false); setEditLaporanFotos([]); setEditStockMats([]);
              }} style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
                ✓ Simpan Semua Perubahan
              </button>
            </div>
          </div>
        ) : (
          /* VIEW MODE — support multi-unit (baru) & legacy (lama) */
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px", fontSize: 12 }}>
              <div><span style={{ color: cs.muted }}>Job ID: </span><span style={{ fontFamily: "monospace", color: cs.accent, fontWeight: 700 }}>{selectedLaporan.job_id}</span></div>
              <div><span style={{ color: cs.muted }}>Tanggal: </span><span style={{ color: cs.text }}>{selectedLaporan.date}</span></div>
              <div><span style={{ color: cs.muted }}>Customer: </span><span style={{ color: cs.text, fontWeight: 600 }}>{selectedLaporan.customer}</span></div>
              <div><span style={{ color: cs.muted }}>Layanan: </span><span style={{ color: cs.text }}>{selectedLaporan.service}</span></div>
              <div><span style={{ color: cs.muted }}>Teknisi: </span><span style={{ color: cs.accent, fontWeight: 700 }}>{selectedLaporan.teknisi}</span></div>
              {selectedLaporan.helper && <div><span style={{ color: cs.muted }}>Helper: </span><span style={{ color: cs.text }}>{selectedLaporan.helper}</span></div>}
            </div>

            {/* Multi-unit display (struktur baru) */}
            {(selectedLaporan.units || []).length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {(selectedLaporan.units || []).map((u, ui) => (
                  <div key={ui} style={{ background: cs.card, borderRadius: 10, padding: 14, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, color: cs.accent, marginBottom: 8 }}>Unit {u.unit_no} — {u.label} {u.merk ? `(${u.merk})` : ""}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                      {(u.kondisi_sebelum || []).map((k, ki) => <span key={ki} style={{ background: cs.yellow + "18", color: cs.yellow, fontSize: 10, padding: "2px 8px", borderRadius: 99 }}>{k}</span>)}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                      {(u.pekerjaan || []).map((p, pi) => <span key={pi} style={{ background: cs.accent + "18", color: cs.accent, fontSize: 10, padding: "2px 8px", borderRadius: 99 }}>{p}</span>)}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                      {(u.kondisi_setelah || []).map((k, ki) => <span key={ki} style={{ background: cs.green + "18", color: cs.green, fontSize: 10, padding: "2px 8px", borderRadius: 99 }}>{k}</span>)}
                    </div>
                    {(u.ampere_akhir || parseFloat(u.freon_ditambah) > 0) && (
                      <div style={{ fontSize: 11, color: cs.muted }}>
                        {u.ampere_akhir ? `Ampere: ${u.ampere_akhir}A` : ""}
                        {u.ampere_akhir && parseFloat(u.freon_ditambah) > 0 ? " · " : ""}
                        {parseFloat(u.freon_ditambah) > 0 ? `Tekanan: ${u.freon_ditambah} psi` : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* Legacy struktur lama (flat) */
              <div style={{ background: cs.card, borderRadius: 10, padding: 14, fontSize: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                  <div><div style={{ color: cs.muted, fontSize: 11, marginBottom: 4 }}>Kondisi Sebelum</div><div style={{ color: cs.yellow, fontWeight: 600 }}>{typeof selectedLaporan.kondisi_sebelum === "string" ? selectedLaporan.kondisi_sebelum : (selectedLaporan.kondisi_sebelum || []).join(", ")}</div></div>
                  <div><div style={{ color: cs.muted, fontSize: 11, marginBottom: 4 }}>Kondisi Sesudah</div><div style={{ color: cs.green, fontWeight: 600 }}>{typeof selectedLaporan.kondisi_setelah === "string" ? selectedLaporan.kondisi_setelah : (selectedLaporan.kondisi_setelah || []).join(", ")}</div></div>
                </div>
                {(selectedLaporan.pekerjaan || []).length > 0 && (
                  <div style={{ marginBottom: 8 }}><span style={{ color: cs.muted, fontSize: 11 }}>Pekerjaan: </span>{(selectedLaporan.pekerjaan || []).map((p, pi) => <span key={pi} style={{ background: cs.accent + "18", color: cs.accent, fontSize: 10, padding: "2px 8px", borderRadius: 99, marginRight: 4 }}>{p}</span>)}</div>
                )}
              </div>
            )}

            {/* Material terpakai */}
            {(selectedLaporan.materials || []).length > 0 && (
              <div style={{ background: cs.card, borderRadius: 10, padding: "10px 14px", fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: cs.muted, marginBottom: 6 }}>🔧 Material</div>
                {(selectedLaporan.materials || []).map((m, mi) => (
                  <div key={mi} style={{ color: cs.muted, marginBottom: 2 }}>• {m.nama}: {m.jumlah} {m.satuan}</div>
                ))}
              </div>
            )}

            {selectedLaporan.rekomendasi && <div style={{ fontSize: 11, marginBottom: 4 }}><span style={{ color: cs.muted }}>Rekomendasi: </span><span style={{ color: cs.text }}>{selectedLaporan.rekomendasi}</span></div>}
            {(selectedLaporan.catatan_global || selectedLaporan.catatan) && <div style={{ fontSize: 11 }}><span style={{ color: cs.muted }}>Catatan: </span><span style={{ color: cs.text }}>{selectedLaporan.catatan_global || selectedLaporan.catatan}</span></div>}

            {/* ── Survey: preview hasil + tombol kirim ── */}
            {selectedLaporan.service === "Survey" && (selectedLaporan.hasil_survey || selectedLaporan.catatan_rekomendasi) && (
              <div style={{ background: "linear-gradient(135deg,#0369a1,#0c4a6e)", borderRadius: 12, padding: "16px 18px", marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,.7)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>📋 Hasil Survey</div>
                {selectedLaporan.hasil_survey && (
                  <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 8, padding: "10px 12px", marginBottom: selectedLaporan.catatan_rekomendasi ? 8 : 0 }}>
                    <div style={{ fontSize: 13, color: "#fff", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{selectedLaporan.hasil_survey}</div>
                  </div>
                )}
                {selectedLaporan.catatan_rekomendasi && (
                  <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.6)", marginBottom: 4 }}>💡 Rekomendasi</div>
                    <div style={{ fontSize: 13, color: "#fff", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{selectedLaporan.catatan_rekomendasi}</div>
                  </div>
                )}
                {selectedLaporan.survey_sent_at && (
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,.55)", marginTop: 8 }}>
                    ✅ Dikirim ke customer: {new Date(selectedLaporan.survey_sent_at).toLocaleString("id-ID")}
                  </div>
                )}
              </div>
            )}

            {/* ── Tombol aksi bawah ── */}
            {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {selectedLaporan.service === "Survey"
                  ? <button onClick={() => { setModalLaporanDetail(false); setTimeout(() => { window.dispatchEvent(new CustomEvent("open-survey-kirim", { detail: selectedLaporan })); }, 100); }}
                      style={{ flex: 1, background: "linear-gradient(135deg,#16a34a,#15803d)", border: "none", color: "#fff", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                      📤 Kirim Hasil Survey ke Customer
                    </button>
                  : <button onClick={() => { const relInv = invoicesData.find(i => i.job_id === selectedLaporan.job_id) || {}; downloadServiceReportPDF(selectedLaporan, relInv); }}
                      style={{ flex: 1, background: "#1e3a5f", border: "none", color: "#fff", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                      📋 Preview Report Card
                    </button>
                }
              </div>
            )}

            {safeArr(selectedLaporan.editLog).length > 0 && (
              <div style={{ background: cs.yellow + "08", border: "1px solid " + cs.yellow + "22", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow, marginBottom: 8 }}>Riwayat Edit ({safeArr(selectedLaporan.editLog).length}x)</div>
                {safeArr(selectedLaporan.editLog).map((log, li) => (
                  <div key={li} style={{ fontSize: 11, color: cs.muted, marginBottom: 5, paddingBottom: 5, borderBottom: li < safeArr(selectedLaporan.editLog).length - 1 ? "1px solid " + cs.border : "none" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                      <span style={{ background: cs.accent + "18", color: cs.accent, fontWeight: 700, padding: "1px 8px", borderRadius: 99, fontSize: 10 }}>{log.by}</span>
                      <span style={{ color: cs.muted }}>{log.at}</span>
                      <span>ubah field <b style={{ color: cs.text }}>{log.field}</b></span>
                    </div>
                    <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                      <span style={{ color: cs.red, textDecoration: "line-through" }}>{String(log.old).slice(0, 60)}</span>
                      <span style={{ color: cs.muted }}>→</span>
                      <span style={{ color: cs.green, fontWeight: 600 }}>{String(log.new).slice(0, 60)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
