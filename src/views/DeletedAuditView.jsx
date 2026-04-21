import { memo, useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPA_URL, SUPA_KEY);

const PAGE_SIZE = 25;

const HIGH_RISK_ACTIONS = [
  "ADMIN_EDIT_GRATIS_APPROVED",
  "INVOICE_DELETED",
  "REPAIR_GRATIS_REJECTED",
  "INVOICE_EDITED",
];

function fmtRupiah(v) {
  if (v == null) return "-";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return "Rp " + n.toLocaleString("id-ID");
}

function fmtDate(str) {
  if (!str) return "-";
  return new Date(str).toLocaleString("id-ID", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// Parse "Customer: Nama | ..." format dari detail string
function parseCustomerFromDetail(detail) {
  if (!detail) return null;
  const m = detail.match(/Customer:\s*([^|]+)/i);
  return m ? m[1].trim() : null;
}

// Parse invoice ID dari detail string
function parseInvoiceFromDetail(detail) {
  if (!detail) return null;
  const m = detail.match(/Invoice\s+(INV-[^\s|]+)/i);
  return m ? m[1].trim() : null;
}

// Parse alasan dari detail string
function parseAlasanFromDetail(detail) {
  if (!detail) return null;
  const m = detail.match(/Alasan:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

function SnapshotModal({ row, onClose }) {
  if (!row) return null;
  const data = row.before_data || row.after_data || {};
  const C = cs;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.bg, border: "1px solid " + C.border, borderRadius: 14,
        maxWidth: 680, width: "100%", maxHeight: "88vh", overflow: "auto", padding: 22,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.red }}>🗑 Snapshot Data Sebelum Dihapus</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              Invoice ID: {row.row_id} · Dihapus: {fmtDate(row.changed_at)} · Oleh: {row.changed_by || "-"}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid " + C.border, color: C.text,
            padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13,
          }}>Tutup</button>
        </div>

        <div style={{ background: C.surface, borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.red, marginBottom: 10 }}>Data Invoice (sebelum dihapus)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            {[
              ["No. Invoice", data.invoice_number || data.id],
              ["Pelanggan", data.customer || data.customer_name],
              ["Total", fmtRupiah(data.total)],
              ["Status", data.status],
              ["Tipe Repair", data.repair_type],
              ["Teknisi", data.teknisi_name || data.technician_name],
              ["Dibuat", fmtDate(data.created_at)],
              ["Catatan", data.notes],
            ].map(([label, val]) => (
              <div key={label} style={{ borderBottom: "1px solid " + C.border, paddingBottom: 6 }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{val ?? <span style={{ color: C.muted }}>∅</span>}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>Raw Data Lengkap</div>
        <pre style={{
          background: C.surface, border: "1px solid " + C.border, borderRadius: 8,
          padding: 14, fontSize: 10, color: C.muted, overflow: "auto", maxHeight: 300,
          fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function GratisDetailModal({ log, onClose }) {
  if (!log) return null;
  const C = cs;
  const customer = parseCustomerFromDetail(log.detail);
  const invoiceId = parseInvoiceFromDetail(log.detail);
  const alasan = parseAlasanFromDetail(log.detail);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.bg, border: "1px solid " + C.border, borderRadius: 14,
        maxWidth: 520, width: "100%", padding: 22,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.yellow }}>⚠ Detail Aksi High-Risk</div>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid " + C.border, color: C.text,
            padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13,
          }}>Tutup</button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {[
            ["Waktu", fmtDate(log.created_at)],
            ["Admin / User", log.user_name || "-"],
            ["Action", log.action],
            ["Invoice ID", invoiceId || "-"],
            ["Pelanggan", customer || "-"],
            ["Alasan", alasan || "-"],
            ["Status Log", log.status],
            ["Detail Lengkap", log.detail],
          ].map(([label, val]) => (
            <div key={label} style={{
              background: C.surface, borderRadius: 8, padding: "10px 14px",
              display: "grid", gridTemplateColumns: "130px 1fr", gap: 8, alignItems: "start",
            }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 12, color: label === "Alasan" ? C.yellow : C.text, wordBreak: "break-word" }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const selectStyle = {
  background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
  color: cs.text, padding: "5px 10px", fontSize: 12, cursor: "pointer",
};

function DeletedAuditView() {
  const [tab, setTab] = useState("deleted"); // "deleted" | "gratis" | "highrisk"
  const [deletedRows, setDeletedRows] = useState([]);
  const [highRiskLogs, setHighRiskLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [dateFilter, setDateFilter] = useState("Semua");
  const [userFilter, setUserFilter] = useState("Semua");
  const [actionFilter, setActionFilter] = useState("Semua");
  const [customerSearch, setCustomerSearch] = useState("");
  const [page, setPage] = useState(1);

  const [snapshotRow, setSnapshotRow] = useState(null);
  const [detailLog, setDetailLog] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [deletedRes, highRiskRes] = await Promise.all([
        supabase
          .from("audit_log")
          .select("*")
          .eq("table_name", "invoices")
          .eq("action", "DELETE")
          .order("changed_at", { ascending: false })
          .limit(500),
        supabase
          .from("agent_logs")
          .select("*")
          .in("action", HIGH_RISK_ACTIONS)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (deletedRes.error) throw new Error("audit_log: " + deletedRes.error.message);
      if (highRiskRes.error) throw new Error("agent_logs: " + highRiskRes.error.message);
      setDeletedRows(deletedRes.data || []);
      setHighRiskLogs(highRiskRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const getDateStr = (row) => (row.changed_at || row.created_at || "").slice(0, 10);
  const getUserStr = (row) => row.changed_by || row.user_name || "system";
  const getCustomerStr = (row) => {
    if (row.before_data) return row.before_data.customer || row.before_data.customer_name || "";
    return parseCustomerFromDetail(row.detail) || "";
  };

  const activeRows = tab === "deleted" ? deletedRows
    : tab === "gratis" ? highRiskLogs.filter(l => l.action === "ADMIN_EDIT_GRATIS_APPROVED")
    : highRiskLogs;

  const allDates = [...new Set(activeRows.map(getDateStr).filter(Boolean))].sort().reverse();
  const allUsers = [...new Set(activeRows.map(getUserStr).filter(Boolean))].sort();
  const allActions = tab === "highrisk"
    ? [...new Set(highRiskLogs.map(l => l.action).filter(Boolean))].sort()
    : [];

  const filtered = activeRows.filter(row => {
    const d = dateFilter === "Semua" || getDateStr(row) === dateFilter;
    const u = userFilter === "Semua" || getUserStr(row) === userFilter;
    const a = actionFilter === "Semua" || row.action === actionFilter;
    const c = !customerSearch || getCustomerStr(row).toLowerCase().includes(customerSearch.toLowerCase());
    return d && u && a && c;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const resetFilters = () => {
    setDateFilter("Semua"); setUserFilter("Semua");
    setActionFilter("Semua"); setCustomerSearch(""); setPage(1);
  };
  const changeTab = (t) => { setTab(t); resetFilters(); };

  const hasFilter = dateFilter !== "Semua" || userFilter !== "Semua" || actionFilter !== "Semua" || customerSearch;

  const C = cs;

  const tabStyle = (t) => ({
    padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
    border: "1px solid " + (tab === t ? C.accent : C.border),
    background: tab === t ? C.accent + "22" : C.surface,
    color: tab === t ? C.accent : C.muted,
  });

  const deletedCount = deletedRows.length;
  const gratisCount = highRiskLogs.filter(l => l.action === "ADMIN_EDIT_GRATIS_APPROVED").length;
  const highRiskCount = highRiskLogs.length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {snapshotRow && <SnapshotModal row={snapshotRow} onClose={() => setSnapshotRow(null)} />}
      {detailLog && <GratisDetailModal log={detailLog} onClose={() => setDetailLog(null)} />}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: C.text }}>🗑 Deleted & High-Risk Audit</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Semua invoice yang dihapus dan aksi berisiko tersimpan di sini sebagai bukti permanen.
          </div>
        </div>
        <button onClick={loadData} disabled={loading} style={{
          padding: "8px 16px", borderRadius: 8, border: "1px solid " + C.border,
          background: C.card, color: loading ? C.muted : C.text, cursor: loading ? "not-allowed" : "pointer",
          fontSize: 12, fontWeight: 600,
        }}>
          {loading ? "Memuat..." : "⟳ Refresh"}
        </button>
      </div>

      {/* Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {[
          { label: "Invoice Dihapus", value: deletedCount, color: C.red, icon: "🗑" },
          { label: "Edit Gratis (WARNING)", value: gratisCount, color: C.yellow, icon: "⚠" },
          { label: "Total High-Risk Actions", value: highRiskCount, color: C.accent, icon: "🔴" },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={{
            background: C.card, border: "1px solid " + color + "44", borderRadius: 12,
            padding: "14px 18px",
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color }}>{icon} {value}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={tabStyle("deleted")} onClick={() => changeTab("deleted")}>
          🗑 Invoice Dihapus ({deletedCount})
        </button>
        <button style={tabStyle("gratis")} onClick={() => changeTab("gratis")}>
          ⚠ Edit Gratis ({gratisCount})
        </button>
        <button style={tabStyle("highrisk")} onClick={() => changeTab("highrisk")}>
          🔴 Semua High-Risk ({highRiskCount})
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Tanggal:</span>
          <select value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1); }} style={selectStyle}>
            <option value="Semua">Semua</option>
            {allDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>User:</span>
          <select value={userFilter} onChange={e => { setUserFilter(e.target.value); setPage(1); }} style={selectStyle}>
            <option value="Semua">Semua</option>
            {allUsers.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {tab === "highrisk" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Action:</span>
            <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1); }} style={selectStyle}>
              <option value="Semua">Semua</option>
              {allActions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Customer:</span>
          <input
            value={customerSearch}
            onChange={e => { setCustomerSearch(e.target.value); setPage(1); }}
            placeholder="Cari nama..."
            style={{ ...selectStyle, padding: "5px 10px", width: 140, outline: "none" }}
          />
        </div>
        {hasFilter && (
          <button onClick={resetFilters} style={{
            padding: "5px 12px", borderRadius: 8, border: "1px solid " + C.border,
            background: C.surface, color: C.muted, cursor: "pointer", fontSize: 11,
          }}>Reset Filter</button>
        )}
        <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>
          {filtered.length} entri ditemukan
        </span>
      </div>

      {error && (
        <div style={{ background: C.red + "15", border: "1px solid " + C.red + "44", borderRadius: 10, padding: "12px 16px", color: C.red, fontSize: 12 }}>
          Error: {error}
        </div>
      )}

      {/* Table */}
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 14, overflow: "hidden", overflowX: "auto" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>Memuat data audit...</div>
        ) : pageRows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
            Tidak ada data untuk filter ini.
          </div>
        ) : tab === "deleted" ? (
          <DeletedTable rows={pageRows} onViewSnapshot={setSnapshotRow} C={C} />
        ) : (
          <HighRiskTable rows={pageRows} onViewDetail={setDetailLog} isGratis={tab === "gratis"} C={C} />
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0" }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={curPage === 1}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + C.border, background: curPage === 1 ? C.surface : C.card, color: curPage === 1 ? C.muted : C.text, cursor: curPage === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>← Prev</button>
          <span style={{ fontSize: 12, color: C.text }}>Hal {curPage}/{totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={curPage === totalPages}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + C.border, background: curPage === totalPages ? C.surface : C.card, color: curPage === totalPages ? C.muted : C.text, cursor: curPage === totalPages ? "not-allowed" : "pointer", fontSize: 12 }}>Next →</button>
          <span style={{ fontSize: 11, color: C.muted }}>{filtered.length} total</span>
        </div>
      )}

      <div style={{ fontSize: 10, color: C.muted, textAlign: "center", paddingBottom: 8 }}>
        Data dari <code>audit_log</code> (DELETE trigger) + <code>agent_logs</code> (high-risk actions) · Tidak dapat dihapus oleh admin
      </div>
    </div>
  );
}

function DeletedTable({ rows, onViewSnapshot, C }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: C.surface }}>
          {["Waktu Hapus", "Invoice ID", "Pelanggan", "Total", "Teknisi", "Status Lama", "Dihapus Oleh", "Bukti"].map(h => (
            <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: C.muted, fontWeight: 600, fontSize: 11, borderBottom: "1px solid " + C.border, whiteSpace: "nowrap" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const d = row.before_data || {};
          return (
            <tr key={row.id} style={{ borderBottom: "1px solid " + C.border, background: i % 2 === 0 ? "transparent" : C.surface + "44" }}>
              <td style={{ padding: "10px 14px", color: C.muted, whiteSpace: "nowrap" }}>{fmtDate(row.changed_at)}</td>
              <td style={{ padding: "10px 14px", fontFamily: "monospace", color: C.accent, fontSize: 11, whiteSpace: "nowrap" }}>{d.invoice_number || row.row_id}</td>
              <td style={{ padding: "10px 14px", color: C.text, fontWeight: 600 }}>{d.customer || d.customer_name || <span style={{ color: C.muted }}>-</span>}</td>
              <td style={{ padding: "10px 14px", color: C.green, fontWeight: 700, whiteSpace: "nowrap" }}>{fmtRupiah(d.total)}</td>
              <td style={{ padding: "10px 14px", color: C.text }}>{d.teknisi_name || d.technician_name || "-"}</td>
              <td style={{ padding: "10px 14px" }}>
                <span style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  background: C.yellow + "22", color: C.yellow, border: "1px solid " + C.yellow + "44",
                  fontFamily: "monospace", fontWeight: 700,
                }}>{d.status || "-"}</span>
              </td>
              <td style={{ padding: "10px 14px", color: C.red, fontWeight: 600 }}>{row.changed_by || "system"}</td>
              <td style={{ padding: "10px 14px" }}>
                <button onClick={() => onViewSnapshot(row)} style={{
                  padding: "4px 12px", borderRadius: 6, border: "1px solid " + C.red + "66",
                  background: C.red + "15", color: C.red, cursor: "pointer", fontSize: 11, fontWeight: 600,
                }}>Lihat Data</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HighRiskTable({ rows, onViewDetail, isGratis, C }) {
  const actionColor = (action) => {
    if (action === "INVOICE_DELETED") return C.red;
    if (action === "ADMIN_EDIT_GRATIS_APPROVED") return C.yellow;
    if (action === "REPAIR_GRATIS_REJECTED") return C.muted;
    return C.accent;
  };

  const headers = isGratis
    ? ["Waktu", "Invoice ID", "Pelanggan", "Alasan", "Admin", "Status", ""]
    : ["Waktu", "Action", "Invoice ID", "Pelanggan", "Admin", "Status", ""];

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: C.surface }}>
          {headers.map(h => (
            <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: C.muted, fontWeight: 600, fontSize: 11, borderBottom: "1px solid " + C.border, whiteSpace: "nowrap" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const aC = actionColor(row.action);
          const statusC = row.status === "ERROR" ? C.red : row.status === "WARNING" ? C.yellow : C.green;
          const customer = parseCustomerFromDetail(row.detail);
          const invoiceId = parseInvoiceFromDetail(row.detail);
          const alasan = parseAlasanFromDetail(row.detail);
          return (
            <tr key={row.id || i} style={{ borderBottom: "1px solid " + C.border, background: i % 2 === 0 ? "transparent" : C.surface + "44" }}>
              <td style={{ padding: "10px 14px", color: C.muted, whiteSpace: "nowrap", fontSize: 11 }}>{fmtDate(row.created_at)}</td>
              {!isGratis && (
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    fontSize: 10, padding: "2px 8px", borderRadius: 4,
                    background: aC + "22", color: aC, border: "1px solid " + aC + "44",
                    fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap",
                  }}>{row.action}</span>
                </td>
              )}
              <td style={{ padding: "10px 14px", fontFamily: "monospace", color: C.accent, fontSize: 11, whiteSpace: "nowrap" }}>
                {invoiceId || "-"}
              </td>
              <td style={{ padding: "10px 14px", color: C.text, fontWeight: 600 }}>
                {customer || <span style={{ color: C.muted }}>-</span>}
              </td>
              {isGratis ? (
                <td style={{ padding: "10px 14px", color: C.yellow, maxWidth: 220 }}>
                  <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {alasan || <span style={{ color: C.muted }}>-</span>}
                  </span>
                </td>
              ) : null}
              <td style={{ padding: "10px 14px", color: C.text }}>{row.user_name || "-"}</td>
              <td style={{ padding: "10px 14px" }}>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: statusC + "22", color: statusC, border: "1px solid " + statusC + "44",
                  fontFamily: "monospace", fontWeight: 700,
                }}>{row.status}</span>
              </td>
              <td style={{ padding: "10px 14px" }}>
                <button onClick={() => onViewDetail(row)} style={{
                  padding: "4px 12px", borderRadius: 6, border: "1px solid " + aC + "66",
                  background: aC + "15", color: aC, cursor: "pointer", fontSize: 11, fontWeight: 600,
                  whiteSpace: "nowrap",
                }}>Detail</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default memo(DeletedAuditView);
