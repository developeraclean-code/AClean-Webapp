import { memo, useEffect, useRef, useState } from "react";
import { cs } from "../theme/cs.js";
import AbsenBanner from "./AbsenBanner.jsx";
import KasbonWidget from "./KasbonWidget.jsx";
import ExpenseInputWidget from "./ExpenseInputWidget.jsx";
import { findDelayedFieldReports, isFieldOrderAssigned } from "../lib/fieldReportWorkflow.js";
import { normalizePhone, samePhone } from "../lib/phone.js";
import { ORDER_DONE_STATUSES } from "../constants/status.js";
import { enqueueFieldStatus } from "../lib/fieldOfflineQueue.js";
import { buildFieldReminders, claimFieldReminder } from "../lib/fieldReminders.js";
import { captureOptionalCheckin } from "../lib/fieldCheckin.js";

const STATUS_CONFIG = {
  PENDING:    { label: "Pending",    color: "#94a3b8", bg: "#94a3b822" },
  CONFIRMED:  { label: "Confirmed",  color: "#60a5fa", bg: "#60a5fa22" },
  DISPATCHED: { label: "Berangkat",  color: "#f59e0b", bg: "#f59e0b22" },
  IN_PROGRESS:{ label: "Dikerjakan", color: "#a78bfa", bg: "#a78bfa22" },
  WORKING:    { label: "Dikerjakan", color: "#a78bfa", bg: "#a78bfa22" },
  ON_SITE:    { label: "Di Lokasi",  color: "#34d399", bg: "#34d39922" },
  COMPLETED:  { label: "Selesai",    color: "#10b981", bg: "#10b98122" },
  REPORT_SUBMITTED: { label: "Laporan Masuk", color: "#10b981", bg: "#10b98122" },
  INVOICE_CREATED: { label: "Invoice Dibuat", color: "#10b981", bg: "#10b98122" },
  INVOICE_APPROVED: { label: "Invoice Dikirim", color: "#10b981", bg: "#10b98122" },
  PAID: { label: "Lunas", color: "#10b981", bg: "#10b98122" },
  CONTINUED: { label: "Lanjut Hari Berikut", color: "#f59e0b", bg: "#f59e0b22" },
};

