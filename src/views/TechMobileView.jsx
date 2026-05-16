import { memo, useState } from "react";
import { cs } from "../theme/cs.js";

const STATUS_CONFIG = {
  PENDING:    { label: "Pending",    color: "#94a3b8", bg: "#94a3b822" },
  CONFIRMED:  { label: "Confirmed",  color: "#60a5fa", bg: "#60a5fa22" },
  DISPATCHED: { label: "Berangkat",  color: "#f59e0b", bg: "#f59e0b22" },
  IN_PROGRESS:{ label: "Dikerjakan", color: "#a78bfa", bg: "#a78bfa22" },
  ON_SITE:    { label: "Di Lokasi",  color: "#34d399", bg: "#34d39922" },
  COMPLETED:  { label: "Selesai",    color: "#10b981", bg: "#10b98122" },
};

function TechMobileView({ currentUser, ordersData, TODAY, openLaporanModal, updateOrderStatus, supabase, sendWA, auditUserName, showNotif, setActiveMenu }) {
  const myName = currentUser?.name || "";
  const [updating, setUpdating] = useState(null); // order.id sedang diupdate

  // Filter: order hari ini milik teknisi/helper ini
  const todayOrders = ordersData.filter(o => {
    if (o.date !== TODAY) return false;
    if (["CANCELLED", "INVOICE_APPROVED"].includes(o.status)) return false;
    return (
      (o.teknisi || "").toLowerCase() === myName.toLowerCase() ||
      (o.helper || "").toLowerCase() === myName.toLowerCase() ||
      (o.teknisi2 || "").toLowerCase() === myName.toLowerCase() ||
      (o.helper2 || "").toLowerCase() === myName.toLowerCase() ||
      (o.teknisi3 || "").toLowerCase() === myName.toLowerCase() ||
      (o.helper3 || "").toLowerCase() === myName.toLowerCase()
    );
  }).sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  // Stats hari ini
  const countDone      = todayOrders.filter(o => o.status === "COMPLETED").length;
  const countOnSite    = todayOrders.filter(o => o.status === "ON_SITE").length;
  const countActive    = todayOrders.filter(o => ["PENDING","CONFIRMED","DISPATCHED","IN_PROGRESS"].includes(o.status)).length;

  const handleStatus = async (order, newStatus, notifMsg) => {
    setUpdating(order.id);
    try {
      await updateOrderStatus(supabase, order.id, newStatus, auditUserName?.() || myName, {});
      showNotif?.("✅ " + notifMsg);
    } catch (e) {
      showNotif?.("❌ Gagal update status", "error");
    } finally {
      setUpdating(null);
    }
  };

  const openMaps = (address) => {
    const q = encodeURIComponent(address || "");
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank");
  };

  const openWACustomer = (phone) => {
    if (!phone) return;
    const num = phone.replace(/\D/g, "").replace(/^0/, "62");
    window.open(`https://wa.me/${num}`, "_blank");
  };

  // Sticky CTA: ada job ON_SITE?
  const onSiteJob = todayOrders.find(o => o.status === "ON_SITE");

  return (
    <div style={{ display: "grid", gap: 12, paddingBottom: onSiteJob ? 80 : 16 }}>
      {/* Greeting Header */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: "16px 18px" }}>
        <div style={{ fontSize: 13, color: cs.muted }}>Selamat datang,</div>
        <div style={{ fontWeight: 800, fontSize: 20, color: cs.text, marginTop: 2 }}>{myName} <span style={{ fontSize: 14 }}>{currentUser?.role === "Helper" ? "🤝" : "👷"}</span></div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>
          {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </div>
      </div>

      {/* Stats Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {[
          { label: "Belum Mulai", val: countActive, color: cs.accent },
          { label: "Di Lokasi",   val: countOnSite, color: "#34d399" },
          { label: "Selesai",     val: countDone,   color: cs.green },
        ].map(s => (
          <div key={s.label} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Job Cards */}
      {todayOrders.length === 0 ? (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: "40px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 700, color: cs.text, marginBottom: 4 }}>Tidak ada job hari ini</div>
          <div style={{ fontSize: 12, color: cs.muted }}>Cek jadwal lengkap di menu Jadwal</div>
          <button onClick={() => setActiveMenu?.("schedule")}
            style={{ marginTop: 16, background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 10, padding: "9px 20px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            Lihat Jadwal
          </button>
        </div>
      ) : (
        todayOrders.map(order => {
          const st = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
          const isUpdating = updating === order.id;
          const isCompleted = order.status === "COMPLETED";
          const isOnSite = order.status === "ON_SITE";
          const isDispatched = order.status === "DISPATCHED" || order.status === "IN_PROGRESS";
          const isPending = order.status === "PENDING" || order.status === "CONFIRMED";
          const helperNote = [order.helper, order.helper2, order.helper3].filter(Boolean).join(", ");
          const team2 = [order.teknisi2, order.teknisi3].filter(Boolean).join(", ");

          return (
            <div key={order.id} style={{ background: cs.card, border: "2px solid " + st.color + "55", borderRadius: 16, overflow: "hidden" }}>
              {/* Job Header */}
              <div style={{ padding: "14px 16px", borderBottom: "1px solid " + cs.border + "55" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: cs.accent }}>{order.time || "--:--"}</span>
                      <span style={{ fontSize: 10, color: cs.muted, fontFamily: "monospace" }}>{order.id}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: cs.text }}>{order.customer}</div>
                    <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{order.service} · {order.units} unit</div>
                    {helperNote && <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>🤝 Helper: {helperNote}</div>}
                    {team2 && <div style={{ fontSize: 11, color: cs.muted }}>👷 Tim: {team2}</div>}
                  </div>
                  <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, fontWeight: 700, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                    {st.label}
                  </span>
                </div>
              </div>

              {/* Address */}
              <button onClick={() => openMaps(order.address)}
                style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid " + cs.border + "44", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 16 }}>📍</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: cs.text }}>{order.address || "Alamat tidak tersedia"}</div>
                  {order.area && <div style={{ fontSize: 11, color: cs.muted }}>{order.area}</div>}
                </div>
                <span style={{ fontSize: 11, color: cs.accent, fontWeight: 600 }}>Maps →</span>
              </button>

              {/* Notes */}
              {order.notes && (
                <div style={{ padding: "8px 16px", background: cs.yellow + "08", borderBottom: "1px solid " + cs.border + "33" }}>
                  <div style={{ fontSize: 11, color: cs.yellow }}>📝 {order.notes}</div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ padding: "12px 16px", display: "grid", gap: 8 }}>
                {/* Primary CTA — berubah per status */}
                {isPending && (
                  <button
                    onClick={() => handleStatus(order, "DISPATCHED", "Status diupdate: Berangkat")}
                    disabled={isUpdating}
                    style={{ width: "100%", background: "#f59e0b", border: "none", color: "#0a0f1e", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 800, cursor: "pointer", opacity: isUpdating ? 0.6 : 1 }}>
                    {isUpdating ? "⏳ Memproses..." : "🚀 Konfirmasi Berangkat"}
                  </button>
                )}
                {isDispatched && (
                  <button
                    onClick={() => handleStatus(order, "ON_SITE", "Konfirmasi tiba di lokasi")}
                    disabled={isUpdating}
                    style={{ width: "100%", background: "#34d399", border: "none", color: "#0a0f1e", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 800, cursor: "pointer", opacity: isUpdating ? 0.6 : 1 }}>
                    {isUpdating ? "⏳ Memproses..." : "✅ Konfirmasi Tiba di Lokasi"}
                  </button>
                )}
                {isOnSite && (
                  <button
                    onClick={() => openLaporanModal(order)}
                    style={{ width: "100%", background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                    📝 Isi Laporan Pekerjaan
                  </button>
                )}
                {isCompleted && (
                  <div style={{ background: cs.green + "15", border: "1px solid " + cs.green + "33", borderRadius: 10, padding: "10px 14px", textAlign: "center", fontSize: 12, color: cs.green, fontWeight: 600 }}>
                    ✅ Pekerjaan Selesai
                  </div>
                )}

                {/* Secondary actions */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button onClick={() => openWACustomer(order.phone)}
                    style={{ background: "#25d36622", border: "1px solid #25d36644", color: "#25d366", borderRadius: 10, padding: "10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                    💬 WA Customer
                  </button>
                  {!isCompleted && (
                    <button onClick={() => openLaporanModal(order)}
                      style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 10, padding: "10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                      📋 Laporan
                    </button>
                  )}
                  {isCompleted && (
                    <button onClick={() => setActiveMenu?.("myreport")}
                      style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, borderRadius: 10, padding: "10px", fontSize: 12, cursor: "pointer" }}>
                      📄 Lihat Laporan
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}

      {/* Sticky CTA: jika ada job ON_SITE */}
      {onSiteJob && (
        <div style={{ position: "fixed", bottom: 72, left: 0, right: 0, padding: "0 16px", zIndex: 200 }}>
          <button onClick={() => openLaporanModal(onSiteJob)}
            style={{ width: "100%", background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff", borderRadius: 14, padding: "15px", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px #0a84ff55" }}>
            📝 Isi Laporan Sekarang — {onSiteJob.customer}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(TechMobileView);
