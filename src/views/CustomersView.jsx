import { memo } from "react";
import { cs } from "../theme/cs.js";
import { statusColor } from "../constants/status.js";
import { normalizePhone } from "../lib/phone.js";

// Warna avatar deterministik berdasarkan nama
const AVATAR_COLORS = [
  ["#6366f1","#818cf8"], ["#0ea5e9","#38bdf8"], ["#10b981","#34d399"],
  ["#f59e0b","#fbbf24"], ["#ef4444","#f87171"], ["#8b5cf6","#a78bfa"],
  ["#ec4899","#f472b6"], ["#14b8a6","#2dd4bf"],
];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name||"").length; i++) h = (h * 31 + (name||"").charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function CustomersView({ selectedCustomer, setSelectedCustomer, ordersData, laporanReports, invoicesData, customersData, setCustomersData, searchCustomer, setSearchCustomer, customerPage, setCustomerPage, customerTab, setCustomerTab, currentUser, isMobile, setNewCustomerForm, setModalAddCustomer, setNewOrderForm, setModalOrder, setSelectedInvoice, setModalPDF, buildCustomerHistory, openWA, showConfirm, showNotif, deleteCustomer, addAgentLog, updateCustomer, fotoSrc, safeArr, fmt, supabase, CUST_PAGE_SIZE, downloadServiceReportPDF }) {
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
const isOwnerAdmin = currentUser?.role === "Owner" || currentUser?.role === "Admin";
const isTekHelper = currentUser?.role === "Teknisi" || currentUser?.role === "Helper";

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* ── Header ── */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>
        {selectedCustomer ? (
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => { setSelectedCustomer(null); setCustomerTab("list"); }}
              style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              ← Kembali
            </button>
            <span style={{ fontSize: 16 }}>{selectedCustomer.name}</span>
            {selectedCustomer.is_vip && (
              <span style={{ background: "#f59e0b22", color: "#f59e0b", fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99, border: "1px solid #f59e0b44" }}>VIP</span>
            )}
          </span>
        ) : (
          <span>Customers <span style={{ fontSize: 13, color: cs.muted, fontWeight: 400 }}>({filteredCusts.length})</span></span>
        )}
      </div>
      {!selectedCustomer && (
        <button onClick={() => { setNewCustomerForm({ name: "", phone: "", address: "", area: "", notes: "", is_vip: false }); setModalAddCustomer(true); }}
          style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "9px 18px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          + Customer Baru
        </button>
      )}
    </div>

    {!selectedCustomer ? (
      <div style={{ display: "grid", gap: 12 }}>
        {/* Search */}
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: cs.muted, pointerEvents: "none" }}>🔍</span>
          <input id="searchCustomer" value={searchCustomer} onChange={e => { setSearchCustomer(e.target.value); setCustomerPage(1); }}
            placeholder="Cari nama, nomor telepon, area, atau alamat..."
            style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          {searchCustomer && (
            <button onClick={() => setSearchCustomer("")}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
          )}
        </div>
        {searchCustomer && (
          <div style={{ fontSize: 12, color: cs.muted }}>Ditemukan <b style={{ color: cs.accent }}>{filteredCusts.length}</b> dari {customersData.length} customer</div>
        )}

        {/* ── Daftar customer card ── */}
        <div style={{ display: "grid", gap: 10 }}>
          {pageCusts.map(cu => {
            const cHist = buildCustomerHistory(cu, ordersData, laporanReports, invoicesData);
            const lastSvc = cHist[0];
            const [grad1, grad2] = avatarColor(cu.name);
            const totalSpend = cHist.reduce((a, b) => a + (b.invoice_total || 0), 0);
            return (
              <div key={cu.id} style={{
                background: cs.card,
                border: "1px solid " + cs.border,
                borderRadius: 14,
                padding: "14px 16px",
                display: "flex", alignItems: "center", gap: 14,
                transition: "border-color .15s",
              }}>
                {/* Avatar */}
                <div style={{
                  width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                  background: "linear-gradient(135deg," + grad1 + "," + grad2 + ")",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, fontWeight: 800, color: "#fff",
                  boxShadow: "0 2px 8px " + grad1 + "55",
                }}>
                  {(cu.name || "?").charAt(0).toUpperCase()}
                </div>

                {/* Info utama */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>{cu.name}</span>
                    {cu.is_vip && (
                      <span style={{ fontSize: 9, background: "#f59e0b22", color: "#f59e0b", padding: "2px 7px", borderRadius: 99, fontWeight: 800, border: "1px solid #f59e0b33" }}>VIP</span>
                    )}
                    {cHist.length > 0 && (
                      <span style={{ fontSize: 10, background: cs.accent + "15", color: cs.accent, padding: "1px 7px", borderRadius: 99, fontWeight: 600 }}>
                        {cHist.length}x servis
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: cs.muted }}>
                    {cu.phone && <span>{cu.phone}</span>}
                    {(cu.area || cu.address) && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{cu.area || cu.address}</span>}
                    {lastSvc && <span style={{ color: cs.muted }}>Terakhir: {lastSvc.date}</span>}
                  </div>
                  {isOwnerAdmin && totalSpend > 0 && (
                    <div style={{ marginTop: 4, fontSize: 11, color: cs.green, fontWeight: 600 }}>{fmt(totalSpend)} total</div>
                  )}
                </div>

                {/* Aksi */}
                <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                  <button onClick={() => { setSelectedCustomer(cu); setCustomerTab("history"); }}
                    style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent, borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                    Riwayat
                  </button>
                  <div style={{ display: "flex", gap: 5 }}>
                    {cu.phone && (
                      <button onClick={() => openWA(cu.phone, "")}
                        style={{ flex: 1, background: "#25D36615", border: "1px solid #25D36633", color: "#25D366", borderRadius: 7, padding: "5px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                        WA
                      </button>
                    )}
                    {!isTekHelper && (
                      <button onClick={() => { setNewOrderForm(f => ({ ...f, customer: cu.name, phone: normalizePhone(cu.phone) || cu.phone, address: cu.address || "", service: "Cleaning" })); setModalOrder(true); }}
                        style={{ flex: 1, background: cs.green + "15", border: "1px solid " + cs.green + "33", color: cs.green, borderRadius: 7, padding: "5px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                        Order
                      </button>
                    )}
                    {currentUser?.role === "Owner" && (
                      <button onClick={async () => {
                        if (!await showConfirm({ icon: "🗑️", title: "Hapus Customer?", danger: true, message: `Hapus "${cu.name}"?\nHistory order tetap ada.`, confirmText: "Hapus" })) return;
                        setCustomersData(prev => prev.filter(c => c.id !== cu.id));
                        const { error } = await deleteCustomer(supabase, cu.id);
                        if (error) showNotif("⚠️ " + error.message);
                        else { addAgentLog("CUSTOMER_DELETED", cu.name + " dihapus", "WARNING"); showNotif("Dihapus"); }
                      }} style={{ background: "#ef444415", border: "1px solid #ef444430", color: "#ef4444", borderRadius: 7, padding: "5px 8px", cursor: "pointer", fontSize: 11 }}>
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totPgCust > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setCustomerPage(p => Math.max(1, p - 1))} disabled={curPgCust === 1}
              style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgCust === 1 ? cs.surface : cs.card, color: curPgCust === 1 ? cs.muted : cs.text, cursor: curPgCust === 1 ? "default" : "pointer" }}>‹</button>
            {Array.from({ length: Math.min(totPgCust, 7) }, (_, i) => {
              let pg = i + 1;
              if (totPgCust > 7) { if (curPgCust <= 4) pg = i + 1; else if (curPgCust >= totPgCust - 3) pg = totPgCust - 6 + i; else pg = curPgCust - 3 + i; }
              return (
                <button key={pg} onClick={() => setCustomerPage(pg)}
                  style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid " + (curPgCust === pg ? cs.accent : cs.border), background: curPgCust === pg ? cs.accent : cs.card, color: curPgCust === pg ? "#0a0f1e" : cs.text, cursor: "pointer", fontWeight: curPgCust === pg ? 700 : 400 }}>
                  {pg}
                </button>
              );
            })}
            <button onClick={() => setCustomerPage(p => Math.min(totPgCust, p + 1))} disabled={curPgCust === totPgCust}
              style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgCust === totPgCust ? cs.surface : cs.card, color: curPgCust === totPgCust ? cs.muted : cs.text, cursor: curPgCust === totPgCust ? "default" : "pointer" }}>›</button>
            <span style={{ fontSize: 11, color: cs.muted }}>hal {curPgCust}/{totPgCust} · {filteredCusts.length} customer</span>
          </div>
        )}
      </div>

    ) : (
      /* ── Detail Customer ── */
      <div style={{ display: "grid", gap: 14 }}>

        {/* Profile card */}
        {(() => {
          const [grad1, grad2] = avatarColor(selectedCustomer.name);
          const totalSpend = history.reduce((a, b) => a + (b.invoice_total || 0), 0);
          return (
            <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 16, overflow: "hidden" }}>
              {/* Banner */}
              <div style={{ height: 6, background: "linear-gradient(90deg," + grad1 + "," + grad2 + ")" }} />
              <div style={{ padding: "18px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                  {/* Avatar besar */}
                  <div style={{
                    width: 64, height: 64, borderRadius: 18, flexShrink: 0,
                    background: "linear-gradient(135deg," + grad1 + "," + grad2 + ")",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 26, fontWeight: 900, color: "#fff",
                    boxShadow: "0 4px 16px " + grad1 + "55",
                  }}>
                    {(selectedCustomer.name || "?").charAt(0).toUpperCase()}
                  </div>

                  {/* Info identitas */}
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>{selectedCustomer.name}</span>
                      {selectedCustomer.is_vip && (
                        <span style={{ background: "#f59e0b22", color: "#f59e0b", fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 99, border: "1px solid #f59e0b44" }}>VIP</span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: cs.muted }}>
                      {selectedCustomer.phone && <span>{selectedCustomer.phone}</span>}
                      {selectedCustomer.area && <span>{selectedCustomer.area}</span>}
                      {selectedCustomer.email && <span>{selectedCustomer.email}</span>}
                    </div>
                    {selectedCustomer.address && (
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>{selectedCustomer.address}</div>
                    )}
                  </div>

                  {/* Aksi cepat */}
                  {isOwnerAdmin && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
                      <button onClick={() => { setNewCustomerForm({ name: selectedCustomer.name, phone: selectedCustomer.phone, address: selectedCustomer.address, area: selectedCustomer.area, notes: selectedCustomer.notes || "", is_vip: selectedCustomer.is_vip }); setModalAddCustomer(true); }}
                        style={{ background: cs.accent + "20", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                        Edit
                      </button>
                      <button onClick={() => openWA(selectedCustomer.phone, "")}
                        style={{ background: "#25D36618", border: "1px solid #25D36633", color: "#25D366", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        WA
                      </button>
                      <button onClick={() => { setNewOrderForm(f => ({ ...f, customer: selectedCustomer.name, phone: selectedCustomer.phone, address: selectedCustomer.address, area: selectedCustomer.area })); setModalOrder(true); }}
                        style={{ background: cs.green + "18", border: "1px solid " + cs.green + "33", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        + Order
                      </button>
                      <button onClick={async () => {
                        const newVip = !selectedCustomer.is_vip;
                        if (!await showConfirm({ icon: "⭐", title: "Ubah Status VIP?", message: `Tandai ${selectedCustomer.name} sebagai ${newVip ? "VIP" : "Regular"}?`, confirmText: "Ya, Ubah" })) return;
                        setCustomersData(prev => prev.map(cu => cu.id === selectedCustomer.id ? { ...cu, is_vip: newVip } : cu));
                        setSelectedCustomer(prev => ({ ...prev, is_vip: newVip }));
                        updateCustomer(supabase, selectedCustomer.id, { is_vip: newVip });
                        showNotif(selectedCustomer.name + (newVip ? " dijadikan VIP ⭐" : " diturunkan ke Regular"));
                      }} style={{ background: "#f59e0b18", border: "1px solid #f59e0b33", color: "#f59e0b", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
                        {selectedCustomer.is_vip ? "Hapus VIP" : "Jadikan VIP"}
                      </button>
                    </div>
                  )}
                </div>

                {/* Statistik ringkas */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, marginTop: 16, paddingTop: 16, borderTop: "1px solid " + cs.border }}>
                  {[
                    { label: "Total Servis", val: history.length + "x", color: cs.accent },
                    ...(!isTekHelper ? [{ label: "Total Spend", val: totalSpend > 0 ? fmt(totalSpend) : "—", color: cs.green }] : []),
                    { label: "Terakhir Servis", val: history[0]?.date || selectedCustomer.last_service || "—", color: cs.yellow },
                    { label: "Bergabung", val: selectedCustomer.joined ? selectedCustomer.joined.slice(0,10) : "—", color: cs.muted },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ background: cs.surface, borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: cs.muted, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                      <div style={{ fontWeight: 800, color, fontSize: 14 }}>{val}</div>
                    </div>
                  ))}
                </div>

                {selectedCustomer.notes && (
                  <div style={{ marginTop: 12, background: "#0ea5e910", border: "1px solid #0ea5e930", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#7dd3fc" }}>
                    {selectedCustomer.notes}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 2, background: cs.surface, borderRadius: 10, padding: 4, width: "fit-content" }}>
          {[["history", "Riwayat Servis"], ["profile", "Detail Profil"]].map(([tab, label]) => (
            <button key={tab} onClick={() => setCustomerTab(tab)}
              style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: customerTab === tab ? cs.accent : "transparent", color: customerTab === tab ? "#0a0f1e" : cs.muted, cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "all .15s" }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab: Riwayat Servis ── */}
        {customerTab === "history" ? (
          <div style={{ display: "grid", gap: 10 }}>
            {history.length === 0 ? (
              <div style={{ background: cs.card, borderRadius: 14, padding: 32, textAlign: "center", color: cs.muted }}>Belum ada riwayat servis</div>
            ) : history.map(svc => {
              const hasLaporan = !!svc.laporan_id;
              const unitDetails = svc.unit_detail || [];
              const svcColor = statusColor[svc.status] || cs.border;
              return (
                <div key={svc.id} style={{ background: cs.card, border: "1px solid " + svcColor + "33", borderRadius: 14, overflow: "hidden" }}>
                  {/* Bar warna status */}
                  <div style={{ height: 3, background: svcColor + "88" }} />
                  <div style={{ padding: "14px 16px" }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent, fontSize: 12 }}>{svc.job_id}</span>
                        <span style={{ fontSize: 13, color: cs.text, fontWeight: 700 }}>{svc.service}</span>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: svcColor + "18", color: svcColor, fontWeight: 700 }}>{svc.status}</span>
                        {hasLaporan && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: cs.green + "15", color: cs.green, fontWeight: 700 }}>Laporan Ada</span>}
                        {svc.total_freon > 0 && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: cs.yellow + "15", color: cs.yellow, fontWeight: 700 }}>Freon +{svc.total_freon}psi</span>}
                      </div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: cs.muted }}>{svc.date}</span>
                        {!isTekHelper && svc.invoice_id && <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>{svc.invoice_id}</span>}
                      </div>
                    </div>

                    {/* Info dasar */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "4px 16px", fontSize: 12, color: cs.muted, marginBottom: 10 }}>
                      <span>{svc.type || svc.service} × {svc.units} unit</span>
                      <span>Teknisi: {svc.teknisi}{svc.helper ? " + " + svc.helper : ""}</span>
                      {svc.notes && <span style={{ gridColumn: "1/-1", color: "#7dd3fc" }}>{svc.notes}</span>}
                    </div>

                    {/* Detail unit AC */}
                    {unitDetails.length > 0 && (
                      <div style={{ background: cs.surface, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent, marginBottom: 8 }}>Detail Unit AC</div>
                        {unitDetails.map((u, ui) => (
                          <div key={ui} style={{ marginBottom: ui < unitDetails.length - 1 ? 10 : 0, paddingBottom: ui < unitDetails.length - 1 ? 10 : 0, borderBottom: ui < unitDetails.length - 1 ? "1px solid " + cs.border : "none" }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                              <span style={{ fontWeight: 700, color: cs.text, fontSize: 12 }}>Unit {u.unit_no} — {u.label}</span>
                              {u.merk && <span style={{ fontSize: 11, color: cs.muted }}>{u.merk}</span>}
                              {u.pk && <span style={{ fontSize: 10, background: cs.accent + "12", color: cs.accent, padding: "1px 7px", borderRadius: 99 }}>{u.pk}</span>}
                              {u.tipe && <span style={{ fontSize: 10, color: cs.muted }}>{u.tipe}</span>}
                              {u.ampere_akhir && <span style={{ fontSize: 10, background: cs.green + "15", color: cs.green, padding: "1px 7px", borderRadius: 99 }}>{u.ampere_akhir}A</span>}
                              {parseFloat(u.freon_ditambah) > 0 && <span style={{ fontSize: 10, background: cs.yellow + "15", color: cs.yellow, padding: "1px 7px", borderRadius: 99 }}>{u.freon_ditambah} psi</span>}
                            </div>
                            {safeArr(u.kondisi_sebelum).length > 0 && (
                              <div style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: 10, color: cs.muted }}>Kondisi masuk: </span>
                                {safeArr(u.kondisi_sebelum).map((k, ki) => (
                                  <span key={ki} style={{ fontSize: 10, background: cs.yellow + "15", color: cs.yellow, padding: "1px 6px", borderRadius: 99, marginRight: 3 }}>{k}</span>
                                ))}
                              </div>
                            )}
                            {safeArr(u.pekerjaan).length > 0 && (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                                <span style={{ fontSize: 10, color: cs.muted, alignSelf: "center" }}>Dikerjakan: </span>
                                {safeArr(u.pekerjaan).map((p, pi) => (
                                  <span key={pi} style={{ fontSize: 10, background: cs.accent + "15", color: cs.accent, padding: "1px 6px", borderRadius: 99 }}>{p}</span>
                                ))}
                              </div>
                            )}
                            {safeArr(u.kondisi_setelah).length > 0 && (
                              <div style={{ marginBottom: 3 }}>
                                <span style={{ fontSize: 10, color: cs.muted }}>Setelah: </span>
                                {safeArr(u.kondisi_setelah).map((k, ki) => (
                                  <span key={ki} style={{ fontSize: 10, background: cs.green + "15", color: cs.green, padding: "1px 6px", borderRadius: 99, marginRight: 3 }}>{k}</span>
                                ))}
                              </div>
                            )}
                            {u.catatan_unit && <div style={{ fontSize: 11, color: "#7dd3fc", marginTop: 3 }}>{u.catatan_unit}</div>}
                          </div>
                        ))}
                      </div>
                    )}

                    {svc.rekomendasi && (
                      <div style={{ background: "#0ea5e910", border: "1px solid #0ea5e930", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#7dd3fc" }}>
                        Rekomendasi: {svc.rekomendasi}
                      </div>
                    )}
                    {safeArr(svc.materials).length > 0 && (
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>
                        Material: {safeArr(svc.materials).map(m => `${m.nama} ${m.jumlah}${m.satuan}`).join(", ")}
                      </div>
                    )}

                    {/* Foto */}
                    {safeArr(svc.foto_urls).length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                        {safeArr(svc.foto_urls).slice(0, 5).map((url, fi) => (
                          <img key={fi} src={fotoSrc(url)} alt={`Foto ${fi + 1}`}
                            onClick={() => window.open(fotoSrc(url), "_blank")}
                            style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, cursor: "pointer", border: "1px solid " + cs.border }}
                            onMouseEnter={e => e.target.style.opacity = ".75"}
                            onMouseLeave={e => e.target.style.opacity = "1"} />
                        ))}
                        {safeArr(svc.foto_urls).length > 5 && (
                          <div style={{ width: 56, height: 56, borderRadius: 8, background: cs.surface, border: "1px solid " + cs.border, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: cs.muted, cursor: "pointer" }}
                            onClick={() => window.open(fotoSrc(svc.foto_urls[5]), "_blank")}>
                            +{safeArr(svc.foto_urls).length - 5}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tombol aksi */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {isOwnerAdmin && svc.invoice_id && (
                        <button onClick={() => { const inv = invoicesData.find(i => i.id === svc.invoice_id); if (inv) { setSelectedInvoice(inv); setModalPDF(true); } }}
                          style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, cursor: "pointer", background: cs.green + "15", border: "1px solid " + cs.green + "33", color: cs.green }}>
                          Lihat Invoice
                        </button>
                      )}
                      {isOwnerAdmin && (
                        <button onClick={() => { setNewOrderForm(f => ({ ...f, customer: selectedCustomer.name, phone: selectedCustomer.phone, address: selectedCustomer.address, area: selectedCustomer.area, service: svc.service, type: svc.type, units: svc.units })); setModalOrder(true); }}
                          style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, cursor: "pointer", background: cs.accent + "15", border: "1px solid " + cs.accent + "33", color: cs.accent }}>
                          Order Ulang
                        </button>
                      )}
                      {downloadServiceReportPDF && svc.laporan_id && (
                        <button onClick={() => { const fullLap = laporanReports.find(r => r.id === svc.laporan_id); if (!fullLap) return; const relInv = invoicesData.find(i => i.job_id === fullLap.job_id) || {}; downloadServiceReportPDF(fullLap, relInv); }}
                          style={{ fontSize: 11, padding: "5px 12px", borderRadius: 7, cursor: "pointer", background: "#1e3a5f22", border: "1px solid #1e3a5f44", color: "#93c5fd" }}>
                          Report Card
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        ) : (
          /* ── Tab: Detail Profil ── */
          <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
            {[
              ["Nama Lengkap", selectedCustomer.name],
              ["Telepon", selectedCustomer.phone],
              ["Email", selectedCustomer.email || "—"],
              ["Area", selectedCustomer.area],
              ["Alamat", selectedCustomer.address],
              ["Bergabung", selectedCustomer.joined ? selectedCustomer.joined.slice(0,10) : "—"],
              ["Status", selectedCustomer.is_vip ? "VIP" : "Regular"],
            ].map(([k, v], idx, arr) => (
              <div key={k} style={{ display: "flex", gap: 16, padding: "12px 18px", borderBottom: idx < arr.length - 1 ? "1px solid " + cs.border : "none", alignItems: "flex-start" }}>
                <span style={{ fontSize: 12, color: cs.muted, minWidth: 110, fontWeight: 600, paddingTop: 1 }}>{k}</span>
                <span style={{ fontSize: 13, color: cs.text, flex: 1 }}>{v || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
);
}

export default memo(CustomersView);
