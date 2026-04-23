import { memo } from "react";
import { cs } from "../theme/cs.js";
import { statusColor } from "../constants/status.js";
import { normalizePhone } from "../lib/phone.js";

function CustomersView({ selectedCustomer, setSelectedCustomer, ordersData, laporanReports, invoicesData, customersData, setCustomersData, searchCustomer, setSearchCustomer, customerPage, setCustomerPage, customerTab, setCustomerTab, currentUser, isMobile, setNewCustomerForm, setModalAddCustomer, setNewOrderForm, setModalOrder, setSelectedInvoice, setModalPDF, buildCustomerHistory, openWA, showConfirm, showNotif, deleteCustomer, addAgentLog, updateCustomer, fotoSrc, safeArr, fmt, supabase, CUST_PAGE_SIZE, downloadServiceReportPDF }) {
// ── LIVE history: ordersData + laporanReports + invoicesData ──
const history = selectedCustomer
  ? buildCustomerHistory(selectedCustomer, ordersData, laporanReports, invoicesData)
  : [];
const _scq = searchCustomer.trim().toLowerCase();
const filteredCusts = customersData.filter(cu => {
  if (!_scq) return true;
  return (
    (cu.name || "").toLowerCase().includes(_scq) ||
    (cu.phone || "").includes(searchCustomer.trim()) ||
    (cu.address || "").toLowerCase().includes(_scq) ||
    (cu.area || "").toLowerCase().includes(_scq) ||
    (cu.notes || "").toLowerCase().includes(_scq)
  );
});
const totPgCust = Math.ceil(filteredCusts.length / CUST_PAGE_SIZE) || 1;
const curPgCust = Math.min(customerPage, totPgCust);
const pageCusts = filteredCusts.slice((curPgCust - 1) * CUST_PAGE_SIZE, curPgCust * CUST_PAGE_SIZE);
return (
  <div style={{ display: "grid", gap: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>
        {selectedCustomer ? (
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => { setSelectedCustomer(null); setCustomerTab("list"); }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Kembali</button>
            <span>👤 {selectedCustomer.name}</span>
            {selectedCustomer.is_vip && <span style={{ background: cs.yellow + "22", color: cs.yellow, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, border: "1px solid " + cs.yellow + "44" }}>⭐ VIP</span>}
            {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
              <button onClick={() => { setNewCustomerForm({ name: selectedCustomer.name, phone: selectedCustomer.phone, address: selectedCustomer.address, area: selectedCustomer.area, notes: selectedCustomer.notes || "", is_vip: selectedCustomer.is_vip }); setModalAddCustomer(true); }}
                style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✏️ Edit</button>
            )}
          </span>
        ) : "👥 Data Customer"}
      </div>
      {!selectedCustomer && (
        <button onClick={() => { setNewCustomerForm({ name: "", phone: "", address: "", area: "", notes: "", is_vip: false }); setModalAddCustomer(true); }}
          style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          + Customer Baru
        </button>
      )}
    </div>

    {!selectedCustomer ? (
      <div style={{ display: "grid", gap: 12 }}>
        {/* Search bar */}
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: cs.muted, pointerEvents: "none" }}>🔍</span>
          <input id="searchCustomer" value={searchCustomer} onChange={e => { setSearchCustomer(e.target.value); setCustomerPage(1); }}
            placeholder="Cari nama customer atau nomor telepon..."
            style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          {searchCustomer && <button onClick={() => setSearchCustomer("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>}
        </div>
        {searchCustomer && (
          <div style={{ fontSize: 12, color: cs.muted }}>Menampilkan <b style={{ color: cs.accent }}>{filteredCusts.length}</b> dari {customersData.length} customer</div>
        )}
        {pageCusts.map(cu => {
          const cHist = buildCustomerHistory(cu, ordersData, laporanReports, invoicesData);
          const lastSvc = cHist[0]; // sudah sorted by date desc
          return (
            <div key={cu.id} style={{
              background: cs.card, border: "1px solid " + cs.border,
              borderRadius: 10, padding: "10px 12px",
              display: "flex", alignItems: "center", gap: 10
            }}>
              {/* Avatar */}
              <div style={{
                width: 38, height: 38, borderRadius: "50%",
                background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: 800, color: "#fff", flexShrink: 0
              }}>
                {(cu.name || "?").charAt(0).toUpperCase()}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>{cu.name}</span>
                  {cu.is_vip && <span style={{ fontSize: 9, background: "#f59e0b22", color: "#f59e0b", padding: "1px 5px", borderRadius: 99, fontWeight: 700 }}>⭐VIP</span>}
                </div>
                <div style={{ fontSize: 11, color: cs.muted }}>📱 {cu.phone || "-"}</div>
                <div style={{ fontSize: 11, color: cs.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>📍 {cu.address || cu.area || "-"}</div>
              </div>
              {/* Tombol — role-aware */}
              {(currentUser?.role === "Teknisi" || currentUser?.role === "Helper") ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => { setSelectedCustomer(cu); setCustomerTab("history"); }}
                    style={{
                      background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent,
                      borderRadius: 7, padding: "5px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600
                    }}>
                    📋 Riwayat
                  </button>
                  <button onClick={() => cu.phone && openWA(cu.phone, "")}
                    style={{
                      background: "#25D36618", border: "1px solid #25D36633", color: "#25D366",
                      borderRadius: 7, padding: "5px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600
                    }}>
                    💬 WA
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => { setSelectedCustomer(cu); setCustomerTab("history"); }}
                    style={{
                      background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent,
                      borderRadius: 7, padding: "5px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600
                    }}>
                    📋 Riwayat
                  </button>
                  <button onClick={() => { setNewOrderForm(f => ({ ...f, customer: cu.name, phone: normalizePhone(cu.phone) || cu.phone, address: cu.address || "", service: "Cleaning" })); setModalOrder(true); }}
                    style={{
                      background: cs.green + "18", border: "1px solid " + cs.green + "33", color: cs.green,
                      borderRadius: 7, padding: "5px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600
                    }}>
                    📦 Order
                  </button>
                  <button onClick={() => cu.phone && openWA(cu.phone, "")}
                    style={{
                      background: "#25D36618", border: "1px solid #25D36633", color: "#25D366",
                      borderRadius: 7, padding: "5px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600
                    }}>
                    💬 WA
                  </button>
                  {currentUser?.role === "Owner" ? (
                    <button onClick={async () => {
                      if (!await showConfirm({
                        icon: "🗑️", title: "Hapus Customer?", danger: true,
                        message: `Hapus "${cu.name}"?\nHistory order tetap ada.`,
                        confirmText: "Hapus"
                      })) return;
                      setCustomersData(prev => prev.filter(c => c.id !== cu.id));
                      const { error } = await deleteCustomer(supabase, cu.id);
                      if (error) showNotif("⚠️ " + error.message);
                      else { addAgentLog("CUSTOMER_DELETED", cu.name + " dihapus", "WARNING"); showNotif("🗑️ Dihapus"); }
                    }} style={{
                      background: "#ef444418", border: "1px solid #ef444433", color: "#ef4444",
                      borderRadius: 7, padding: "5px 9px", cursor: "pointer", fontSize: 11, fontWeight: 600
                    }}>
                      🗑️ Hapus
                    </button>
                  ) : <div />}
                </div>
              )}
            </div>
          );
        })}
        {/* Customer pagination */}
        {totPgCust > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={() => setCustomerPage(p => Math.max(1, p - 1))} disabled={curPgCust === 1}
              style={{
                padding: "5px 12px", borderRadius: 8, border: "1px solid " + cs.border,
                background: curPgCust === 1 ? cs.surface : cs.card, color: curPgCust === 1 ? cs.muted : cs.text, cursor: curPgCust === 1 ? "default" : "pointer"
              }}>‹</button>
            {Array.from({ length: Math.min(totPgCust, 7) }, (_, i) => {
              let pg = i + 1;
              if (totPgCust > 7) { if (curPgCust <= 4) pg = i + 1; else if (curPgCust >= totPgCust - 3) pg = totPgCust - 6 + i; else pg = curPgCust - 3 + i; }
              return (<button key={pg} onClick={() => setCustomerPage(pg)}
                style={{
                  padding: "5px 10px", borderRadius: 8, border: "1px solid " + (curPgCust === pg ? cs.accent : cs.border),
                  background: curPgCust === pg ? cs.accent : cs.card, color: curPgCust === pg ? "#0a0f1e" : cs.text, cursor: "pointer", fontWeight: curPgCust === pg ? 700 : 400
                }}>{pg}</button>);
            })}
            <button onClick={() => setCustomerPage(p => Math.min(totPgCust, p + 1))} disabled={curPgCust === totPgCust}
              style={{
                padding: "5px 12px", borderRadius: 8, border: "1px solid " + cs.border,
                background: curPgCust === totPgCust ? cs.surface : cs.card, color: curPgCust === totPgCust ? cs.muted : cs.text, cursor: curPgCust === totPgCust ? "default" : "pointer"
              }}>›</button>
            <span style={{ fontSize: 11, color: cs.muted }}>hal {curPgCust}/{totPgCust} · {filteredCusts.length} customer</span>
          </div>
        )}
      </div>
    ) : (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 18, display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 14, textAlign: "center" }}>
          {[
            ["Total Order", history.length, cs.accent],
            ["Total Spend", currentUser?.role === "Teknisi" || currentUser?.role === "Helper"
              ? "—"
              : fmt(history.reduce((a, b) => a + (b.invoice_total || 0), 0)), cs.green],
            ["Terakhir Servis", history[0]?.date || selectedCustomer.last_service || "—", cs.yellow],
            ["Area", selectedCustomer.area, cs.muted],
          ].map(([label, val, color]) => (
            <div key={label}><div style={{ fontSize: 11, color: cs.muted, fontWeight: 600, marginBottom: 4 }}>{label}</div><div style={{ fontWeight: 800, color, fontSize: 15 }}>{val}</div></div>
          ))}
        </div>
        {selectedCustomer.notes && <div style={{ background: "#0ea5e912", border: "1px solid #0ea5e933", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#7dd3fc" }}>💡 {selectedCustomer.notes}</div>}
        <div style={{ display: "flex", gap: 2, background: cs.surface, borderRadius: 10, padding: 4, width: "fit-content" }}>
          {[["history", "📋 Riwayat"], ["profile", "👤 Profil"]].map(([tab, label]) => (
            <button key={tab} onClick={() => setCustomerTab(tab)} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: customerTab === tab ? cs.accent : "transparent", color: customerTab === tab ? "#0a0f1e" : cs.muted, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{label}</button>
          ))}
        </div>
        {customerTab === "history" ? (
          <div style={{ display: "grid", gap: 10 }}>
            {history.length === 0 ? <div style={{ background: cs.card, borderRadius: 14, padding: 32, textAlign: "center", color: cs.muted }}>Belum ada riwayat</div>
              : history.map(svc => {
                // Cek apakah ada laporan teknisi untuk job ini
                const hasLaporan = !!svc.laporan_id;
                const unitDetails = svc.unit_detail || [];
                const svcColor = statusColor[svc.status] || cs.border;
                return (
                  <div key={svc.id} style={{ background: cs.card, border: "1px solid " + svcColor + "44", borderRadius: 12, padding: "14px 16px", position: "relative" }}>

                    {/* Header — job ID, layanan, status, tanggal */}
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent, fontSize: 13 }}>{svc.job_id}</span>
                        <span style={{ fontSize: 13, color: cs.text, fontWeight: 600 }}>{svc.service}</span>
                        <span style={{
                          fontSize: 10, padding: "2px 8px", borderRadius: 99,
                          background: (svcColor) + "18", color: svcColor, fontWeight: 700
                        }}>
                          {svc.status}
                        </span>
                        {hasLaporan && (
                          <span style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 99,
                            background: cs.green + "15", color: cs.green, fontWeight: 700
                          }}>
                            ✅ Laporan Ada
                          </span>
                        )}
                        {svc.total_freon > 0 && (
                          <span style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 99,
                            background: cs.yellow + "15", color: cs.yellow, fontWeight: 700
                          }}>
                            🧊 Freon +{svc.total_freon}psi
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: cs.muted }}>📅 {svc.date}</span>
                        {currentUser?.role !== "Teknisi" && currentUser?.role !== "Helper" && svc.invoice_id && (
                          <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>🧾 {svc.invoice_id}</span>
                        )}
                      </div>
                    </div>

                    {/* Info dasar */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "4px 16px", fontSize: 12, color: cs.muted, marginBottom: 10 }}>
                      <span>🔧 {svc.type || svc.service} × {svc.units} unit</span>
                      <span>👷 {svc.teknisi}{svc.helper ? " + " + svc.helper : ""}</span>
                      {svc.notes && <span style={{ gridColumn: "1/-1", color: "#7dd3fc" }}>📝 {svc.notes}</span>}
                    </div>

                    {/* ── Detail Unit AC dari laporan teknisi ── */}
                    {unitDetails.length > 0 && (
                      <div style={{ background: cs.surface, borderRadius: 9, padding: "10px 12px", marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent, marginBottom: 7 }}>
                          🌡️ Detail Unit AC (dari Laporan Teknisi)
                        </div>
                        {unitDetails.map((u, ui) => (
                          <div key={ui} style={{
                            marginBottom: ui < unitDetails.length - 1 ? 10 : 0, paddingBottom: ui < unitDetails.length - 1 ? 10 : 0,
                            borderBottom: ui < unitDetails.length - 1 ? "1px solid " + cs.border : "none"
                          }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                              <span style={{ fontWeight: 700, color: cs.text, fontSize: 12 }}>
                                Unit {u.unit_no} — {u.label}
                              </span>
                              {u.merk && <span style={{ fontSize: 11, color: cs.muted }}>{u.merk}</span>}
                              {u.pk && <span style={{ fontSize: 10, background: cs.accent + "12", color: cs.accent, padding: "1px 7px", borderRadius: 99 }}>{u.pk}</span>}
                              {u.tipe && <span style={{ fontSize: 10, color: cs.muted }}>{u.tipe}</span>}
                              {u.ampere_akhir && (
                                <span style={{
                                  fontSize: 10, background: cs.green + "15", color: cs.green,
                                  padding: "1px 7px", borderRadius: 99
                                }}>⚡ {u.ampere_akhir}A</span>
                              )}
                              {parseFloat(u.freon_ditambah) > 0 && (
                                <span style={{
                                  fontSize: 10, background: cs.yellow + "15", color: cs.yellow,
                                  padding: "1px 7px", borderRadius: 99
                                }}>🧊 {u.freon_ditambah} psi</span>
                              )}
                            </div>
                            {/* Kondisi sebelum — array dari mkUnit */}
                            {safeArr(u.kondisi_sebelum).length > 0 && (
                              <div style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: 10, color: cs.muted }}>Kondisi masuk: </span>
                                {safeArr(u.kondisi_sebelum).map((k, ki) => (
                                  <span key={ki} style={{
                                    fontSize: 10, background: cs.yellow + "15",
                                    color: cs.yellow, padding: "1px 6px", borderRadius: 99, marginRight: 3
                                  }}>{k}</span>
                                ))}
                              </div>
                            )}
                            {/* Pekerjaan dilakukan — array dari mkUnit */}
                            {safeArr(u.pekerjaan).length > 0 && (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                                <span style={{ fontSize: 10, color: cs.muted, alignSelf: "center" }}>Dikerjakan: </span>
                                {safeArr(u.pekerjaan).map((p, pi) => (
                                  <span key={pi} style={{
                                    fontSize: 10, background: cs.accent + "15",
                                    color: cs.accent, padding: "1px 6px", borderRadius: 99
                                  }}>{p}</span>
                                ))}
                              </div>
                            )}
                            {/* Kondisi sesudah — array dari mkUnit */}
                            {safeArr(u.kondisi_setelah).length > 0 && (
                              <div style={{ marginBottom: 3 }}>
                                <span style={{ fontSize: 10, color: cs.muted }}>Setelah: </span>
                                {safeArr(u.kondisi_setelah).map((k, ki) => (
                                  <span key={ki} style={{
                                    fontSize: 10, background: cs.green + "15",
                                    color: cs.green, padding: "1px 6px", borderRadius: 99, marginRight: 3
                                  }}>{k}</span>
                                ))}
                              </div>
                            )}
                            {u.catatan_unit && (
                              <div style={{ fontSize: 11, color: "#7dd3fc", marginTop: 3 }}>💬 {u.catatan_unit}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Rekomendasi teknisi */}
                    {svc.rekomendasi && (
                      <div style={{
                        background: "#0ea5e910", border: "1px solid #0ea5e933", borderRadius: 8,
                        padding: "7px 10px", marginBottom: 8, fontSize: 12, color: "#7dd3fc"
                      }}>
                        💡 <b>Rekomendasi:</b> {svc.rekomendasi}
                      </div>
                    )}

                    {/* Material yang dipakai */}
                    {safeArr(svc.materials).length > 0 && (
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 6 }}>
                        🔩 Material: {safeArr(svc.materials).map(m => `${m.nama} ${m.jumlah}${m.satuan}`).join(", ")}
                      </div>
                    )}

                    {/* Foto thumbnail */}
                    {safeArr(svc.foto_urls).length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        {safeArr(svc.foto_urls).slice(0, 5).map((url, fi) => (
                          <img key={fi} src={fotoSrc(url)} alt={`Foto ${fi + 1}`}
                            onClick={() => window.open(fotoSrc(url), "_blank")}
                            style={{
                              width: 56, height: 56, objectFit: "cover", borderRadius: 8,
                              cursor: "pointer", border: "1px solid " + cs.border,
                              transition: "opacity .15s"
                            }}
                            onMouseEnter={e => e.target.style.opacity = ".8"}
                            onMouseLeave={e => e.target.style.opacity = "1"} />
                        ))}
                        {safeArr(svc.foto_urls).length > 5 && (
                          <div style={{
                            width: 56, height: 56, borderRadius: 8, background: cs.surface,
                            border: "1px solid " + cs.border, display: "flex", alignItems: "center",
                            justifyContent: "center", fontSize: 11, color: cs.muted, cursor: "pointer"
                          }}
                            onClick={() => window.open(fotoSrc(svc.foto_urls[5]), "_blank")}>
                            +{safeArr(svc.foto_urls).length - 5}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action buttons — buat order baru / lihat invoice */}
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && svc.invoice_id && (
                        <button
                          onClick={() => {
                            const inv = invoicesData.find(i => i.id === svc.invoice_id);
                            if (inv) { setSelectedInvoice(inv); setModalPDF(true); }
                          }}
                          style={{
                            fontSize: 11, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
                            background: cs.green + "15", border: "1px solid " + cs.green + "44", color: cs.green
                          }}>
                          🧾 Lihat Invoice
                        </button>
                      )}
                      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                        <button
                          onClick={() => {
                            setNewOrderForm(f => ({
                              ...f,
                              customer: selectedCustomer.name,
                              phone: selectedCustomer.phone,
                              address: selectedCustomer.address,
                              area: selectedCustomer.area,
                              service: svc.service,
                              type: svc.type,
                              units: svc.units,
                            }));
                            setModalOrder(true);
                          }}
                          style={{
                            fontSize: 11, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
                            background: cs.accent + "15", border: "1px solid " + cs.accent + "44", color: cs.accent
                          }}>
                          🔁 Order Ulang
                        </button>
                      )}
                      {/* Report Card PDF — semua role yang punya laporan */}
                      {downloadServiceReportPDF && svc.laporan_id && (
                        <button
                          onClick={() => {
                            const fullLap = laporanReports.find(r => r.id === svc.laporan_id);
                            if (!fullLap) return;
                            const relInv = invoicesData.find(i => i.job_id === fullLap.job_id) || {};
                            downloadServiceReportPDF(fullLap, relInv);
                          }}
                          style={{
                            fontSize: 11, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
                            background: "#1e3a5f22", border: "1px solid #1e3a5f44", color: "#93c5fd"
                          }}>
                          📋 Report Card
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18, display: "grid", gap: 10 }}>
            {[["Nama", selectedCustomer.name], ["Telepon", selectedCustomer.phone], ["Email", selectedCustomer.email || "—"], ["Area", selectedCustomer.area], ["Alamat", selectedCustomer.address], ["Bergabung", selectedCustomer.joined]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 16, paddingBottom: 10, borderBottom: "1px solid " + cs.border }}>
                <span style={{ fontSize: 12, color: cs.muted, minWidth: 100, fontWeight: 600 }}>{k}</span>
                <span style={{ fontSize: 13, color: cs.text }}>{v}</span>
              </div>
            ))}
            {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
              <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                <button onClick={() => { setNewCustomerForm({ name: selectedCustomer.name, phone: selectedCustomer.phone, address: selectedCustomer.address, area: selectedCustomer.area, notes: selectedCustomer.notes || "", is_vip: selectedCustomer.is_vip }); setModalAddCustomer(true); }}
                  style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ Edit Data Customer</button>
                <button onClick={() => { openWA(selectedCustomer.phone, ""); }}
                  style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>📱 Hubungi WA</button>
                <button onClick={async () => {
                  if (await showConfirm({
                    icon: "⭐", title: "Ubah Status VIP?",
                    message: `Tandai ${selectedCustomer.name} sebagai ${selectedCustomer.is_vip ? "Regular" : "VIP"}?`,
                    confirmText: "Ya, Ubah"
                  }))
                    setCustomersData(prev => prev.map(cu => cu.id === selectedCustomer.id ? { ...cu, is_vip: !cu.is_vip } : cu));
                  setSelectedCustomer(prev => ({ ...prev, is_vip: !prev.is_vip }));
                  updateCustomer(supabase, selectedCustomer.id, { is_vip: !selectedCustomer.is_vip });
                  showNotif(selectedCustomer.name + (selectedCustomer.is_vip ? " diturunkan ke Regular" : " dijadikan VIP ⭐"));
                }}
                  style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>{selectedCustomer.is_vip ? "⭐ Hapus VIP" : "⭐ Jadikan VIP"}</button>
              </div>
            )}
          </div>
        )}
      </div>
    )}
  </div>
);
}

export default memo(CustomersView);
