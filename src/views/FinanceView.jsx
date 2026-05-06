import { useState, useMemo, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { cs } from "../theme/cs.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Field DB yang benar:
// invoices: id, job_id, customer, service, total, status ("PAID"/"UNPAID"/"OVERDUE"/dll),
//           payment_proof_url, paid_at, approved_by
// orders:   id (= job_id di invoice), customer, service, units, teknisi, helper, date, time, status

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "biaya", label: "Biaya Operasional", icon: "💸" },
  { id: "statistik", label: "Statistik", icon: "📈" },
  { id: "planning", label: "Financial Planning", icon: "🎯" },
];

const fmtRp = (n) =>
  n == null || n === "" ? "—" : "Rp " + Number(n).toLocaleString("id-ID");

const StatCard = ({ value, label, color }) => (
  <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
    <div style={{ fontSize: 20, fontWeight: 700, color: color || cs.accent, lineHeight: 1.2 }}>{value}</div>
    <div style={{ fontSize: 11, color: cs.muted, marginTop: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
  </div>
);

const Badge = ({ children, color, bg, border }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", padding: "4px 10px",
    borderRadius: 14, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    color, background: bg, border: "1px solid " + border,
  }}>{children}</span>
);

// invoice.status dari DB: "PAID", "UNPAID", "OVERDUE", "PENDING_APV", "INVOICE_APPROVED", dll
const invStatusBadge = (status) => {
  if (!status) return <span style={{ color: cs.muted }}>—</span>;
  const s = status.toUpperCase();
  if (s === "PAID") return <Badge color={cs.green} bg={cs.green + "18"} border={cs.green + "44"}>✓ PAID</Badge>;
  if (s === "UNPAID") return <Badge color={cs.yellow} bg={cs.yellow + "18"} border={cs.yellow + "44"}>UNPAID</Badge>;
  if (s === "OVERDUE") return <Badge color={cs.red} bg={cs.red + "18"} border={cs.red + "44"}>OVERDUE</Badge>;
  if (s.includes("PENDING")) return <Badge color={cs.ara} bg={cs.ara + "18"} border={cs.ara + "44"}>PENDING APV</Badge>;
  return <Badge color={cs.muted} bg="transparent" border={cs.border}>{status}</Badge>;
};

// order.status dari DB: "INVOICE_APPROVED", "CONFIRMED", "COMPLETED", "REPORT_SUBMITTED", dll
const orderStatusBadge = (status) => {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === "INVOICE_APPROVED") return <Badge color={cs.accent} bg={cs.accent + "18"} border={cs.accent + "44"}>Invoice Dikirim</Badge>;
  if (s === "CONFIRMED") return <Badge color={cs.green} bg={cs.green + "18"} border={cs.green + "44"}>Dikonfirmasi</Badge>;
  if (s === "COMPLETED" || s === "LUNAS") return <Badge color={cs.green} bg={cs.green + "18"} border={cs.green + "44"}>Lunas</Badge>;
  if (s === "REPORT_SUBMITTED") return <Badge color={cs.ara} bg={cs.ara + "18"} border={cs.ara + "44"}>Laporan Masuk</Badge>;
  if (s.includes("PENDING")) return <Badge color={cs.ara} bg={cs.ara + "18"} border={cs.ara + "44"}>Pending APV</Badge>;
  return <Badge color={cs.muted} bg="transparent" border={cs.border}>{status}</Badge>;
};

