import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { fetchWeeklyPayrollByUser, fetchMyBonuses } from "../data/reads.js";

const STATUS_COLORS  = { PENDING: "#f59e0b", ELIGIBLE: "#3b82f6", PAID: "#22c55e", VOID: "#6b7280" };
const STATUS_LABELS  = { PENDING: "Dalam Warranty", ELIGIBLE: "Siap Cair", PAID: "Sudah Dibayar", VOID: "Void" };
const STATUS_ICONS   = { PENDING: "⏳", ELIGIBLE: "✅", PAID: "💰", VOID: "🚫" };

function fmtRp(n) {
  if (!n && n !== 0) return "-";
  return "Rp " + Math.abs(Number(n)).toLocaleString("id-ID");
}
function fmtDate(d) {
  if (!d) return "-";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function KomisiView({ currentUser, supabase, bonusCategories = [], BONUS_LABELS = {} }) {
  const [tab, setTab]           = useState("komisi"); // "komisi" | "payroll"
  const [payrolls, setPayrolls] = useState([]);
  const [bonuses, setBonuses]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [bonusFilter, setBonusFilter] = useState("ALL");
  const [expandedPayroll, setExpandedPayroll] = useState(null);

  const userId   = currentUser?.id;
  const userName = currentUser?.name;

  const loadData = useCallback(async () => {
    if (!userId || !userName) return;
    setLoading(true);
    const [payRes, bonRes] = await Promise.all([
      fetchWeeklyPayrollByUser(supabase, userId, 8),
      fetchMyBonuses(supabase, userName, 60),
    ]);
    setPayrolls(payRes.data || []);
    setBonuses(bonRes.data || []);
    setLoading(false);
  }, [supabase, userId, userName]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredBonuses = bonusFilter === "ALL"
    ? bonuses
    : bonuses.filter(b => b.status === bonusFilter);

  // Summary counts
  const totalEligible = bonuses.filter(b => b.status === "ELIGIBLE").reduce((s, b) => s + Number(b.amount_per_person || 0), 0);
  const totalPaid     = bonuses.filter(b => b.status === "PAID").reduce((s, b) => s + Number(b.amount_per_person || 0), 0);
  const totalPending  = bonuses.filter(b => b.status === "PENDING").reduce((s, b) => s + Number(b.amount_per_person || 0), 0);

  const latestPayroll = payrolls[0];

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 4px" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)", borderRadius: 14, padding: "20px 20px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>💰 Komisi & Gaji</div>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>{userName} · {currentUser?.role}</div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div style={{ background: cs.card, borderRadius: 10, padding: "12px 14px", border: "1px solid " + STATUS_COLORS.ELIGIBLE }}>
          <div style={{ fontSize: 11, color: cs.muted }}>Siap Cair</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: STATUS_COLORS.ELIGIBLE }}>{fmtRp(totalEligible)}</div>
        </div>
        <div style={{ background: cs.card, borderRadius: 10, padding: "12px 14px", border: "1px solid " + STATUS_COLORS.PENDING }}>
          <div style={{ fontSize: 11, color: cs.muted }}>Dalam Warranty</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: STATUS_COLORS.PENDING }}>{fmtRp(totalPending)}</div>
        </div>
        <div style={{ background: cs.card, borderRadius: 10, padding: "12px 14px", border: "1px solid " + STATUS_COLORS.PAID }}>
          <div style={{ fontSize: 11, color: cs.muted }}>Total Dibayar</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: STATUS_COLORS.PAID }}>{fmtRp(totalPaid)}</div>
        </div>
      </div>

      {/* Gaji minggu terakhir */}
      {latestPayroll && (
        <div style={{ background: cs.card, borderRadius: 12, padding: 14, marginBottom: 16, border: "1px solid " + (latestPayroll.is_paid ? STATUS_COLORS.PAID : cs.border) }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>📋 Gaji Terakhir</div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: latestPayroll.is_paid ? STATUS_COLORS.PAID : "#f59e0b", color: "#fff" }}>
              {latestPayroll.is_paid ? "✅ DIBAYAR" : "⏳ BELUM DIBAYAR"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: cs.muted, marginBottom: 10 }}>
            {fmtDate(latestPayroll.period_start)} — {fmtDate(latestPayroll.period_end)}
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <Row label="Hari Masuk" value={`${latestPayroll.days_worked} hari × ${fmtRp(latestPayroll.daily_rate)} = ${fmtRp(latestPayroll.days_worked * latestPayroll.daily_rate)}`} />
            {latestPayroll.full_week_bonus && <Row label="Bonus Full Week" value={"+" + fmtRp(latestPayroll.role === "Helper" ? 75000 : 100000)} color={STATUS_COLORS.PAID} />}
            {latestPayroll.late_days > 0 && <Row label={`Potongan Telat (${latestPayroll.late_days}×)`} value={"-" + fmtRp(latestPayroll.late_days * 10000)} color="#ef4444" />}
            {latestPayroll.kasbon_total > 0 && <Row label="Kasbon" value={"-" + fmtRp(latestPayroll.kasbon_total)} color="#ef4444" />}
            {latestPayroll.manual_bonus > 0 && <Row label={"Bonus Manual" + (latestPayroll.manual_bonus_note ? " (" + latestPayroll.manual_bonus_note + ")" : "")} value={"+" + fmtRp(latestPayroll.manual_bonus)} color={STATUS_COLORS.PAID} />}
          </div>
          <div style={{ borderTop: "1px solid " + cs.border, marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: cs.muted }}>TOTAL</span>
            <span style={{ fontWeight: 800, fontSize: 20, color: cs.accent }}>{fmtRp(latestPayroll.gross_salary)}</span>
          </div>
        </div>
      )}

      {/* Tab */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[{ k: "komisi", l: "🎯 Riwayat Komisi" }, { k: "payroll", l: "📋 Riwayat Gaji" }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, border: "1px solid",
            borderColor: tab === t.k ? cs.accent : cs.border,
            background: tab === t.k ? cs.accent : cs.surface,
            color: tab === t.k ? "#fff" : cs.muted,
          }}>{t.l}</button>
        ))}
      </div>

      {loading && <div style={{ color: cs.muted, fontSize: 13, textAlign: "center", padding: 24 }}>Memuat data...</div>}

      {/* ── KOMISI ── */}
      {!loading && tab === "komisi" && (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Info warranty */}
          <div style={{ background: "#1e2d40", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>
            ℹ️ Komisi dicairkan setelah <strong style={{ color: "#e2e8f0" }}>30–45 hari</strong> dari tanggal pengerjaan. Void jika ada komplain customer pada pekerjaan yang sama.
          </div>

          {/* Filter */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["ALL","PENDING","ELIGIBLE","PAID","VOID"].map(s => (
              <button key={s} onClick={() => setBonusFilter(s)} style={{
                padding: "4px 10px", borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid",
                background: bonusFilter === s ? (STATUS_COLORS[s] || cs.accent) : cs.surface,
                borderColor: bonusFilter === s ? (STATUS_COLORS[s] || cs.accent) : cs.border,
                color: bonusFilter === s ? "#fff" : cs.muted,
              }}>
                {STATUS_ICONS[s] || "●"} {s === "ALL" ? "Semua" : STATUS_LABELS[s]}
                {s !== "ALL" && ` (${bonuses.filter(b => b.status === s).length})`}
              </button>
            ))}
          </div>

          {filteredBonuses.length === 0 ? (
            <div style={{ background: cs.surface, borderRadius: 10, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
              <div style={{ color: cs.muted, fontSize: 14 }}>Belum ada komisi.</div>
            </div>
          ) : filteredBonuses.map(b => (
            <div key={b.id} style={{
              background: cs.card, borderRadius: 10, padding: 14,
              border: "1px solid " + STATUS_COLORS[b.status],
              opacity: b.status === "VOID" ? 0.55 : 1,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>{STATUS_ICONS[b.status]}</span>
                    <span style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>{BONUS_LABELS[b.bonus_type] || b.bonus_type}</span>
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted }}>
                    {b.order_id ? `[${b.order_id}]` : ""} · {fmtDate(b.order_date)}
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted }}>
                    Tim: {(b.team_members || []).join(", ")}
                  </div>
                  {b.note && <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic", marginTop: 2 }}>{b.note}</div>}
                  {b.void_reason && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2 }}>Void: {b.void_reason}</div>}
                  <div style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: STATUS_COLORS[b.status] + "33", color: STATUS_COLORS[b.status] }}>
                      {STATUS_LABELS[b.status]}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 90 }}>
                  <div style={{ fontSize: 10, color: cs.muted }}>Bagian Saya</div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: b.status === "VOID" ? cs.muted : cs.accent }}>{fmtRp(b.amount_per_person)}</div>
                  <div style={{ fontSize: 10, color: cs.muted }}>dari {fmtRp(b.total_amount)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── RIWAYAT PAYROLL ── */}
      {!loading && tab === "payroll" && (
        <div style={{ display: "grid", gap: 10 }}>
          {payrolls.length === 0 ? (
            <div style={{ background: cs.surface, borderRadius: 10, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <div style={{ color: cs.muted, fontSize: 14 }}>Belum ada riwayat gaji.</div>
            </div>
          ) : payrolls.map(p => {
            const isExp = expandedPayroll === p.id;
            const fullBonus = p.role === "Helper" ? 75000 : 100000;
            return (
              <div key={p.id} style={{ background: cs.card, borderRadius: 10, border: "1px solid " + (p.is_paid ? STATUS_COLORS.PAID : cs.border) }}>
                <button onClick={() => setExpandedPayroll(isExp ? null : p.id)} style={{
                  width: "100%", padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>
                      {fmtDate(p.period_start)} — {fmtDate(p.period_end)}
                    </div>
                    <div style={{ fontSize: 11, color: cs.muted }}>
                      {p.days_worked} hari masuk · {p.is_paid ? "✅ Dibayar" : "⏳ Belum dibayar"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: cs.accent }}>{fmtRp(p.gross_salary)}</div>
                    <div style={{ fontSize: 10, color: cs.muted }}>{isExp ? "▲" : "▼"}</div>
                  </div>
                </button>
                {isExp && (
                  <div style={{ padding: "0 14px 14px", borderTop: "1px solid " + cs.border }}>
                    <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
                      <Row label="Hari Masuk" value={`${p.days_worked} × ${fmtRp(p.daily_rate)} = ${fmtRp(p.days_worked * p.daily_rate)}`} />
                      {p.full_week_bonus && <Row label="Bonus Full Week" value={"+" + fmtRp(fullBonus)} color={STATUS_COLORS.PAID} />}
                      {p.late_days > 0 && <Row label={`Potongan Telat (${p.late_days}×)`} value={"-" + fmtRp(p.late_days * 10000)} color="#ef4444" />}
                      {p.kasbon_total > 0 && <Row label="Kasbon" value={"-" + fmtRp(p.kasbon_total)} color="#ef4444" />}
                      {p.manual_bonus > 0 && <Row label={"Bonus Manual" + (p.manual_bonus_note ? ` (${p.manual_bonus_note})` : "")} value={"+" + fmtRp(p.manual_bonus)} color={STATUS_COLORS.PAID} />}
                    </div>
                    {p.is_paid && p.paid_at && (
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 8 }}>
                        Dibayar oleh {p.paid_by} · {new Date(p.paid_at).toLocaleString("id-ID")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "2px 0" }}>
      <span style={{ color: cs.muted }}>{label}</span>
      <span style={{ fontWeight: 600, color: color || cs.text }}>{value}</span>
    </div>
  );
}
