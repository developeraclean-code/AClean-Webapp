import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { buildMovementRows, reconcileMovement, movementStatus } from "../lib/materialMovement.js";

// Opsi dropdown → SKU stok kantor (terverifikasi migrasi 085)
const PIPA_OPTS = [
  { code: "SKU022", label: "1PK" }, { code: "SKU023", label: "2PK" },
  { code: "SKU024", label: "2.5PK" }, { code: "SKU057", label: "3PK" },
];
const KABEL_OPTS = [
  { code: "SKU025", label: "3x1,5" }, { code: "SKU026", label: "3x2,5" }, { code: "SKU028", label: "4x2,5" },
];
const optsFor = (cat) => (cat === "pipa" ? PIPA_OPTS : KABEL_OPTS);
const labelFor = (cat, code) => (optsFor(cat).find(o => o.code === code) || {}).label || code;

// Modal gabungan Bawa/Pulang (Pipa & Kabel). FASE 1: catat saja (deduct_status CROSSCHECK), tidak potong stok.
function MaterialMovementModal({ job, mode, onClose, supabase, currentUser, showNotif }) {
  const isBawa = mode === "bawa";
  const [rows, setRows] = useState([]);        // {category, inventory_code, type_label, qty_bawa, qty_pulang}
  const [reported, setReported] = useState({}); // {code: meter} dari laporan job
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: mv } = await supabase.from("material_job_movement")
      .select("*").eq("job_id", job.id).in("category", ["pipa", "kabel"]).order("created_at");
    const existing = (mv || []).map(r => ({
      id: r.id, category: r.category, inventory_code: r.inventory_code, type_label: r.type_label,
      qty_bawa: r.qty_bawa, qty_pulang: r.qty_pulang,
    }));
    setRows(existing.length ? existing : []);
    // pemakaian dilaporkan (cross-check) dari inventory_transactions job ini
    const { data: tx } = await supabase.from("inventory_transactions")
      .select("inventory_code,qty,type").eq("order_id", job.id).eq("type", "usage");
    const rep = {};
    (tx || []).forEach(t => { rep[t.inventory_code] = (rep[t.inventory_code] || 0) + Math.abs(Number(t.qty) || 0); });
    setReported(rep);
  }, [supabase, job.id]);

  useEffect(() => { load(); }, [load]);

  const addRow = (category) => setRows(r => [...r, { category, inventory_code: optsFor(category)[0].code, type_label: optsFor(category)[0].label, qty_bawa: "", qty_pulang: "" }]);
  const setRow = (i, patch) => setRows(r => r.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const delRow = (i) => setRows(r => r.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true);
    try {
      for (const row of rows) {
        if (!row.inventory_code) continue;
        const base = {
          job_id: job.id, category: row.category, inventory_code: row.inventory_code,
          type_label: labelFor(row.category, row.inventory_code),
          brought_by: currentUser?.name || null, updated_at: new Date().toISOString(),
        };
        if (isBawa) base.qty_bawa = parseFloat(row.qty_bawa) || 0;
        else { base.qty_pulang = (row.qty_pulang === "" || row.qty_pulang == null) ? null : parseFloat(row.qty_pulang); base.returned_at = new Date().toISOString(); }
        if (row.id) await supabase.from("material_job_movement").update(base).eq("id", row.id);
        else if (isBawa) await supabase.from("material_job_movement").insert(base);
      }
      showNotif(`✅ Material ${isBawa ? "bawa" : "pulang"} tersimpan`);
      await load();
      if (!isBawa) onClose();
    } catch (e) { showNotif("❌ Gagal simpan: " + (e?.message || e)); }
    finally { setBusy(false); }
  };

  // cross-check (mode pulang): used vs reported
  const lines = !isBawa ? reconcileMovement(buildMovementRows(
    rows.map(r => ({ category: r.category, inventory_code: r.inventory_code, type_label: r.type_label, qty: r.qty_bawa })),
    rows.filter(r => r.qty_pulang !== "" && r.qty_pulang != null).map(r => ({ category: r.category, inventory_code: r.inventory_code, qty: r.qty_pulang })),
  ), reported) : [];

  const inp = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 14, outline: "none" };
  const flagColor = { OK: "#10b981", OVER: "#ef4444", UNDER: "#f59e0b", PENDING_PULANG: "#9ca3af" };

  const Section = ({ category, title }) => {
    const catRows = rows.map((r, i) => ({ r, i })).filter(x => x.r.category === category);
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{title}</div>
          {isBawa && <button onClick={() => addRow(category)} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Baris</button>}
        </div>
        {catRows.length === 0 && <div style={{ fontSize: 12, color: cs.muted }}>—</div>}
        {catRows.map(({ r, i }) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5 }}>
            <select value={r.inventory_code} disabled={!isBawa} onChange={e => setRow(i, { inventory_code: e.target.value, type_label: labelFor(category, e.target.value) })} style={{ ...inp, flex: 1.2 }}>
              {optsFor(category).map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
            <input type="number" inputMode="decimal" placeholder="bawa (m)" value={r.qty_bawa} disabled={!isBawa}
              onChange={e => setRow(i, { qty_bawa: e.target.value })} style={{ ...inp, width: 90 }} />
            {!isBawa && <input type="number" inputMode="decimal" placeholder="pulang (m)" value={r.qty_pulang ?? ""}
              onChange={e => setRow(i, { qty_pulang: e.target.value })} style={{ ...inp, width: 90 }} />}
            {isBawa && <button onClick={() => delRow(i)} style={{ background: "none", border: "none", color: cs.red, cursor: "pointer", fontSize: 18 }}>×</button>}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 650, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: cs.panel, borderRadius: "16px 16px 0 0", padding: 18, width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: cs.text }}>{isBawa ? "📦 Material Bawa" : "📥 Material Pulang"}</div>
            <div style={{ fontSize: 12, color: cs.muted }}>{job.id} · {job.customer} · {job.date}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: cs.muted, background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "7px 10px", margin: "8px 0 14px" }}>
          {isBawa ? "Catat pipa & kabel yang dibawa untuk job ini. Freon dicatat di menu Material Harian (timbang harian)." : "Isi sisa yang dikembalikan. Terpakai = bawa − pulang, dibandingkan dengan yang dilaporkan."}
          <span style={{ color: cs.accent }}> (Fase 1: pencatatan saja, belum potong stok.)</span>
        </div>

        <Section category="pipa" title="🔧 Pipa AC" />
        <Section category="kabel" title="⚡ Kabel" />

        {!isBawa && lines.length > 0 && (
          <div style={{ marginTop: 6, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Cross-check (fisik vs dilaporkan): {movementStatus(lines)}</div>
            {lines.map((l, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderTop: "1px solid " + cs.border }}>
                <span style={{ color: cs.text }}>{labelFor(l.category, l.inventory_code)} ({l.category})</span>
                <span style={{ color: cs.muted }}>pakai {l.used ?? "—"} · lapor {l.reported} · selisih <b style={{ color: flagColor[l.flag] || cs.text }}>{l.selisih ?? "—"} [{l.flag}]</b></span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 8 }}>
          <button onClick={onClose} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: 12, borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Tutup</button>
          <button disabled={busy} onClick={save} style={{ background: busy ? cs.border : "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: 12, borderRadius: 10, cursor: "pointer", fontWeight: 800 }}>
            {busy ? "Menyimpan…" : isBawa ? "Simpan Bawa" : "Simpan Pulang"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MaterialMovementModal;