// ─── Dashboard Tab ───────────────────────────────────────────────
const DashboardTab = ({ ordersData, invoicesData, allInvoices, currentDate, onPrevDay, onNextDay, onToday, setPaymentProofModal, currentUser }) => {
  // mutasiChecked: { [job_id]: { checked: bool, id: uuid, checked_by, checked_at } }
  const [mutasiChecked, setMutasiChecked] = useState({});
  const [mutasiLoading, setMutasiLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);

  // Load semua checklist dari DB (tidak filter tanggal — semua permanent)
  const loadMutasi = useCallback(async () => {
    setMutasiLoading(true);
    const { data } = await supabase
      .from("mutasi_checklist")
      .select("id, job_id, invoice_id, checked, checked_by, checked_at, notes");
    if (data) {
      const map = {};
      data.forEach(r => { map[r.job_id] = r; });
      setMutasiChecked(map);
    }
    setMutasiLoading(false);
  }, []);

  useEffect(() => { loadMutasi(); }, [loadMutasi]);

  const toggleMutasi = async (jobId, invoiceId) => {
    const current = mutasiChecked[jobId];
    const newChecked = current ? !current.checked : true;
    setSavingId(jobId);

    if (current?.id) {
      // Update existing
      await supabase.from("mutasi_checklist").update({
        checked: newChecked,
        checked_by: currentUser?.name || "Finance",
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", current.id);
    } else {
      // Insert baru
      await supabase.from("mutasi_checklist").insert({
        job_id: jobId,
        invoice_id: invoiceId || null,
        checked: newChecked,
        checked_by: currentUser?.name || "Finance",
      });
    }
    // Optimistic update + reload
    setMutasiChecked(prev => ({
      ...prev,
      [jobId]: { ...prev[jobId], checked: newChecked, checked_by: currentUser?.name },
    }));
    setSavingId(null);
    loadMutasi();
  };

  // Match order → invoice via job_id (order.id === invoice.job_id)
  const rows = useMemo(() => {
    return (ordersData || []).map(order => {
      const inv = (invoicesData || []).find(i => i.job_id === order.id);
      return { order, inv };
    });
  }, [ordersData, invoicesData]);

  const paidInvs = (invoicesData || []).filter(i => i.status === "PAID");
  const totalPemasukan = paidInvs.reduce((s, i) => s + (i.total || 0), 0);
  const belumLunas = (invoicesData || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length;
  const pendingAPV = (invoicesData || []).filter(i => (i.status || "").toUpperCase().includes("PENDING")).length;
  // Belum mutasi: PAID tapi belum dicek atau checked=false
  const belumMutasi = rows.filter(r => r.inv?.status === "PAID" && !mutasiChecked[r.order?.id]?.checked).length;

  return (
    <div>
      {/* Date Navigator */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={onPrevDay} style={{ width: 32, height: 32, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 14 }}>◀</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>📅 {currentDate}</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
            {rows.length} order · {paidInvs.length} lunas · {belumLunas} belum lunas
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onToday} style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "66", color: cs.accent, padding: "7px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 12 }}>Hari Ini</button>
          <button onClick={onNextDay} style={{ width: 32, height: 32, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 14 }}>▶</button>
        </div>
      </div>

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard value={rows.length} label="Total Order" color={cs.accent} />
        <StatCard value={fmtRp(totalPemasukan)} label="Total Pemasukan" color={cs.green} />
        <StatCard value={belumLunas} label="Belum Lunas" color={cs.yellow} />
        <StatCard value={pendingAPV} label="Pending APV" color={cs.ara} />
        <StatCard value={mutasiLoading ? "⟳" : belumMutasi} label="Belum Cek Mutasi" color={cs.red} />
      </div>

      {/* Tabel */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1.1fr 1fr 1fr 1fr 1fr 0.65fr", gap: 8, padding: "10px 16px", borderBottom: "1px solid " + cs.border, fontSize: 10, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          <div>Detail Job</div><div>Team</div><div>Status</div>
          <div>Invoice Value</div><div>Invoice Status</div><div>Bukti Bayar</div>
          <div style={{ textAlign: "center" }}>Cek Mutasi {mutasiLoading ? "⟳" : "✓"}</div>
        </div>

        {rows.length === 0 && (
          <div style={{ padding: "40px 16px", textAlign: "center", color: cs.muted, fontSize: 13 }}>
            Tidak ada order pada tanggal ini
          </div>
        )}

        {rows.map(({ order, inv }) => {
          const isPaid = inv?.status === "PAID";
          const hasProof = !!inv?.payment_proof_url;
          const isComplain = (order.service || "").toLowerCase().includes("complain");
          return (
            <div key={order.id} style={{ display: "grid", gridTemplateColumns: "1.7fr 1.1fr 1fr 1fr 1fr 1fr 0.65fr", gap: 8, padding: "13px 16px", borderBottom: "1px solid " + cs.border + "80", alignItems: "center" }}>
              {/* Job */}
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: isComplain ? cs.red : cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {order.customer}
                </div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                  {order.service} · {order.units || 1} unit · {(order.time || "").slice(0, 5)}
                </div>
              </div>
              {/* Team */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: cs.accent, flexShrink: 0, display: "inline-block" }} />
                  {order.teknisi || "—"}
                </div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 3 }}>
                  {order.helper ? "🪙 " + order.helper : "— Tanpa Helper"}
                </div>
              </div>
              {/* Order Status */}
              <div>{orderStatusBadge(order.status)}</div>
              {/* Invoice Value */}
              <div style={{ fontWeight: 700, color: inv?.total ? cs.green : cs.muted, fontSize: 13 }}>
                {inv?.total ? fmtRp(inv.total) : "—"}
              </div>
              {/* Invoice Status */}
              <div>{invStatusBadge(inv?.status)}</div>
              {/* Bukti Bayar */}
              <div>
                {isPaid && hasProof ? (
                  <button
                    onClick={() => setPaymentProofModal({ url: inv.payment_proof_url, customer: order.customer })}
                    style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "66", color: cs.accent, padding: "5px 10px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                    📎 Lihat
                  </button>
                ) : isPaid ? (
                  <span style={{ fontSize: 11, color: cs.muted }}>📎 Belum upload</span>
                ) : (
                  <span style={{ fontSize: 11, color: cs.border }}>—</span>
                )}
              </div>
              {/* Cek Mutasi — semua row bisa dicek, permanent di DB */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                {savingId === order.id ? (
                  <div style={{ width: 28, height: 28, borderRadius: 7, border: "2px solid " + cs.accent, background: cs.surface, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: cs.accent }}>⟳</div>
                ) : (
                  <button
                    onClick={() => toggleMutasi(order.id, inv?.id)}
                    title={mutasiChecked[order.id]?.checked
                      ? "Dicek oleh " + (mutasiChecked[order.id]?.checked_by || "?") + " · klik untuk batal"
                      : "Klik untuk tandai sudah cek mutasi"}
                    style={{
                      width: 28, height: 28, borderRadius: 7,
                      border: "2px solid " + (mutasiChecked[order.id]?.checked ? cs.green : cs.border),
                      background: mutasiChecked[order.id]?.checked ? cs.green : cs.surface,
                      color: mutasiChecked[order.id]?.checked ? "#fff" : cs.muted,
                      cursor: "pointer", fontWeight: 700, fontSize: 15,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.15s",
                    }}>
                    {mutasiChecked[order.id]?.checked ? "✓" : "○"}
                  </button>
                )}
                {mutasiChecked[order.id]?.checked && mutasiChecked[order.id]?.checked_by && (
                  <div style={{ fontSize: 9, color: cs.green, textAlign: "center", maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {mutasiChecked[order.id].checked_by}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Biaya Tab ───────────────────────────────────────────────────
const BiayaTab = ({ expensesData }) => {
  const [search, setSearch] = useState("");
  const [kategori, setKategori] = useState("Semua");

  const KATEGORI_COLOR = {
    "Gaji": { color: cs.green, bg: cs.green + "18", border: cs.green + "44", icon: "💼" },
    "Material": { color: cs.ara, bg: cs.ara + "18", border: cs.ara + "44", icon: "📦" },
    "Transport": { color: cs.yellow, bg: cs.yellow + "18", border: cs.yellow + "44", icon: "⛽" },
    "Operasional": { color: cs.accent, bg: cs.accent + "18", border: cs.accent + "44", icon: "🏢" },
  };

  const rows = useMemo(() => {
    let data = expensesData || [];
    if (kategori !== "Semua") data = data.filter(e => (e.category || e.kategori || "") === kategori);
    if (search) data = data.filter(e => JSON.stringify(e).toLowerCase().includes(search.toLowerCase()));
    return data;
  }, [expensesData, kategori, search]);

  const total = rows.reduce((s, e) => s + (e.amount || 0), 0);
  const totalBulan = (expensesData || []).reduce((s, e) => s + (e.amount || 0), 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard value={fmtRp(totalBulan)} label="Total Biaya" color={cs.red} />
        <StatCard value={(expensesData || []).length} label="Jumlah Transaksi" color={cs.yellow} />
        <StatCard value={fmtRp((expensesData || []).length > 0 ? Math.round(totalBulan / (expensesData || []).length) : 0)} label="Rata-rata / Transaksi" color={cs.accent} />
        <StatCard value={rows.length + " item"} label="Ditampilkan" color={cs.ara} />
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Cari keterangan..."
          style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.text, padding: "9px 12px", borderRadius: 8, fontSize: 13 }} />
        <select
          value={kategori} onChange={e => setKategori(e.target.value)}
          style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, padding: "9px 12px", borderRadius: 8, fontSize: 13 }}>
          <option>Semua</option>
          <option>Gaji</option>
          <option>Operasional</option>
          <option>Material</option>
          <option>Transport</option>
        </select>
      </div>

      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 2fr 1fr 1fr", gap: 10, padding: "10px 16px", borderBottom: "1px solid " + cs.border, fontSize: 10, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          <div>Tanggal</div><div>Kategori</div><div>Keterangan</div><div>Nominal</div><div>Dicatat Oleh</div>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: "40px 16px", textAlign: "center", color: cs.muted, fontSize: 13 }}>Tidak ada data biaya</div>
        )}
        {rows.map((e, i) => {
          const kat = e.category || e.kategori || "Operasional";
          const cfg = KATEGORI_COLOR[kat] || KATEGORI_COLOR["Operasional"];
          const rawDate = e.date || e.expense_date || e.created_at;
          const tgl = rawDate ? new Date(rawDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
          return (
            <div key={e.id || i} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 2fr 1fr 1fr", gap: 10, padding: "12px 16px", borderBottom: "1px solid " + cs.border + "80", alignItems: "center", fontSize: 13 }}>
              <div style={{ color: cs.muted, fontSize: 12 }}>{tgl}</div>
              <div><Badge color={cfg.color} bg={cfg.bg} border={cfg.border}>{cfg.icon} {kat}</Badge></div>
              <div style={{ color: cs.text }}>{e.description || e.notes || "—"}</div>
              <div style={{ fontWeight: 700, color: cs.red }}>{fmtRp(e.amount)}</div>
              <div style={{ color: cs.muted, fontSize: 12 }}>{e.created_by || "—"}</div>
            </div>
          );
        })}
        {rows.length > 0 && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid " + cs.border, display: "flex", justifyContent: "flex-end", gap: 12, fontSize: 13 }}>
            <span style={{ color: cs.muted }}>Total tampil:</span>
            <span style={{ fontWeight: 700, color: cs.red }}>{fmtRp(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Statistik Tab ────────────────────────────────────────────────
const StatistikTab = ({ invoicesData, expensesData }) => {
  const totalIn = (invoicesData || []).filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
  const totalOut = (expensesData || []).reduce((s, e) => s + (e.amount || 0), 0);
  const netProfit = totalIn - totalOut;
  const margin = totalIn > 0 ? ((netProfit / totalIn) * 100).toFixed(1) : 0;

  const cashflowIn = (invoicesData || []).filter(i => i.status === "PAID").slice(0, 4).map(i => ({
    type: "in", title: i.customer || "Pelanggan", sub: i.service || "Service", amount: i.total || 0,
  }));
  const cashflowOut = (expensesData || []).slice(0, 3).map(e => ({
    type: "out", title: e.description || e.notes || "Pengeluaran", sub: e.category || "Operasional", amount: e.amount || 0,
  }));
  const cashflowItems = [...cashflowIn, ...cashflowOut].slice(0, 8);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard value={fmtRp(totalIn)} label="Total Pemasukan" color={cs.green} />
        <StatCard value={fmtRp(totalOut)} label="Total Pengeluaran" color={cs.red} />
        <StatCard value={fmtRp(netProfit)} label="Net Profit" color={netProfit >= 0 ? cs.green : cs.red} />
        <StatCard value={margin + "%"} label="Profit Margin" color={cs.ara} />
      </div>

      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📈 Pemasukan vs Pengeluaran (ilustrasi tren)</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150, paddingBottom: 30 }}>
          {[
            { label: "Jan", in: 0.55, out: 0.25 },
            { label: "Feb", in: 0.62, out: 0.28 },
            { label: "Mar", in: 0.70, out: 0.30 },
            { label: "Apr", in: 0.78, out: 0.33 },
            { label: "Mei", in: Math.min(1, totalIn / Math.max(totalIn, 1)), out: Math.min(0.8, totalOut / Math.max(totalIn, 1)) },
          ].map(m => (
            <div key={m.label} style={{ flex: 1, display: "flex", gap: 3, alignItems: "flex-end", position: "relative" }}>
              <div style={{ flex: 1, height: (m.in * 120) + "px", background: "linear-gradient(180deg," + cs.green + "," + cs.green + "55)", borderRadius: "4px 4px 0 0", minHeight: 4 }} />
              <div style={{ flex: 1, height: (m.out * 120) + "px", background: "linear-gradient(180deg," + cs.red + "," + cs.red + "55)", borderRadius: "4px 4px 0 0", minHeight: 4 }} />
              <div style={{ position: "absolute", bottom: -22, left: 0, right: 0, textAlign: "center", fontSize: 10, color: cs.muted }}>{m.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 18, justifyContent: "center", marginTop: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: cs.green, display: "inline-block" }} /> Pemasukan
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: cs.red, display: "inline-block" }} /> Pengeluaran
          </span>
        </div>
      </div>

      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💰 Aktivitas Cashflow Terkini</div>
        {cashflowItems.length === 0 && (
          <div style={{ color: cs.muted, fontSize: 13, textAlign: "center", padding: "24px 0" }}>Belum ada data</div>
        )}
        {cashflowItems.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < cashflowItems.length - 1 ? "1px solid " + cs.border + "80" : "none" }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, flexShrink: 0, background: item.type === "in" ? cs.green + "18" : cs.red + "18", color: item.type === "in" ? cs.green : cs.red }}>
              {item.type === "in" ? "+" : "−"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{item.sub}</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, color: item.type === "in" ? cs.green : cs.red, flexShrink: 0 }}>
              {item.type === "in" ? "+ " : "− "}{fmtRp(item.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Financial Planning Tab ──────────────────────────────────────
const PlanningTab = ({ invoicesData, expensesData }) => {
  const [targetBulan, setTargetBulan] = useState(100000000);

  const totalIn = (invoicesData || []).filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
  const totalOut = (expensesData || []).reduce((s, e) => s + (e.amount || 0), 0);
  const netProfit = totalIn - totalOut;
  const pct = targetBulan > 0 ? Math.min(100, (totalIn / targetBulan) * 100) : 0;
  const unpaidCount = (invoicesData || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length;

  const budgets = [
    { label: "💼 Gaji Tim", used: totalOut * 0.55, budget: targetBulan * 0.20 },
    { label: "📦 Material", used: totalOut * 0.23, budget: targetBulan * 0.08 },
    { label: "⛽ Transport", used: totalOut * 0.14, budget: targetBulan * 0.05 },
    { label: "🏢 Operasional", used: totalOut * 0.08, budget: targetBulan * 0.03 },
  ];

  return (
    <div>
      {/* Target Progress */}
      <div style={{ background: "linear-gradient(135deg," + cs.accent + "12," + cs.ara + "08)", border: "1px solid " + cs.accent + "33", borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Target Pemasukan Bulan Ini (klik untuk edit)</div>
            <input
              type="number"
              value={targetBulan}
              onChange={e => setTargetBulan(Number(e.target.value))}
              style={{ background: "transparent", border: "none", color: cs.accent, fontSize: 20, fontWeight: 700, width: 220, outline: "none" }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Tercapai</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: cs.green }}>{fmtRp(totalIn)}</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{pct.toFixed(1)}% dari target</div>
          </div>
        </div>
        <div style={{ height: 8, background: cs.surface, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: pct + "%", background: "linear-gradient(90deg," + cs.green + ",#16a34a)", borderRadius: 4, transition: "width 0.5s" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Ringkasan */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📊 Ringkasan Keuangan</div>
          {[
            { label: "Total Pemasukan (PAID)", value: fmtRp(totalIn), color: cs.green },
            { label: "Total Pengeluaran", value: fmtRp(totalOut), color: cs.red },
            { label: "Net Profit", value: fmtRp(netProfit), color: netProfit >= 0 ? cs.green : cs.red },
            { label: "Profit Margin", value: totalIn > 0 ? ((netProfit / totalIn) * 100).toFixed(1) + "%" : "—", color: cs.accent },
            { label: "Invoice Belum Lunas", value: unpaidCount + " invoice", color: cs.yellow },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid " + cs.border + "80" }}>
              <span style={{ fontSize: 12, color: cs.muted }}>{r.label}</span>
              <span style={{ fontWeight: 700, color: r.color, fontSize: 13 }}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* Budget per Kategori */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>🎯 Budget per Kategori (estimasi)</div>
          {budgets.map(b => {
            const bPct = b.budget > 0 ? Math.min(110, (b.used / b.budget) * 100) : 0;
            const isOver = b.used > b.budget;
            return (
              <div key={b.label} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span>{b.label}</span>
                  <span style={{ color: isOver ? cs.red : cs.muted }}>{fmtRp(Math.round(b.used))} / {fmtRp(Math.round(b.budget))}</span>
                </div>
                <div style={{ height: 7, background: cs.surface, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: Math.min(100, bPct) + "%", background: isOver ? "linear-gradient(90deg," + cs.red + ",#b91c1c)" : "linear-gradient(90deg," + cs.green + ",#16a34a)", borderRadius: 4 }} />
                </div>
                {isOver && <div style={{ fontSize: 10, color: cs.red, marginTop: 3 }}>⚠️ Over {fmtRp(Math.round(b.used - b.budget))}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Rekomendasi */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💡 Rekomendasi Finance</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: cs.green + "0d", border: "1px solid " + cs.green + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.green, fontSize: 13, marginBottom: 4 }}>✓ Target {pct >= 100 ? "Tercapai!" : "On Track"}</div>
            <div style={{ fontSize: 12, color: cs.muted }}>{pct.toFixed(1)}% dari target bulanan. {pct >= 100 ? "Luar biasa!" : "Pertahankan performa."}</div>
          </div>
          <div style={{ background: cs.accent + "0d", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.accent, fontSize: 13, marginBottom: 4 }}>💰 Sisihkan Saving</div>
            <div style={{ fontSize: 12, color: cs.muted }}>20% dari net profit = {fmtRp(Math.max(0, Math.round(netProfit * 0.2)))} untuk dana darurat.</div>
          </div>
          <div style={{ background: cs.yellow + "0d", border: "1px solid " + cs.yellow + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.yellow, fontSize: 13, marginBottom: 4 }}>⚠️ Piutang Beredar</div>
            <div style={{ fontSize: 12, color: cs.muted }}>{unpaidCount} invoice masih UNPAID/OVERDUE. Lakukan follow-up segera.</div>
          </div>
          <div style={{ background: cs.ara + "0d", border: "1px solid " + cs.ara + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.ara, fontSize: 13, marginBottom: 4 }}>📋 Cek Mutasi Rutin</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Verifikasi semua invoice PAID di rekening setiap hari kerja.</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Modal Bukti Bayar ───────────────────────────────────────────
const ProofModal = ({ modal, onClose }) => {
  if (!modal) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 16, padding: 24, maxWidth: 500, width: "90%", maxHeight: "85vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>📎 Bukti Pembayaran</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 14 }}>{modal.customer}</div>
        {modal.url ? (
          <img src={modal.url} alt="Bukti bayar" style={{ width: "100%", borderRadius: 8, objectFit: "contain", maxHeight: 500 }} />
        ) : (
          <div style={{ textAlign: "center", color: cs.muted, padding: "40px 0" }}>Belum ada bukti yang diupload</div>
        )}
      </div>
    </div>
  );
};

// ─── Main FinanceView ─────────────────────────────────────────────
export default function FinanceView({ currentUser, ordersData, invoicesData, expensesData }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [paymentProofModal, setPaymentProofModal] = useState(null);
  const [dateOffset, setDateOffset] = useState(0);

  const currentDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }, [dateOffset]);

  const todayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    return d.toISOString().slice(0, 10);
  }, [dateOffset]);

  // Filter orders berdasarkan tanggal dipilih
  const filteredOrders = useMemo(() =>
    (ordersData || []).filter(o => (o.date || "").startsWith(todayStr)),
    [ordersData, todayStr]);

  // Invoice hari ini: match via invoice.job_id === order.id
  const filteredInvoices = useMemo(() => {
    const orderIds = new Set(filteredOrders.map(o => o.id));
    return (invoicesData || []).filter(i => orderIds.has(i.job_id));
  }, [invoicesData, filteredOrders]);

  return (
    <div style={{ color: cs.text, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 2, marginBottom: 18, borderBottom: "1px solid " + cs.border }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "10px 18px", cursor: "pointer", fontWeight: 600, fontSize: 13,
              background: "transparent", border: "none",
              borderBottom: "2px solid " + (activeTab === t.id ? cs.accent : "transparent"),
              color: activeTab === t.id ? cs.accent : cs.muted,
              marginBottom: -1, transition: "color 0.15s",
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === "dashboard" && (
        <DashboardTab
          ordersData={filteredOrders}
          invoicesData={filteredInvoices}
          allInvoices={invoicesData}
          currentDate={currentDate}
          onPrevDay={() => setDateOffset(d => d - 1)}
          onNextDay={() => setDateOffset(d => d + 1)}
          onToday={() => setDateOffset(0)}
          setPaymentProofModal={setPaymentProofModal}
          currentUser={currentUser}
        />
      )}
      {activeTab === "biaya" && <BiayaTab expensesData={expensesData} />}
      {activeTab === "statistik" && <StatistikTab invoicesData={invoicesData} expensesData={expensesData} />}
      {activeTab === "planning" && <PlanningTab invoicesData={invoicesData} expensesData={expensesData} />}

      <ProofModal modal={paymentProofModal} onClose={() => setPaymentProofModal(null)} />
    </div>
  );
}
