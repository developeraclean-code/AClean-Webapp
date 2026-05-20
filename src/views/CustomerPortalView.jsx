import { useEffect, useState, useCallback } from "react";

const API_BASE = "/api";

const STATUS_MAP = {
  PENDING:        { label: "Pesanan Diterima",           step: 0, emoji: "📋" },
  CONFIRMED:      { label: "Tim Sedang Disiapkan",       step: 1, emoji: "🔧" },
  DISPATCHED:     { label: "Tim Sedang Menuju Lokasi",   step: 2, emoji: "🚗" },
  IN_PROGRESS:    { label: "Tim Sedang Menuju Lokasi",   step: 2, emoji: "🚗" },
  ON_SITE:        { label: "Tim Sudah di Lokasi",        step: 3, emoji: "📍" },
  COMPLETED:      { label: "Servis Selesai",             step: 4, emoji: "✅" },
  INVOICE_APPROVED:{ label: "Servis Selesai",            step: 4, emoji: "✅" },
  CANCELLED:      { label: "Dibatalkan",                 step: -1, emoji: "❌" },
};

const STEPS = ["Dikonfirmasi", "Tim Disiapkan", "Menuju Lokasi", "Di Lokasi", "Selesai"];

const INV_STATUS_LABEL = {
  UNPAID:       { label: "Belum Dibayar",   cls: "status-unpaid" },
  PARTIAL_PAID: { label: "Lunas Sebagian",  cls: "status-partial" },
  PAID:         { label: "Lunas",           cls: "status-paid" },
  OVERDUE:      { label: "Jatuh Tempo",     cls: "status-unpaid" },
};

function fmtRp(n) {
  if (!n) return "Rp 0";
  return "Rp " + Number(n).toLocaleString("id-ID");
}

function fmtDate(d) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch { return d; }
}

function fmtDateShort(d) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  } catch { return d; }
}

const SERVICE_ICON = (service = "") => {
  const s = service.toLowerCase();
  if (s.includes("pasang") || s.includes("install")) return "🏗️";
  if (s.includes("perbaik") || s.includes("repair") || s.includes("service")) return "🔧";
  return "❄️";
};

const SERVICE_BG = (service = "") => {
  const s = service.toLowerCase();
  if (s.includes("pasang") || s.includes("install")) return "#f0fdf4";
  if (s.includes("perbaik") || s.includes("repair")) return "#fef3c7";
  return "#e0f2fe";
};

