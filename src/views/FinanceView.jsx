import { useState, useMemo } from "react";
import { cs } from "../theme/cs.js";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "biaya", label: "Biaya Operasional", icon: "💸" },
  { id: "statistik", label: "Statistik", icon: "📈" },
  { id: "planning", label: "Financial Planning", icon: "🎯" },
];

const fmt = (n) =>
  n == null ? "—" : "Rp " + Number(n).toLocaleString("id-ID");

const StatCard = ({ value, label, color }) => (
  <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: color || cs.accent, lineHeight: 1.2 }}>{value}</div>
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

const invoiceStatusBadge = (status) => {
  if (!status) return <Badge color={cs.muted} bg="transparent" border={cs.border}>—</Badge>;
  const s = (status || "").toUpperCase();
  if (s === "PAID") return <Badge color={cs.green} bg={cs.green + "18"} border={cs.green + "44"}>✓ PAID</Badge>;
  if (s === "UNPAID") return <Badge color={cs.yellow} bg={cs.yellow + "18"} border={cs.yellow + "44"}>UNPAID</Badge>;
  return <Badge color={cs.ara} bg={cs.ara + "18"} border={cs.ara + "44"}>{status}</Badge>;
};

const orderStatusBadge = (status) => {
  if (!status) return null;
  const map = {
    "Dikonfirmasi": { color: cs.green, bg: cs.green + "18", border: cs.green + "44" },
    "Invoice Dikirim": { color: cs.accent, bg: cs.accent + "18", border: cs.accent + "44" },
    "Lunas": { color: cs.green, bg: cs.green + "18", border: cs.green + "44" },
    "Laporan Masuk": { color: cs.ara, bg: cs.ara + "18", border: cs.ara + "44" },
    "Pending APV": { color: cs.ara, bg: cs.ara + "18", border: cs.ara + "44" },
  };
  const cfg = map[status] || { color: cs.muted, bg: "transparent", border: cs.border };
  return <Badge color={cfg.color} bg={cfg.bg} border={cfg.border}>{status}</Badge>;
};

