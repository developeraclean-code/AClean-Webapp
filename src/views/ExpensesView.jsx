import { memo, useState, useMemo, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { useAppContext } from "../context/AppContext.js";
import { fetchAllExpenses, fetchDeletedExpenses, fetchExpenseBudgets, fetchExpenseWorkspace } from "../data/reads.js";
import { restoreExpense, purgeExpense } from "../data/writes.js";
import { useDebounce } from "../lib/useDebounce.js";
import ExpenseFormModal, { BudgetModal } from "./ExpenseFormModal.jsx";
import TautkanStokModal from "./TautkanStokModal.jsx";
import { downloadCsv, printDocument, htmlTable, rp, fmtTanggal, escapeHtml } from "../lib/exportUtils.js";

// ── Kasbon Section (Owner/Admin) — approve request → otomatis masuk ke Biaya ──
function KasbonSection({ currentUser, kasbonRequests, approveKasbon, rejectKasbon }) {
  const [kasbonFilter, setKasbonFilter] = useState("PENDING");
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState("");
  if (currentUser?.role !== "Owner" && currentUser?.role !== "Admin") return null;
  const allKasbon = kasbonRequests || [];
  const pendingCount = allKasbon.filter(r => r.status === "PENDING").length;
  const shown = allKasbon.filter(r => kasbonFilter === "Semua" || r.status === kasbonFilter);
  const fmtRp2 = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  const fmtTgl2 = (d) => { try { return new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d || "—"; } };
  const statusStyle = { PENDING: [cs.yellow, "⏳ Pending"], APPROVED: [cs.green, "✅ Disetujui"], REJECTED: [cs.red, "❌ Ditolak"] };
  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 16, padding: 18, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>
            💰 Kasbon Requests
            {pendingCount > 0 && <span style={{ marginLeft: 8, fontSize: 12, background: cs.yellow + "22", color: cs.yellow, border: "1px solid " + cs.yellow + "44", borderRadius: 99, padding: "2px 9px", fontWeight: 700 }}>{pendingCount} Pending</span>}
          </div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Approve → otomatis masuk ke Biaya (Kasbon Karyawan)</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {["PENDING", "APPROVED", "REJECTED", "Semua"].map(f => (
          <button key={f} onClick={() => setKasbonFilter(f)}
            style={{ padding: "5px 13px", borderRadius: 99, fontSize: 12, fontWeight: kasbonFilter === f ? 700 : 400, cursor: "pointer", border: "1px solid " + (kasbonFilter === f ? cs.accent : cs.border), background: kasbonFilter === f ? cs.accent + "22" : cs.surface, color: kasbonFilter === f ? cs.accent : cs.muted }}>
            {f}
          </button>
        ))}
      </div>
      {shown.length === 0
        ? <div style={{ color: cs.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Tidak ada request {kasbonFilter.toLowerCase()}</div>
        : <div style={{ display: "grid", gap: 8 }}>
          {shown.map(r => {
            const [sc, sl] = statusStyle[r.status] || [cs.muted, r.status];
            const isReviewing = reviewingId === r.id;
            return (
              <div key={r.id} style={{ background: cs.surface, border: "1px solid " + (r.status === "PENDING" ? cs.yellow + "44" : cs.border), borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, color: cs.text, fontSize: 15 }}>{fmtRp2(r.amount)}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: sc, background: sc + "18", border: "1px solid " + sc + "44", padding: "1px 8px", borderRadius: 99 }}>{sl}</span>
                    </div>
                    <div style={{ fontSize: 13, color: cs.text, marginBottom: 3 }}><span style={{ color: cs.accent, fontWeight: 700 }}>{r.teknisi_name}</span> — {r.reason}</div>
                    <div style={{ fontSize: 11, color: cs.muted }}>{fmtTgl2(r.requested_at)}{r.reviewed_by ? ` · Direview oleh ${r.reviewed_by}` : ""}</div>
                    {r.review_notes && <div style={{ fontSize: 11, color: cs.muted, marginTop: 2, fontStyle: "italic" }}>Catatan: {r.review_notes}</div>}
                    {r.expense_id && <div style={{ fontSize: 10, color: cs.green, marginTop: 2 }}>→ Biaya: {r.expense_id}</div>}
                  </div>
                  {r.status === "PENDING" && !isReviewing && (
                    <button onClick={() => { setReviewingId(r.id); setReviewNotes(""); }}
                      style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                      Review
                    </button>
                  )}
                </div>
                {isReviewing && (
                  <div style={{ marginTop: 10, borderTop: "1px solid " + cs.border, paddingTop: 10, display: "grid", gap: 8 }}>
                    <input value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
                      placeholder="Catatan opsional untuk teknisi..."
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <button onClick={() => setReviewingId(null)} style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "8px", borderRadius: 7, cursor: "pointer", fontSize: 12 }}>Batal</button>
                      <button onClick={async () => { await rejectKasbon(r, reviewNotes); setReviewingId(null); }}
                        style={{ background: cs.red + "18", border: "1px solid " + cs.red + "44", color: cs.red, padding: "8px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>❌ Tolak</button>
                      <button onClick={async () => { await approveKasbon(r, reviewNotes); setReviewingId(null); }}
                        style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", border: "none", color: "#fff", padding: "8px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✅ Approve</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}

function ExpensesView({ expensesData, setExpensesData, expenseTab, setExpenseTab, expenseFilter, setExpenseFilter, expenseDateFrom, setExpenseDateFrom, expenseDateTo, setExpenseDateTo, expenseSearch, setExpenseSearch, expensePage, setExpensePage, modalExpense, setModalExpense, editExpenseItem, setEditExpenseItem, newExpenseForm, setNewExpenseForm, insertExpense, updateExpense, deleteExpense, setAuditModal, EXPENSE_PAGE_SIZE, appSettings, setAppSettings, teknisiData, userAccounts, kasbonRequests, approveKasbon, rejectKasbon, inventoryData = [], setInventoryData, addAgentLog, ordersData = [] }) {
  // Fase 1: primitif global dari AppContext.
  const { currentUser, supabase, auditUserName, TODAY, fmt, showNotif, showConfirm } = useAppContext();

  // Nota material → stok (Tahap 1 HPP). Manual by design: AI nota bisa salah baca dan
  // banyak barang langsung dipakai di job, bukan masuk gudang.
  const [linkExpense, setLinkExpense] = useState(null);
const isOwnerAdmin = currentUser?.role === "Owner" || currentUser?.role === "Admin" || currentUser?.role === "Finance";
const isOwner = currentUser?.role === "Owner";

const PETTY_CASH_SUBS = ["Bensin Motor", "Perbaikan Motor", "Parkir", "Kasbon Karyawan", "Lembur", "Bonus", "Lain-lain"];
const MATERIAL_SUBS = ["Pipa AC", "Kabel", "Freon", "Material Lain"];
const EXPENSE_AUDIT_FROM = "2026-10-04";
// Quick-filter chips (for petty_cash tab only) — semua subcategory
const QUICK_FILTERS = ["Semua", "Bensin Motor", "Perbaikan Motor", "Parkir", "Kasbon Karyawan", "Lembur", "Bonus", "Lain-lain"];

// Month quick-select: 5 bulan terakhir dinamis
const MONTH_QUICK = useMemo(() => {
  const now = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (4 - i), 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const label = d.toLocaleDateString("id-ID", { month: "short", year: "numeric" });
    return { label, from, to };
  });
}, []);

const debouncedExpenseSearch = useDebounce(expenseSearch, 300);
const [workspace, setWorkspace] = useState(null);
const [workspaceV2, setWorkspaceV2] = useState(false);
const [workspaceLoading, setWorkspaceLoading] = useState(false);
const [workspaceError, setWorkspaceError] = useState("");
const [workspaceRevision, setWorkspaceRevision] = useState(0);
const [expenseSort, setExpenseSort] = useState("date_desc");
const [showExpenseAuditNotices, setShowExpenseAuditNotices] = useState(false);
const [expenseAudit, setExpenseAudit] = useState({ type: null, loading: false, error: "", rows: [] });
const [approvingExpenseId, setApprovingExpenseId] = useState(null);

// ── Budget state ──
const [showBudgetPanel, setShowBudgetPanel] = useState(false);
const [budgetForm, setBudgetForm] = useState(null); // null | { category, subcategory, amount }
const [budgetSaving, setBudgetSaving] = useState(false);
const [monthlyBudgetRows, setMonthlyBudgetRows] = useState([]);
const [budgetV2, setBudgetV2] = useState(false);
const budgetKey = (cat, sub) => sub ? `${cat}::${sub}` : cat;

// Budget data dari app_settings.expense_budgets (JSON: { "petty_cash::Bensin Motor": 500000, ... })
const budgetMap = useMemo(() => {
  if (budgetV2) return Object.fromEntries(monthlyBudgetRows.map(row => [budgetKey(row.category, row.subcategory || null), Number(row.amount) || 0]));
  try { return JSON.parse(appSettings?.expense_budgets || "{}"); } catch { return {}; }
}, [appSettings?.expense_budgets, budgetV2, monthlyBudgetRows]);

// Hitung pengeluaran bulan ini per kategori & sub
const nowDate = new Date();
const thisMonthPrefix = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}`;
const budgetPeriodMonth = `${thisMonthPrefix}-01`;
useEffect(() => {
  let alive = true;
  fetchExpenseBudgets(supabase, budgetPeriodMonth).then(({ data, error }) => {
    if (!alive) return;
    if (!error) { setMonthlyBudgetRows(data || []); setBudgetV2(true); }
    else if (!/expense_budgets|schema cache/i.test(error.message || "")) showNotif?.("❌ Gagal memuat budget: " + error.message);
  });
  return () => { alive = false; };
}, [supabase, budgetPeriodMonth]);
const spendThisMonth = useMemo(() => {
  if (workspaceV2 && workspace?.budget_spend) {
    return Object.fromEntries(Object.entries(workspace.budget_spend).map(([key, value]) => [key, Number(value) || 0]));
  }
  const map = {};
  expensesData.forEach(e => {
    if (e.approval_status === "PENDING_APPROVAL") return;   // belum disetujui Owner → belum dihitung
    if (e.validation_status === "PENDING_AI") return;       // draft AI belum di-review → belum dihitung
    if (!(e.date || "").startsWith(thisMonthPrefix)) return;
    const catKey = budgetKey(e.category, null);
    map[catKey] = (map[catKey] || 0) + Number(e.amount || 0);
    if (e.subcategory) {
      const subKey = budgetKey(e.category, e.subcategory);
      map[subKey] = (map[subKey] || 0) + Number(e.amount || 0);
    }
  });
  return map;
}, [expensesData, thisMonthPrefix, workspaceV2, workspace]);

const saveBudget = async () => {
  if (!budgetForm) return;
  setBudgetSaving(true);
  const key = budgetKey(budgetForm.category, budgetForm.subcategory);
  const newMap = { ...budgetMap };
  const amt = Number(budgetForm.amount);
  if (budgetV2) {
    const subcategory = budgetForm.subcategory || "";
    const result = (!amt || amt <= 0)
      ? await supabase.from("expense_budgets").delete().eq("period_month", budgetPeriodMonth).eq("category", budgetForm.category).eq("subcategory", subcategory)
      : await supabase.from("expense_budgets").upsert({
          period_month: budgetPeriodMonth, category: budgetForm.category, subcategory,
          amount: amt, updated_by: currentUser?.id || null, updated_at: new Date().toISOString(),
        }, { onConflict: "period_month,category,subcategory" }).select().single();
    if (result.error) showNotif?.("❌ Gagal simpan budget: " + result.error.message);
    else {
      setMonthlyBudgetRows(prev => {
        const rest = prev.filter(r => !(r.category === budgetForm.category && (r.subcategory || "") === subcategory));
        return (!amt || amt <= 0) ? rest : [...rest, result.data];
      });
      showNotif?.("✅ Budget bulan ini disimpan");
      setBudgetForm(null);
    }
    setBudgetSaving(false);
    return;
  }
  if (!amt || amt <= 0) { delete newMap[key]; } else { newMap[key] = amt; }
  const newVal = JSON.stringify(newMap);
  const { error } = await supabase.from("app_settings")
    .upsert({ key: "expense_budgets", value: newVal }, { onConflict: "key" });
  if (error) { showNotif?.("❌ Gagal simpan budget: " + error.message); }
  else {
    setAppSettings?.(p => ({ ...p, expense_budgets: newVal }));
    showNotif?.("✅ Budget disimpan");
    setBudgetForm(null);
  }
  setBudgetSaving(false);
};

// Budget items to display: semua kategori + sub yang punya budget atau spending bulan ini
const ALL_BUDGET_ITEMS = [
  { label: "💰 Petty Cash (Total)", cat: "petty_cash", sub: null },
  ...PETTY_CASH_SUBS.map(s => ({ label: s, cat: "petty_cash", sub: s })),
  { label: "🔧 Material (Total)", cat: "material_purchase", sub: null },
  ...MATERIAL_SUBS.map(s => ({ label: s, cat: "material_purchase", sub: s })),
];

// Alert: kategori yang >80% budget
const budgetAlerts = ALL_BUDGET_ITEMS.filter(item => {
  const k = budgetKey(item.cat, item.sub);
  const b = budgetMap[k] || 0;
  const s = spendThisMonth[k] || 0;
  return b > 0 && s >= b * 0.8;
});

const isTrash = expenseTab === "deleted";
const isPendingAi = expenseTab === "pending_ai";

// Server-side filter + pagination setelah migration 168. Sebelum migration tersedia,
// fallback lama tetap dipakai sehingga localhost/production tidak blank saat rollout.
useEffect(() => {
  if (isTrash || isPendingAi || !supabase) return;
  let alive = true;
  const load = async () => {
    setWorkspaceLoading(true);
    setWorkspaceError("");
    try {
      const category = ["petty_cash", "material_purchase"].includes(expenseTab) ? expenseTab : null;
      const subcategory = expenseTab === "petty_cash" && expenseFilter !== "Semua" ? expenseFilter : null;
      const result = await fetchExpenseWorkspace(supabase, {
        dateFrom: expenseDateFrom, dateTo: expenseDateTo, category, subcategory,
        search: debouncedExpenseSearch, page: expensePage, pageSize: EXPENSE_PAGE_SIZE,
      });
      if (!alive) return;
      if (!result.error && result.data) {
        setWorkspace(result.data);
        setWorkspaceV2(true);
        setExpensesData(result.data.rows || []);
        return;
      }
      const unavailable = /get_expense_workspace|schema cache|could not find the function/i.test(result.error?.message || "");
      if (!unavailable) throw result.error;
      const fallback = await fetchAllExpenses(supabase);
      if (fallback.error) throw fallback.error;
      if (alive) {
        setExpensesData(fallback.data || []);
        setWorkspace(null);
        setWorkspaceV2(false);
      }
    } catch (error) {
      if (alive) setWorkspaceError(error?.message || "Gagal memuat biaya");
    } finally {
      if (alive) setWorkspaceLoading(false);
    }
  };
  load();
  return () => { alive = false; };
}, [isTrash, isPendingAi, supabase, expenseTab, expenseFilter, expenseDateFrom, expenseDateTo, debouncedExpenseSearch, expensePage, EXPENSE_PAGE_SIZE, workspaceRevision]);

// Pending AI items — diisi oleh AI vision classifier dari foto grup WA
const [pendingAi, setPendingAi] = useState([]);
const [loadingPendingAi, setLoadingPendingAi] = useState(false);
const [pendingAiBusy, setPendingAiBusy] = useState(null); // id yang sedang diproses
const loadPendingAi = async () => {
  if (!supabase) return;
  setLoadingPendingAi(true);
  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("*, ai_extractions:ai_extraction_id(*)")
      .eq("validation_status", "PENDING_AI")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    setPendingAi(data || []);
  } catch (e) {
    showNotif?.("Gagal load Pending AI: " + e.message, "error");
  } finally {
    setLoadingPendingAi(false);
  }
};
useEffect(() => { if (isPendingAi) loadPendingAi(); /* eslint-disable-line */ }, [isPendingAi]);

const handleApprovePendingAi = async (item) => {
  setPendingAiBusy(item.id);
  try {
    const { error: expenseError } = await supabase.from("expenses")
      .update({ validation_status: "APPROVED", last_changed_by: auditUserName() })
      .eq("id", item.id);
    if (expenseError) throw expenseError;
    if (item.ai_extraction_id) {
      const { error: aiError } = await supabase.from("ai_extractions").update({ status: "approved" }).eq("id", item.ai_extraction_id);
      if (aiError) throw new Error("Biaya sudah approved, tetapi sinkronisasi AI gagal: " + aiError.message);
    }
    showNotif?.("✓ Approved: " + (item.description || ""), "success");
    setPendingAi(prev => prev.filter(x => x.id !== item.id));
    // Sync expensesData biar item muncul di regular tab (Petty Cash / Material) tanpa reload
    setExpensesData(prev => {
      const exists = prev.some(x => x.id === item.id);
      if (exists) return prev.map(x => x.id === item.id ? { ...x, validation_status: "APPROVED" } : x);
      // Item belum ada di expensesData (insert dari backend setelah Owner buka tab) → tambah
      return [{ ...item, validation_status: "APPROVED" }, ...prev];
    });
    setWorkspaceRevision(v => v + 1);
  } catch (e) {
    showNotif?.("Gagal approve: " + e.message, "error");
  } finally { setPendingAiBusy(null); }
};
const handleRejectPendingAi = async (item) => {
  showConfirm?.({
    title: "Tolak entri ini?",
    message: "Entri AI akan ditolak dan dipindahkan ke recycle bin agar jejak audit tetap tersimpan. Yakin?",
    onConfirm: async () => {
      setPendingAiBusy(item.id);
      try {
        const { error: expenseError } = await supabase.from("expenses").update({
          validation_status: "REJECTED",
          deleted_at: new Date().toISOString(),
          deleted_by: auditUserName(),
          last_changed_by: auditUserName(),
        }).eq("id", item.id);
        if (expenseError) throw expenseError;
        if (item.ai_extraction_id) {
          const { error: aiError } = await supabase.from("ai_extractions").update({ status: "rejected" }).eq("id", item.ai_extraction_id);
          if (aiError) throw new Error("Biaya sudah ditolak, tetapi sinkronisasi AI gagal: " + aiError.message);
        }
        showNotif?.("✕ Rejected", "info");
        setPendingAi(prev => prev.filter(x => x.id !== item.id));
        setExpensesData(prev => prev.filter(x => x.id !== item.id));
        setWorkspaceRevision(v => v + 1);
      } catch (e) {
        showNotif?.("Gagal reject: " + e.message, "error");
      } finally { setPendingAiBusy(null); }
    }
  });
};

// Recycle bin state — di-load lazy saat tab "Dihapus" dibuka (Owner only)
const [deletedData, setDeletedData] = useState([]);
const [loadingDeleted, setLoadingDeleted] = useState(false);
useEffect(() => {
  if (expenseTab !== "deleted") return;
  let alive = true;
  setLoadingDeleted(true);
  fetchDeletedExpenses(supabase).then(({ data, error }) => {
    if (!alive) return;
    if (error) showNotif?.("❌ Gagal memuat recycle bin: " + error.message);
    else setDeletedData(data || []);
    setLoadingDeleted(false);
  }).catch((error) => {
    if (alive) { showNotif?.("❌ Gagal memuat recycle bin: " + error.message); setLoadingDeleted(false); }
  });
  return () => { alive = false; };
}, [expenseTab, supabase]);

// Apply filters — sumber data tergantung tab (trash = deletedData, else = expensesData)
const filtered = (isTrash ? deletedData : (workspaceV2 ? (workspace?.rows || []) : expensesData)).filter(e => {
  if (!isTrash) {
    // Sembunyikan entri PENDING_AI dari tab regular — hanya muncul di tab Pending AI
    if (e.validation_status === "PENDING_AI") return false;
    if (expenseTab === "petty_cash" && e.category !== "petty_cash") return false;
    if (expenseTab === "material_purchase" && e.category !== "material_purchase") return false;
    if (expenseTab === "petty_cash" && expenseFilter !== "Semua" && e.subcategory !== expenseFilter) return false;
  }
  if (expenseDateFrom && (e.date || "") < expenseDateFrom) return false;
  if (expenseDateTo && (e.date || "") > expenseDateTo) return false;
  if (expenseSearch) {
    const q = expenseSearch.toLowerCase();
    if (!(e.description || "").toLowerCase().includes(q) &&
      !(e.subcategory || "").toLowerCase().includes(q) &&
      !(e.teknisi_name || "").toLowerCase().includes(q) &&
      !(e.item_name || "").toLowerCase().includes(q)) return false;
  }
  return true;
});

const totalFilteredCount = workspaceV2 ? Number(workspace?.total_count || 0) : filtered.length;
const totalPage = Math.ceil(totalFilteredCount / EXPENSE_PAGE_SIZE) || 1;
const pageData = (workspaceV2 ? filtered : filtered.slice((expensePage - 1) * EXPENSE_PAGE_SIZE, expensePage * EXPENSE_PAGE_SIZE))
  .slice()
  .sort((a, b) => {
    if (expenseSort === "date_asc") return (a.date || "").localeCompare(b.date || "");
    if (expenseSort === "amount_desc") return Number(b.amount || 0) - Number(a.amount || 0);
    if (expenseSort === "amount_asc") return Number(a.amount || 0) - Number(b.amount || 0);
    if (expenseSort === "name_asc") return (a.subcategory || a.item_name || "").localeCompare(b.subcategory || b.item_name || "", "id");
    return (b.date || "").localeCompare(a.date || "");
  });
// Total tidak menghitung biaya PENDING_APPROVAL (belum disetujui Owner).
const grandTotal = workspaceV2 ? Number(workspace?.total_amount || 0) : filtered.reduce((s, e) => s + (e.approval_status === "PENDING_APPROVAL" ? 0 : Number(e.amount || 0)), 0);
const pendingApprovals = (expensesData || []).filter(e => e.approval_status === "PENDING_APPROVAL" && !e.deleted_at);
const pendingApprovalCount = workspaceV2 ? Number(workspace?.pending_approval_count || 0) : pendingApprovals.length;
const pendingApprovalSum = workspaceV2 ? Number(workspace?.pending_approval_amount || 0) : pendingApprovals.reduce((s, e) => s + Number(e.amount || 0), 0);

// ── Export rekap Biaya (CSV + PDF) — ikut data yang sedang tampil (filter/tab/tanggal) ──
const catLabel = (c) => c === "material_purchase" ? "Pembelian Material" : c === "petty_cash" ? "Petty Cash" : (c || "-");
const tabLabel = isTrash ? "Dihapus" : expenseTab === "material_purchase" ? "Pembelian Material" : expenseTab === "petty_cash" ? "Petty Cash" : "Semua";
const periodLabel = (expenseDateFrom && expenseDateTo)
  ? (expenseDateFrom === expenseDateTo ? fmtTanggal(expenseDateFrom) : `${fmtTanggal(expenseDateFrom)} – ${fmtTanggal(expenseDateTo)}`)
  : "Semua tanggal";
const fileTag = (expenseDateFrom && expenseDateTo)
  ? (expenseDateFrom === expenseDateTo ? expenseDateFrom : `${expenseDateFrom}_${expenseDateTo}`)
  : "semua";
const statusLabelExp = (e) => e.approval_status === "PENDING_APPROVAL" ? "Menunggu Approval" : "OK";

const loadRowsForExport = async () => {
  if (isTrash || !workspaceV2 || totalFilteredCount <= filtered.length) return filtered;
  const rows = [];
  const category = ["petty_cash", "material_purchase"].includes(expenseTab) ? expenseTab : null;
  const subcategory = expenseTab === "petty_cash" && expenseFilter !== "Semua" ? expenseFilter : null;
  const pages = Math.ceil(totalFilteredCount / 100);
  for (let page = 1; page <= pages; page++) {
    const { data, error } = await fetchExpenseWorkspace(supabase, {
      dateFrom: expenseDateFrom, dateTo: expenseDateTo, category, subcategory,
      search: debouncedExpenseSearch, page, pageSize: 100,
    });
    if (error) throw error;
    rows.push(...(data?.rows || []));
  }
  return rows;
};

const exportBiayaCsv = async () => {
  let exportRows;
  try { exportRows = await loadRowsForExport(); }
  catch (error) { showNotif?.("❌ Gagal menyiapkan export: " + error.message); return; }
  if (exportRows.length === 0) { showNotif?.("Tidak ada data untuk diekspor."); return; }
  const headers = ["Tanggal", "Kategori", "Subkategori", "Item", "Keterangan", "Teknisi", "Nominal", "Status", "Tertaut Stok", "Dibuat Oleh"];
  const rows = exportRows.map(e => [
    e.date || "", catLabel(e.category), e.subcategory || "", e.item_name || "",
    (e.description || "").replace(/\s+/g, " ").trim(), e.teknisi_name || "",
    Number(e.amount || 0), statusLabelExp(e), e.stock_linked_at ? "Ya" : "", e.created_by || "",
  ]);
  downloadCsv(headers, rows, `rekap-biaya_${fileTag}.csv`);
  showNotif?.("✅ CSV rekap biaya diunduh");
};

const exportBiayaPdf = async () => {
  let exportRows;
  try { exportRows = await loadRowsForExport(); }
  catch (error) { showNotif?.("❌ Gagal menyiapkan export: " + error.message); return; }
  if (exportRows.length === 0) { showNotif?.("Tidak ada data untuk diekspor."); return; }
  // Ringkasan per subkategori (kecualikan PENDING_APPROVAL agar sama dgn total di layar).
  const sumMap = {};
  exportRows.forEach(e => {
    if (e.approval_status === "PENDING_APPROVAL") return;
    const key = `${catLabel(e.category)}||${e.subcategory || "-"}`;
    if (!sumMap[key]) sumMap[key] = { cat: catLabel(e.category), sub: e.subcategory || "-", total: 0, count: 0 };
    sumMap[key].total += Number(e.amount || 0);
    sumMap[key].count++;
  });
  const sumRows = Object.values(sumMap).sort((a, b) => b.total - a.total)
    .map(s => [escapeHtml(s.cat), escapeHtml(s.sub), String(s.count), rp(s.total)]);
  const summaryTable = htmlTable(
    ["Kategori", "Subkategori", "Transaksi", "Total"], sumRows,
    { colClass: ["", "", "c", "r"], footer: ["", "TOTAL", String(exportRows.filter(e => e.approval_status !== "PENDING_APPROVAL").length), rp(grandTotal)] }
  );
  const detailRows = exportRows.map((e, i) => [
    String(i + 1), fmtTanggal(e.date), escapeHtml(catLabel(e.category)), escapeHtml(e.subcategory || "-"),
    escapeHtml([e.item_name, (e.description || "").replace(/\s+/g, " ").trim()].filter(Boolean).join(" — ") || "-"),
    escapeHtml(e.teknisi_name || "-"),
    e.approval_status === "PENDING_APPROVAL" ? `<span class="muted">${rp(e.amount)} (pending)</span>` : rp(e.amount),
  ]);
  const detailTable = htmlTable(
    ["#", "Tanggal", "Kategori", "Subkategori", "Keterangan", "Teknisi", "Nominal"], detailRows,
    { colClass: ["no", "", "", "", "", "", "r"] }
  );
  printDocument({
    title: "Rekap Biaya — AClean",
    subtitle: `${tabLabel} · ${periodLabel} · ${exportRows.length} transaksi · Dicetak ${fmtTanggal(new Date())}`,
    legend: `Total <b>${rp(grandTotal)}</b> (belum termasuk biaya berstatus <i>Menunggu Approval</i>).`,
    bodyHtml: `<h2 class="sec">Ringkasan per Kategori</h2>${summaryTable}<h2 class="sec">Rincian Transaksi</h2>${detailTable}`,
    signature: true,
    showNotif,
  });
  showNotif?.("🖨️ Menyiapkan PDF rekap biaya…");
};

// ── Navigasi per-hari (geser slide, seperti Dashboard) ──
const dayMode = !!expenseDateFrom && expenseDateFrom === expenseDateTo;
// Pakai jam 12 siang + komponen LOKAL (bukan toISOString/UTC) — kalau UTC, WIB (UTC+7)
// mundur 7 jam ke hari sebelumnya → tombol ▶ tampak "tak jalan" (mentok tanggal sama).
const shiftDay = (d, delta) => {
  const dt = new Date((d || TODAY) + "T12:00:00");
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const goDay = (d) => { setExpenseDateFrom(d); setExpenseDateTo(d); setExpensePage(1); };
const fmtDayLong = (d) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const resetForm = () => {
  setNewExpenseForm({
    category: expenseTab === "material_purchase" ? "material_purchase" : "petty_cash",
    subcategory: "", amount: "", date: TODAY, description: "", teknisi_name: "", item_name: "", freon_type: "", order_id: "", allocation_status: "UNRESOLVED"
  });
  setEditExpenseItem(null);
};

const openAdd = () => { resetForm(); setModalExpense(true); };
const openEdit = (item) => {
  setEditExpenseItem(item);
  setNewExpenseForm({
    category: item.category, subcategory: item.subcategory, amount: String(item.amount || ""),
    date: item.date || TODAY, description: item.description || "", teknisi_name: item.teknisi_name || "",
    item_name: item.item_name || "", freon_type: item.freon_type || "", order_id: item.order_id || "", allocation_status: item.allocation_status || "UNRESOLVED"
  });
  setModalExpense(true);
};

const markMaterialNonStock = async (item) => {
  const ok = showConfirm
    ? await showConfirm({ icon: "✅", title: "Tandai langsung dipakai?", message: "Nota tidak akan menambah stok dan dianggap sudah selesai dialokasikan.", confirmText: "Ya, Tandai" })
    : window.confirm("Tandai nota sebagai langsung dipakai / non-stok?");
  if (!ok) return;
  const { error } = await supabase.from("expenses").update({
    allocation_status: "NON_STOCK", allocation_notes: "Langsung dipakai / non-stok",
    last_changed_by: auditUserName(),
  }).eq("id", item.id);
  if (error) {
    const hint = /allocation_status|schema cache/i.test(error.message || "") ? " Jalankan migration 168 terlebih dahulu." : "";
    showNotif?.("❌ Gagal mengubah alokasi: " + error.message + hint);
    return;
  }
  setExpensesData(prev => prev.map(x => x.id === item.id ? { ...x, allocation_status: "NON_STOCK" } : x));
  setWorkspace(prev => prev ? { ...prev, rows: (prev.rows || []).map(x => x.id === item.id ? { ...x, allocation_status: "NON_STOCK" } : x), unresolved_material_count: Math.max(0, Number(prev.unresolved_material_count || 0) - 1) } : prev);
  showNotif?.("✅ Nota ditandai langsung dipakai / non-stok");
};

const handleDeleteExpense = async (item) => {
  const confirmed = showConfirm
    ? await showConfirm({ icon: "🗑️", title: "Hapus Biaya?", danger: true,
        message: `Hapus biaya "${item.subcategory}" ${fmt(item.amount)}?`, confirmText: "Ya, Hapus" })
    : window.confirm(`Hapus biaya "${item.subcategory}" Rp ${Number(item.amount).toLocaleString("id-ID")}?`);
  if (!confirmed) return;
  const { error } = await deleteExpense(supabase, item.id, auditUserName());
  if (error) { showNotif?.("❌ Gagal hapus biaya: " + error.message); return; }
  setExpensesData(prev => prev.filter(x => x.id !== item.id));
  setWorkspaceRevision(v => v + 1);
  showNotif?.(`🗑️ Biaya ${item.subcategory} dipindah ke Dihapus (bisa dipulihkan)`);
};

// ── Approval biaya Admin (≥500rb) — Owner/Finance ──
const bolehApprove = currentUser?.role === "Owner" || currentUser?.role === "Finance";
const approveExpense = async (item) => {
  if (approvingExpenseId === item.id) return;
  setApprovingExpenseId(item.id);
  try {
    // Compare-and-set: hanya transisi dari PENDING_APPROVAL. Klik ganda/request bersamaan
    // tidak dapat menyetujui ulang baris yang sama, apalagi membuat expense baru.
    const { data, error } = await supabase.from("expenses").update({
      approval_status: "APPROVED", approved_by: auditUserName(), approved_at: new Date().toISOString(),
      last_changed_by: auditUserName(),
    }).eq("id", item.id).eq("approval_status", "PENDING_APPROVAL").is("deleted_at", null)
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      setWorkspaceRevision(v => v + 1);
      showNotif?.("ℹ️ Biaya ini sudah diproses atau tidak lagi menunggu approval. Data dimuat ulang.");
      return;
    }
    setExpensesData(prev => prev.map(x => x.id === item.id ? { ...x, approval_status: "APPROVED", approved_by: auditUserName() } : x));
    setExpenseAudit(prev => prev.type === "pending" ? { ...prev, rows: prev.rows.filter(x => x.id !== item.id) } : prev);
    setWorkspaceRevision(v => v + 1);
    showNotif?.(`✅ Biaya ${item.subcategory} (${fmt(item.amount)}) disetujui — kini terhitung`);
  } catch (error) {
    showNotif?.("❌ Gagal setujui biaya: " + error.message);
  } finally {
    setApprovingExpenseId(null);
  }
};
const rejectExpense = async (item) => {
  const ok = showConfirm
    ? await showConfirm({ icon: "❌", title: "Tolak Biaya?", danger: true,
        message: `Tolak & hapus biaya "${item.subcategory}" ${fmt(item.amount)}? (masuk ke Dihapus)`, confirmText: "Ya, Tolak" })
    : window.confirm("Tolak biaya ini?");
  if (!ok) return;
  const { error } = await updateExpense(supabase, item.id, {
    approval_status: "REJECTED", deleted_at: new Date().toISOString(), deleted_by: auditUserName(),
  }, auditUserName());
  if (error) { showNotif?.("❌ Gagal tolak: " + error.message); return; }
  setExpensesData(prev => prev.filter(x => x.id !== item.id));
  setWorkspaceRevision(v => v + 1);
  showNotif?.(`❌ Biaya ${item.subcategory} ditolak`);
};

// ── Recycle bin: restore & purge (Owner only) ──
const handleRestoreExpense = async (item) => {
  const { data, error } = await restoreExpense(supabase, item.id, auditUserName());
  if (error) { showNotif?.("❌ Gagal pulihkan: " + error.message); return; }
  setDeletedData(prev => prev.filter(x => x.id !== item.id));
  setExpensesData(prev => [data || item, ...prev]);
  showNotif?.(`♻️ Biaya ${item.subcategory} dipulihkan`);
};

const handlePurgeExpense = async (item) => {
  const confirmed = showConfirm
    ? await showConfirm({ icon: "⚠️", title: "Hapus Permanen?", danger: true,
        message: `Hapus PERMANEN "${item.subcategory}" ${fmt(item.amount)}? Tindakan ini tidak bisa dibatalkan.`, confirmText: "Hapus Permanen" })
    : window.confirm(`Hapus PERMANEN "${item.subcategory}"? Tidak bisa di-undo.`);
  if (!confirmed) return;
  const { error } = await purgeExpense(supabase, item.id);
  if (error) { showNotif?.("❌ Gagal hapus permanen: " + error.message); return; }
  setDeletedData(prev => prev.filter(x => x.id !== item.id));
  showNotif?.(`🗑️ Biaya ${item.subcategory} dihapus permanen`);
};

const loadExpenseAuditIssue = async (type) => {
  setExpenseAudit({ type, loading: true, error: "", rows: [] });
  try {
    let rows = [];
    if (type === "pending") {
      const { data, error } = await supabase.from("expenses").select("*")
        .is("deleted_at", null).eq("approval_status", "PENDING_APPROVAL")
        .order("date", { ascending: false }).limit(200);
      if (error) throw error;
      rows = data || [];
    } else if (type === "duplicates") {
      let query = supabase.from("expenses")
        .select("id,date,amount,category,subcategory,teknisi_name,item_name,description,created_by")
        .is("deleted_at", null).gte("date", EXPENSE_AUDIT_FROM).order("date", { ascending: false }).limit(1000);
      const { data, error } = await query;
      if (error) throw error;
      const groups = new Map();
      (data || []).forEach(row => {
        const actorItem = String(row.teknisi_name ?? row.item_name ?? "").trim().toLowerCase();
        const key = JSON.stringify([row.date, Number(row.amount || 0), row.category, row.subcategory, actorItem]);
        groups.set(key, [...(groups.get(key) || []), row]);
      });
      rows = [...groups.values()].filter(group => group.length > 1);
      if ((data || []).length === 1000) rows.truncated = true;
    } else if (type === "legacy") {
      const [{ data: admins, error: adminError }, { data: expenses, error: expenseError }] = await Promise.all([
        supabase.from("user_profiles").select("name").eq("role", "Admin"),
        supabase.from("expenses").select("*").is("deleted_at", null).gte("date", EXPENSE_AUDIT_FROM).gte("amount", 500000)
          .eq("approval_status", "APPROVED").is("approved_at", null)
          .order("date", { ascending: false }).limit(500),
      ]);
      if (adminError) throw adminError;
      if (expenseError) throw expenseError;
      const adminNames = new Set((admins || []).map(user => String(user.name || "").trim().toLowerCase()).filter(Boolean));
      rows = (expenses || []).filter(item => adminNames.has(String(item.created_by || "").trim().toLowerCase()));
    }
    setExpenseAudit({ type, loading: false, error: "", rows });
  } catch (error) {
    setExpenseAudit({ type, loading: false, error: error?.message || "Gagal memuat rincian audit", rows: [] });
  }
};

const closeExpenseAudit = () => setExpenseAudit({ type: null, loading: false, error: "", rows: [] });

const renderAuditExpense = (item, { canApprove = false, label = "" } = {}) => (
  <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 9 }}>
    <div style={{ flex: 1, minWidth: 190 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ color: cs.text, fontSize: 12 }}>{item.subcategory || item.category || "Biaya"}</strong>
        <span style={{ color: cs.muted, fontSize: 11 }}>{item.date || "Tanggal tidak tersedia"}</span>
        {label && <span style={{ color: cs.yellow, fontSize: 10, fontWeight: 700 }}>{label}</span>}
      </div>
      <div style={{ color: cs.muted, fontSize: 11, marginTop: 3 }}>{item.description || item.item_name || "Tanpa keterangan"}{item.teknisi_name ? ` · ${item.teknisi_name}` : ""}</div>
      {item.created_by && <div style={{ color: cs.muted, fontSize: 10, marginTop: 2 }}>Input: {item.created_by}</div>}
    </div>
    <strong style={{ color: cs.red, whiteSpace: "nowrap", fontSize: 12 }}>Rp {Number(item.amount || 0).toLocaleString("id-ID")}</strong>
    {canApprove && bolehApprove && <button type="button" disabled={approvingExpenseId === item.id} onClick={() => approveExpense(item)} style={{ border: 0, borderRadius: 7, padding: "6px 9px", background: cs.green + "22", color: cs.green, cursor: approvingExpenseId === item.id ? "wait" : "pointer", opacity: approvingExpenseId === item.id ? 0.65 : 1, fontWeight: 700, fontSize: 11 }}>{approvingExpenseId === item.id ? "Memproses…" : "Setujui"}</button>}
    {isOwnerAdmin && <button type="button" onClick={() => openEdit(item)} style={{ border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 9px", background: "transparent", color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Edit</button>}
  </div>
);

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>💸 Biaya{isTrash ? " — Recycle Bin" : ""}</div>
      {isOwnerAdmin && !isTrash && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={exportBiayaPdf}
            title="Cetak / simpan PDF rekap biaya (ringkasan per kategori + rincian) sesuai filter aktif"
            style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, padding: "9px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            🖨️ PDF
          </button>
          <button onClick={exportBiayaCsv}
            title="Unduh CSV rekap biaya sesuai filter aktif (buka di Excel)"
            style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, padding: "9px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            ⬇️ CSV
          </button>
          <button onClick={openAdd}
            style={{
              background: "linear-gradient(135deg," + cs.accent + "," + cs.ara + ")", border: "none", color: "#fff",
              padding: "9px 18px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13
            }}>
            + Tambah Biaya
          </button>
        </div>
      )}
    </div>

    {/* Kasbon Requests — approve di sini → otomatis tercatat ke Biaya (Owner/Admin) */}
    {!isTrash && <KasbonSection currentUser={currentUser} kasbonRequests={kasbonRequests} approveKasbon={approveKasbon} rejectKasbon={rejectKasbon} />}

    {/* Budget Alert Banner */}
    {isOwnerAdmin && budgetAlerts.length > 0 && (
      <div style={{ background: cs.red + "10", border: "1px solid " + cs.red + "44", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: cs.red }}>Budget hampir habis bulan ini:</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
            {budgetAlerts.map(item => {
              const k = budgetKey(item.cat, item.sub);
              const pct = Math.round((spendThisMonth[k] || 0) / budgetMap[k] * 100);
              return `${item.label} (${pct}%)`;
            }).join(" · ")}
          </div>
        </div>
        <button onClick={() => setShowBudgetPanel(v => !v)}
          style={{ fontSize: 11, padding: "4px 12px", borderRadius: 7, background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, cursor: "pointer", fontWeight: 600 }}>
          {showBudgetPanel ? "Tutup" : "Lihat Budget"}
        </button>
      </div>
    )}

    {/* Budget Toggle Button */}
    {isOwnerAdmin && budgetAlerts.length === 0 && (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setShowBudgetPanel(v => !v)}
          style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, background: showBudgetPanel ? cs.accent + "22" : cs.surface, border: "1px solid " + (showBudgetPanel ? cs.accent : cs.border), color: showBudgetPanel ? cs.accent : cs.muted, cursor: "pointer", fontWeight: 600 }}>
          {showBudgetPanel ? "✕ Sembunyikan Budget" : "💰 Kelola Budget Bulanan"}
        </button>
      </div>
    )}

    {/* Budget Panel */}
    {isOwnerAdmin && showBudgetPanel && (
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>💰 Budget Bulanan</div>
            <div style={{ fontSize: 11, color: cs.muted }}>Bulan ini: {new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</div>
          </div>
          {isOwner && (
            <button onClick={() => setBudgetForm({ category: "petty_cash", subcategory: null, amount: "" })}
              style={{ fontSize: 11, padding: "6px 12px", borderRadius: 7, background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, cursor: "pointer", fontWeight: 600 }}>
              ✏️ Set Budget
            </button>
          )}
        </div>
        <div style={{ padding: "12px 16px", display: "grid", gap: 8 }}>
          {ALL_BUDGET_ITEMS.map(item => {
            const k = budgetKey(item.cat, item.sub);
            const budget = budgetMap[k] || 0;
            const spent = spendThisMonth[k] || 0;
            const pct = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;
            const isOver = budget > 0 && spent >= budget;
            const isWarn = budget > 0 && spent >= budget * 0.8 && !isOver;
            const barColor = isOver ? cs.red : isWarn ? cs.yellow : cs.green;
            const isTotal = item.sub === null;
            return (
              <div key={k} style={{ paddingLeft: isTotal ? 0 : 16, borderLeft: isTotal ? "none" : "2px solid " + cs.border + "44" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: isTotal ? 12 : 11, fontWeight: isTotal ? 700 : 400, color: isTotal ? cs.text : cs.muted }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: spent > 0 ? cs.text : cs.muted, textAlign: "right" }}>
                    {spent > 0 ? "Rp " + spent.toLocaleString("id-ID") : "—"}
                    {budget > 0 && <span style={{ color: cs.muted }}> / Rp {budget.toLocaleString("id-ID")}</span>}
                  </div>
                  {isOwner && (
                    <button onClick={() => setBudgetForm({ category: item.cat, subcategory: item.sub, amount: String(budget || "") })}
                      style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, background: "transparent", border: "1px solid " + cs.border + "66", color: cs.muted, cursor: "pointer" }}>
                      {budget > 0 ? "Ubah" : "Set"}
                    </button>
                  )}
                </div>
                {budget > 0 ? (
                  <div style={{ height: 5, background: cs.surface, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: pct + "%", background: barColor, borderRadius: 99, transition: "width .4s" }} />
                  </div>
                ) : (
                  <div style={{ height: 5, background: cs.surface + "55", borderRadius: 99 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    )}

    {/* Modal Set Budget */}
    {isOwner && (
      <BudgetModal
        open={budgetForm !== null}
        onClose={() => setBudgetForm(null)}
        budgetForm={budgetForm}
        setBudgetForm={setBudgetForm}
        saveBudget={saveBudget}
        budgetSaving={budgetSaving}
      />
    )}

    {/* Tab bar */}
    <div style={{ display: "flex", gap: 6 }}>
      {[["petty_cash", "💰 Petty Cash"], ["material_purchase", "🔧 Pembelian Material"], ["pending_ai", "🤖 Pending AI" + (pendingAi.length ? ` (${pendingAi.length})` : "")], ...(isOwner ? [["deleted", "🗑️ Dihapus"]] : [])].map(([v, lbl]) => (
        <button key={v} onClick={() => { setExpenseTab(v); setExpensePage(1); setExpenseFilter("Semua"); }}
          style={{
            padding: "8px 16px", borderRadius: 10, border: "1px solid " + (expenseTab === v ? cs.accent : cs.border),
            background: expenseTab === v ? cs.accent + "22" : cs.card,
            color: expenseTab === v ? cs.accent : cs.muted, fontWeight: expenseTab === v ? 700 : 400,
            cursor: "pointer", fontSize: 13
          }}>
          {lbl}
        </button>
      ))}
    </div>

    {/* ─── Tab Pending AI ─── */}
    {isPendingAi && (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 12, color: cs.muted }}>
            Foto struk dari grup WA yang diklasifikasi AI. Review sebelum approve.
          </div>
          <button onClick={loadPendingAi} disabled={loadingPendingAi}
            style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
            {loadingPendingAi ? "Loading..." : "↻ Refresh"}
          </button>
        </div>
        {pendingAi.length === 0 && !loadingPendingAi && (
          <div style={{ padding: 24, background: cs.card, borderRadius: 10, textAlign: "center", color: cs.muted, fontSize: 13 }}>
            Tidak ada entri menunggu validasi AI.
          </div>
        )}
        {pendingAi.map(item => {
          const ai = item.ai_extractions || {};
          const confColor = ai.confidence === "HIGH" ? "#10b981" : ai.confidence === "MEDIUM" ? "#f59e0b" : "#ef4444";
          const isKasbon = item.subcategory === "Kasbon Karyawan";
          const ackMatch = (item.description || "").match(/\[ACK by (\d+) at ([\d:]+)\]/);
          // Prefer R2 (permanent) over Fonnte URL (TTL 15-30 min, returns 404 after)
          const photoUrl = ai.r2_url || ai.image_url || null;
          return (
            <div key={item.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: 14, display: "flex", gap: 14 }}>
              {photoUrl && (
                <a href={photoUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
                  <img src={photoUrl} alt="struk" style={{ width: 160, height: 200, objectFit: "cover", borderRadius: 8, border: "1px solid " + cs.border }}
                    onError={e => { e.target.style.display = "none"; }} />
                </a>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: cs.text }}>{fmt ? fmt(item.amount) : `Rp ${item.amount?.toLocaleString("id")}`}</span>
                  {isKasbon && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#a855f722", color: "#a855f7" }}>💸 KASBON</span>
                  )}
                  {ai.confidence && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: confColor + "22", color: confColor }}>{ai.confidence}</span>
                  )}
                  {ackMatch ? (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#10b98122", color: "#10b981" }}>
                      ✅ ACKED · {ackMatch[1].slice(-4)} · {ackMatch[2]}
                    </span>
                  ) : isKasbon ? (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#f59e0b22", color: "#f59e0b" }}>🕐 Awaiting Finance/Owner ack</span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, color: cs.text, marginBottom: 4 }}>📅 {item.date} · 🏷 {item.category} <span style={{ color: cs.muted }}>· {item.subcategory || "—"}</span></div>
                <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8, wordBreak: "break-word" }}>{item.description}</div>
                {ai.notes && <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic", marginBottom: 8 }}>🧠 {ai.notes}</div>}
                <div style={{ fontSize: 11, color: cs.muted, marginBottom: 10 }}>👤 {item.teknisi_name || "—"} · 🤖 {ai.model || "AI"}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button disabled={pendingAiBusy === item.id} onClick={() => handleApprovePendingAi(item)}
                    style={{ background: "#10b98122", border: "1px solid #10b98155", color: "#10b981", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    ✓ Approve
                  </button>
                  <button disabled={pendingAiBusy === item.id} onClick={() => {
                    setEditExpenseItem(item);
                    setNewExpenseForm({
                      category: item.category, subcategory: item.subcategory, amount: String(item.amount || ""),
                      date: item.date || TODAY, description: item.description || "", teknisi_name: item.teknisi_name || "",
                      item_name: item.item_name || "", freon_type: item.freon_type || "", order_id: item.order_id || "", allocation_status: item.allocation_status || "UNRESOLVED"
                    });
                    setModalExpense(true);
                  }}
                    style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
                    ✏️ Edit
                  </button>
                  <button disabled={pendingAiBusy === item.id} onClick={() => handleRejectPendingAi(item)}
                    style={{ background: "#ef444422", border: "1px solid #ef444455", color: "#ef4444", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
                    ✕ Reject
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}

    {/* ── Navigasi per-hari (geser ◀ ▶) — ringkas, tak perlu pusing baris & paginasi ── */}
    {!isPendingAi && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "10px 14px" }}>
        <button onClick={() => goDay(shiftDay(dayMode ? expenseDateFrom : TODAY, -1))}
          title="Hari sebelumnya"
          style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.text, borderRadius: 9, width: 38, height: 38, cursor: "pointer", fontSize: 15, fontWeight: 700 }}>◀</button>
        <div style={{ minWidth: 210, textAlign: "center", flex: "0 1 auto" }}>
          {dayMode ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
                {fmtDayLong(expenseDateFrom)}{expenseDateFrom === TODAY && <span style={{ fontSize: 11, color: cs.accent, marginLeft: 6 }}>Hari Ini</span>}
              </div>
              <div style={{ fontSize: 11, color: cs.muted }}>{totalFilteredCount} transaksi · Total Rp {grandTotal.toLocaleString("id-ID")}</div>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: cs.muted }}>
              {(expenseDateFrom || expenseDateTo) ? `Rentang: ${expenseDateFrom || "…"} — ${expenseDateTo || "…"}` : "Semua tanggal"} · {totalFilteredCount} transaksi
            </div>
          )}
        </div>
        <button onClick={() => goDay(shiftDay(dayMode ? expenseDateFrom : TODAY, +1))}
          title="Hari berikutnya"
          style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.text, borderRadius: 9, width: 38, height: 38, cursor: "pointer", fontSize: 15, fontWeight: 700 }}>▶</button>
        <span style={{ flex: 1 }} />
        {dayMode ? (
          <>
            <button onClick={() => goDay(TODAY)} style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 9, padding: "8px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Hari ini</button>
            <button onClick={() => { setExpenseDateFrom(""); setExpenseDateTo(""); setExpensePage(1); }} style={{ background: "transparent", border: "1px solid " + cs.border, color: cs.muted, borderRadius: 9, padding: "8px 12px", cursor: "pointer", fontSize: 12 }}>Semua tanggal</button>
          </>
        ) : (
          <button onClick={() => goDay(TODAY)} style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 9, padding: "8px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>📅 Mode per-hari</button>
        )}
      </div>
    )}

    {/* Filter row: subcategory chips + month quick-select dalam satu baris */}
    {!isPendingAi && <>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {/* Subcategory chips — petty_cash only */}
      {expenseTab === "petty_cash" && QUICK_FILTERS.map(f => (
        <button key={f} onClick={() => { setExpenseFilter(f); setExpensePage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12,
            border: "1px solid " + (expenseFilter === f ? cs.accent : cs.border),
            background: expenseFilter === f ? cs.accent + "22" : "transparent",
            color: expenseFilter === f ? cs.accent : cs.muted,
            fontWeight: expenseFilter === f ? 700 : 400
          }}>
          {f}
        </button>
      ))}

      {/* Separator */}
      <span style={{ color: cs.border, fontSize: 16, userSelect: "none", margin: "0 4px" }}>|</span>

      {/* Month quick-select */}
      <span style={{ fontSize: 11, color: cs.muted }}>📅</span>
      {MONTH_QUICK.map(({ label, from, to }) => {
        const isActive = expenseDateFrom === from && expenseDateTo === to;
        return (
          <button key={from}
            onClick={() => { setExpenseDateFrom(from); setExpenseDateTo(to); setExpensePage(1); }}
            style={{
              padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12,
              border: "1px solid " + (isActive ? "#a855f7" : cs.border),
              background: isActive ? "#a855f722" : "transparent",
              color: isActive ? "#a855f7" : cs.muted,
              fontWeight: isActive ? 700 : 400
            }}>
            {label}
          </button>
        );
      })}
      {(expenseDateFrom || expenseDateTo) && (
        <button onClick={() => { setExpenseDateFrom(""); setExpenseDateTo(""); setExpensePage(1); }}
          style={{ background: "transparent", border: "none", color: cs.muted, fontSize: 11, cursor: "pointer", padding: "4px 4px" }}>
          ✕
        </button>
      )}
    </div>

    {/* Ringkasan audit dibuat ringkas agar tidak menenggelamkan filter dan transaksi. */}
    {!isTrash && !isPendingAi && (() => {
      const duplicateCount = Number(workspace?.duplicate_warning_count || 0);
      const legacyCount = Number(workspace?.legacy_admin_high_without_review || 0);
      const hasPending = bolehApprove && pendingApprovalCount > 0;
      const hasDuplicate = workspaceV2 && duplicateCount > 0;
      const hasLegacy = bolehApprove && workspaceV2 && legacyCount > 0;
      if (!hasPending && !hasDuplicate && !hasLegacy) return null;
      return (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 11, overflow: "hidden" }}>
          <button type="button" onClick={() => setShowExpenseAuditNotices(value => !value)}
            aria-expanded={showExpenseAuditNotices}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 13px", textAlign: "left", background: "transparent", border: 0, color: cs.text, cursor: "pointer" }}>
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>🔎 Pemeriksaan & tindak lanjut</span>
            {hasPending && <span style={{ fontSize: 11, color: cs.yellow, fontWeight: 700 }}>{pendingApprovalCount} perlu approval</span>}
            {hasDuplicate && <span style={{ fontSize: 11, color: cs.yellow }}>{duplicateCount} mirip</span>}
            {hasLegacy && <span style={{ fontSize: 11, color: cs.red }}>{legacyCount} perlu audit</span>}
            <span aria-hidden="true" style={{ color: cs.muted }}>{showExpenseAuditNotices ? "▲" : "▼"}</span>
          </button>
          {showExpenseAuditNotices && (
            <div style={{ display: "grid", gap: 7, padding: "0 13px 12px" }}>
              {hasPending && <div style={{ borderLeft: "3px solid " + cs.yellow, background: cs.yellow + "10", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: cs.yellow }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>⏳ {pendingApprovalCount} biaya Admin menunggu persetujuan (Rp {pendingApprovalSum.toLocaleString("id-ID")}); belum masuk total biaya.</span>
                  <button type="button" onClick={() => loadExpenseAuditIssue("pending")} style={{ border: "1px solid " + cs.yellow + "66", borderRadius: 7, padding: "5px 9px", background: "transparent", color: cs.yellow, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Lihat transaksi</button>
                </div>
              </div>}
              {hasDuplicate && <div style={{ borderLeft: "3px solid " + cs.yellow, background: cs.yellow + "10", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: cs.yellow }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>⚠️ {duplicateCount} kelompok transaksi sejak 4 Okt 2026 tampak serupa. Tidak ada data dihapus otomatis.</span>
                  <button type="button" onClick={() => loadExpenseAuditIssue("duplicates")} style={{ border: "1px solid " + cs.yellow + "66", borderRadius: 7, padding: "5px 9px", background: "transparent", color: cs.yellow, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Periksa kelompok</button>
                </div>
              </div>}
              {hasLegacy && <div style={{ borderLeft: "3px solid " + cs.red, background: cs.red + "10", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: cs.red }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>🔎 {legacyCount} biaya sejak 4 Okt 2026 oleh Admin ≥Rp500.000 belum memiliki jejak reviewer.</span>
                  <button type="button" onClick={() => loadExpenseAuditIssue("legacy")} style={{ border: "1px solid " + cs.red + "66", borderRadius: 7, padding: "5px 9px", background: "transparent", color: cs.red, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>Tinjau transaksi</button>
                </div>
              </div>}
              {hasPending && <div style={{ fontSize: 11, color: cs.muted }}>Gunakan tanggal dan pencarian untuk menemukan transaksi yang perlu ditinjau.</div>}
            </div>
          )}
        </div>
      );
    })()}

    {expenseAudit.type && (
      <section style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 13, padding: 14, display: "grid", gap: 10 }} aria-live="polite">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ color: cs.text, fontWeight: 800, fontSize: 13 }}>
            {expenseAudit.type === "pending" ? "Transaksi menunggu approval" : expenseAudit.type === "duplicates" ? "Kelompok transaksi yang mirip" : "Biaya lama tanpa jejak reviewer"}
          </div>
          <button type="button" onClick={closeExpenseAudit} aria-label="Tutup rincian audit" style={{ border: "1px solid " + cs.border, borderRadius: 7, padding: "5px 9px", background: "transparent", color: cs.muted, cursor: "pointer" }}>Tutup ✕</button>
        </div>
        {expenseAudit.loading ? <div style={{ color: cs.muted, fontSize: 12, padding: 8 }}>Memuat transaksi terkait…</div>
          : expenseAudit.error ? <div role="alert" style={{ color: cs.red, fontSize: 12 }}>Gagal memuat rincian: {expenseAudit.error}</div>
          : expenseAudit.type === "duplicates" ? (
            <>
              {expenseAudit.rows.length === 0 ? <div style={{ color: cs.muted, fontSize: 12 }}>Tidak ditemukan kelompok transaksi mirip pada rentang tanggal aktif.</div>
                : expenseAudit.rows.map((group, index) => (
                  <div key={`${group[0]?.date}-${group[0]?.id}-${index}`} style={{ display: "grid", gap: 6, padding: 10, border: "1px solid " + cs.yellow + "44", borderRadius: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: cs.yellow }}>Kelompok {index + 1} · {group.length} transaksi · {group[0]?.date} · Rp {Number(group[0]?.amount || 0).toLocaleString("id-ID")}</div>
                    {group.map(item => renderAuditExpense(item, { label: "Periksa kemungkinan duplikat" }))}
                  </div>
                ))}
              {expenseAudit.rows.truncated && <div style={{ fontSize: 11, color: cs.muted }}>Pemindaian dibatasi pada 1.000 transaksi terbaru. Persempit rentang tanggal untuk pemeriksaan yang lebih lengkap.</div>}
            </>
          ) : expenseAudit.rows.length === 0 ? <div style={{ color: cs.muted, fontSize: 12 }}>Tidak ada transaksi yang cocok. Data kemungkinan sudah berubah setelah ringkasan audit dimuat.</div>
            : <>
              <div style={{ fontSize: 11, color: cs.muted }}>Menampilkan {expenseAudit.rows.length} transaksi terkait{expenseAudit.type === "pending" && expenseAudit.rows.length === 200 ? " (maksimal 200; gunakan rentang tanggal untuk membatasi)" : ""}.</div>
              {expenseAudit.rows.map(item => renderAuditExpense(item, { canApprove: expenseAudit.type === "pending", label: expenseAudit.type === "pending" ? "Menunggu approval" : "Reviewer belum tercatat" }))}
            </>}
      </section>
    )}

    {/* Search + date range + sorting */}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input value={expenseSearch} onChange={e => { setExpenseSearch(e.target.value); setExpensePage(1); }}
        placeholder="🔍 Cari keterangan / nama..."
        style={{
          flex: 1, minWidth: 140, background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
          color: cs.text, padding: "8px 12px", fontSize: 13
        }} />
      <input type="date" value={expenseDateFrom} onChange={e => { setExpenseDateFrom(e.target.value); setExpensePage(1); }}
        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "7px 10px", fontSize: 12 }} />
      <span style={{ color: cs.muted, fontSize: 12 }}>—</span>
      <input type="date" value={expenseDateTo} onChange={e => { setExpenseDateTo(e.target.value); setExpensePage(1); }}
        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "7px 10px", fontSize: 12 }} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, color: cs.muted, fontSize: 11 }}>
        Urutkan halaman
        <select value={expenseSort} onChange={e => setExpenseSort(e.target.value)}
          style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "7px 9px", fontSize: 12 }}>
          <option value="date_desc">Tanggal terbaru</option>
          <option value="date_asc">Tanggal terlama</option>
          <option value="amount_desc">Nominal terbesar</option>
          <option value="amount_asc">Nominal terkecil</option>
          <option value="name_asc">Kategori / nama A–Z</option>
        </select>
      </label>
      {(expenseSearch || expenseDateFrom || expenseDateTo) && (
        <button onClick={() => { setExpenseSearch(""); setExpenseDateFrom(""); setExpenseDateTo(""); setExpensePage(1); }}
          style={{ background: "transparent", border: "1px solid " + cs.border, borderRadius: 8, color: cs.muted, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
          ✕ Reset
        </button>
      )}
    </div>

    {/* Summary bar */}
    <div style={{
      background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 18px",
      display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8
    }}>
      <span style={{ fontSize: 13, color: cs.muted }}>{totalFilteredCount} transaksi{workspaceV2 ? " · server-side" : ""}</span>
      <span style={{ fontWeight: 700, fontSize: 16, color: cs.red }}>Total: Rp {grandTotal.toLocaleString("id-ID")}</span>
    </div>

    {/* Table */}
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
      {(!isTrash && workspaceLoading)
        ? <div style={{ padding: "40px", textAlign: "center", color: cs.muted }}>Memuat biaya…</div>
        : (!isTrash && workspaceError)
        ? <div style={{ padding: "40px", textAlign: "center", color: cs.red }}>❌ {workspaceError}</div>
        : isTrash && loadingDeleted
        ? <div style={{ padding: "40px", textAlign: "center", color: cs.muted }}>Memuat data dihapus…</div>
        : pageData.length === 0
        ? <div style={{ padding: "40px", textAlign: "center", color: cs.muted }}>{isTrash ? "Recycle bin kosong — tidak ada biaya yang dihapus." : "Tidak ada data biaya."}</div>
        : pageData.map((item, i) => (
          <div key={item.id || i} style={{
            display: "flex", gap: 12, padding: "12px 16px",
            borderBottom: "1px solid " + cs.border, alignItems: "center", flexWrap: "wrap"
          }}>
            <div style={{ minWidth: 80, fontSize: 11, color: cs.muted, fontFamily: "monospace" }}>{item.date || "-"}</div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: cs.text }}>{item.subcategory || "-"}</div>
              {item.description && <div style={{ fontSize: 11, color: cs.muted }}>{item.description}</div>}
              {item.teknisi_name && <div style={{ fontSize: 11, color: cs.accent }}>👤 {item.teknisi_name}</div>}
              {item.item_name && <div style={{ fontSize: 11, color: cs.muted }}>📦 {item.item_name}{item.freon_type ? " (" + item.freon_type + ")" : ""}</div>}
              {item.source && <div style={{ fontSize: 9, color: cs.muted, marginTop: 2 }}>Sumber: {item.source}{item.created_by ? ` · ${item.created_by}` : ""}</div>}
              {item.stock_linked_at && (
                <div style={{ fontSize: 10, color: cs.green, marginTop: 2 }}>
                  🔗 Sudah jadi stok: {item.qty} {item.unit} @ Rp{Number(item.unit_cost || 0).toLocaleString("id-ID")}
                </div>
              )}
              {item.order_id && <div style={{ fontSize: 10, color: cs.accent, marginTop: 2 }}>🧾 Biaya job {item.order_id}</div>}
              {item.category === "material_purchase" && !item.stock_linked_at && !item.order_id && (
                <div style={{ fontSize: 10, color: item.allocation_status === "NON_STOCK" ? cs.green : cs.yellow, marginTop: 2 }}>
                  {item.allocation_status === "NON_STOCK" ? "✅ Langsung dipakai / non-stok" : "⏳ Belum ditentukan: masuk stok atau langsung dipakai"}
                </div>
              )}
              {isTrash && item.deleted_at && (
                <div style={{ fontSize: 10, color: cs.red, marginTop: 2 }}>
                  🗑️ Dihapus {new Date(item.deleted_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{item.deleted_by ? " oleh " + item.deleted_by : ""}
                </div>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: cs.red, whiteSpace: "nowrap", textAlign: "right" }}>
              Rp {Number(item.amount || 0).toLocaleString("id-ID")}
              {item.approval_status === "PENDING_APPROVAL" && (
                <div style={{ fontSize: 9, fontWeight: 800, color: "#f59e0b", marginTop: 2 }}>⏳ MENUNGGU APPROVAL</div>
              )}
            </div>
            {!isTrash && item.approval_status === "PENDING_APPROVAL" && bolehApprove && (
              <div style={{ display: "flex", gap: 6 }}>
                <button disabled={approvingExpenseId === item.id} onClick={() => approveExpense(item)} title="Setujui — biaya mulai dihitung"
                  style={{ background: cs.green, border: "none", color: "#fff", borderRadius: 8, padding: "5px 12px", cursor: approvingExpenseId === item.id ? "wait" : "pointer", opacity: approvingExpenseId === item.id ? 0.65 : 1, fontSize: 12, fontWeight: 700 }}>{approvingExpenseId === item.id ? "⏳ Memproses" : "✅ Setujui"}</button>
                <button onClick={() => rejectExpense(item)} title="Tolak & hapus"
                  style={{ background: "transparent", border: "1px solid " + cs.red, color: cs.red, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>❌ Tolak</button>
              </div>
            )}
            {isTrash ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => handleRestoreExpense(item)}
                  style={{
                    background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green,
                    borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600
                  }}>♻️ Pulihkan</button>
                <button onClick={() => handlePurgeExpense(item)}
                  style={{
                    background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red,
                    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12
                  }}>⚠️</button>
              </div>
            ) : isOwnerAdmin && (
              <div style={{ display: "flex", gap: 6 }}>
                {/* Owner/Admin saja: trigger trg_guard_inventory_price (migrasi 154) menolak
                    perubahan HPP dari role lain — Finance yang mengklik akan menandai nota &
                    menulis ledger tapi gagal di update stok, meninggalkan data setengah jalan. */}
                {item.category === "material_purchase" && !item.stock_linked_at
                  && (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                  <button onClick={() => setLinkExpense(item)} title="Jadikan restock: stok bertambah & harga beli item ter-update"
                    style={{
                      background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green,
                      borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700
                    }}>🔗 Stok</button>
                )}
                {item.category === "material_purchase" && !item.stock_linked_at && !item.order_id
                  && item.allocation_status !== "NON_STOCK"
                  && (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                  <button onClick={() => markMaterialNonStock(item)} title="Barang langsung dipakai atau bukan stok gudang"
                    style={{ background: cs.yellow + "18", border: "1px solid " + cs.yellow + "44", color: cs.yellow, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✅ Non-stok</button>
                )}
                <button onClick={() => openEdit(item)}
                  style={{
                    background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent,
                    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12
                  }}>✏️</button>
                <button onClick={() => handleDeleteExpense(item)}
                  style={{
                    background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red,
                    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12
                  }}>🗑️</button>
                <button onClick={() => setAuditModal({ tableName: "expenses", rowId: item.id })}
                  style={{
                    background: cs.surface, border: "1px solid " + cs.border, color: cs.muted,
                    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12
                  }}>📜</button>
              </div>
            )}
          </div>
        ))
      }
    </div>

    {/* Pagination */}
    {totalPage > 1 && (
      <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        {Array.from({ length: totalPage }, (_, i) => i + 1).map(p => (
          <button key={p} onClick={() => setExpensePage(p)}
            style={{
              padding: "6px 12px", borderRadius: 8,
              border: "1px solid " + (expensePage === p ? cs.accent : cs.border),
              background: expensePage === p ? cs.accent + "22" : "transparent",
              color: expensePage === p ? cs.accent : cs.muted, cursor: "pointer", fontSize: 12
            }}>
            {p}
          </button>
        ))}
      </div>
    )}
    </>}

    {/* Modal Add/Edit */}
    <ExpenseFormModal
      open={modalExpense}
      onClose={() => { setModalExpense(false); resetForm(); }}
      editExpenseItem={editExpenseItem}
      newExpenseForm={newExpenseForm}
      setNewExpenseForm={setNewExpenseForm}
      teknisiData={teknisiData}
      userAccounts={userAccounts}
      currentUser={currentUser}
      supabase={supabase}
      insertExpense={insertExpense}
      updateExpense={updateExpense}
      auditUserName={auditUserName}
      showNotif={showNotif}
      TODAY={TODAY}
      setExpensesData={setExpensesData}
      setPendingAi={setPendingAi}
      fmt={fmt}
      ordersData={ordersData}
      onSaved={() => setWorkspaceRevision(v => v + 1)}
    />

    {/* Nota material → restock + update HPP */}
    <TautkanStokModal
      open={!!linkExpense}
      expense={linkExpense}
      inventoryData={inventoryData}
      onClose={() => setLinkExpense(null)}
      onLinked={({ expensePatch, inventoryPatch }) => {
        setExpensesData(prev => prev.map(x => x.id === linkExpense.id ? { ...x, ...expensePatch } : x));
        setWorkspace(prev => prev ? { ...prev, rows: (prev.rows || []).map(x => x.id === linkExpense.id ? { ...x, ...expensePatch } : x), unresolved_material_count: Math.max(0, Number(prev.unresolved_material_count || 0) - 1) } : prev);
        setInventoryData?.(prev => prev.map(i => i.code === inventoryPatch.code ? { ...i, ...inventoryPatch } : i));
      }}
      supabase={supabase}
      currentUser={currentUser}
      showNotif={showNotif}
      addAgentLog={addAgentLog}
    />
  </div>
);
}

export default memo(ExpensesView);
