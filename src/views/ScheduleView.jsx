import { memo } from "react";
import { cs } from "../theme/cs.js";
import { statusColor, statusLabel } from "../constants/status.js";

function ScheduleView({ ordersData, setOrdersData, laporanReports, customersData, teknisiData, currentUser, weekOffset, setWeekOffset, scheduleView, setScheduleView, filterTeknisi, setFilterTeknisi, calLaporanFilter, setCalLaporanFilter, searchSchedule, setSearchSchedule, schedListFilter, setSchedListFilter, schedPage, setSchedPage, isMobile, setModalOrder, setSelectedCustomer, setCustomerTab, setActiveMenu, setEditOrderItem, setEditOrderForm, setModalEditOrder, setHistoryPreview, setWaTekTarget, setModalWaTek, getTechColor, dispatchStatus, sendDispatchWA, dispatchWA, deleteOrder, addAgentLog, auditUserName, showConfirm, showNotif, openWA, openLaporanModal, sendWA, updateOrderStatus, hitungJamSelesai, downloadRekapHarian, triggerRekapHarian, supabase, TODAY, SCHED_PAGE_SIZE, getLocalDate, userAccounts }) {
// Hitung minggu dinamis berdasarkan weekOffset
const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const baseDate = new Date();
// Cari Minggu (hari pertama minggu ini)
const dayOfWeek = baseDate.getDay();
const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
const weekStart = new Date(baseDate);
weekStart.setDate(baseDate.getDate() + mondayOffset + (weekOffset * 7));
const weekDays = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(weekStart);
  d.setDate(weekStart.getDate() + i);
  const iso = d.toISOString().slice(0, 10);
  return { date: iso, label: `${dayNames[d.getDay()]} ${d.getDate()}` };
});
const weekLabel = `${weekDays[0].date.slice(5).replace("-", "/")} – ${weekDays[6].date.slice(5).replace("-", "/")}`;
const techColors = Object.fromEntries([...new Set(ordersData.map(o => o.teknisi).filter(Boolean))].map(n => [n, getTechColor(n, teknisiData)]))

// For Teknisi role: force filter to own name; for Owner/Admin: use filterTeknisi state
const isTekRole = currentUser?.role === "Teknisi" || currentUser?.role === "Helper";
const myTekName = currentUser?.name || "";
const activeTek = isTekRole ? myTekName : filterTeknisi;

const allTekNames = [...new Set(ordersData.map(o => o.teknisi).filter(Boolean))];
// Helper: lihat jadwal via field o.helper, bukan o.teknisi
const isHelperRole = currentUser?.role === "Helper";
const _sqSched = searchSchedule.trim().toLowerCase();
const _baseOrders = activeTek === "Semua"
  ? ordersData
  : ordersData.filter(o => isHelperRole
    ? (o.helper === activeTek || o.teknisi === activeTek)
    : o.teknisi === activeTek);
// BUG-4: tambah search text filter di jadwal
const filteredOrders = !_sqSched ? _baseOrders : _baseOrders.filter(o =>
  (o.customer || "").toLowerCase().includes(_sqSched) ||
  (o.id || "").toLowerCase().includes(_sqSched) ||
  (o.teknisi || "").toLowerCase().includes(_sqSched) ||
  (o.helper || "").toLowerCase().includes(_sqSched) ||
  (o.address || "").toLowerCase().includes(_sqSched) ||
  (o.service || "").toLowerCase().includes(_sqSched) ||
  (o.phone || "").includes(searchSchedule.trim())
);
// Opsi A: hanya teknisi aktif (dari teknisiData) UNION teknisi yang punya job di minggu ini
// → tidak ada baris kosong untuk teknisi lama yang sudah nonaktif
const weekDateSet = new Set(weekDays.map(d => d.date));
const teksWithJobThisWeek = new Set(ordersData.filter(o => weekDateSet.has(o.date) && o.teknisi).map(o => o.teknisi));
const activeTeknisiNames = new Set(teknisiData.filter(t => t.active !== false && (t.role === "Teknisi" || t.role === "Helper")).map(t => t.name));
const smartTekNames = [...new Set([...activeTeknisiNames, ...teksWithJobThisWeek])].sort();
const teknisiList = activeTek === "Semua" ? smartTekNames : [activeTek];
// Untuk teknisi/helper: filter hanya hari ini
const todayOrdersTek = isTekRole ? filteredOrders.filter(o => o.date === TODAY) : filteredOrders;

