import { memo } from "react";
import { cs } from "../theme/cs.js";
import { statusColor, statusLabel } from "../constants/status.js";
import { displayStock } from "../lib/inventory.js";

function DashboardView({ currentUser, ordersData, invoicesData, inventoryData, teknisiData, omsetView, setOmsetView, isMobile, waConversations, bulanIni, setActiveMenu, setInvoiceFilter, setModalOrder, setWaPanel, setWaTekTarget, setModalWaTek, fmt, getTechColor, triggerRekapHarian, openLaporanModal, showNotif, TODAY, sendWA, dispatchWA, addAgentLog, setSelectedInvoice, setModalPDF, customersData, laporanReports, findCustomer, setSelectedCustomer, setCustomerTab, expensesData }) {
const role = currentUser?.role || "Admin";
const hariIni = new Date(TODAY + "T00:00:00+07:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// ── TEKNISI & HELPER DASHBOARD ─────────────────────────────
if (role === "Teknisi" || role === "Helper") {
  const myName = currentUser?.name || "";
  const techColors = Object.fromEntries([...new Set(ordersData.map(o => o.teknisi).filter(Boolean))].map(n => [n, getTechColor(n, teknisiData)]))
  const myColor = techColors[myName] || cs.accent;
  const myJobs = ordersData.filter(o => o.teknisi === myName);
  const todayJobs = myJobs.filter(o => o.date === TODAY);
  const doneCount = myJobs.filter(o => o.status === "COMPLETED").length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Greeting */}
      <div style={{ background: "linear-gradient(135deg," + myColor + "18," + cs.card + ")", border: "1px solid " + myColor + "33", borderRadius: 16, padding: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg," + myColor + "," + myColor + "88)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 22, color: "#fff" }}>{currentUser?.avatar}</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: cs.text }}>Halo, {myName} 👋</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{hariIni} · Teknisi AClean</div>
        </div>
      </div>

      {/* My stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: isMobile ? 10 : 12 }}>
        {[
          { icon: "📋", label: "Job Hari Ini", value: todayJobs.length, color: cs.accent },
          { icon: "✅", label: "Total Selesai", value: doneCount, color: cs.green },
        ].map(k => (
          <div key={k.label} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{k.icon}</div>
            <div style={{ fontWeight: 800, fontSize: 24, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 3 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Today jobs */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 18 }}>
        <div style={{ fontWeight: 700, color: cs.text, fontSize: 14, marginBottom: 12 }}>📅 Jadwal Hari Ini</div>
        {todayJobs.length === 0
          ? <div style={{ color: cs.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Tidak ada jadwal hari ini</div>
          : todayJobs.map(o => (
            <div key={o.id} style={{ background: cs.surface, border: "1px solid " + myColor + "33", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 800, color: myColor, fontSize: 16 }}>{o.time}</span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: (statusColor[o.status] || cs.muted) + "22", color: statusColor[o.status] || cs.muted, border: "1px solid " + (statusColor[o.status] || cs.muted) + "33", fontWeight: 700 }}>{statusLabel[o.status] || o.status.replace("_", " ")}</span>
              </div>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 13, marginBottom: 3 }}>{o.customer}</div>
              <div style={{ fontSize: 12, color: cs.muted, marginBottom: 4 }}>🔧 {o.service} · {o.units} unit</div>
              <div style={{ fontSize: 11, color: cs.muted }}>📍 {o.address}</div>
              {o.helper && <div style={{ fontSize: 11, color: cs.accent, marginTop: 3 }}>🤝 Helper: {o.helper}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button onClick={() => { setWaTekTarget({ phone: o.phone, customer: o.customer, service: o.service, time: o.time, address: o.address }); setModalWaTek(true); }}
                  style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>💬 Chat WA</button>
                <button onClick={() => { const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.address); window.open(url, "_blank"); }}
                  style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗺 Maps</button>
                <button onClick={() => openLaporanModal(o)}
                  style={{ background: cs.ara + "22", border: "1px solid " + cs.ara + "44", color: cs.ara, padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📝 Laporan</button>
              </div>
            </div>
          ))
        }
      </div>

    </div>
  );
}