function TechMobileView({ currentUser, ordersData, setOrdersData, laporanReports, TODAY, openLaporanModal, openJobReport, materialsBroughtMap, updateOrderStatus, supabase, auditUserName, showNotif, setActiveMenu, apiHeaders, kasbonProps, expenseProps, customersData, setHistoryPreview, onFieldQueued }) {
  const myName = currentUser?.name || "";
  const [updating, setUpdating] = useState(null); // order.id sedang diupdate
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const statusLocks = useRef(new Set());

  useEffect(() => {
    const sync = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  // Reminder lokal: tidak memakai cron/server quota. Satu reminder dikirim satu
  // kali per job per hari selama aplikasi terbuka dan izin notifikasi tersedia.
  useEffect(() => {
    const check = () => {
      const due = buildFieldReminders({
        orders: ordersData, reports: laporanReports, employeeName: myName,
        today: TODAY, now: new Date(), materialsBroughtMap,
      });
      const next = due.find(reminder => claimFieldReminder(reminder));
      if (next) showNotif?.(next.message, true);
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [TODAY, laporanReports, materialsBroughtMap, myName, ordersData, showNotif]);

  // Filter: order hari ini milik teknisi/helper ini
  const todayOrders = ordersData.filter(o => {
    if (o.date !== TODAY) return false;
    if (["CANCELLED", "RESCHEDULED"].includes(o.status)) return false;
    return isFieldOrderAssigned(o, myName);
  }).sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  // Stats hari ini
  const countDone      = todayOrders.filter(o => ORDER_DONE_STATUSES.includes(o.status)).length;
  const countOnSite    = todayOrders.filter(o => ["ON_SITE", "WORKING"].includes(o.status)).length;
  const countActive    = todayOrders.filter(o => ["PENDING","CONFIRMED","DISPATCHED","IN_PROGRESS"].includes(o.status)).length;
  const focusPriority = { WORKING: 0, ON_SITE: 1, IN_PROGRESS: 2, DISPATCHED: 3, CONFIRMED: 4, PENDING: 5 };
  const focusedOrder = [...todayOrders]
    .filter(order => Object.hasOwn(focusPriority, order.status))
    .sort((a, b) => (focusPriority[a.status] ?? 9) - (focusPriority[b.status] ?? 9) || (a.time || "").localeCompare(b.time || ""))[0] || null;
  const displayedOrders = showAllJobs || !focusedOrder ? todayOrders : [focusedOrder];
  const hiddenJobCount = Math.max(0, todayOrders.length - displayedOrders.length);
  const delayedReports = findDelayedFieldReports(ordersData, laporanReports, myName, TODAY);

  const handleStatus = async (order, newStatus, notifMsg, extraFactory = null) => {
    if (statusLocks.current.has(order.id)) return;
    statusLocks.current.add(order.id);
    setUpdating(order.id);
    try {
      const extra = typeof extraFactory === "function" ? await extraFactory() : {};
      const actorName = auditUserName?.() || myName;
      if (!isOnline) {
        await enqueueFieldStatus({ orderId: order.id, status: newStatus, extra, actorName });
        setOrdersData?.(prev => prev.map(row => row.id === order.id ? { ...row, status: newStatus, ...extra, _pendingFieldSync: true } : row));
        onFieldQueued?.();
        showNotif?.("📡 " + notifMsg + " disimpan offline dan akan disinkronkan otomatis.");
        return;
      }
      const { data, error, locationSkipped } = await updateOrderStatus(supabase, order.id, newStatus, actorName, extra);
      if (error) throw error;
      if (!data?.id) throw new Error("Order tidak berubah atau akses ditolak");
      setOrdersData?.(prev => prev.map(row => row.id === order.id ? { ...row, status: newStatus } : row));
      showNotif?.("✅ " + notifMsg + (locationSkipped ? " (lokasi belum tersimpan; skema sedang diperbarui)" : ""));
    } catch (e) {
      console.error("[TECH_STATUS]", e);
      showNotif?.("❌ Gagal update status: " + (e?.message || "coba lagi"), "error");
    } finally {
      statusLocks.current.delete(order.id);
      setUpdating(null);
    }
  };

  const captureArrival = () => captureOptionalCheckin();

  const openMaps = (address) => {
    if (!String(address || "").trim()) { showNotif?.("⚠️ Alamat job belum tersedia", "error"); return; }
    const q = encodeURIComponent(address || "");
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank");
  };

  const openWACustomer = (phone) => {
    const num = normalizePhone(phone);
    if (num.length < 8) { showNotif?.("⚠️ Nomor WhatsApp customer belum valid", "error"); return; }
    window.open(`https://wa.me/${num}`, "_blank");
  };

  // History customer — sama seperti tombol di menu Jadwal (CustomerHistoryModal
  // via setHistoryPreview di App). Cari baris customer utk match akurat (customer_id),
  // fallback objek minimal dari order.
  const openHistory = (order) => {
    const orderName = String(order.customer || "").trim().toLowerCase();
    const cu = (customersData || []).find(c => order.customer_id && c.id === order.customer_id)
      || (customersData || []).find(c => samePhone(c.phone, order.phone))
      || (customersData || []).find(c => String(c.name || "").trim().toLowerCase() === orderName);
    setHistoryPreview?.(cu || { name: order.customer, phone: order.phone, address: order.address });
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
        {/* Quick-nav: pintu harian material & alat (di luar per-job) */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => setActiveMenu?.("matcheckout")}
            style={{ flex: 1, background: cs.accent + "18", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 10, padding: "9px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
            📥 Material Harian
          </button>
          <button onClick={() => setActiveMenu?.("alatsaya")}
            style={{ flex: 1, background: "#f59e0b18", border: "1px solid #f59e0b44", color: "#f59e0b", borderRadius: 10, padding: "9px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
            🧰 Alat Saya
          </button>
        </div>
      </div>

      {!isOnline && (
        <div role="alert" style={{ background: "#ef444418", border: "1px solid #ef444466", color: "#fca5a5", borderRadius: 11, padding: "10px 13px", fontSize: 12, fontWeight: 700 }}>
          📵 Offline — draft teks tetap tersimpan di perangkat, tetapi status dan foto baru dikirim setelah koneksi kembali.
        </div>
      )}

      {/* Absen mandiri — Teknisi & Helper */}
      <AbsenBanner currentUser={currentUser} supabase={supabase} TODAY={TODAY} showNotif={showNotif} apiHeaders={apiHeaders} />

      {/* Pengeluaran harian — bensin/parkir + AI vision */}
      {expenseProps && <ExpenseInputWidget {...expenseProps} />}

      {/* Kasbon — request uang muka */}
      {kasbonProps && <KasbonWidget {...kasbonProps} />}

      {/* Stats Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {[
          { label: "Belum / Menuju", val: countActive, color: cs.accent },
          { label: "Di Lokasi",   val: countOnSite, color: "#34d399" },
          { label: "Selesai",     val: countDone,   color: cs.green },
        ].map(s => (
          <div key={s.label} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {delayedReports.length > 0 && (
        <div style={{ background: "#f59e0b12", border: "1px solid #f59e0b55", borderRadius: 12, padding: "11px 13px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#f59e0b" }}>⏱ {delayedReports.length} laporan tertunda</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 3 }}>{delayedReports[0].id} · {delayedReports[0].customer} · {delayedReports[0].date}</div>
          <button onClick={() => openLaporanModal(delayedReports[0])}
            style={{ marginTop: 8, width: "100%", background: "#f59e0b", color: "#0a0f1e", border: "none", borderRadius: 8, padding: "8px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
            Isi laporan tertua sekarang
          </button>
        </div>
      )}

      {focusedOrder && !showAllJobs && (
        <div style={{ background: cs.accent + "12", border: "1px solid " + cs.accent + "44", borderRadius: 12, padding: "10px 13px" }}>
          <div style={{ fontSize: 10, color: cs.accent, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>Fokus sekarang · satu aksi berikutnya</div>
          <div style={{ fontSize: 13, color: cs.text, fontWeight: 700, marginTop: 3 }}>
            {["ON_SITE", "WORKING"].includes(focusedOrder.status) ? "Isi laporan pekerjaan" : ["DISPATCHED", "IN_PROGRESS"].includes(focusedOrder.status) ? "Konfirmasi tiba di lokasi" : "Konfirmasi berangkat"} — {focusedOrder.customer}
          </div>
        </div>
      )}

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
        displayedOrders.map(order => {
          const st = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
          const isUpdating = updating === order.id;
          const isCompleted = ORDER_DONE_STATUSES.includes(order.status);
          const isContinued = order.status === "CONTINUED";
          const isClosedForToday = isCompleted || isContinued;
          const isOnSite = order.status === "ON_SITE" || order.status === "WORKING";
          const isDispatched = order.status === "DISPATCHED" || order.status === "IN_PROGRESS";
          const isPending = order.status === "PENDING" || order.status === "CONFIRMED";
          const bCount = (materialsBroughtMap || {})[order.id] || 0;
          const helperNote = [order.helper, order.helper2, order.helper3].filter(Boolean).join(", ");
          const team2 = [order.teknisi2, order.teknisi3].filter(Boolean).join(", ");

          return (
            <div key={order.id} style={{ background: cs.card, border: "2px solid " + st.color + "55", borderRadius: 16, overflow: "hidden" }}>
              {/* Job Header */}
              <div style={{ padding: "14px 16px", borderBottom: "1px solid " + cs.border + "55" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: cs.accent }}>{order.time || "--:--"}{order.time_end ? `–${order.time_end}` : ""}</span>
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
                {/* Primary CTA per status. Material TIDAK lagi pakai tombol terpisah —
                    satu pintu "📝 Laporan & Material" (di bawah) yang urus bawa + pakai material.
                    Alat → menu harian "🧰 Alat Saya". */}
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
                    onClick={() => handleStatus(order, "ON_SITE", "Konfirmasi tiba di lokasi", captureArrival)}
                    disabled={isUpdating}
                    style={{ width: "100%", background: "#34d399", border: "none", color: "#0a0f1e", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 800, cursor: "pointer", opacity: isUpdating ? 0.6 : 1 }}>
                    {isUpdating ? "⏳ Memproses..." : "✅ Konfirmasi Tiba di Lokasi"}
                  </button>
                )}
                {isDispatched && (
                  <div style={{ fontSize: 10, color: cs.muted, textAlign: "center", marginTop: -3 }}>
                    Lokasi hanya diminta sekali saat tombol Tiba ditekan dan boleh ditolak.
                  </div>
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
                {isContinued && (
                  <div style={{ background: "#f59e0b15", border: "1px solid #f59e0b44", borderRadius: 10, padding: "10px 14px", textAlign: "center", fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>
                    ↪️ Pekerjaan dilanjutkan pada jadwal berikutnya
                  </div>
                )}

                {/* Secondary actions */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => openWACustomer(order.phone)}
                      style={{ background: "#25d36622", border: "1px solid #25d36644", color: "#25d366", borderRadius: 10, padding: "10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                      💬 WA Customer
                    </button>
                    <button onClick={() => openHistory(order)}
                      style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 10, padding: "10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                      📋 History
                    </button>
                  </div>
                  {!isClosedForToday && (
                    <button onClick={() => (openJobReport || openLaporanModal)(order)}
                      style={{ width: "100%", background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 10, padding: "10px", fontSize: 12, cursor: "pointer", fontWeight: 600, position: "relative" }}>
                      📝 Laporan & Material
                      {bCount > 0 && <span style={{ position: "absolute", top: -6, right: -6, background: "#a855f7", color: "#fff", fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 99 }}>{bCount}</span>}
                    </button>
                  )}
                  {isCompleted && (
                    <button onClick={() => setActiveMenu?.("myreport")}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, borderRadius: 10, padding: "10px", fontSize: 12, cursor: "pointer" }}>
                      📄 Lihat Laporan
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}

      {hiddenJobCount > 0 && (
        <button onClick={() => setShowAllJobs(true)}
          style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, borderRadius: 11, padding: "11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Lihat {hiddenJobCount} job lainnya ▾
        </button>
      )}
      {showAllJobs && focusedOrder && todayOrders.length > 1 && (
        <button onClick={() => setShowAllJobs(false)}
          style={{ background: "transparent", border: "none", color: cs.accent, padding: "6px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Kembali ke satu job aktif
        </button>
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