return (
  <div style={{ display: "grid", gap: 14 }}>
    {/* Header — kondisional per role */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>
          {isTekRole ? "📋 Jadwal Hari Ini" : "📅 Jadwal Pengerjaan"}
        </div>
        {isTekRole && (
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>
            {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {/* Week navigation — hanya untuk Owner/Admin */}
        {!isTekRole && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: cs.card, border: "1px solid " + cs.border, borderRadius: 9, padding: "4px 10px" }}>
            <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>‹</button>
            <span style={{ fontSize: 11, color: cs.muted, fontWeight: 600, minWidth: 80, textAlign: "center" }}>{weekLabel}</span>
            <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>›</button>
            {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>Hari ini</button>}
          </div>
        )}
        {/* View toggle — hanya untuk Owner/Admin */}
        {!isTekRole && (
          <div style={{ display: "flex", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, overflow: "hidden" }}>
            {[["week", "📅 Kalender"], ["list", "📋 List Pekerjaan"]].map(([v, lbl]) => (
              <button key={v} onClick={() => setScheduleView(v)} style={{ padding: "7px 14px", border: "none", background: scheduleView === v ? cs.accent : "transparent", color: scheduleView === v ? "#0a0f1e" : cs.muted, cursor: "pointer", fontSize: 12, fontWeight: scheduleView === v ? 700 : 500 }}>{lbl}</button>
            ))}
          </div>
        )}
        {/* ── Rekap Jadwal: Download + Kirim WA ── */}
        {!isTekRole && (
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "4px 7px"
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: cs.muted, whiteSpace: "nowrap" }}>📥 Rekap</span>
            <input type="date" id="rekapSched"
              defaultValue={TODAY}
              style={{
                background: cs.card, border: "1px solid " + cs.border, borderRadius: 6,
                padding: "3px 7px", fontSize: 11, color: cs.text, colorScheme: "dark", cursor: "pointer"
              }}
            />
            <button onClick={() => { const d = document.getElementById("rekapSched")?.value || TODAY; downloadRekapHarian(d); }}
              title="Download rekap ke file"
              style={{
                background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green,
                padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 11
              }}>⬇️</button>
            <button onClick={() => { const d = document.getElementById("rekapSched")?.value || TODAY; triggerRekapHarian(d); }}
              title="Kirim rekap via WhatsApp"
              style={{
                background: "#25D36622", border: "1px solid #25D36644", color: "#25D366",
                padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 11
              }}>📲</button>
          </div>
        )}
        {!isTekRole && (
          <button onClick={() => setModalOrder(true)} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "9px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>+ Order</button>

        )}
      </div>
    </div>

    {/* Teknisi filter pills — Owner/Admin only */}
    {!isTekRole && (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: cs.muted, fontWeight: 600, marginRight: 4 }}>Filter:</span>
        {["Semua", ...allTekNames].map(name => {
          const col = name === "Semua" ? cs.accent : (techColors[name] || cs.muted);
          const isActive = activeTek === name;
          return (
            <button key={name} onClick={() => setFilterTeknisi(name)}
              style={{ padding: "5px 12px", borderRadius: 99, border: "1px solid " + (isActive ? col : cs.border), background: isActive ? col + "22" : "transparent", color: isActive ? col : cs.muted, cursor: "pointer", fontSize: 11, fontWeight: isActive ? 700 : 400 }}>
              {name === "Semua" ? "👥 Semua" : (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, display: "inline-block" }}></span>
                  {(name || "").split(" ")[0]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    )}

    {/* Laporan status filter — Owner/Admin, week view only */}
    {!isTekRole && scheduleView === "week" && (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: cs.muted, fontWeight: 600, marginRight: 4 }}>Laporan:</span>
        {[["semua", "Semua"], ["sudah", "✅ Sudah"], ["belum", "⏳ Belum"]].map(([v, lbl]) => (
          <button key={v} onClick={() => setCalLaporanFilter(v)}
            style={{
              padding: "4px 10px", borderRadius: 99,
              border: "1px solid " + (calLaporanFilter === v ? (v === "sudah" ? cs.green : v === "belum" ? cs.yellow : cs.accent) : cs.border),
              background: calLaporanFilter === v ? (v === "sudah" ? cs.green + "22" : v === "belum" ? cs.yellow + "22" : cs.accent + "22") : "transparent",
              color: calLaporanFilter === v ? (v === "sudah" ? cs.green : v === "belum" ? cs.yellow : cs.accent) : cs.muted,
              cursor: "pointer", fontSize: 11, fontWeight: calLaporanFilter === v ? 700 : 400
            }}>{lbl}</button>
        ))}
      </div>
    )}

    {/* Search bar di Jadwal — Owner & Admin */}
    {!isTekRole && (
      <div style={{ position: "relative", marginTop: 4 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: cs.muted, fontSize: 13, pointerEvents: "none" }}>🔍</span>
        <input id="searchSchedule"
          value={searchSchedule}
          onChange={e => setSearchSchedule(e.target.value)}
          placeholder="Cari customer, teknisi, alamat, Job ID..."
          style={{ width: "100%", background: cs.card, border: "1px solid " + (searchSchedule ? cs.accent : cs.border), borderRadius: 10, padding: "9px 36px", color: cs.text, fontSize: 12, boxSizing: "border-box", outline: "none" }}
        />
        {searchSchedule && (
          <button onClick={() => setSearchSchedule("")}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 15 }}>✕</button>
        )}
      </div>
    )}

    {/* Stats bar for filtered teknisi */}
    {activeTek !== "Semua" && (
      <div style={{ background: cs.card, border: "1px solid " + (techColors[activeTek] || cs.accent) + "44", borderRadius: 12, padding: "12px 16px", display: "flex", gap: 20, alignItems: "center" }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg," + (techColors[activeTek] || cs.accent) + "," + (techColors[activeTek] || cs.accent) + "66)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#fff" }}>
          {activeTek.charAt(0)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>{activeTek}</div>
          <div style={{ fontSize: 11, color: cs.muted }}>
            {filteredOrders.filter(o => o.date === TODAY).length} job hari ini ·{" "}
            {filteredOrders.filter(o => o.date > TODAY).length} mendatang ·{" "}
            {filteredOrders.filter(o => o.status === "COMPLETED").length} selesai
          </div>
        </div>
        {!isTekRole && (() => {
          const undisp = filteredOrders.filter(o => !o.dispatch);
          return undisp.length > 0 ? (
            <button onClick={() => { undisp.forEach(o => dispatchWA(o)); }}
              style={{ background: "#25D36618", border: "1px solid #25D36633", color: "#25D366", padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11 }}>📱 WA Teknisi ({undisp.length})</button>
          ) : (
            <span style={{ fontSize: 10, color: cs.green, background: cs.green + "15", padding: "5px 10px", borderRadius: 8, border: "1px solid " + cs.green + "33" }}>✅ Ter-dispatch</span>
          );
        })()}
      </div>
    )}

    {/* ════════════════════════════════════════════════
        TAMPILAN JADWAL HARI INI — khusus Teknisi & Helper
        Tidak ada tab Minggu, hanya list pekerjaan hari ini
        ════════════════════════════════════════════════ */}
    {isTekRole && (() => {
      const myJobs = todayOrdersTek.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      if (myJobs.length === 0) return (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
          <div style={{ fontWeight: 700, color: cs.text, fontSize: 15 }}>Tidak ada jadwal hari ini</div>
          <div style={{ color: cs.muted, fontSize: 12, marginTop: 6 }}>Hubungi Admin jika ada penugasan baru</div>
        </div>
      );
      return (
        <div style={{ display: "grid", gap: 10 }}>
          {/* Summary bar */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "Total Job", value: myJobs.length, color: cs.accent },
              { label: "Pending", value: myJobs.filter(o => o.status === "PENDING" || o.status === "CONFIRMED").length, color: cs.yellow },
              { label: "On Site", value: myJobs.filter(o => o.status === "ON_SITE" || o.status === "IN_PROGRESS").length, color: cs.green },
              { label: "Selesai", value: myJobs.filter(o => o.status === "COMPLETED").length, color: cs.muted },
            ].map(k => (
              <div key={k.label} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 16px", flex: 1, minWidth: 70 }}>
                <div style={{ fontWeight: 800, fontSize: 20, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* List Pekerjaan Hari Ini */}
          <div style={{ fontWeight: 700, color: cs.text, fontSize: 14, marginTop: 4 }}>
            📋 List Pekerjaan — {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long" })}
          </div>
          {myJobs.map((o, idx) => {
            const myColor = techColors[o.teknisi] || cs.accent;
            const sCol = statusColor[o.status] || cs.border;
            const isMe = o.teknisi === myTekName;
            return (
              <div key={o.id} style={{ background: cs.card, border: "1px solid " + sCol + "55", borderRadius: 12, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                {/* Urutan + jam */}
                <div style={{ background: myColor + "22", border: "1px solid " + myColor + "44", borderRadius: 10, padding: "8px 10px", textAlign: "center", minWidth: 46, flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: myColor }}>{String(idx + 1).padStart(2, "0")}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: myColor }}>{o.time || "--:--"}</div>
                </div>

                {/* Info job */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent, fontSize: 12 }}>{o.id}</span>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: sCol + "22", color: sCol, fontWeight: 700 }}>{o.status}</span>
                    {!isMe && <span style={{ fontSize: 10, background: cs.yellow + "22", color: cs.yellow, padding: "2px 8px", borderRadius: 99 }}>🤝 Helper</span>}
                  </div>
                  <div style={{ fontWeight: 700, color: cs.text, fontSize: 14, marginBottom: 4 }}>{o.customer}</div>
                  <div style={{ fontSize: 12, color: cs.muted, display: "grid", gap: "3px 0" }}>
                    <span>🔧 {o.service} · {o.units} unit{o.type ? " (" + o.type + ")" : ""}</span>
                    <span>📍 {o.address}</span>
                    {o.helper && <span>🤝 Helper: {o.helper}</span>}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => window.open("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.address), "_blank")}
                    style={{ background: "#3b82f622", border: "1px solid #3b82f644", color: "#3b82f6", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                    🗺️ Maps
                  </button>
                  <button onClick={() => {
                    const cu = customersData.find(c => c.name === o.customer);
                    setHistoryPreview(cu || { name: o.customer, phone: o.phone, address: o.address });
                  }}
                    style={{
                      background: cs.accent + "18", border: "1px solid " + cs.accent + "44",
                      color: cs.accent, borderRadius: 8, padding: "6px 12px",
                      cursor: "pointer", fontWeight: 600, fontSize: 12
                    }}>
                    📋 History
                  </button>
                  <button onClick={() => { setWaTekTarget({ phone: o.phone, customer: o.customer, service: o.service, time: o.time, address: o.address }); setModalWaTek(true); }}
                    style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                    📱 WA
                  </button>
                  {o.dispatch && !["COMPLETED", "CANCELLED", "PAID"].includes(o.status) && (
                    <>
                      {o.status !== "ON_SITE" && (
                        <button onClick={async () => {
                          await updateOrderStatus(supabase, o.id, "ON_SITE", auditUserName());
                          setOrdersData(prev => prev.map(ord => ord.id === o.id ? { ...ord, status: "ON_SITE" } : ord));
                          showNotif("✅ Status → On Site!");
                          const admins = teknisiData.filter(u => u.role === "Admin" || u.role === "Owner")
                            .concat((userAccounts || []).filter(u => u.role === "Admin" || u.role === "Owner"));
                          const msg =
                            "Teknisi di Lokasi\n"
                            + "Job: " + o.id + " - " + o.customer + "\n"
                            + "Teknisi: " + myTekName;
                          admins.forEach(adm => { if (adm?.phone) sendWA(adm.phone, msg); });
                        }} style={{ background: "#22c55e22", border: "1px solid #22c55e44", color: "#22c55e", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                          ✅ On Site
                        </button>
                      )}
                      <button onClick={() => openLaporanModal(o)}
                        style={{ background: cs.ara + "22", border: "1px solid " + cs.ara + "44", color: cs.ara, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                        📝 Laporan
                      </button>
                    </>
                  )}
                  {!o.dispatch && (
                    <span style={{ fontSize: 10, color: cs.muted, textAlign: "center", padding: "4px 8px" }}>Menunggu dispatch</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    })()}

    {/* WEEK CALENDAR & LIST VIEW — hanya untuk Owner / Admin */}
    {!isTekRole && (
      <>
        {/* WEEK CALENDAR VIEW */}
        {scheduleView === "week" ? (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 600 }}>
              <div style={{ display: "grid", gridTemplateColumns: "70px repeat(7,1fr)", gap: 2, marginBottom: 2 }}>
                <div />
                {weekDays.map(d => (
                  <div key={d.date} style={{ background: d.date === TODAY ? cs.accent + "22" : cs.surface, border: "1px solid " + (d.date === TODAY ? cs.accent : cs.border), borderRadius: 7, padding: "7px 4px", textAlign: "center", fontSize: 11, fontWeight: 700, color: d.date === TODAY ? cs.accent : cs.muted }}>{d.label}</div>
                ))}
              </div>
              {teknisiList.map(tek => (
                <div key={tek} style={{ display: "grid", gridTemplateColumns: "70px repeat(7,1fr)", gap: 2, marginBottom: 2 }}>
                  <div style={{ background: cs.card, border: "1px solid " + (techColors[tek] || cs.border), borderRadius: 7, padding: "6px 4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: techColors[tek] || cs.muted, textAlign: "center", lineHeight: 1.3 }}>{(tek || "").split(" ")[0]}</span>
                  </div>
                  {weekDays.map(d => {
                    // SIM-6: tampilkan job dimana tek adalah teknisi ATAU helper
                    const jobs = ordersData
                      .filter(o => (o.teknisi === tek || o.helper === tek) && o.date === d.date)
                      .filter(o => {
                        if (calLaporanFilter === "semua") return true;
                        const hasL = laporanReports.some(r => r.job_id === o.id);
                        return calLaporanFilter === "sudah" ? hasL : !hasL;
                      });
                    return (
                      <div key={d.date} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: 4, minHeight: 60 }}>
                        {jobs.map(j => {
                          const hasLaporan = laporanReports.some(r => r.job_id === j.id);
                          const lapStatus = laporanReports.find(r => r.job_id === j.id)?.status;
                          const lapVerified = lapStatus === "VERIFIED";
                          const isHelper = j.teknisi !== tek && j.helper === tek;
                          const col = techColors[tek] || cs.accent;
                          const borderHL = hasLaporan ? (lapVerified ? cs.green : "#facc15") : col;
                          return (
                            <div key={j.id} style={{ background: col + (isHelper ? "10" : "22"), border: "1px solid " + borderHL + (isHelper ? "44" : "66"), borderLeft: "3px solid " + borderHL, borderRadius: 5, padding: "3px 5px 3px 4px", marginBottom: 2, opacity: isHelper ? 0.85 : 1, position: "relative" }}>
                              {hasLaporan && (
                                <span style={{
                                  position: "absolute", top: 1, right: 2, fontSize: 7, fontWeight: 800,
                                  color: lapVerified ? cs.green : "#facc15",
                                  background: (lapVerified ? cs.green : "#facc15") + "22",
                                  borderRadius: 3, padding: "0 2px"
                                }}>
                                  {lapVerified ? "✓VRF" : "✓LAP"}
                                </span>
                              )}
                              <div style={{ fontSize: 9, fontWeight: 800, color: col }}>{j.time} {isHelper ? "🤝" : ""}</div>
                              <div style={{ fontSize: 9, color: cs.text }}>{(j.customer || "").slice(0, 13)}{(j.customer || "").length > 13 ? "…" : ""}</div>
                              <div style={{ fontSize: 8, color: cs.muted }}>{j.service}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}                </div>
              ))}
            </div>
          </div>
        ) : (
          /* LIST VIEW */
          <div style={{ display: "grid", gap: 10 }}>
            {/* Filter bar — Hari Ini / Minggu Ini / Semua */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: cs.muted, fontWeight: 600 }}>Tampilkan:</span>
              {[["hari_ini", "🔴 Hari Ini"], ["minggu_ini", "📅 Minggu Ini"], ["semua", "📋 Semua"]].map(([v, lbl]) => (
                <button key={v} onClick={() => { setSchedListFilter(v); setSchedPage(1); }}
                  style={{
                    padding: "5px 12px", borderRadius: 99, border: "1px solid " + (schedListFilter === v ? cs.accent : cs.border),
                    background: schedListFilter === v ? cs.accent + "22" : "transparent", color: schedListFilter === v ? cs.accent : cs.muted,
                    cursor: "pointer", fontSize: 11, fontWeight: schedListFilter === v ? 700 : 400
                  }}>{lbl}</button>
              ))}
              {_sqSched && <span style={{ fontSize: 10, color: cs.yellow, background: cs.yellow + "15", padding: "3px 10px", borderRadius: 99, border: "1px solid " + cs.yellow + "33" }}>🔍 Hasil pencarian — menampilkan semua periode</span>}
            </div>
            {(() => {
              const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
              // Saat ada pencarian aktif, tampilkan semua (tidak tersembunyi)
              const preFiltered = _sqSched ? filteredOrders : filteredOrders.filter(o => {
                if (schedListFilter === "hari_ini") return (o.date || "") === TODAY;
                if (schedListFilter === "minggu_ini") return (o.date || "") >= (weekDays[0]?.date || TODAY) && (o.date || "") <= (weekDays[6]?.date || TODAY);
                // "semua" — sembunyikan >30 hari lalu
                return (o.date || "") >= cutoff30;
              });
              if (preFiltered.length === 0) {
                return <div style={{ background: cs.card, borderRadius: 12, padding: 32, textAlign: "center", color: cs.muted }}>
                  {schedListFilter === "hari_ini" ? "Tidak ada jadwal hari ini" : schedListFilter === "minggu_ini" ? "Tidak ada jadwal minggu ini" : "Tidak ada jadwal dalam 30 hari terakhir"}
                  {!_sqSched && schedListFilter !== "semua" && <div style={{ fontSize: 11, color: cs.muted, marginTop: 6 }}>Klik <b style={{ color: cs.accent }}>Semua</b> atau gunakan pencarian untuk melihat jadwal lama</div>}
                </div>;
              }
              if (filteredOrders.length === 0) {
                return <div style={{ background: cs.card, borderRadius: 12, padding: 32, textAlign: "center", color: cs.muted }}>Tidak ada jadwal untuk {activeTek}</div>;
              }
              const dayNames2 = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
              const sorted2 = [...preFiltered].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
              const totPgSched = Math.ceil(sorted2.length / SCHED_PAGE_SIZE) || 1;
              const curPgSched = Math.min(schedPage, totPgSched);
              const pagedSched = sorted2.slice((curPgSched - 1) * SCHED_PAGE_SIZE, curPgSched * SCHED_PAGE_SIZE);
              const groups = pagedSched.reduce((acc, o) => { if (!acc[o.date]) acc[o.date] = []; acc[o.date].push(o); return acc; }, {});
              const groupsJSX = Object.entries(groups).map(([date2, dayOrders]) => {
                const d2 = new Date(date2 + "T00:00:00");
                const todayStr2 = getLocalDate();
                const tomorrowStr2 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
                const isToday2 = (date2 === todayStr2);
                const isTomorrow2 = (date2 === tomorrowStr2);
                const dayLabel2 = isToday2 ? "🔴 Hari Ini" : isTomorrow2 ? "🟡 Besok" : dayNames2[d2.getDay()];
                const dateStr2 = d2.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
                const sepColor = isToday2 ? cs.red : isTomorrow2 ? cs.yellow : cs.border;
                return (
                  <div key={date2} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, marginTop: 8 }}>
                      <div style={{ background: sepColor + "22", border: "1px solid " + sepColor + "55", borderRadius: 99, padding: "5px 16px", fontSize: 12, fontWeight: 800, color: sepColor }}>{dayLabel2}&nbsp;·&nbsp;{dateStr2}</div>
                      <div style={{ flex: 1, height: 1, background: cs.border + "55" }} />
                      <span style={{ fontSize: 11, color: cs.muted, padding: "2px 8px", borderRadius: 99, border: "1px solid " + cs.border }}>{dayOrders.length} job</span>
                    </div>
                    {dayOrders.map(o => (
                      <div key={o.id} style={{ background: cs.card, border: "1px solid " + (statusColor[o.status] || cs.border) + "44", borderRadius: 12, padding: 14, display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
                        <div style={{ background: (techColors[o.teknisi] || cs.accent) + "22", border: "1px solid " + (techColors[o.teknisi] || cs.accent) + "44", borderRadius: 8, padding: "6px 10px", textAlign: "center", minWidth: 54, flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: techColors[o.teknisi] || cs.accent }}>{o.time}</div>
                          <div style={{ fontSize: 9, color: cs.muted }}>–{o.time_end || hitungJamSelesai(o.time, o.service, o.units)}</div>
                          <div style={{ fontSize: 9, color: cs.muted }}>{(o.date || "").slice(5)}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent, fontSize: 12 }}>{o.id}</span>
                            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: (statusColor[o.status] || cs.muted) + "22", color: statusColor[o.status] || cs.muted, border: "1px solid " + (statusColor[o.status] || cs.muted) + "44", fontWeight: 700 }}>{statusLabel[o.status] || o.status}</span>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: cs.text, marginBottom: 4 }}>{o.customer}</div>
                          <div style={{ fontSize: 12, color: cs.muted, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 14px" }}>
                            <span>🔧 {o.service} · {o.units} unit</span>
                            <span style={{ color: techColors[o.teknisi] || cs.muted }}>👷 {o.teknisi}{o.helper ? " + " + o.helper : ""}</span>
                            <span>📍 {(o.address || "-").slice(0, 32)}...</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                          {!isTekRole && (
                            <button onClick={() => { const cu = customersData.find(c => c.phone === o.phone); if (cu) { setSelectedCustomer(cu); setCustomerTab("history"); setActiveMenu("customers"); } }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>📋 History</button>
                          )}
                          {(!o.dispatch && !isTekRole) && (
                            <button onClick={() => dispatchStatus(o)} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                              ✅ Set Dispatch
                            </button>
                          )}
                          {(!isTekRole) && (
                            <button onClick={() => sendDispatchWA(o)} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>📱 Dispatch</button>
                          )}
                          {!isTekRole && (
                            <button onClick={() => { setEditOrderItem(o); setEditOrderForm({ customer: o.customer, phone: o.phone || "", address: o.address || "", area: o.area || "", service: o.service, type: o.type || "", units: o.units || 1, teknisi: o.teknisi, helper: o.helper || "", teknisi2: o.teknisi2 || "", helper2: o.helper2 || "", teknisi3: o.teknisi3 || "", helper3: o.helper3 || "", date: o.date, time: o.time || "09:00", status: o.status, notes: o.notes || "" }); setModalEditOrder(true); }} style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>✏️ Edit</button>
                          )}
                          {currentUser?.role === "Owner" && !(["COMPLETED", "PAID"].includes(o.status)) && (
                            <button onClick={async () => {
                              if (!await showConfirm({
                                icon: "🗑️", title: "Hapus Order?", danger: true,
                                message: `Hapus order ${o.id} — ${o.customer}?\nOrder COMPLETED/PAID tidak bisa dihapus.`,
                                confirmText: "Hapus"
                              })) return;
                              const { error: delOrdErr } = await deleteOrder(supabase, o.id, auditUserName());
                              if (delOrdErr) { showNotif("❌ Gagal hapus order: " + delOrdErr.message); return; }
                              // Hapus schedule terkait
                              try { await supabase.from("technician_schedule").delete().eq("order_id", o.id); } catch (_) { }
                              setOrdersData(prev => prev.filter(ord => ord.id !== o.id));
                              addAgentLog("ORDER_DELETED", `Owner hapus order ${o.id} — ${o.customer} (${o.service})`, "WARNING");
                              showNotif("🗑️ Order " + o.id + " berhasil dihapus");
                            }} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }} title="Hapus order (Owner only)">🗑️</button>
                          )}
                          {isTekRole && (
                            <button onClick={() => { window.open("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.address), "_blank"); }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>🗺 Maps</button>
                          )}
                          {isTekRole && (
                            <button onClick={() => {
                              const cu = customersData.find(c => c.name === o.customer);
                              setHistoryPreview(cu || { name: o.customer, phone: o.phone, address: o.address });
                            }}
                              style={{
                                background: cs.accent + "18", border: "1px solid " + cs.accent + "44",
                                color: cs.accent, borderRadius: 8, padding: "7px 10px",
                                cursor: "pointer", fontWeight: 600, fontSize: 12
                              }}>
                              📋 History
                            </button>
                          )}
                          {isTekRole && (
                            <button onClick={() => { if (o.phone) openWA(o.phone, "Halo " + (o.customer || "Bapak/Ibu") + ", saya " + myTekName + " dari AClean. Saya akan tiba pkl " + (o.time || "-") + " untuk " + (o.service || "servis AC") + ". Terima kasih!"); else showNotif("❌ Nomor HP customer tidak tersedia"); }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>💬 Chat WA</button>
                          )}
                          {isTekRole && o.dispatch && !["COMPLETED", "CANCELLED", "PAID"].includes(o.status) && (<>
                            {/* ── Konfirmasi Tiba: 1 tombol, update status ON_SITE, tanpa WA Admin ── */}
                            {o.status !== "ON_SITE" && (
                              <button onClick={async () => {
                                await updateOrderStatus(supabase, o.id, "ON_SITE", auditUserName(), { on_site_at: new Date().toISOString() });
                                setOrdersData(prev => prev.map(ord => ord.id === o.id ? { ...ord, status: "ON_SITE" } : ord));
                                showNotif("✅ Status → Sudah di Lokasi!");
                                addAgentLog("ON_SITE", `${currentUser?.name} tiba di lokasi — ${o.id}`, "SUCCESS");
                                // Notif Owner via WA saat teknisi konfirmasi tiba
                                const ownerContacts = [...(teknisiData || []), ...(userAccounts || [])]
                                  .filter(u => u.role === "Owner" && u.phone);
                                const konfMsg = `✅ *Teknisi di Lokasi*\n📋 ${o.id}\n👤 ${o.customer}\n📍 ${o.address || "-"}\n👷 ${currentUser?.name}\n⏰ ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
                                ownerContacts.forEach(ow => sendWA(ow.phone, konfMsg));
                              }} style={{ background: "#22c55e22", border: "1px solid #22c55e44", color: "#22c55e", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                                ✅ Konfirmasi Tiba
                              </button>
                            )}
                            {/* ── WA Customer: manual, teknisi isi estimasi jam tiba ── */}
                            {o.phone && (() => {
                              const jamSkrg = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
                              const [h, m] = jamSkrg.split(":").map(Number);
                              const etaDate = new Date(); etaDate.setMinutes(etaDate.getMinutes() + 30);
                              const jamEta = etaDate.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
                              return (
                                <button onClick={() => {
                                  const eta = window.prompt(
                                    `Estimasi tiba di lokasi ${o.customer}?\nContoh: 13:30`,
                                    jamEta
                                  );
                                  if (!eta) return;
                                  const msg = `Halo ${o.customer} 👋\n\nKami dari *AClean Service* akan segera tiba di lokasi Anda.\n\n📋 Job: ${o.id}\n🔧 Service: ${o.service} — ${o.units} unit\n⏰ Estimasi tiba: *${eta} WIB*\n\nMohon pastikan ada di lokasi ya! 🙏\n\n_${currentUser?.name} — AClean_`;
                                  if (o.phone) sendWA(o.phone, msg);
                                  else showNotif("⚠️ No. HP customer tidak tersedia");
                                }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                                  📱 WA Customer
                                </button>
                              );
                            })()}
                          </>)}
                          <button onClick={() => openLaporanModal(o)} style={{ background: cs.ara + "22", border: "1px solid " + cs.ara + "44", color: cs.ara, padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>📝 Laporan</button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              });
              return (
                <>
                  {groupsJSX}
                  {totPgSched > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
                      <button onClick={() => setSchedPage(p => Math.max(1, p - 1))} disabled={curPgSched === 1}
                        style={{
                          padding: "5px 12px", borderRadius: 8, border: "1px solid " + cs.border,
                          background: curPgSched === 1 ? cs.surface : cs.card, color: curPgSched === 1 ? cs.muted : cs.text, cursor: curPgSched === 1 ? "default" : "pointer"
                        }}>‹</button>
                      {Array.from({ length: Math.min(totPgSched, 7) }, (_, i) => {
                        let pg = i + 1;
                        if (totPgSched > 7) { if (curPgSched <= 4) pg = i + 1; else if (curPgSched >= totPgSched - 3) pg = totPgSched - 6 + i; else pg = curPgSched - 3 + i; }
                        return (<button key={pg} onClick={() => setSchedPage(pg)}
                          style={{
                            padding: "5px 10px", borderRadius: 8, border: "1px solid " + (curPgSched === pg ? cs.accent : cs.border),
                            background: curPgSched === pg ? cs.accent : cs.card, color: curPgSched === pg ? "#0a0f1e" : cs.text, cursor: "pointer", fontWeight: curPgSched === pg ? 700 : 400
                          }}>{pg}</button>);
                      })}
                      <button onClick={() => setSchedPage(p => Math.min(totPgSched, p + 1))} disabled={curPgSched === totPgSched}
                        style={{
                          padding: "5px 12px", borderRadius: 8, border: "1px solid " + cs.border,
                          background: curPgSched === totPgSched ? cs.surface : cs.card, color: curPgSched === totPgSched ? cs.muted : cs.text, cursor: curPgSched === totPgSched ? "default" : "pointer"
                        }}>›</button>
                      <span style={{ fontSize: 11, color: cs.muted }}>hal {curPgSched}/{totPgSched} · {sorted2.length} jadwal</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </>
    )}
  </div>
);
}

export default memo(ScheduleView);