// ── OWNER / ADMIN DASHBOARD ────────────────────────────────
const todayOrders = ordersData.filter(o => o.date === TODAY);
const unpaidCount = invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length;
const totalRevBulanIni = invoicesData.filter(i => i.status === "PAID" && String(i.paid_at || "").startsWith(bulanIni)).reduce((a, b) => a + b.total, 0);
const lowStock = inventoryData.filter(i => i.status === "CRITICAL" || i.status === "OUT").length;
const garansiKritisD = invoicesData.filter(inv => {
  if (!inv.garansi_expires) return false;
  const d = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
  return d >= 0 && d <= 7;
});
const garansiExpireSoon = invoicesData.filter(inv => {
  if (!inv.garansi_expires) return false;
  const d = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
  return d >= 0 && d <= 30;
}).sort((a, b) => a.garansi_expires.localeCompare(b.garansi_expires));
// GAP-4: Invoice pending >3 hari
const pendingOldInv = invoicesData.filter(inv => {
  if (inv.status !== "PENDING_APPROVAL") return false;
  const daysPending = Math.ceil((new Date() - new Date(inv.created_at || inv.sent || "")) / 86400000);
  return daysPending > 3;
});
// GAP-6: Approved belum bayar
const approvedUnpaid = invoicesData.filter(inv => inv.status === "APPROVED");
const greeting = role === "Owner" ? "Owner" : "Admin";
// techColors dipakai di omset stats block (IIFE) dan kalender
const techColors = Object.fromEntries(
  [...new Set(ordersData.map(o => o.teknisi).filter(Boolean))].map((n, i) => [
    n, ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"][i % 8]
  ])
);