export default function CustomerPortalView({ token: tokenProp }) {
  const token = tokenProp || window.__portalToken || "";
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [vouchers, setVouchers] = useState([]);
  const [ratingTarget, setRatingTarget] = useState(null); // order yang mau di-rating
  const [ratedOrders, setRatedOrders]   = useState({}); // { order_id: true }

  useEffect(() => {
    if (!token) { setError("not_found"); setLoading(false); return; }
    fetch(`${API_BASE}/customer-status?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.code === "NOT_FOUND" ? "not_found" : d.code === "TOKEN_EXPIRED" ? "expired" : "error");
        else {
          setData(d);
          // Fetch vouchers paralel
          fetch(`${API_BASE}/customer-vouchers?token=${encodeURIComponent(token)}`)
            .then(r => r.json()).then(v => setVouchers(v.vouchers || [])).catch(() => {});
          // Cek hash anchor #rating
          if (window.location.hash === "#rating" && d.orders?.length > 0) {
            const lastDone = d.orders.find(o => ["COMPLETED","INVOICE_APPROVED"].includes(o.status));
            if (lastDone) setRatingTarget(lastDone);
          }
        }
      })
      .catch(() => setError("error"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <LoadingScreen />;
  if (error === "not_found") return <NotFoundScreen />;
  if (error === "expired") return <ExpiredScreen />;
  if (error) return <ErrorScreen />;

  // Job aktif hari ini (non-completed, non-cancelled)
  const todayStr = new Date().toISOString().slice(0, 10);
  const activeJob = data.orders?.find(o =>
    !["COMPLETED","INVOICE_APPROVED","CANCELLED"].includes(o.status) && o.date >= todayStr
  ) || null;

  // Job selesai terbaru (untuk garansi + rating)
  const lastDoneJob = data.orders?.find(o => ["COMPLETED","INVOICE_APPROVED"].includes(o.status));
  const lastInvoice = data.invoices?.[0] || null;
  const garansiInvoice = lastInvoice?.garansi_expires ? lastInvoice : null;

  // Job selesai yang belum di-rating (hanya tampilkan tombol jika ada)
  const unratedJob = data.orders?.find(o =>
    ["COMPLETED","INVOICE_APPROVED"].includes(o.status) && !ratedOrders[o.id]
  ) || null;

  return (
    <div style={s.page}>
      {/* TOP BAR */}
      <div style={s.topbar}>
        <div style={s.logoBadge}>AC</div>
        <div>
          <div style={s.topbarTitle}>AClean</div>
          <div style={s.topbarSub}>Portal Status Servis</div>
        </div>
        <a href="https://wa.me/6281234567890" style={s.waBtn} target="_blank" rel="noreferrer">
          💬 Hubungi Kami
        </a>
      </div>

      <div style={s.wrapper}>
        {/* CUSTOMER CARD */}
        <CustomerCard data={data} />

        {/* EXPIRED NOTICE — data tetap tampil tapi ada banner */}
        {data.expired && (
          <div style={s.expiredBanner}>
            🔒 Link ini sudah tidak aktif. Hubungi AClean untuk link baru.
          </div>
        )}

        {/* ACTIVE JOB */}
        {activeJob && !data.expired && (
          <>
            <div style={s.sectionLabel}>Job Hari Ini</div>
            <ActiveJobCard job={activeJob} />
          </>
        )}

        {/* INVOICE AKTIF */}
        {lastInvoice && ["UNPAID","PARTIAL_PAID","OVERDUE"].includes(lastInvoice.status) && (
          <>
            <div style={s.sectionLabel}>Invoice</div>
            <InvoiceCard inv={lastInvoice} />
          </>
        )}

        {/* GARANSI */}
        {garansiInvoice && (
          <GaransiCard inv={garansiInvoice} />
        )}

        {/* RATING PROMPT — jika ada job selesai belum di-rating */}
        {unratedJob && !ratingTarget && (
          <RatingPrompt job={unratedJob} onOpen={() => setRatingTarget(unratedJob)} />
        )}

        {/* RATING FORM — aktif saat customer klik beri rating */}
        {ratingTarget && (
          <RatingForm
            job={ratingTarget}
            token={token}
            onDone={() => {
              setRatedOrders(prev => ({ ...prev, [ratingTarget.id]: true }));
              setRatingTarget(null);
            }}
            onCancel={() => setRatingTarget(null)}
          />
        )}

        {/* VOUCHER */}
        {vouchers.length > 0 && (
          <>
            <div style={s.sectionLabel}>Voucher Anda</div>
            <div style={{ display: "grid", gap: 8 }}>
              {vouchers.map(v => <VoucherCard key={v.id} voucher={v} />)}
            </div>
          </>
        )}

        {/* RIWAYAT */}
        {data.orders?.length > 0 && (
          <>
            <div style={s.sectionLabel}>Riwayat Servis</div>
            <div style={{ display: "grid", gap: 10 }}>
              {data.orders.slice(0, 10).map(o => {
                const inv = data.invoices?.find(i => i.job_id === o.id);
                return <HistoryItem key={o.id} order={o} invoice={inv} />;
              })}
            </div>
          </>
        )}

        {/* FOOTER */}
        <div style={s.footer}>
          <div style={s.footerLogo}><strong style={{ color: "#0369a1" }}>AClean</strong> · Jasa Servis AC Profesional</div>
          {data.token_expires && (
            <div style={s.footerExp}>
              Link berlaku hingga {fmtDateShort(data.token_expires)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SUB-COMPONENTS ──

const TIERS = [
  { label: "Bronze",   min: 1,  max: 4,  badge: "🥉", color: "#a16207", bg: "#fef9c3", border: "#fde047" },
  { label: "Silver",   min: 5,  max: 9,  badge: "🥈", color: "#475569", bg: "#f1f5f9", border: "#94a3b8" },
  { label: "Gold",     min: 10, max: 14, badge: "🥇", color: "#b45309", bg: "#fffbeb", border: "#fbbf24" },
  { label: "Platinum", min: 15, max: Infinity, badge: "💎", color: "#6d28d9", bg: "#f5f3ff", border: "#a78bfa" },
];

function getTier(count) {
  return TIERS.find(t => count >= t.min && count <= t.max) || TIERS[0];
}

function CustomerCard({ data }) {
  const totalOrders = data.orders?.length || 0;
  const tier = getTier(totalOrders);
  const nextTier = TIERS[TIERS.indexOf(tier) + 1] || null;
  const progressPct = nextTier
    ? Math.min(100, Math.round(((totalOrders - tier.min) / (nextTier.min - tier.min)) * 100))
    : 100;

  return (
    <div style={s.customerCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={s.customerLabel}>Portal Servis</div>
        {totalOrders >= 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: tier.bg, border: "1px solid " + tier.border, borderRadius: 20, padding: "3px 10px" }}>
            <span style={{ fontSize: 14 }}>{tier.badge}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: tier.color }}>{tier.label}</span>
          </div>
        )}
      </div>
      <div style={s.customerName}>{data.customer_name || "Pelanggan AClean"}</div>
      <div style={s.customerPhone}>📱 {data.phone}</div>
      <div style={s.customerMeta}>
        <span style={s.badge}>{totalOrders} kali servis</span>
        {data.orders?.length > 0 && (
          <span style={s.badge}>Servis terakhir {fmtDateShort(data.orders[0]?.date)}</span>
        )}
      </div>
      {nextTier && totalOrders >= 1 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#64748b" }}>
              {nextTier.min - totalOrders} servis lagi menuju {nextTier.badge} {nextTier.label}
            </span>
            <span style={{ fontSize: 10, color: "#64748b" }}>{progressPct}%</span>
          </div>
          <div style={{ height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: progressPct + "%", background: "linear-gradient(90deg,#38bdf8,#0369a1)", borderRadius: 99, transition: "width 0.5s" }} />
          </div>
        </div>
      )}
      {!nextTier && totalOrders >= 1 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#6d28d9", fontWeight: 600 }}>
          💎 Anda adalah Pelanggan Platinum kami! Terima kasih atas kepercayaan Anda.
        </div>
      )}
    </div>
  );
}

function ActiveJobCard({ job }) {
  const st = STATUS_MAP[job.status] || STATUS_MAP.PENDING;
  const currentStep = st.step;
  const isOnSite = job.status === "ON_SITE";
  const isDispatched = ["DISPATCHED","IN_PROGRESS"].includes(job.status);
  const borderColor = isOnSite ? "#22c55e44" : "#0ea5e944";
  const headerBg = isOnSite ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : "linear-gradient(135deg,#f0f9ff,#e0f2fe)";
  const headerBorder = isOnSite ? "#86efac" : "#bae6fd";
  const dotColor = isOnSite ? "#22c55e" : "#0ea5e9";
  const titleColor = isOnSite ? "#15803d" : "#0369a1";

  const team = [job.teknisi, job.helper, job.teknisi2, job.helper2].filter(Boolean);

  return (
    <div style={{ ...s.activeJob, borderColor, boxShadow: `0 4px 20px ${dotColor}15` }}>
      {/* Header */}
      <div style={{ ...s.activeJobHeader, background: headerBg, borderBottomColor: headerBorder }}>
        <div style={{ ...s.pulseDot, background: dotColor }} className="portal-pulse" />
        <div>
          <div style={{ ...s.activeJobTitle, color: titleColor }}>
            {st.emoji} {st.label}
          </div>
          <div style={{ fontSize: 11, color: titleColor, marginTop: 1, opacity: 0.8 }}>
            {fmtDate(job.date)} · Pukul {job.time || "--:--"}
          </div>
        </div>
      </div>

      <div style={s.activeJobBody}>
        {/* Stepper */}
        <div style={s.stepper}>
          {STEPS.map((label, i) => {
            const isDone   = i < currentStep;
            const isActive = i === currentStep;
            const isPend   = i > currentStep;
            return (
              <div key={i} style={s.stepWrap}>
                {i < STEPS.length - 1 && (
                  <div style={{ ...s.stepLine, background: isDone || isActive ? dotColor : "#e2e8f0" }} />
                )}
                <div style={{
                  ...s.stepDot,
                  background: isDone ? dotColor : isActive ? "#fff" : "#f1f5f9",
                  border: isActive ? `2.5px solid ${dotColor}` : isPend ? "1.5px solid #cbd5e1" : "none",
                  color: isDone ? "#fff" : isActive ? dotColor : "#94a3b8",
                }}>
                  {isDone ? "✓" : i === 2 ? "🚗" : i === 3 ? "📍" : i === 4 ? "✅" : i + 1}
                </div>
                <div style={{ ...s.stepLabel, color: isActive ? titleColor : "#94a3b8", fontWeight: isActive ? 700 : 400 }}>
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* ETA dari jadwal */}
        {(isDispatched || isOnSite) && job.time && (
          <div style={s.etaPill}>
            ⏱ {isOnSite ? `Tiba pukul ${job.time}` : `Estimasi tiba pukul ${job.time}`}
            {job.area ? ` · ${job.area}` : ""}
          </div>
        )}

        {/* Service info */}
        <div style={s.jobInfoRow}>
          <span style={{ fontSize: 18 }}>{SERVICE_ICON(job.service)}</span>
          <div>
            <div style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>{job.service}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{job.units} unit · {job.address}</div>
          </div>
        </div>

        {/* Tim teknisi */}
        {team.length > 0 && (
          <div style={s.techRow}>
            {team.slice(0, 2).map((name, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <div style={{ ...s.techAvatar, background: i === 0 ? "linear-gradient(135deg,#0ea5e9,#7c3aed)" : "linear-gradient(135deg,#f59e0b,#ef4444)" }}>
                  {name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{name}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{i === 0 ? "Teknisi" : "Helper"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceCard({ inv }) {
  const st = INV_STATUS_LABEL[inv.status] || INV_STATUS_LABEL.UNPAID;
  const total = Number(inv.total) || 0;
  const paid  = Number(inv.paid_amount) || 0;
  const remaining = Number(inv.remaining_amount) || (total - paid);
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

  return (
    <div style={s.invoiceCard}>
      <div style={s.invoiceHeader}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{inv.id}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{inv.service} · {inv.units} unit</div>
        </div>
        <span style={{ ...s.invStatus, ...s[st.cls] }}>{st.label}</span>
      </div>
      <div style={s.invoiceBody}>
        <div style={s.invRow}>
          <span style={s.invLabel}>Total</span>
          <span style={{ ...s.invValue, color: "#0369a1", fontWeight: 800, fontSize: 15 }}>{fmtRp(total)}</span>
        </div>
        {paid > 0 && (
          <div style={s.payProgress}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>Progress Pembayaran</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0369a1" }}>{pct}%</span>
            </div>
            <div style={s.progressBg}>
              <div style={{ ...s.progressBar, width: pct + "%" }} />
            </div>
            <div style={s.progressLabels}>
              <span>Dibayar: <strong style={{ color: "#16a34a" }}>{fmtRp(paid)}</strong></span>
              <span>Sisa: <strong style={{ color: "#dc2626" }}>{fmtRp(remaining)}</strong></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GaransiCard({ inv }) {
  const exp = inv.garansi_expires;
  const isActive = exp && new Date(exp) > new Date();
  return (
    <div style={s.garansiCard}>
      <span style={{ fontSize: 28 }}>🛡️</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#6d28d9" }}>
          {isActive ? "Garansi Servis Aktif" : "Garansi Servis"}
        </div>
        <div style={{ fontSize: 12, color: "#7c3aed", marginTop: 4, lineHeight: 1.5 }}>
          Jika AC bermasalah dalam masa garansi, teknisi kami akan kembali tanpa biaya tambahan.
        </div>
        <div style={{ fontSize: 11, color: "#a78bfa", marginTop: 6 }}>
          {isActive ? `Berlaku hingga: ${fmtDateShort(exp)}` : `Berakhir: ${fmtDateShort(exp)}`}
        </div>
      </div>
    </div>
  );
}

function HistoryItem({ order, invoice }) {
  const inv = invoice;
  const invSt = inv ? (INV_STATUS_LABEL[inv.status] || null) : null;
  const stDone = ["COMPLETED","INVOICE_APPROVED"].includes(order.status);
  return (
    <div style={s.historyItem}>
      <div style={{ ...s.historyIcon, background: SERVICE_BG(order.service) }}>
        {SERVICE_ICON(order.service)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDateShort(order.date)}</div>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", marginTop: 1 }}>{order.service}</div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
          {order.units} unit{order.teknisi ? ` · ${order.teknisi}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {inv && <div style={{ fontSize: 13, fontWeight: 700, color: "#0369a1" }}>{fmtRp(inv.total)}</div>}
        {invSt && (
          <div style={{ ...s.historyStatus, ...(inv.status === "PAID" ? s.hsDone : inv.status === "PARTIAL_PAID" ? s.hsPartial : s.hsUnpaid) }}>
            {invSt.label}
          </div>
        )}
        {!inv && stDone && <div style={{ ...s.historyStatus, ...s.hsDone }}>Selesai</div>}
      </div>
    </div>
  );
}

// ── RATING PROMPT ──
function RatingPrompt({ job, onOpen }) {
  return (
    <div style={{ background: "linear-gradient(135deg,#fef9c3,#fef3c7)", border: "1px solid #fcd34d", borderRadius: 16, padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 28 }}>⭐</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#92400e" }}>Bagaimana servis kami?</div>
        <div style={{ fontSize: 11, color: "#a16207", marginTop: 2 }}>{job.service} · {fmtDateShort(job.date)}</div>
      </div>
      <button onClick={onOpen}
        style={{ background: "#f59e0b", border: "none", color: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
        Beri Rating
      </button>
    </div>
  );
}

// ── RATING FORM ──
function RatingForm({ job, token, onDone, onCancel }) {
  const [selected, setSelected] = useState(0);
  const [hover, setHover]       = useState(0);
  const [comment, setComment]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState(null);

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/submit-rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, order_id: job.id, rating: selected, comment }),
      });
      const d = await r.json();
      if (r.ok) { setMsg("success"); setTimeout(onDone, 1800); }
      else setMsg(d.error || "Gagal kirim rating");
    } catch { setMsg("Gagal kirim, coba lagi"); }
    finally { setSaving(false); }
  };

  const LABELS = ["", "Sangat Buruk", "Buruk", "Cukup", "Bagus", "Sangat Bagus"];
  const active = hover || selected;

  return (
    <div style={{ background: "#fff", border: "2px solid #fcd34d", borderRadius: 18, overflow: "hidden" }}>
      <div style={{ background: "linear-gradient(135deg,#fef9c3,#fef3c7)", padding: "14px 18px", borderBottom: "1px solid #fde68a" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#92400e" }}>⭐ Beri Rating Servis</div>
        <div style={{ fontSize: 11, color: "#a16207", marginTop: 2 }}>{job.service} · {fmtDateShort(job.date)}</div>
      </div>
      <div style={{ padding: "20px 18px", display: "grid", gap: 16 }}>
        {msg === "success" ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🙏</div>
            <div style={{ fontWeight: 700, color: "#16a34a", fontSize: 15 }}>Terima kasih atas rating Anda!</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Masukan Anda sangat berarti untuk AClean</div>
          </div>
        ) : (
          <>
            {/* Bintang */}
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 6 }}>
                {[1,2,3,4,5].map(i => (
                  <span key={i}
                    onClick={() => setSelected(i)}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(0)}
                    style={{ fontSize: 36, cursor: "pointer", color: i <= active ? "#f59e0b" : "#e2e8f0", transition: "color .15s, transform .1s", transform: i === active ? "scale(1.2)" : "scale(1)", display: "inline-block" }}>
                    ★
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: active ? "#92400e" : "#94a3b8", minHeight: 20 }}>
                {active ? LABELS[active] : "Pilih bintang"}
              </div>
            </div>

            {/* Komentar */}
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Ceritakan pengalaman Anda (opsional)..."
              maxLength={500}
              rows={3}
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#334155", resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />

            {msg && msg !== "success" && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#dc2626" }}>{msg}</div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
              <button onClick={onCancel} disabled={saving}
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px", fontSize: 13, cursor: "pointer", color: "#64748b" }}>
                Batal
              </button>
              <button onClick={submit} disabled={!selected || saving}
                style={{ background: selected ? "#f59e0b" : "#e2e8f0", border: "none", borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 700, cursor: selected ? "pointer" : "default", color: selected ? "#fff" : "#94a3b8", transition: "background .2s" }}>
                {saving ? "Mengirim..." : "Kirim Rating ⭐"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── VOUCHER CARD ──
function VoucherCard({ voucher: v }) {
  const typeLabel = v.type === "discount_pct" ? `Diskon ${v.value}%`
    : v.type === "free_unit" ? `${v.value} Unit Gratis`
    : v.type === "free_service" ? "Servis Gratis" : v.type;

  return (
    <div style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1px solid #86efac", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🎁</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: "#15803d" }}>{typeLabel}</div>
        {v.description && <div style={{ fontSize: 11, color: "#16a34a", marginTop: 2 }}>{v.description}</div>}
        <div style={{ fontSize: 10, color: "#4ade80", marginTop: 4, fontFamily: "monospace", letterSpacing: 1 }}>KODE: {v.code}</div>
      </div>
      {v.expires_at && (
        <div style={{ fontSize: 10, color: "#16a34a", textAlign: "right", flexShrink: 0 }}>
          Berlaku s/d<br /><strong>{fmtDateShort(v.expires_at)}</strong>
        </div>
      )}
    </div>
  );
}

// ── LOADING / ERROR SCREENS ──

function LoadingScreen() {
  return (
    <div style={{ ...s.page, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>❄️</div>
        <div style={{ fontWeight: 700, color: "#0369a1" }}>Memuat...</div>
      </div>
    </div>
  );
}

function ExpiredScreen() {
  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.logoBadge}>AC</div>
        <div><div style={s.topbarTitle}>AClean</div></div>
      </div>
      <div style={{ ...s.wrapper, paddingTop: 40 }}>
        <div style={s.expiredCard}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⏰</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#1e293b" }}>Link Sudah Kedaluwarsa</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 8, lineHeight: 1.6 }}>
            Link portal ini sudah expired (berlaku 7 hari).<br />
            Hubungi tim AClean untuk mendapatkan link baru.
          </div>
          <a href="https://wa.me/6281234567890" style={{ ...s.waBtn, marginTop: 20, display: "inline-flex", textDecoration: "none" }} target="_blank" rel="noreferrer">
            💬 Chat AClean
          </a>
        </div>
      </div>
    </div>
  );
}

function NotFoundScreen() {
  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.logoBadge}>AC</div>
        <div><div style={s.topbarTitle}>AClean</div></div>
      </div>
      <div style={{ ...s.wrapper, paddingTop: 40 }}>
        <div style={s.expiredCard}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#1e293b" }}>Link Tidak Ditemukan</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 8, lineHeight: 1.6 }}>
            Link ini tidak valid atau sudah kedaluwarsa.<br />
            Hubungi tim AClean untuk mendapatkan link baru.
          </div>
          <a href="https://wa.me/6281234567890" style={{ ...s.waBtn, marginTop: 20, display: "inline-flex", textDecoration: "none" }} target="_blank" rel="noreferrer">
            💬 Chat AClean
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen() {
  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <div style={s.logoBadge}>AC</div>
        <div><div style={s.topbarTitle}>AClean</div></div>
      </div>
      <div style={{ ...s.wrapper, paddingTop: 40 }}>
        <div style={s.expiredCard}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#1e293b" }}>Gagal Memuat Data</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 8, lineHeight: 1.6 }}>
            Terjadi kesalahan saat memuat halaman. Coba lagi atau hubungi AClean.
          </div>
          <button onClick={() => window.location.reload()} style={{ ...s.waBtn, marginTop: 16, border: "none", cursor: "pointer" }}>
            🔄 Coba Lagi
          </button>
        </div>
      </div>
    </div>
  );
}

// ── STYLES ──
const s = {
  page:          { fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: "#f0f4f8", color: "#1a2332", minHeight: "100vh" },
  topbar:        { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100 },
  logoBadge:     { width: 38, height: 38, background: "linear-gradient(135deg,#0ea5e9,#0369a1)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: 15, flexShrink: 0 },
  topbarTitle:   { fontWeight: 800, fontSize: 16, color: "#0369a1" },
  topbarSub:     { fontSize: 11, color: "#64748b" },
  waBtn:         { marginLeft: "auto", background: "#22c55e", color: "#fff", border: "none", borderRadius: 20, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" },
  wrapper:       { maxWidth: 480, margin: "0 auto", padding: "16px 16px 32px", display: "grid", gap: 14 },
  sectionLabel:  { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#94a3b8", padding: "0 2px" },

  customerCard:  { background: "linear-gradient(135deg,#0369a1,#0ea5e9)", borderRadius: 18, padding: 20, color: "#fff", position: "relative", overflow: "hidden" },
  customerLabel: { fontSize: 11, opacity: 0.8, letterSpacing: "0.5px", textTransform: "uppercase" },
  customerName:  { fontSize: 22, fontWeight: 800, marginTop: 4 },
  customerPhone: { fontSize: 12, opacity: 0.75, marginTop: 3 },
  customerMeta:  { display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" },
  badge:         { background: "rgba(255,255,255,0.2)", borderRadius: 20, padding: "4px 10px", fontSize: 11, fontWeight: 600 },

  expiredBanner: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#dc2626", fontWeight: 600 },
  expiredCard:   { background: "#fff", borderRadius: 18, padding: "40px 24px", textAlign: "center", border: "1px solid #e2e8f0" },

  activeJob:       { background: "#fff", borderRadius: 18, border: "2px solid", overflow: "hidden" },
  activeJobHeader: { padding: "14px 18px", borderBottom: "1px solid", display: "flex", alignItems: "center", gap: 10 },
  pulseDot:        { width: 10, height: 10, borderRadius: "50%", flexShrink: 0, animation: "none" },
  activeJobTitle:  { fontWeight: 700, fontSize: 14 },
  activeJobBody:   { padding: "16px 18px", display: "grid", gap: 12 },

  stepper:   { display: "flex", alignItems: "flex-start" },
  stepWrap:  { display: "flex", flexDirection: "column", alignItems: "center", flex: 1, position: "relative" },
  stepLine:  { position: "absolute", top: 14, left: "50%", right: "-50%", height: 2, zIndex: 0 },
  stepDot:   { width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0, zIndex: 1 },
  stepLabel: { fontSize: 9, color: "#64748b", marginTop: 5, textAlign: "center", lineHeight: 1.3 },

  etaPill:   { background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: "#92400e", display: "inline-flex", alignItems: "center", gap: 5 },
  jobInfoRow:{ display: "flex", alignItems: "flex-start", gap: 10 },
  techRow:   { display: "flex", alignItems: "center", gap: 8, background: "#f8fafc", borderRadius: 10, padding: "10px 12px" },
  techAvatar:{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 12, flexShrink: 0 },

  invoiceCard:   { background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden" },
  invoiceHeader: { padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9" },
  invoiceBody:   { padding: "14px 18px", display: "grid", gap: 8 },
  invRow:        { display: "flex", justifyContent: "space-between", fontSize: 13 },
  invLabel:      { color: "#64748b" },
  invValue:      { fontWeight: 600, color: "#1e293b" },
  invStatus:     { fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 },
  "status-unpaid":  { background: "#fef2f2", color: "#dc2626" },
  "status-partial": { background: "#fffbeb", color: "#d97706" },
  "status-paid":    { background: "#f0fdf4", color: "#16a34a" },

  payProgress:    { background: "#f8fafc", borderRadius: 10, padding: 12 },
  progressBg:     { background: "#e2e8f0", borderRadius: 99, height: 8, margin: "8px 0", overflow: "hidden" },
  progressBar:    { height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#0ea5e9,#22c55e)" },
  progressLabels: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b" },

  garansiCard:   { background: "linear-gradient(135deg,#f5f3ff,#ede9fe)", border: "1px solid #ddd6fe", borderRadius: 16, padding: "16px 18px", display: "flex", gap: 12, alignItems: "flex-start" },

  historyItem:   { background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" },
  historyIcon:   { width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 },
  historyStatus: { fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, marginTop: 4, display: "inline-block" },
  hsDone:        { background: "#f0fdf4", color: "#16a34a" },
  hsPartial:     { background: "#fffbeb", color: "#d97706" },
  hsUnpaid:      { background: "#fef2f2", color: "#dc2626" },

  footer:    { textAlign: "center", paddingTop: 8 },
  footerLogo:{ fontSize: 11, color: "#94a3b8" },
  footerExp: { fontSize: 10, color: "#cbd5e1", marginTop: 4 },
};
