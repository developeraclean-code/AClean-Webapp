import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

const PETTY_CASH_SUBS = ["Bensin Motor", "Perbaikan Motor", "Parkir", "Kasbon Karyawan", "Lembur", "Bonus", "Lain-lain"];
const MATERIAL_SUBS = ["Pipa AC", "Kabel", "Freon", "Material Lain"];
const FREON_TYPES = ["R22", "R32", "R410A", "R134a", "R404A", "Lainnya"];

const inp = (err) => ({
  width: "100%", background: cs.surface,
  border: "1px solid " + (err ? cs.red : cs.border),
  borderRadius: 8, padding: "9px 12px", color: cs.text,
  fontSize: 13, outline: "none", boxSizing: "border-box",
});
const lbl = { fontSize: 11, color: cs.muted, marginBottom: 4, display: "block", fontWeight: 600 };
const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" };
const secTitle = { fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 };

export default function ExpenseFormModal({
  open, onClose,
  editExpenseItem,
  newExpenseForm, setNewExpenseForm,
  teknisiData, userAccounts,
  currentUser, supabase,
  insertExpense, updateExpense,
  auditUserName,
  showNotif, TODAY,
  setExpensesData, setPendingAi,
  fmt,
}) {
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
  }, [open]);

  if (!open) return null;

  const set = (key, val) => {
    setNewExpenseForm(f => ({ ...f, [key]: val }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: "" }));
  };

  const subs = newExpenseForm.category === "material_purchase" ? MATERIAL_SUBS : PETTY_CASH_SUBS;
  const isKasbonLemburBonus = newExpenseForm.category === "petty_cash" && ["Kasbon Karyawan", "Lembur", "Bonus"].includes(newExpenseForm.subcategory);
  const isPendingAiItem = editExpenseItem?.validation_status === "PENDING_AI";
  const ai = editExpenseItem?.ai_extractions || {};
  const confColor = ai.confidence === "HIGH" ? cs.green : ai.confidence === "MEDIUM" ? cs.yellow : cs.red;

  const namesSet = new Set();
  [...(teknisiData || []), ...(userAccounts || [])]
    .filter(u => ["Teknisi", "Helper"].includes(u.role))
    .forEach(u => { if (u.name) namesSet.add(u.name.trim()); });
  const nameOptions = [...namesSet].sort((a, b) => a.localeCompare(b));

  const validate = () => {
    const e = {};
    if (!newExpenseForm.subcategory) e.subcategory = "Sub-kategori wajib dipilih";
    if (!newExpenseForm.amount) e.amount = "Jumlah wajib diisi";
    if (!newExpenseForm.date) e.date = "Tanggal wajib diisi";
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const f = newExpenseForm;
      const payload = {
        category: f.category,
        subcategory: f.subcategory,
        amount: Number(f.amount),
        date: f.date,
        description: f.description,
        teknisi_name: f.teknisi_name ? f.teknisi_name.trim() : null,
        item_name: f.item_name || null,
        freon_type: f.freon_type || null,
        created_by: currentUser?.name || currentUser?.email || "unknown",
      };
      if (editExpenseItem) {
        if (isPendingAiItem) {
          payload.validation_status = "APPROVED";
          if (editExpenseItem.ai_extraction_id) {
            supabase.from("ai_extractions").update({ status: "edited" }).eq("id", editExpenseItem.ai_extraction_id).then(() => {}, () => {});
          }
        }
        const { error } = await updateExpense(supabase, editExpenseItem.id, payload, auditUserName());
        if (error) { showNotif?.("❌ Gagal update biaya: " + error.message); return; }
        setExpensesData(prev => prev.map(x => x.id === editExpenseItem.id ? { ...x, ...payload } : x));
        if (isPendingAiItem) setPendingAi?.(prev => prev.filter(x => x.id !== editExpenseItem.id));
        showNotif?.(`✅ Biaya ${payload.subcategory} (${fmt(payload.amount)}) diperbarui`);
      } else {
        const { data, error } = await insertExpense(supabase, { ...payload, last_changed_by: auditUserName() });
        if (error) { showNotif?.("❌ Gagal simpan biaya: " + error.message); return; }
        setExpensesData(prev => [data, ...prev]);
        showNotif?.(`✅ Biaya ${payload.subcategory} (${fmt(payload.amount)}) tersimpan`);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 460, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: "16px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
              {editExpenseItem ? "✏️ Edit Biaya" : "➕ Tambah Biaya"}
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
              {editExpenseItem ? "Edit entri biaya operasional" : "Petty cash atau pembelian material"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Card 1 — Kategori */}
          <div style={card}>
            <div style={secTitle}>Kategori</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Kategori chip toggle */}
              <div style={{ display: "flex", gap: 8 }}>
                {[["petty_cash", "💰 Petty Cash"], ["material_purchase", "🔧 Material"]].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setNewExpenseForm(f => ({ ...f, category: val, subcategory: "" }))}
                    style={{ flex: 1, padding: "9px 10px", borderRadius: 10, border: "2px solid " + (newExpenseForm.category === val ? cs.accent : cs.border), background: newExpenseForm.category === val ? cs.accent + "22" : cs.surface, color: newExpenseForm.category === val ? cs.accent : cs.muted, fontWeight: newExpenseForm.category === val ? 700 : 400, cursor: "pointer", fontSize: 13 }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Sub-kategori */}
              <div>
                <label style={lbl}>Sub-kategori <span style={{ color: cs.red }}>*</span></label>
                <select
                  value={newExpenseForm.subcategory || ""}
                  onChange={e => { set("subcategory", e.target.value); }}
                  style={inp(errors.subcategory)}
                >
                  <option value="">— Pilih —</option>
                  {subs.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {errors.subcategory && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.subcategory}</div>}
              </div>
              {/* Tanggal */}
              <div>
                <label style={lbl}>Tanggal <span style={{ color: cs.red }}>*</span></label>
                <input
                  type="date"
                  value={newExpenseForm.date || TODAY}
                  onChange={e => set("date", e.target.value)}
                  style={inp(errors.date)}
                />
                {errors.date && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.date}</div>}
              </div>
            </div>
          </div>

          {/* Card 2 — Nominal & Detail */}
          <div style={card}>
            <div style={secTitle}>Nominal & Detail</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Jumlah */}
              <div>
                <label style={lbl}>Jumlah (Rp) <span style={{ color: cs.red }}>*</span></label>
                <input
                  type="number"
                  min="0"
                  value={newExpenseForm.amount || ""}
                  onChange={e => set("amount", e.target.value)}
                  placeholder="50000"
                  style={inp(errors.amount)}
                />
                {errors.amount && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>⚠ {errors.amount}</div>}
              </div>
              {/* Nama Karyawan (Kasbon/Lembur/Bonus) */}
              {isKasbonLemburBonus && (
                <div>
                  <label style={lbl}>Nama Karyawan</label>
                  <select
                    value={newExpenseForm.teknisi_name || ""}
                    onChange={e => set("teknisi_name", e.target.value)}
                    style={{ ...inp(false), borderColor: newExpenseForm.teknisi_name ? cs.border : cs.yellow + "66" }}
                  >
                    <option value="">— Pilih teknisi / helper —</option>
                    {nameOptions.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>Pilih dari preset agar kasbon terhitung di payroll mingguan</div>
                </div>
              )}
              {/* Item name + freon type (material) */}
              {newExpenseForm.category === "material_purchase" && (
                <>
                  <div>
                    <label style={lbl}>Nama / Spesifikasi Barang</label>
                    <input
                      value={newExpenseForm.item_name || ""}
                      onChange={e => set("item_name", e.target.value)}
                      placeholder="misal: Pipa 3/8 × 5/8 — 15m"
                      style={inp(false)}
                    />
                  </div>
                  {newExpenseForm.subcategory === "Freon" && (
                    <div>
                      <label style={lbl}>Jenis Freon</label>
                      <select
                        value={newExpenseForm.freon_type || ""}
                        onChange={e => set("freon_type", e.target.value)}
                        style={inp(false)}
                      >
                        <option value="">— Pilih —</option>
                        {FREON_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  )}
                </>
              )}
              {/* Keterangan */}
              <div>
                <label style={lbl}>Keterangan</label>
                <textarea
                  value={newExpenseForm.description || ""}
                  onChange={e => set("description", e.target.value)}
                  placeholder="Keterangan tambahan (opsional)..."
                  rows={3}
                  style={{ ...inp(false), resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                />
              </div>
            </div>
          </div>

          {/* Card 3 — AI Info (hanya jika PENDING_AI) */}
          {isPendingAiItem && (
            <div style={{ background: cs.accent + "08", border: "1px solid " + cs.accent + "33", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ ...secTitle, color: cs.accent + "aa" }}>Dari AI Vision</div>
              <div style={{ display: "flex", align: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: cs.muted }}>🤖 {ai.model || "AI"}</span>
                {ai.confidence && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: confColor + "22", color: confColor }}>{ai.confidence}</span>
                )}
              </div>
              {ai.notes && <div style={{ fontSize: 11, color: cs.muted, marginTop: 6, fontStyle: "italic" }}>🧠 {ai.notes}</div>}
              <div style={{ fontSize: 10, color: cs.muted, marginTop: 6 }}>Edit & simpan = auto-approve entri ini</div>
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "12px 20px", display: "flex", gap: 10, flexShrink: 0 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ flex: 2, background: saving ? cs.accent + "88" : `linear-gradient(135deg,${cs.accent},${cs.ara})`, border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: saving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Menyimpan..." : (editExpenseItem ? "✓ Simpan Perubahan" : "✓ Simpan Biaya")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BudgetModal({
  open, onClose,
  budgetForm, setBudgetForm,
  saveBudget, budgetSaving,
}) {
  if (!open || !budgetForm) return null;
  const subs = budgetForm.category === "material_purchase" ? MATERIAL_SUBS : PETTY_CASH_SUBS;
  const currentMonth = new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 18, width: "100%", maxWidth: 380, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>💰 Set Budget Bulanan</div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{currentMonth}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={lbl}>Kategori</label>
            <select
              value={budgetForm.category}
              onChange={e => setBudgetForm(f => ({ ...f, category: e.target.value, subcategory: null }))}
              style={inp(false)}
            >
              <option value="petty_cash">💰 Petty Cash</option>
              <option value="material_purchase">🔧 Pembelian Material</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Sub-kategori <span style={{ fontSize: 10, fontWeight: 400 }}>(kosongkan = semua)</span></label>
            <select
              value={budgetForm.subcategory || ""}
              onChange={e => setBudgetForm(f => ({ ...f, subcategory: e.target.value || null }))}
              style={inp(false)}
            >
              <option value="">-- Semua --</option>
              {subs.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Budget per Bulan (Rp)</label>
            <input
              type="number"
              min="0"
              value={budgetForm.amount || ""}
              onChange={e => setBudgetForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="500000"
              autoFocus
              style={inp(false)}
            />
            <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>Kosongkan / isi 0 untuk hapus budget</div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "12px 20px", display: "flex", gap: 10, flexShrink: 0 }}>
          <button
            onClick={onClose}
            disabled={budgetSaving}
            style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}
          >
            Batal
          </button>
          <button
            onClick={saveBudget}
            disabled={budgetSaving}
            style={{ flex: 2, background: budgetSaving ? cs.accent + "88" : `linear-gradient(135deg,${cs.accent},#3b82f6)`, border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: budgetSaving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13, opacity: budgetSaving ? 0.7 : 1 }}
          >
            {budgetSaving ? "Menyimpan..." : "✅ Simpan Budget"}
          </button>
        </div>
      </div>
    </div>
  );
}