return (
  <div style={{ display: "grid", gap: 20 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 22, color: cs.text }}>Selamat pagi, {greeting} 👋</div>
        <div style={{ fontSize: 13, color: cs.muted }}>{hariIni} · ARA aktif memantau</div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {/* Rekap Hari Ini — tombol ringkas di dashboard */}
        {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
          <button onClick={() => triggerRekapHarian(TODAY)}
            style={{
              background: cs.surface, border: "1px solid " + cs.border, color: cs.muted,
              padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", gap: 6
            }}>
            📊 Rekap Hari Ini
          </button>
        )}
        <button onClick={() => setModalOrder(true)} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+ Order Baru</button>
        <button onClick={() => setWaPanel(true)} style={{ position: "relative", background: cs.card, border: "1px solid #25D36644", color: "#25D366", padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
          📱 WhatsApp
          {waConversations.filter(wc => wc.unread > 0).length > 0 && (
            <span style={{ position: "absolute", top: -6, right: -6, background: cs.red, color: "#fff", fontSize: 9, fontWeight: 800, borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {waConversations.filter(wc => wc.unread > 0).reduce((a, b) => a + b.unread, 0)}
            </span>
          )}
        </button>
      </div>
    </div>

    {/* ── GAP-4: Pending invoice >3 hari ── */}
    {pendingOldInv && pendingOldInv.length > 0 && (
      <div style={{ background: "#ef444410", border: "1px solid #ef444440", borderRadius: 14, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>🔴</span>
          <div>
            <div style={{ fontWeight: 800, color: "#ef4444", fontSize: 13 }}>{pendingOldInv.length} Invoice Pending Approval &gt;3 Hari</div>
            <div style={{ fontSize: 11, color: cs.muted }}>Total tertahan: Rp {pendingOldInv.reduce((s, i) => s + (i.total || 0), 0).toLocaleString("id-ID")}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setActiveMenu("invoice"); setInvoiceFilter("PENDING_APPROVAL"); }} style={{ padding: "7px 14px", borderRadius: 8, background: "#ef444422", border: "1px solid #ef444444", color: "#ef4444", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Lihat Invoice</button>
          <button onClick={() => { showNotif("WA reminder dikirim ke admin"); }} style={{ padding: "7px 14px", borderRadius: 8, background: "#ef444422", border: "1px solid #ef444444", color: "#ef4444", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>📱 WA Remind</button>
        </div>
      </div>
    )}
    {/* ── GAP-6: Approved belum bayar ── */}
    {approvedUnpaid && approvedUnpaid.length > 0 && (
      <div style={{ background: cs.yellow + "10", border: "1px solid " + cs.yellow + "40", borderRadius: 14, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>🟡</span>
          <div>
            <div style={{ fontWeight: 800, color: cs.yellow, fontSize: 13 }}>{approvedUnpaid.length} Invoice Approved Belum Dibayar</div>
            <div style={{ fontSize: 11, color: cs.muted }}>Total: Rp {approvedUnpaid.reduce((s, i) => s + (i.total || 0), 0).toLocaleString("id-ID")}</div>
          </div>
        </div>
        <button onClick={() => { setActiveMenu("invoice"); setInvoiceFilter("APPROVED"); }} style={{ padding: "7px 14px", borderRadius: 8, background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Lihat Invoice</button>
      </div>
    )}

    {/* KPI Cards */}
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 14 }}>
      {[
        { label: "Order Hari Ini", value: todayOrders.length, sub: `${todayOrders.filter(o => o.status === "IN_PROGRESS").length} aktif · ${todayOrders.filter(o => o.status === "COMPLETED").length} selesai`, color: cs.accent, icon: "📋", onClick: () => setActiveMenu("orders") },
        { label: "Invoice Unpaid", value: unpaidCount, sub: "Perlu follow-up", color: cs.yellow, icon: "🧾", onClick: () => { setActiveMenu("invoice"); setInvoiceFilter("UNPAID"); } },
        ...(role === "Owner" ? [{ label: "Pendapatan Bln Ini", value: fmt(totalRevBulanIni), sub: "Invoice terbayar", color: cs.green, icon: "💰", onClick: () => { setActiveMenu("invoice"); setInvoiceFilter("PAID"); } }] : [{ label: "Invoice Selesai", value: invoicesData.filter(i => i.status === "PAID" && String(i.paid_at || "").startsWith(bulanIni)).length, sub: "Terbayar bln ini", color: cs.green, icon: "✅", onClick: () => { setActiveMenu("invoice"); setInvoiceFilter("PAID"); } }]),
        { label: "Stok Kritis", value: lowStock, sub: "Perlu restock", color: cs.red, icon: "📦", onClick: () => setActiveMenu("inventory") },
      ].map(kpi => (
        <div key={kpi.label} onClick={kpi.onClick} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 18, cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <span style={{ fontSize: 24 }}>{kpi.icon}</span>
            <span style={{ fontSize: 11, color: cs.muted }}>{kpi.sub}</span>
          </div>
          <div style={{ fontWeight: 800, fontSize: 26, color: kpi.color, marginBottom: 4 }}>{kpi.value}</div>
          <div style={{ fontSize: 11, color: cs.muted, fontWeight: 600 }}>{kpi.label}</div>
        </div>
      ))}
    </div>

    {/* ── STATISTIK OMSET PER HARI/MINGGU/BULAN (Owner & Admin) ── */}
    {(() => {
      const now = new Date();
      const todayStr = TODAY;

      const startOf = (mode) => {
        const d = new Date(now);
        if (mode === "hari") { d.setHours(0, 0, 0, 0); return d; }
        if (mode === "minggu") { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d; }
        if (mode === "bulan") { d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
        return d;
      };

      const paidInvoices = invoicesData.filter(i => i.status === "PAID" && i.paid_at);

      const buildData = (mode) => {
        const start = startOf(mode);
        const filtered = paidInvoices.filter(i => new Date(i.paid_at) >= start);
        if (mode === "hari") {
          const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}:00`, total: 0, count: 0 }));
          filtered.forEach(i => { const h = new Date(i.paid_at).getHours(); hours[h].total += (i.total || 0); hours[h].count++; });
          return hours.filter((_, h) => h <= new Date().getHours());
        }
        if (mode === "minggu") {
          const days = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
          return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(startOf("minggu")); d.setDate(d.getDate() + i);
            const dStr = d.toISOString().slice(0, 10);
            const dayInv = paidInvoices.filter(inv => inv.paid_at?.slice(0, 10) === dStr);
            return { label: days[d.getDay()], date: dStr, total: dayInv.reduce((s, v) => s + (v.total || 0), 0), count: dayInv.length };
          });
        }
        if (mode === "bulan") {
          const weeks = [{ label: "Mgg 1", total: 0, count: 0 }, { label: "Mgg 2", total: 0, count: 0 }, { label: "Mgg 3", total: 0, count: 0 }, { label: "Mgg 4+", total: 0, count: 0 }];
          filtered.forEach(i => { const wk = Math.min(Math.floor((new Date(i.paid_at).getDate() - 1) / 7), 3); weeks[wk].total += (i.total || 0); weeks[wk].count++; });
          return weeks;
        }
        return [];
      };

      const data = buildData(omsetView);
      const maxVal = Math.max(...data.map(d => d.total), 1);
      const totalPeriod = data.reduce((s, d) => s + d.total, 0);
      const totalCount = data.reduce((s, d) => s + d.count, 0);

      // ── Omset per TEKNISI + HELPER (gabung) ──
      const start = startOf(omsetView);
      const paidInPeriod = paidInvoices.filter(i => new Date(i.paid_at) >= start);
      const byPerson = {};

      paidInPeriod.forEach(inv => {
        // Teknisi utama
        const tek = inv.teknisi;
        if (tek) {
          if (!byPerson[tek]) byPerson[tek] = { total: 0, count: 0, role: "Teknisi" };
          byPerson[tek].total += (inv.total || 0);
          byPerson[tek].count++;
        }
      });

      // Job count per orang hari ini (orders, bukan invoice — sudah include helper)
      const todayOrders2 = ordersData.filter(o => o.date === todayStr);
      const jobsToday = {};
      todayOrders2.forEach(o => {
        if (o.teknisi) { jobsToday[o.teknisi] = (jobsToday[o.teknisi] || 0) + 1; }
        if (o.helper) { jobsToday[o.helper] = (jobsToday[o.helper] || 0) + 1; }
      });

      // Semua anggota tim (dari teknisiData)
      const allTeam = teknisiData.filter(t => t.status !== "inactive");

      const teamRanking = Object.entries(byPerson)
        .sort((a, b) => b[1].total - a[1].total);

      return (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>

          {/* Header + filter tabs */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>{role === "Owner" ? "📊 Statistik Tim & Omset" : "📊 Statistik Tim"}</div>
              <div style={{ fontSize: 11, color: cs.muted }}>{role === "Owner" ? `${totalCount} transaksi terbayar` : `${todayOrders2.length} order hari ini`}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {["hari", "minggu", "bulan"].map(m => (
                <button key={m} onClick={() => setOmsetView(m)}
                  style={{
                    padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    border: "1px solid " + (omsetView === m ? cs.accent : cs.border),
                    background: omsetView === m ? cs.accent + "22" : cs.surface,
                    color: omsetView === m ? cs.accent : cs.muted, fontWeight: omsetView === m ? 700 : 400
                  }}>
                  {m === "hari" ? "Hari Ini" : m === "minggu" ? "Minggu Ini" : "Bulan Ini"}
                </button>
              ))}
            </div>
          </div>

          {/* Total omset — Owner only; Admin hanya lihat job count */}
          <div style={{ display: "grid", gridTemplateColumns: role === "Owner" ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 14 }}>
            {role === "Owner" && (
              <div style={{ background: cs.green + "18", border: "1px solid " + cs.green + "33", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: cs.muted }}>Total Omset</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: cs.green }}>{fmt(totalPeriod)}</div>
              </div>
            )}
            <div style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: cs.muted }}>Job Hari Ini</div>
              <div style={{ fontWeight: 800, fontSize: 18, color: cs.accent }}>{todayOrders2.length} order</div>
            </div>
          </div>

          {/* Bar chart omset — Owner only */}
          {role === "Owner" && data.length > 0 && totalPeriod > 0 && (
            <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 70, marginBottom: 12 }}>
              {data.map((d, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{ fontSize: 8, color: cs.muted }}>{d.total > 0 ? fmt(d.total).replace("Rp ", "").replace(".000", "rb") : ""}</div>
                  <div title={fmt(d.total) + " · " + d.count + " inv"}
                    style={{
                      width: "100%", background: d.total === maxVal ? cs.green : cs.accent + "77",
                      height: Math.max(3, Math.round(d.total / maxVal * 55)) + "px",
                      borderRadius: "3px 3px 0 0",
                      border: d.date === todayStr ? "2px solid " + cs.green : "none"
                    }} />
                  <div style={{ fontSize: 8, color: d.date === todayStr ? cs.green : cs.muted, fontWeight: d.date === todayStr ? 700 : 400, textAlign: "center" }}>
                    {d.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Kartu per anggota tim hari ini */}
          <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 8 }}>👥 Job Hari Ini per Anggota Tim</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 7 }}>
              {allTeam.map(t => {
                const jobCnt = jobsToday[t.name] || 0;
                const col = techColors[t.name] || cs.accent;
                const isActive = jobCnt > 0;
                return (
                  <div key={t.name} style={{
                    background: isActive ? col + "18" : cs.surface,
                    border: "1px solid " + (isActive ? col + "44" : cs.border),
                    borderRadius: 10, padding: "8px 10px", textAlign: "center"
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 10, background: col + "33",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, fontWeight: 800, color: col, margin: "0 auto 6px"
                    }}>
                      {(t.name || "?")[0]}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.text, marginBottom: 2 }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: col, fontWeight: 700 }}>{jobCnt} job</div>
                    <div style={{ fontSize: 9, color: cs.muted }}>{t.role || "Teknisi"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ranking omset per teknisi — Owner only */}
          {role === "Owner" && teamRanking.length > 0 && (
            <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 8 }}>
                🏆 Omset {omsetView === "hari" ? "Hari Ini" : omsetView === "minggu" ? "Minggu Ini" : "Bulan Ini"} per Teknisi
              </div>
              <div style={{ display: "grid", gap: 5 }}>
                {teamRanking.map(([name, stat], idx) => {
                  const col = techColors[name] || cs.accent;
                  const pct = totalPeriod > 0 ? Math.round(stat.total / totalPeriod * 100) : 0;
                  return (
                    <div key={name} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: cs.surface, borderRadius: 8, padding: "8px 12px"
                    }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: 6,
                        background: col + "33", display: "flex", alignItems: "center",
                        justifyContent: "center", fontSize: 11, fontWeight: 800, color: col
                      }}>
                        {idx + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: cs.text }}>{name}</div>
                        {/* Progress bar */}
                        <div style={{ height: 3, background: cs.border, borderRadius: 99, marginTop: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: pct + "%", background: col, borderRadius: 99, transition: "width .3s" }} />
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: cs.green }}>{fmt(stat.total)}</div>
                        <div style={{ fontSize: 10, color: cs.muted }}>{stat.count} inv · {pct}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    })()}

    {/* ── SLA ALERT WIDGET ── */}
    {(() => {
      const now3 = new Date();
      const slaOrders = ordersData.filter(o => {
        if (o.status !== "DISPATCHED" && o.status !== "CONFIRMED") return false;
        if (!o.date || !o.time || o.date !== TODAY) return false;
        const bMs = (o.date && o.time ? new Date(o.date + "T" + o.time + ":00").getTime() : 0);
        return now3.getTime() > bMs + 30 * 60 * 1000;
      });
      if (slaOrders.length === 0) return null;
      return (
        <div style={{ background: "#ef444412", border: "1px solid #ef444433", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#ef4444", marginBottom: 8 }}>⚠️ SLA Alert — {slaOrders.length} order belum konfirmasi tiba</div>
          {slaOrders.map(o => (
            <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#ef444408", borderRadius: 8, marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.text }}>{o.customer}</div>
                <div style={{ fontSize: 11, color: cs.muted }}>👷 {o.teknisi || "-"} · ⏰ booking {o.time}</div>
              </div>
              <span style={{ fontSize: 10, background: "#ef444420", color: "#ef4444", padding: "3px 8px", borderRadius: 99, fontWeight: 700 }}>BELUM TIBA</span>
            </div>
          ))}
        </div>
      );
    })()}


    {/* Today orders */}
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 15, marginBottom: 14 }}>📋 Order Hari Ini — {new Date(TODAY + "T00:00:00+07:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</div>
      <div style={{ display: "grid", gap: 10 }}>
        {todayOrders.map(o => (
          <div key={o.id} style={{ background: cs.surface, border: "1px solid " + (statusColor[o.status] || cs.border) + "44", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 99, background: (statusColor[o.status] || cs.muted) + "22", color: statusColor[o.status] || cs.muted, fontWeight: 700, border: "1px solid " + (statusColor[o.status] || cs.muted) + "44", whiteSpace: "nowrap" }}>{statusLabel[o.status] || o.status.replace("_", " ")}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>{o.customer}</div>
              <div style={{ fontSize: 11, color: cs.muted }}>{o.service} · {o.units} unit · 👷 {o.teknisi} · {o.time}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { const cu = findCustomer(customersData, o.phone, o.customer); if (cu) { setSelectedCustomer(cu); setCustomerTab("history"); setActiveMenu("customers"); } }}
                style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>History</button>
              {!o.dispatch && <button onClick={() => dispatchWA(o)} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>Dispatch WA</button>}
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Invoice + Stok alerts */}
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 14 }}>🧾 Invoice Perlu Tindakan</div>
        {invoicesData.filter(i => i.status !== "PAID").map(inv => (
          <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: (statusColor[inv.status] || cs.muted) + "22", color: statusColor[inv.status] || cs.muted, fontWeight: 700, border: "1px solid " + (statusColor[inv.status] || cs.muted) + "33", whiteSpace: "nowrap" }}>{inv.status.replace("_", " ")}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.customer}</div>
              <div style={{ fontSize: 11, color: cs.muted }}>{fmt(inv.total)}</div>
            </div>
            <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 10 }}>Preview</button>
          </div>
        ))}
      </div>
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 14 }}>📦 Stok Perlu Restock</div>
        {inventoryData.filter(i => i.status !== "OK").map(item => (
          <div key={item.code} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: (item.status === "OUT" ? cs.red : cs.yellow) + "22", color: item.status === "OUT" ? cs.red : cs.yellow, fontWeight: 700, border: "1px solid " + (item.status === "OUT" ? cs.red : cs.yellow) + "33" }}>{item.status}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.text }}>{item.name}</div>
              <div style={{ fontSize: 11, color: cs.muted }}>Stok: {displayStock(item)} {item.unit}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
    {/* ── FINANCIAL ANALYTICS — Owner only ── */}
    {currentUser?.role === "Owner" && (() => {
      const [bY, bM] = bulanIni.split("-").map(Number);
      const months = Array.from({ length: 6 }, (_, i) => {
        let m = bM - (5 - i);
        let y = bY;
        while (m <= 0) { m += 12; y--; }
        const prefix = y + "-" + String(m).padStart(2, "0");
        const d = new Date(y, m - 1, 1);
        return {
          prefix,
          label: d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }),
        };
      });

      const revenueByMonth = months.map(m => ({
        ...m,
        revenue: invoicesData.filter(i => i.status === "PAID" && String(i.paid_at || "").startsWith(m.prefix)).reduce((s, i) => s + (i.total || 0), 0),
        expenseTotal: (expensesData || []).filter(e => (e.date || "").startsWith(m.prefix)).reduce((s, e) => s + (e.amount || 0), 0),
      }));

      const thisMPrefix = bulanIni;
      const [ty, tm] = bulanIni.split("-").map(Number);
      const lastMPrefix = tm === 1
        ? (ty - 1) + "-12"
        : ty + "-" + String(tm - 1).padStart(2, "0");
      const revThisM = revenueByMonth.find(m => m.prefix === thisMPrefix)?.revenue || 0;
      const revLastM = revenueByMonth.find(m => m.prefix === lastMPrefix)?.revenue || 0;
      const revGrowth = revLastM > 0 ? Math.round(((revThisM - revLastM) / revLastM) * 100) : null;

      const expThisM = revenueByMonth.find(m => m.prefix === thisMPrefix)?.expenseTotal || 0;
      const profitThisM = revThisM - expThisM;
      const unpaidTotal = invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE").reduce((s, i) => s + (i.total || 0), 0);

      const byService = {};
      invoicesData.filter(i => i.status === "PAID" && (i.paid_at || i.created_at || "").startsWith(thisMPrefix)).forEach(i => {
        const s = i.service || "Lainnya";
        byService[s] = (byService[s] || 0) + (i.total || 0);
      });
      const serviceEntries = Object.entries(byService).sort((a, b) => b[1] - a[1]);
      const svcTotal = serviceEntries.reduce((s, [, v]) => s + v, 0);
      const svcColors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

      const maxBar = Math.max(...revenueByMonth.map(m => Math.max(m.revenue, m.expenseTotal)), 1);

      return (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: cs.text, marginBottom: 16 }}>💹 Analitik Keuangan</div>

          {/* KPI Row */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 10, marginBottom: 18 }}>
            {[
              { label: "Revenue Bulan Ini", value: fmt(revThisM), color: cs.green, icon: "💰",
                sub: revGrowth !== null ? (revGrowth >= 0 ? "▲ " : "▼ ") + Math.abs(revGrowth) + "% vs bln lalu" : "Bulan pertama",
                subColor: revGrowth === null ? cs.muted : revGrowth >= 0 ? cs.green : cs.red },
              { label: "Pengeluaran Bln Ini", value: fmt(expThisM), color: cs.yellow, icon: "🧾", sub: "Dari " + (expensesData || []).filter(e => (e.date || "").startsWith(thisMPrefix)).length + " transaksi", subColor: cs.muted },
              { label: "Estimasi Profit", value: fmt(profitThisM), color: profitThisM >= 0 ? cs.green : cs.red, icon: "📈", sub: expThisM > 0 ? "Margin " + Math.round(profitThisM / revThisM * 100) + "%" : "Belum ada pengeluaran", subColor: cs.muted },
              { label: "Outstanding Unpaid", value: fmt(unpaidTotal), color: cs.yellow, icon: "⏳", sub: invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length + " invoice belum lunas", subColor: cs.muted },
            ].map(k => (
              <div key={k.label} style={{ background: cs.surface, border: "1px solid " + k.color + "33", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 18, marginBottom: 6 }}>{k.icon}</div>
                <div style={{ fontWeight: 800, fontSize: 17, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: cs.muted, marginTop: 2 }}>{k.label}</div>
                <div style={{ fontSize: 10, color: k.subColor, marginTop: 3 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Revenue vs Expense Bar Chart — 6 bulan */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 10 }}>Tren Revenue vs Pengeluaran — 6 Bulan</div>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 90 }}>
              {revenueByMonth.map((m, i) => {
                const isThisM = m.prefix === thisMPrefix;
                const revH = Math.max(4, Math.round(m.revenue / maxBar * 75));
                const expH = Math.max(m.expenseTotal > 0 ? 4 : 0, Math.round(m.expenseTotal / maxBar * 75));
                return (
                  <div key={m.prefix} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                    {m.revenue > 0 && <div style={{ fontSize: 7, color: cs.green, marginBottom: 1 }}>{fmt(m.revenue).replace("Rp ", "").replace(/\.000$/, "rb")}</div>}
                    <div style={{ width: "100%", display: "flex", gap: 2, alignItems: "flex-end", justifyContent: "center" }}>
                      <div title={"Revenue: " + fmt(m.revenue)} style={{ flex: 1, height: revH, background: isThisM ? cs.green : cs.green + "55", borderRadius: "3px 3px 0 0", minHeight: 2 }} />
                      <div title={"Pengeluaran: " + fmt(m.expenseTotal)} style={{ flex: 1, height: expH, background: isThisM ? cs.yellow : cs.yellow + "55", borderRadius: "3px 3px 0 0", minHeight: expH > 0 ? 2 : 0 }} />
                    </div>
                    <div style={{ fontSize: 8, color: isThisM ? cs.accent : cs.muted, fontWeight: isThisM ? 700 : 400, marginTop: 3 }}>{m.label}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 10, color: cs.muted, marginTop: 6 }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: cs.green, borderRadius: 2, marginRight: 4 }} />Revenue</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: cs.yellow, borderRadius: 2, marginRight: 4 }} />Pengeluaran</span>
            </div>
          </div>

          {/* Dua kolom: Breakdown Revenue per Service + Breakdown Pengeluaran per Kategori */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>

            {/* Kiri: Revenue per service */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 10 }}>📊 Revenue per Service — Bulan Ini</div>
              {serviceEntries.length > 0 ? (
                <div style={{ display: "grid", gap: 7 }}>
                  {serviceEntries.map(([svc, val], i) => {
                    const pct = svcTotal > 0 ? Math.round(val / svcTotal * 100) : 0;
                    const col = svcColors[i % svcColors.length];
                    return (
                      <div key={svc} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: col + "22", border: "1px solid " + col + "44", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: col, flexShrink: 0 }}>{svc[0]}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: cs.text }}>{svc}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: col }}>{fmt(val)} <span style={{ color: cs.muted, fontWeight: 400 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ height: 5, background: cs.border, borderRadius: 99, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: pct + "%", background: col, borderRadius: 99 }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: cs.muted, fontSize: 12, padding: "20px 0", textAlign: "center" }}>Belum ada invoice terbayar bulan ini</div>
              )}
            </div>

            {/* Kanan: Pengeluaran per kategori */}
            {(() => {
              const catLabels = {
                material_purchase: { label: "Pembelian Material", icon: "🔩", color: "#f59e0b" },
                petty_cash:        { label: "Petty Cash / Operasional", icon: "💵", color: "#3b82f6" },
                salary:            { label: "Gaji / Honor", icon: "👷", color: "#10b981" },
                other:             { label: "Lainnya", icon: "📋", color: "#8b5cf6" },
              };

              const allExpThisM = (expensesData || []).filter(e => (e.date || e.created_at || "").startsWith(thisMPrefix));
              const byCategory = {};
              allExpThisM.forEach(e => {
                const cat = e.category || "other";
                if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0, items: [] };
                byCategory[cat].total += (e.amount || 0);
                byCategory[cat].count++;
                byCategory[cat].items.push(e.subcategory || e.item_name || "—");
              });

              const catEntries = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total);
              const expTotal = catEntries.reduce((s, [, v]) => s + v.total, 0);

              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted }}>🧾 Pengeluaran per Kategori — Bulan Ini</div>
                    {expTotal > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow }}>{fmt(expTotal)}</div>}
                  </div>

                  {catEntries.length > 0 ? (
                    <div style={{ display: "grid", gap: 7 }}>
                      {catEntries.map(([cat, stat]) => {
                        const meta = catLabels[cat] || catLabels.other;
                        const pct = expTotal > 0 ? Math.round(stat.total / expTotal * 100) : 0;
                        const pctOfRev = revThisM > 0 ? Math.round(stat.total / revThisM * 100) : 0;
                        return (
                          <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 8, background: meta.color + "22", border: "1px solid " + meta.color + "44", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{meta.icon}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: cs.text }}>{meta.label}</span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{fmt(stat.total)} <span style={{ color: cs.muted, fontWeight: 400 }}>({pctOfRev}% rev)</span></span>
                              </div>
                              <div style={{ height: 5, background: cs.border, borderRadius: 99, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: pct + "%", background: meta.color, borderRadius: 99 }} />
                              </div>
                              <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>{stat.count} transaksi · {[...new Set(stat.items)].slice(0, 2).join(", ")}{stat.count > 2 ? "..." : ""}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ background: cs.surface, border: "1px dashed " + cs.border, borderRadius: 10, padding: "18px 14px", textAlign: "center" }}>
                      <div style={{ fontSize: 20, marginBottom: 6 }}>📭</div>
                      <div style={{ fontSize: 12, color: cs.muted }}>Belum ada pengeluaran bulan ini</div>
                      <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>Input via menu <strong style={{ color: cs.accent }}>Biaya</strong></div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      );
    })()}

    {/* ── SIM-9: Performa Tim per Teknisi ── */}
    {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (() => {
      const isOwner = currentUser?.role === "Owner";
      const allTekNames2 = [...new Set(ordersData.map(o => o.teknisi).filter(Boolean))];
      if (allTekNames2.length === 0) return null;
      const bulanIniPfx = new Date().toISOString().slice(0, 7);
      return (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 700, color: cs.text, fontSize: 15, marginBottom: 14 }}>
            👥 Performa Tim — {bulanIniPfx.slice(5).padStart(2, "0")}/{bulanIniPfx.slice(0, 4)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", gap: 12 }}>
            {allTekNames2.map(tek => {
              const col = getTechColor(tek, teknisiData);
              const jobsBulan = ordersData.filter(o => o.teknisi === tek && (o.date || "").startsWith(bulanIniPfx));
              const selesai = jobsBulan.filter(o => ["COMPLETED", "PAID"].includes(o.status)).length;
              const pending = jobsBulan.filter(o => ["PENDING", "CONFIRMED", "IN_PROGRESS", "ON_SITE"].includes(o.status)).length;
              const revInvTek = invoicesData.filter(i => i.teknisi === tek && i.status === "PAID" && String(i.created_at || "").startsWith(bulanIniPfx)).reduce((a, b) => a + (b.total || 0), 0);
              const lapVerif = laporanReports.filter(r => r.teknisi === tek && r.status === "VERIFIED").length;
              const lapRevisi = laporanReports.filter(r => r.teknisi === tek && r.status === "REVISION").length;
              return (
                <div key={tek} style={{ background: cs.surface, border: "1px solid " + col + "33", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: col + "22", border: "1px solid " + col + "44", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: col, fontSize: 15 }}>
                      {tek.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>{tek.split(" ")[0]}</div>
                      <div style={{ fontSize: 10, color: cs.muted }}>{teknisiData.find(t => t.name === tek)?.role || "Teknisi"}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: 11 }}>
                    <div><span style={{ color: cs.muted }}>Job bln ini</span><div style={{ fontWeight: 800, color: cs.text, fontSize: 16 }}>{jobsBulan.length}</div></div>
                    <div><span style={{ color: cs.muted }}>Selesai</span><div style={{ fontWeight: 800, color: cs.green, fontSize: 16 }}>{selesai}</div></div>
                    <div><span style={{ color: cs.muted }}>Laporan ✓</span><div style={{ fontWeight: 700, color: col }}>{lapVerif}</div></div>
                    <div><span style={{ color: cs.muted }}>Revisi</span><div style={{ fontWeight: 700, color: lapRevisi > 0 ? cs.yellow : cs.muted }}>{lapRevisi}</div></div>
                  </div>
                  {isOwner && revInvTek > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, background: cs.green + "12", border: "1px solid " + cs.green + "22", borderRadius: 7, padding: "4px 8px", color: cs.green, fontWeight: 700 }}>
                      💰 Revenue: {fmt(revInvTek)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    })()}
  </div>
);
}

export default memo(DashboardView);
