import { memo, useState, useMemo } from "react";
import { cs } from "../theme/cs.js";

function ExpensesView({ expensesData, setExpensesData, expenseTab, setExpenseTab, expenseFilter, setExpenseFilter, expenseDateFrom, setExpenseDateFrom, expenseDateTo, setExpenseDateTo, expenseSearch, setExpenseSearch, expensePage, setExpensePage, modalExpense, setModalExpense, editExpenseItem, setEditExpenseItem, newExpenseForm, setNewExpenseForm, currentUser, supabase, insertExpense, updateExpense, deleteExpense, auditUserName, setAuditModal, TODAY, EXPENSE_PAGE_SIZE, fmt, showNotif, showConfirm, appSettings, setAppSettings }) {
const isOwnerAdmin = currentUser?.role === "Owner" || currentUser?.role === "Admin" || currentUser?.role === "Finance";
const isOwner = currentUser?.role === "Owner";

const PETTY_CASH_SUBS = ["Bensin Motor", "Perbaikan Motor", "Parkir", "Kasbon Karyawan", "Lembur", "Bonus", "Lain-lain"];
const MATERIAL_SUBS = ["Pipa AC", "Kabel", "Freon", "Material Lain"];
// Quick-filter chips (for petty_cash tab only)
const QUICK_FILTERS = ["Semua", "Bensin Motor", "Parkir", "Kasbon Karyawan"];

// ── Budget state ──
const [showBudgetPanel, setShowBudgetPanel] = useState(false);
const [budgetForm, setBudgetForm] = useState(null); // null | { category, subcategory, amount }
const [budgetSaving, setBudgetSaving] = useState(false);

// Budget data dari app_settings.expense_budgets (JSON: { "petty_cash::Bensin Motor": 500000, ... })
const budgetMap = useMemo(() => {
  try { return JSON.parse(appSettings?.expense_budgets || "{}"); } catch { return {}; }
}, [appSettings?.expense_budgets]);

const budgetKey = (cat, sub) => sub ? `${cat}::${sub}` : cat;

// Hitung pengeluaran bulan ini per kategori & sub
const nowDate = new Date();
const thisMonthPrefix = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}`;
const spendThisMonth = useMemo(() => {
  const map = {};
  expensesData.forEach(e => {
    if (!(e.date || "").startsWith(thisMonthPrefix)) return;
    const catKey = budgetKey(e.category, null);
    map[catKey] = (map[catKey] || 0) + Number(e.amount || 0);
    if (e.subcategory) {
      const subKey = budgetKey(e.category, e.subcategory);
      map[subKey] = (map[subKey] || 0) + Number(e.amount || 0);
    }
  });
  return map;
}, [expensesData, thisMonthPrefix]);

const saveBudget = async () => {
  if (!budgetForm) return;
  setBudgetSaving(true);
  const key = budgetKey(budgetForm.category, budgetForm.subcategory);
  const newMap = { ...budgetMap };
  const amt = Number(budgetForm.amount);
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

// Apply filters
const filtered = expensesData.filter(e => {
  if (expenseTab === "petty_cash" && e.category !== "petty_cash") return false;
  if (expenseTab === "material_purchase" && e.category !== "material_purchase") return false;
  if (expenseTab === "petty_cash" && expenseFilter !== "Semua" && e.subcategory !== expenseFilter) return false;
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
}).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

const totalPage = Math.ceil(filtered.length / EXPENSE_PAGE_SIZE) || 1;
const pageData = filtered.slice((expensePage - 1) * EXPENSE_PAGE_SIZE, expensePage * EXPENSE_PAGE_SIZE);
const grandTotal = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);

const resetForm = () => {
  setNewExpenseForm({
    category: expenseTab === "material_purchase" ? "material_purchase" : "petty_cash",
    subcategory: "", amount: "", date: TODAY, description: "", teknisi_name: "", item_name: "", freon_type: ""
  });
  setEditExpenseItem(null);
};

const openAdd = () => { resetForm(); setModalExpense(true); };
const openEdit = (item) => {
  setEditExpenseItem(item);
  setNewExpenseForm({
    category: item.category, subcategory: item.subcategory, amount: String(item.amount || ""),
    date: item.date || TODAY, description: item.description || "", teknisi_name: item.teknisi_name || "",
    item_name: item.item_name || "", freon_type: item.freon_type || ""
  });
  setModalExpense(true);
};

const saveExpense = async () => {
  const f = newExpenseForm;
  if (!f.subcategory || !f.amount || !f.date) { alert("Isi subkategori, jumlah, dan tanggal."); return; }
  const payload = {
    category: f.category, subcategory: f.subcategory, amount: Number(f.amount),
    date: f.date, description: f.description, teknisi_name: f.teknisi_name || null,
    item_name: f.item_name || null, freon_type: f.freon_type || null,
    created_by: currentUser?.name || currentUser?.email || "unknown",
  };
  if (editExpenseItem) {
    const { error } = await updateExpense(supabase, editExpenseItem.id, payload, auditUserName());
    if (error) { showNotif?.("❌ Gagal update biaya: " + error.message); return; }
    setExpensesData(prev => prev.map(x => x.id === editExpenseItem.id ? { ...x, ...payload } : x));
    showNotif?.(`✅ Biaya ${payload.subcategory} (${fmt(payload.amount)}) diperbarui`);
  } else {
    const { data, error } = await insertExpense(supabase, { ...payload, last_changed_by: auditUserName() });
    if (error) { showNotif?.("❌ Gagal simpan biaya: " + error.message); return; }
    setExpensesData(prev => [data, ...prev]);
    showNotif?.(`✅ Biaya ${payload.subcategory} (${fmt(payload.amount)}) tersimpan`);
  }
  setModalExpense(false);
  resetForm();
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
  showNotif?.(`🗑️ Biaya ${item.subcategory} dihapus`);
};

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>💸 Biaya</div>
      {isOwnerAdmin && (
        <button onClick={openAdd}
          style={{
            background: "linear-gradient(135deg," + cs.accent + "," + cs.ara + ")", border: "none", color: "#fff",
            padding: "9px 18px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13
          }}>
          + Tambah Biaya
        </button>
      )}
    </div>

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
    {budgetForm !== null && isOwner && (
      <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) setBudgetForm(null); }}>
        <div style={{ background: cs.bg, border: "1px solid " + cs.border, borderRadius: 14, padding: 24, width: "100%", maxWidth: 380 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: cs.text, marginBottom: 16 }}>
            Set Budget Bulanan
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Kategori</label>
            <select value={budgetForm.category} onChange={e => setBudgetForm(f => ({ ...f, category: e.target.value, subcategory: null }))}
              style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "8px 10px", fontSize: 13 }}>
              <option value="petty_cash">💰 Petty Cash</option>
              <option value="material_purchase">🔧 Pembelian Material</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Sub-kategori (kosongkan = semua)</label>
            <select value={budgetForm.subcategory || ""} onChange={e => setBudgetForm(f => ({ ...f, subcategory: e.target.value || null }))}
              style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "8px 10px", fontSize: 13 }}>
              <option value="">-- Semua --</option>
              {(budgetForm.category === "material_purchase" ? MATERIAL_SUBS : PETTY_CASH_SUBS).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Budget per Bulan (Rp)</label>
            <input type="number" min="0" value={budgetForm.amount} onChange={e => setBudgetForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="500000" autoFocus
              style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "9px 12px", fontSize: 13, boxSizing: "border-box" }} />
            <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>Kosongkan / isi 0 untuk hapus budget</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setBudgetForm(null)}
              style={{ flex: 1, background: "transparent", border: "1px solid " + cs.border, borderRadius: 9, color: cs.muted, padding: 10, cursor: "pointer", fontSize: 13 }}>Batal</button>
            <button onClick={saveBudget} disabled={budgetSaving}
              style={{ flex: 2, background: cs.accent, border: "none", color: "#0a0f1e", padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13, opacity: budgetSaving ? 0.7 : 1 }}>
              {budgetSaving ? "⏳ Menyimpan..." : "✅ Simpan Budget"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Tab bar */}
    <div style={{ display: "flex", gap: 6 }}>
      {[["petty_cash", "💰 Petty Cash"], ["material_purchase", "🔧 Pembelian Material"]].map(([v, lbl]) => (
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

    {/* Quick-filter chips (petty_cash only) */}
    {expenseTab === "petty_cash" && (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {QUICK_FILTERS.map(f => (
          <button key={f} onClick={() => { setExpenseFilter(f); setExpensePage(1); }}
            style={{
              padding: "5px 12px", borderRadius: 20, border: "1px solid " + (expenseFilter === f ? cs.accent : cs.border),
              background: expenseFilter === f ? cs.accent + "22" : "transparent",
              color: expenseFilter === f ? cs.accent : cs.muted,
              cursor: "pointer", fontSize: 12, fontWeight: expenseFilter === f ? 700 : 400
            }}>
            {f}
          </button>
        ))}
      </div>
    )}

    {/* Search + date range */}
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
      <span style={{ fontSize: 13, color: cs.muted }}>{filtered.length} transaksi</span>
      <span style={{ fontWeight: 700, fontSize: 16, color: cs.red }}>Total: Rp {grandTotal.toLocaleString("id-ID")}</span>
    </div>

    {/* Table */}
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
      {pageData.length === 0
        ? <div style={{ padding: "40px", textAlign: "center", color: cs.muted }}>Tidak ada data biaya.</div>
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
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: cs.red, whiteSpace: "nowrap" }}>
              Rp {Number(item.amount || 0).toLocaleString("id-ID")}
            </div>
            {isOwnerAdmin && (
              <div style={{ display: "flex", gap: 6 }}>
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

    {/* Modal Add/Edit */}
    {modalExpense && (
      <div style={{
        position: "fixed", inset: 0, background: "#00000099", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16
      }}
        onClick={e => { if (e.target === e.currentTarget) { setModalExpense(false); resetForm(); } }}>
        <div style={{
          background: cs.bg, border: "1px solid " + cs.border, borderRadius: 16,
          padding: 24, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto"
        }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: cs.text, marginBottom: 16 }}>
            {editExpenseItem ? "✏️ Edit Biaya" : "➕ Tambah Biaya"}
          </div>
          {/* Category */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Kategori</label>
            <select value={newExpenseForm.category}
              onChange={e => setNewExpenseForm(p => ({ ...p, category: e.target.value, subcategory: "" }))}
              style={{
                width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                color: cs.text, padding: "9px 12px", fontSize: 13
              }}>
              <option value="petty_cash">💰 Petty Cash</option>
              <option value="material_purchase">🔧 Pembelian Material</option>
            </select>
          </div>
          {/* Subcategory */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Sub-kategori *</label>
            <select value={newExpenseForm.subcategory}
              onChange={e => setNewExpenseForm(p => ({ ...p, subcategory: e.target.value }))}
              style={{
                width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                color: cs.text, padding: "9px 12px", fontSize: 13
              }}>
              <option value="">-- Pilih --</option>
              {(newExpenseForm.category === "material_purchase" ? MATERIAL_SUBS : PETTY_CASH_SUBS).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {/* Amount */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Jumlah (Rp) *</label>
            <input type="number" value={newExpenseForm.amount}
              onChange={e => setNewExpenseForm(p => ({ ...p, amount: e.target.value }))}
              placeholder="50000"
              style={{
                width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                color: cs.text, padding: "9px 12px", fontSize: 13, boxSizing: "border-box"
              }} />
          </div>
          {/* Date */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Tanggal *</label>
            <input type="date" value={newExpenseForm.date}
              onChange={e => setNewExpenseForm(p => ({ ...p, date: e.target.value }))}
              style={{
                width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                color: cs.text, padding: "9px 12px", fontSize: 13, boxSizing: "border-box"
              }} />
          </div>
          {/* Teknisi name (for petty_cash like Kasbon/Lembur/Bonus) */}
          {newExpenseForm.category === "petty_cash" && ["Kasbon Karyawan", "Lembur", "Bonus"].includes(newExpenseForm.subcategory) && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Nama Karyawan</label>
              <input value={newExpenseForm.teknisi_name}
                onChange={e => setNewExpenseForm(p => ({ ...p, teknisi_name: e.target.value }))}
                placeholder="Nama teknisi/helper..."
                style={{
                  width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                  color: cs.text, padding: "9px 12px", fontSize: 13, boxSizing: "border-box"
                }} />
            </div>
          )}
          {/* Item name + freon type for material */}
          {newExpenseForm.category === "material_purchase" && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Nama / Spesifikasi Barang</label>
                <input value={newExpenseForm.item_name}
                  onChange={e => setNewExpenseForm(p => ({ ...p, item_name: e.target.value }))}
                  placeholder="misal: Pipa 3/8 × 5/8 — 15m"
                  style={{
                    width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                    color: cs.text, padding: "9px 12px", fontSize: 13, boxSizing: "border-box"
                  }} />
              </div>
              {newExpenseForm.subcategory === "Freon" && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Jenis Freon</label>
                  <select value={newExpenseForm.freon_type}
                    onChange={e => setNewExpenseForm(p => ({ ...p, freon_type: e.target.value }))}
                    style={{
                      width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                      color: cs.text, padding: "9px 12px", fontSize: 13
                    }}>
                    <option value="">-- Pilih --</option>
                    {["R22", "R32", "R410A", "R134a", "R404A", "Lainnya"].map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          {/* Description */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Keterangan</label>
            <textarea value={newExpenseForm.description}
              onChange={e => setNewExpenseForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Keterangan tambahan..."
              rows={3}
              style={{
                width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                color: cs.text, padding: "9px 12px", fontSize: 13, resize: "vertical", boxSizing: "border-box"
              }} />
          </div>
          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { setModalExpense(false); resetForm(); }}
              style={{
                flex: 1, background: "transparent", border: "1px solid " + cs.border, borderRadius: 10,
                color: cs.muted, padding: "10px", cursor: "pointer", fontSize: 13
              }}>
              Batal
            </button>
            <button onClick={saveExpense}
              style={{
                flex: 2, background: "linear-gradient(135deg," + cs.accent + "," + cs.ara + ")", border: "none",
                color: "#fff", padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13
              }}>
              {editExpenseItem ? "Simpan Perubahan" : "Simpan"}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);
}

export default memo(ExpensesView);