// ─── Dashboard Tab ───────────────────────────────────────────────
const DashboardTab = ({ ordersData, invoicesData, currentDate, onPrevDay, onNextDay, onToday, fmt: fmtFn, setPaymentProofModal }) => {
  const [mutasiChecked, setMutasiChecked] = useState({});

  const toggleMutasi = (id) =>
    setMutasiChecked(prev => ({ ...prev, [id]: !prev[id] }));

  // Gabungkan order + invoice info
  const rows = useMemo(() => {
    return (ordersData || []).map(order => {
      const inv = (invoicesData || []).find(i => i.order_id === order.id || i.job_id === order.job_id);
      return { order, inv };
    });
  }, [ordersData, invoicesData]);

  const totalPemasukan = useMemo(() =>
    (invoicesData || []).filter(i => (i.payment_status || "").toUpperCase() === "PAID").reduce((s, i) => s + (i.total || 0), 0),
    [invoicesData]);
  const belumLunas = (invoicesData || []).filter(i => (i.payment_status || "").toUpperCase() === "UNPAID").length;
  const pendingAPV = (invoicesData || []).filter(i => (i.status || "").toLowerCase().includes("pending")).length;
  const belumMutasi = rows.filter(r => r.inv && (r.inv.payment_status || "").toUpperCase() === "PAID" && !mutasiChecked[r.order?.id]).length;

  return (
    <div>
      {/* Date Navigator */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={onPrevDay} style={{ width: 32, height: 32, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 14 }}>◀</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>📅 {currentDate}</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
            {rows.length} order · {(invoicesData || []).filter(i => (i.payment_status || "").toUpperCase() === "PAID").length} lunas · {belumLunas} belum lunas
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
        <StatCard value={fmtFn(totalPemasukan)} label="Total Pemasukan" color={cs.green} />
        <StatCard value={belumLunas} label="Belum Lunas" color={cs.yellow} />
        <StatCard value={pendingAPV} label="Pending APV" color={cs.ara} />
        <StatCard value={belumMutasi} label="Belum Tercatat Mutasi" color={cs.red} />
      </div>

      {/* Tabel */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1.1fr 1fr 1fr 1fr 1fr 0.65fr", gap: 8, padding: "10px 16px", borderBottom: "1px solid " + cs.border, fontSize: 10, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          <div>Detail Job</div>
          <div>Team</div>
          <div>Status</div>
          <div>Invoice Value</div>
          <div>Invoice Status</div>
          <div>Bukti Bayar</div>
          <div style={{ textAlign: "center" }}>Cek Mutasi</div>
        </div>

        {rows.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center", color: cs.muted, fontSize: 13 }}>
            Tidak ada order pada tanggal ini
          </div>
        )}

        {rows.map(({ order, inv }) => {
          const isPaid = (inv?.payment_status || "").toUpperCase() === "PAID";
          const hasProof = !!(inv?.payment_proof_url || inv?.bukti_bayar_url);
          const isComplain = (order.service || "").toLowerCase().includes("complain");
          return (
            <div key={order.id} style={{ display: "grid", gridTemplateColumns: "1.7fr 1.1fr 1fr 1fr 1fr 1fr 0.65fr", gap: 8, padding: "13px 16px", borderBottom: "1px solid " + cs.border + "80", alignItems: "center" }}>
              {/* Job */}
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: isComplain ? cs.red : cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {order.customer_name || order.customer}
                </div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                  {order.service} · {order.units || 1} unit · {(order.time || order.scheduled_time || "").slice(0, 5)}
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
              {/* Status */}
              <div>{orderStatusBadge(order.status)}</div>
              {/* Invoice Value */}
              <div style={{ fontWeight: 700, color: cs.green, fontSize: 13 }}>
                {inv?.total ? fmtFn(inv.total) : <span style={{ color: cs.muted }}>—</span>}
              </div>
              {/* Invoice Status */}
              <div>{invoiceStatusBadge(inv?.payment_status)}</div>
              {/* Bukti Bayar */}
              <div>
                {isPaid && hasProof ? (
                  <button
                    onClick={() => setPaymentProofModal({ url: inv.payment_proof_url || inv.bukti_bayar_url, customer: order.customer_name || order.customer })}
                    style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "66", color: cs.accent, padding: "5px 10px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    📎 Lihat
                  </button>
                ) : isPaid ? (
                  <span style={{ fontSize: 11, color: cs.muted }}>📎 Belum upload</span>
                ) : (
                  <span style={{ fontSize: 11, color: cs.border }}>—</span>
                )}
              </div>
              {/* Cek Mutasi */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button
                  onClick={() => toggleMutasi(order.id)}
                  style={{
                    width: 28, height: 28, borderRadius: 7,
                    border: mutasiChecked[order.id] ? "2px solid " + cs.green : "2px solid " + cs.border,
                    background: mutasiChecked[order.id] ? cs.green : cs.surface,
                    color: mutasiChecked[order.id] ? "#fff" : "transparent",
                    cursor: "pointer", fontWeight: 700, fontSize: 16,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}>
                  {mutasiChecked[order.id] ? "✓" : ""}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Biaya Tab ───────────────────────────────────────────────────
const BiayaTab = ({ expensesData, fmt: fmtFn }) => {
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

  const total = rows.reduce((s, e) => s + (e.amount || e.nominal || 0), 0);
  const totalBulan = (expensesData || []).reduce((s, e) => s + (e.amount || e.nominal || 0), 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard value={fmtFn(totalBulan)} label="Total Biaya Bulan Ini" color={cs.red} />
        <StatCard value={(expensesData || []).length} label="Transaksi" color={cs.yellow} />
        <StatCard value={fmtFn((expensesData || []).length > 0 ? Math.round(totalBulan / (expensesData || []).length) : 0)} label="Rata-rata / Transaksi" color={cs.accent} />
        <StatCard value={rows.length + " item"} label="Filter Aktif" color={cs.ara} />
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Cari biaya..."
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 2fr 1fr 1fr", gap: 10, padding: "10px 16px", borderBottom: "1px solid " + cs.border, fontSize: 10, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          <div>Tanggal</div><div>Kategori</div><div>Keterangan</div><div>Nominal</div><div>Dicatat Oleh</div>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center", color: cs.muted, fontSize: 13 }}>Tidak ada data biaya</div>
        )}
        {rows.map((e, i) => {
          const kat = e.category || e.kategori || "Operasional";
          const cfg = KATEGORI_COLOR[kat] || KATEGORI_COLOR["Operasional"];
          const tgl = e.date || e.tanggal ? new Date(e.date || e.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
          return (
            <div key={e.id || i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 2fr 1fr 1fr", gap: 10, padding: "12px 16px", borderBottom: "1px solid " + cs.border + "80", alignItems: "center", fontSize: 13 }}>
              <div style={{ color: cs.muted, fontSize: 12 }}>{tgl}</div>
              <div><Badge color={cfg.color} bg={cfg.bg} border={cfg.border}>{cfg.icon} {kat}</Badge></div>
              <div style={{ color: cs.text }}>{e.description || e.keterangan || "—"}</div>
              <div style={{ fontWeight: 700, color: cs.red }}>{fmtFn(e.amount || e.nominal)}</div>
              <div style={{ color: cs.muted, fontSize: 12 }}>{e.created_by || e.dicatat_oleh || "Finance"}</div>
            </div>
          );
        })}
        {rows.length > 0 && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid " + cs.border, display: "flex", justifyContent: "flex-end", gap: 12, fontSize: 13 }}>
            <span style={{ color: cs.muted }}>Total tampil:</span>
            <span style={{ fontWeight: 700, color: cs.red }}>{fmtFn(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Statistik Tab ────────────────────────────────────────────────
const StatistikTab = ({ invoicesData, expensesData, fmt: fmtFn }) => {
  const totalIn = (invoicesData || []).filter(i => (i.payment_status || "").toUpperCase() === "PAID").reduce((s, i) => s + (i.total || 0), 0);
  const totalOut = (expensesData || []).reduce((s, e) => s + (e.amount || e.nominal || 0), 0);
  const netProfit = totalIn - totalOut;
  const margin = totalIn > 0 ? ((netProfit / totalIn) * 100).toFixed(1) : 0;

  const cashflowItems = [
    ...(invoicesData || []).filter(i => (i.payment_status || "").toUpperCase() === "PAID").slice(0, 4).map(i => ({
      type: "in", title: i.customer_name || i.customer || "Pelanggan", sub: i.service || "Service", amount: i.total || 0,
    })),
    ...(expensesData || []).slice(0, 3).map(e => ({
      type: "out", title: e.description || e.keterangan || "Pengeluaran", sub: e.category || e.kategori || "Operasional", amount: e.amount || e.nominal || 0,
    })),
  ].slice(0, 6);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        <StatCard value={fmtFn(totalIn)} label="Total Pemasukan" color={cs.green} />
        <StatCard value={fmtFn(totalOut)} label="Total Pengeluaran" color={cs.red} />
        <StatCard value={fmtFn(netProfit)} label="Net Profit" color={netProfit >= 0 ? cs.green : cs.red} />
        <StatCard value={margin + "%"} label="Profit Margin" color={cs.ara} />
      </div>

      {/* Bar chart placeholder */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📈 Pemasukan vs Pengeluaran</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 160, padding: "0 8px 32px" }}>
          {[
            { label: "Jan", in: 0.55, out: 0.25 },
            { label: "Feb", in: 0.62, out: 0.28 },
            { label: "Mar", in: 0.70, out: 0.30 },
            { label: "Apr", in: 0.78, out: 0.33 },
            { label: "Mei", in: 0.90, out: 0.38 },
          ].map(m => (
            <div key={m.label} style={{ flex: 1, display: "flex", gap: 3, alignItems: "flex-end", position: "relative" }}>
              <div style={{ flex: 1, height: (m.in * 128) + "px", background: "linear-gradient(180deg," + cs.green + "," + cs.green + "66)", borderRadius: "4px 4px 0 0" }} />
              <div style={{ flex: 1, height: (m.out * 128) + "px", background: "linear-gradient(180deg," + cs.red + "," + cs.red + "66)", borderRadius: "4px 4px 0 0" }} />
              <div style={{ position: "absolute", bottom: -22, left: 0, right: 0, textAlign: "center", fontSize: 10, color: cs.muted }}>{m.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 18, justifyContent: "center", marginTop: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: cs.green, display: "inline-block" }} /> Pemasukan
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: cs.red, display: "inline-block" }} /> Pengeluaran
          </span>
        </div>
      </div>

      {/* Cashflow hari ini */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💰 Aktivitas Cashflow Terkini</div>
        {cashflowItems.length === 0 && (
          <div style={{ color: cs.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Belum ada data cashflow</div>
        )}
        {cashflowItems.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: i < cashflowItems.length - 1 ? "1px solid " + cs.border + "80" : "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, flexShrink: 0, background: item.type === "in" ? cs.green + "18" : cs.red + "18", color: item.type === "in" ? cs.green : cs.red }}>
              {item.type === "in" ? "+" : "−"}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{item.title}</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{item.sub}</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, color: item.type === "in" ? cs.green : cs.red }}>
              {item.type === "in" ? "+ " : "− "}{fmtFn(item.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Financial Planning Tab ──────────────────────────────────────
const PlanningTab = ({ invoicesData, expensesData, fmt: fmtFn }) => {
  const [targetBulan, setTargetBulan] = useState(100000000);

  const totalIn = (invoicesData || []).filter(i => (i.payment_status || "").toUpperCase() === "PAID").reduce((s, i) => s + (i.total || 0), 0);
  const totalOut = (expensesData || []).reduce((s, e) => s + (e.amount || e.nominal || 0), 0);
  const netProfit = totalIn - totalOut;
  const pct = targetBulan > 0 ? Math.min(100, (totalIn / targetBulan) * 100) : 0;

  const budgets = [
    { label: "💼 Gaji Tim", used: totalOut * 0.55, budget: targetBulan * 0.20 },
    { label: "📦 Material", used: totalOut * 0.23, budget: targetBulan * 0.08 },
    { label: "⛽ Transport", used: totalOut * 0.14, budget: targetBulan * 0.05 },
    { label: "🏢 Operasional", used: totalOut * 0.08, budget: targetBulan * 0.03 },
  ];

  return (
    <div>
      {/* Target card */}
      <div style={{ background: "linear-gradient(135deg," + cs.accent + "12," + cs.ara + "08)", border: "1px solid " + cs.accent + "33", borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Target Pemasukan Bulan Ini</div>
            <input
              type="number"
              value={targetBulan}
              onChange={e => setTargetBulan(Number(e.target.value))}
              style={{ background: "transparent", border: "none", color: cs.accent, fontSize: 22, fontWeight: 700, width: 200, outline: "none" }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Tercapai</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: cs.green }}>{fmtFn(totalIn)}</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{pct.toFixed(1)}% dari target</div>
          </div>
        </div>
        <div style={{ height: 8, background: cs.surface, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: pct + "%", background: "linear-gradient(90deg," + cs.green + ",#16a34a)", borderRadius: 4, transition: "width 0.5s" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Proyeksi */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📊 Ringkasan Keuangan</div>
          {[
            { label: "Total Pemasukan", value: fmtFn(totalIn), color: cs.green },
            { label: "Total Pengeluaran", value: fmtFn(totalOut), color: cs.red },
            { label: "Net Profit", value: fmtFn(netProfit), color: netProfit >= 0 ? cs.green : cs.red },
            { label: "Margin", value: totalIn > 0 ? ((netProfit / totalIn) * 100).toFixed(1) + "%" : "—", color: cs.accent },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid " + cs.border + "80" }}>
              <span style={{ fontSize: 13, color: cs.muted }}>{r.label}</span>
              <span style={{ fontWeight: 700, color: r.color }}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* Budget per kategori */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>🎯 Budget per Kategori</div>
          {budgets.map(b => {
            const bPct = b.budget > 0 ? Math.min(110, (b.used / b.budget) * 100) : 0;
            const isOver = b.used > b.budget;
            return (
              <div key={b.label} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span>{b.label}</span>
                  <span style={{ color: cs.muted }}>{fmtFn(Math.round(b.used))} / {fmtFn(Math.round(b.budget))}</span>
                </div>
                <div style={{ height: 8, background: cs.surface, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: Math.min(100, bPct) + "%", background: isOver ? "linear-gradient(90deg," + cs.red + ",#b91c1c)" : "linear-gradient(90deg," + cs.green + ",#16a34a)", borderRadius: 4 }} />
                </div>
                {isOver && <div style={{ fontSize: 10, color: cs.red, marginTop: 3 }}>⚠️ Over budget {fmtFn(Math.round(b.used - b.budget))}</div>}
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
            <div style={{ fontWeight: 700, color: cs.green, fontSize: 13, marginBottom: 4 }}>✓ Target {pct >= 100 ? "Tercapai" : "On Track"}</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Pemasukan saat ini {pct.toFixed(1)}% dari target bulanan. {pct >= 100 ? "Target bulan ini sudah tercapai!" : "Pertahankan performa saat ini."}</div>
          </div>
          <div style={{ background: cs.accent + "0d", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.accent, fontSize: 13, marginBottom: 4 }}>💰 Sisihkan Saving</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Rekomendasikan menyisihkan 20% dari net profit ({fmtFn(Math.round(netProfit * 0.2))}) untuk dana darurat & investasi alat.</div>
          </div>
          <div style={{ background: cs.yellow + "0d", border: "1px solid " + cs.yellow + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.yellow, fontSize: 13, marginBottom: 4 }}>⚠️ Piutang Beredar</div>
            <div style={{ fontSize: 12, color: cs.muted }}>
              {(invoicesData || []).filter(i => (i.payment_status || "").toUpperCase() === "UNPAID").length} invoice masih UNPAID. Lakukan follow-up pembayaran segera.
            </div>
          </div>
          <div style={{ background: cs.ara + "0d", border: "1px solid " + cs.ara + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.ara, fontSize: 13, marginBottom: 4 }}>📋 Cek Mutasi Rutin</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Pastikan semua invoice PAID sudah terverifikasi di rekening. Cek mutasi setiap hari kerja.</div>
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
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 16, padding: 24, maxWidth: 480, width: "90%", maxHeight: "80vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>📎 Bukti Pembayaran</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: cs.muted, fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: cs.muted, marginBottom: 12 }}>{modal.customer}</div>
        {modal.url ? (
          <img src={modal.url} alt="Bukti bayar" style={{ width: "100%", borderRadius: 8, objectFit: "contain" }} />
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

  // Date navigation
  const [dateOffset, setDateOffset] = useState(0);
  const currentDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }, [dateOffset]);

  // Filter orders by selected date
  const todayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    return d.toISOString().slice(0, 10);
  }, [dateOffset]);

  const filteredOrders = useMemo(() =>
    (ordersData || []).filter(o => (o.date || o.scheduled_date || "").startsWith(todayStr)),
    [ordersData, todayStr]);

  // Filter invoices untuk hari yang dipilih
  const filteredInvoices = useMemo(() => {
    const orderIds = new Set(filteredOrders.map(o => o.id));
    const jobIds = new Set(filteredOrders.map(o => o.job_id).filter(Boolean));
    return (invoicesData || []).filter(i => orderIds.has(i.order_id) || jobIds.has(i.job_id));
  }, [invoicesData, filteredOrders]);

  return (
    <div style={{ color: cs.text, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid " + cs.border }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "10px 18px", cursor: "pointer", fontWeight: 600, fontSize: 13, background: "transparent",
              border: "none", borderBottom: "2px solid " + (activeTab === t.id ? cs.accent : "transparent"),
              color: activeTab === t.id ? cs.accent : cs.muted, marginBottom: -1, transition: "all 0.15s",
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "dashboard" && (
        <DashboardTab
          ordersData={filteredOrders}
          invoicesData={filteredInvoices}
          currentDate={currentDate}
          onPrevDay={() => setDateOffset(d => d - 1)}
          onNextDay={() => setDateOffset(d => d + 1)}
          onToday={() => setDateOffset(0)}
          fmt={fmt}
          setPaymentProofModal={setPaymentProofModal}
        />
      )}
      {activeTab === "biaya" && <BiayaTab expensesData={expensesData} fmt={fmt} />}
      {activeTab === "statistik" && <StatistikTab invoicesData={invoicesData} expensesData={expensesData} fmt={fmt} />}
      {activeTab === "planning" && <PlanningTab invoicesData={invoicesData} expensesData={expensesData} fmt={fmt} />}

      <ProofModal modal={paymentProofModal} onClose={() => setPaymentProofModal(null)} />
    </div>
  );
}
