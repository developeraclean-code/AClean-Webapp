import { useState, useEffect, useMemo } from "react";
import { cs } from "../theme/cs.js";

// MaterialBringModal — teknisi/helper declare material yang dibawa per job sebelum berangkat.
// Pre-fill laporan + soft-reserve stok di inventory_units (status=BROUGHT).
//
// Props:
// - open: boolean
// - onClose: () => void
// - job: { id, customer, date, service, teknisi, helper, helper2, helper3 }
// - currentUser: { name, role }
// - inventoryData: list inventory items (untuk filter material_type)
// - invUnitsData: list inventory_units active
// - supabase
// - showNotif: (msg, type) => void
// - onSaved: () => void
export default function MaterialBringModal({
  open, onClose, job, currentUser, inventoryData, invUnitsData, supabase, showNotif, onSaved,
}) {
  const [activeTab, setActiveTab] = useState("freon"); // freon | pipa | kabel
  const [picked, setPicked] = useState({}); // unit_id → { qty_estimate, notes }
  const [existing, setExisting] = useState([]); // existing brought rows for this job
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetch existing brought rows untuk job ini
  useEffect(() => {
    if (!open || !job?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("job_materials_brought")
        .select("*")
        .eq("job_id", job.id)
        .neq("status", "CANCELLED")
        .order("brought_at", { ascending: true });
      if (!cancelled) {
        const rows = data || [];
        setExisting(rows);
        // Pre-populate picked dari existing
        const seed = {};
        rows.forEach(r => {
          if (r.unit_id && r.status !== "CANCELLED") {
            seed[r.unit_id] = { qty_estimate: r.qty_estimate, notes: r.notes || "", existingId: r.id, status: r.status };
          }
        });
        setPicked(seed);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, job?.id, supabase]);

  // Build list units per material_type
  const unitsByType = useMemo(() => {
    const groups = { freon: [], pipa: [], kabel: [] };
    (invUnitsData || []).forEach(u => {
      if (!u.is_active || u.archived) return;
      const inv = (inventoryData || []).find(i => i.code === u.inventory_code);
      if (!inv) return;
      const mt = (inv.material_type || "").toLowerCase();
      if (!groups[mt]) return;
      groups[mt].push({
        ...u,
        inv_name: inv.name,
        inv_unit: inv.unit || (mt === "freon" ? "kg" : "m"),
      });
    });
    // Sort by stock DESC dalam tiap group
    Object.keys(groups).forEach(k => {
      groups[k].sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0));
    });
    return groups;
  }, [invUnitsData, inventoryData]);

  // Reserved count per unit (untuk warning kalau unit sudah dibawa job lain hari ini)
  const [reservedMap, setReservedMap] = useState({});
  useEffect(() => {
    if (!open || !job?.id || !job?.date) return;
    (async () => {
      const { data } = await supabase.from("job_materials_brought")
        .select("unit_id, job_id, brought_by, status")
        .eq("status", "BROUGHT")
        .neq("job_id", job.id);
      const map = {};
      (data || []).forEach(r => {
        if (!r.unit_id) return;
        if (!map[r.unit_id]) map[r.unit_id] = [];
        map[r.unit_id].push({ job_id: r.job_id, by: r.brought_by });
      });
      setReservedMap(map);
    })();
  }, [open, job?.id, job?.date, supabase]);

  if (!open) return null;

  const tabs = [
    { key: "freon", label: "Freon", icon: "❄️" },
    { key: "pipa", label: "Pipa Hoda", icon: "🪈" },
    { key: "kabel", label: "Kabel", icon: "🔌" },
  ];

  const togglePick = (unitId, defaultQty) => {
    setPicked(p => {
      if (p[unitId]) {
        const n = { ...p };
        delete n[unitId];
        return n;
      }
      return { ...p, [unitId]: { qty_estimate: defaultQty || null, notes: "" } };
    });
  };

  const updatePick = (unitId, patch) => {
    setPicked(p => ({ ...p, [unitId]: { ...(p[unitId] || {}), ...patch } }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const broughtBy = currentUser?.name || "Unknown";

      // Determine: insert new, update existing qty, cancel removed
      const existingByUnit = {};
      existing.forEach(r => { if (r.unit_id && r.status !== "CANCELLED") existingByUnit[r.unit_id] = r; });

      const toInsert = [];
      const toUpdate = [];
      const toCancel = [];

      // Insert/update from picked
      for (const [unitId, info] of Object.entries(picked)) {
        const ex = existingByUnit[unitId];
        const u = (invUnitsData || []).find(x => x.id === unitId);
        const inv = (inventoryData || []).find(i => i.code === u?.inventory_code);
        const payload = {
          job_id: job.id,
          unit_id: unitId,
          inventory_code: u?.inventory_code,
          inventory_name: inv?.name,
          unit_label: u?.unit_label,
          material_type: (inv?.material_type || "").toLowerCase(),
          qty_estimate: info.qty_estimate || null,
          brought_by: broughtBy,
          notes: info.notes || null,
          status: ex?.status || "BROUGHT",
          updated_at: now,
        };
        if (ex) {
          toUpdate.push({ id: ex.id, ...payload });
        } else {
          toInsert.push({ ...payload, brought_at: now });
        }
      }

      // Cancel removed: existing yang BROUGHT tapi tidak di-pick lagi
      existing.forEach(r => {
        if (r.unit_id && r.status === "BROUGHT" && !picked[r.unit_id]) {
          toCancel.push(r.id);
        }
      });

      if (toInsert.length > 0) {
        const { error } = await supabase.from("job_materials_brought").insert(toInsert);
        if (error) throw error;
      }
      for (const u of toUpdate) {
        const { id, ...payload } = u;
        const { error } = await supabase.from("job_materials_brought").update(payload).eq("id", id);
        if (error) throw error;
      }
      if (toCancel.length > 0) {
        const { error } = await supabase.from("job_materials_brought")
          .update({ status: "CANCELLED", updated_at: now })
          .in("id", toCancel);
        if (error) throw error;
      }

      showNotif(`✅ Material tersimpan (${Object.keys(picked).length} unit)`, "success");
      onSaved && onSaved();
      onClose();
    } catch (e) {
      showNotif("❌ Gagal simpan: " + (e?.message || e), "error");
    } finally {
      setSaving(false);
    }
  };

  const pickedCount = Object.keys(picked).length;
  const tabCount = (type) => {
    return Object.entries(picked).filter(([uid]) => {
      const u = (invUnitsData || []).find(x => x.id === uid);
      const inv = (inventoryData || []).find(i => i.code === u?.inventory_code);
      return (inv?.material_type || "").toLowerCase() === type;
    }).length;
  };

  const list = unitsByType[activeTab] || [];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14,
        maxWidth: 560, width: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: cs.text }}>📦 Bawa Material</div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
              {job?.id} · {job?.customer} · {job?.date}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", padding: 4,
          }}>×</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 6, padding: "10px 12px 6px 12px", borderBottom: "1px solid " + cs.border }}>
          {tabs.map(t => {
            const cnt = tabCount(t.key);
            const active = activeTab === t.key;
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                flex: 1, padding: "8px 6px", borderRadius: 8,
                background: active ? cs.accent + "22" : cs.card,
                border: "1px solid " + (active ? cs.accent + "66" : cs.border),
                color: active ? cs.accent : cs.text, cursor: "pointer", fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              }}>
                <span>{t.icon}</span>
                <span>{t.label}</span>
                {cnt > 0 && (
                  <span style={{
                    background: cs.accent, color: "#fff", fontSize: 10, fontWeight: 800,
                    padding: "1px 6px", borderRadius: 99, marginLeft: 2,
                  }}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Info */}
        <div style={{ padding: "8px 14px", fontSize: 11, color: cs.muted, background: cs.card, borderBottom: "1px solid " + cs.border }}>
          ℹ️ Pilih tabung/roll yang akan dibawa. Saat input laporan, item ini auto-prefilled.
          Unit yang dipilih akan ter-reserve sementara biar tidak rebutan dengan tim lain.
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {loading ? (
            <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>Memuat...</div>
          ) : list.length === 0 ? (
            <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>
              Tidak ada unit aktif kategori ini di inventory.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {list.map(u => {
                const isPicked = !!picked[u.id];
                const stockNum = Number(u.stock || 0);
                const cap = Number(u.capacity || 0);
                const ratio = cap > 0 ? Math.min(1, stockNum / cap) : 0.5;
                const stockColor = stockNum <= Number(u.min_visible || 0) ? "#ef4444"
                  : ratio < 0.3 ? "#f59e0b" : "#10b981";
                const reservedByOther = (reservedMap[u.id] || []).length > 0;
                const displayStock = activeTab === "freon" ? stockNum.toFixed(1) : Math.floor(stockNum);
                return (
                  <div key={u.id} style={{
                    border: "1px solid " + (isPicked ? cs.accent + "88" : cs.border),
                    background: isPicked ? cs.accent + "10" : cs.card,
                    borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8,
                  }}>
                    <div onClick={() => togglePick(u.id, activeTab === "freon" ? 1.5 : activeTab === "pipa" ? 5 : 3)}
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                        border: "2px solid " + (isPicked ? cs.accent : cs.border),
                        background: isPicked ? cs.accent : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontSize: 13, fontWeight: 800,
                      }}>{isPicked ? "✓" : ""}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: cs.text, display: "flex", alignItems: "center", gap: 6 }}>
                          {u.unit_label}
                          {reservedByOther && (
                            <span title="Dibawa tim lain hari ini" style={{
                              fontSize: 9, background: "#f59e0b22", color: "#f59e0b",
                              padding: "1px 6px", borderRadius: 99, fontWeight: 700,
                            }}>⚠ dipakai tim lain</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>
                          {u.inv_name} · {u.inventory_code}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: stockColor }}>
                          {displayStock} {u.inv_unit}
                        </div>
                        <div style={{
                          width: 60, height: 4, background: cs.border, borderRadius: 99, marginTop: 4, overflow: "hidden",
                        }}>
                          <div style={{
                            width: (ratio * 100) + "%", height: "100%", background: stockColor,
                          }} />
                        </div>
                      </div>
                    </div>
                    {isPicked && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 6, marginLeft: 32 }}>
                        <div>
                          <div style={{ fontSize: 9, color: cs.muted, marginBottom: 2 }}>Qty estimasi (opsional)</div>
                          <input type="number" min="0" step="0.1" placeholder={u.inv_unit}
                            value={picked[u.id]?.qty_estimate || ""}
                            onChange={e => updatePick(u.id, { qty_estimate: e.target.value ? Number(e.target.value) : null })}
                            style={{
                              width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                              borderRadius: 6, padding: "5px 8px", color: cs.text, fontSize: 12, outline: "none",
                            }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: cs.muted, marginBottom: 2 }}>Catatan (opsional)</div>
                          <input type="text" placeholder="mis. tukar dgn tabung Aris"
                            value={picked[u.id]?.notes || ""}
                            onChange={e => updatePick(u.id, { notes: e.target.value })}
                            style={{
                              width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                              borderRadius: 6, padding: "5px 8px", color: cs.text, fontSize: 12, outline: "none",
                            }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 14px", borderTop: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, color: cs.muted }}>
            {pickedCount} unit dipilih
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{
              background: "transparent", border: "1px solid " + cs.border, color: cs.muted,
              borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: saving ? "not-allowed" : "pointer", fontWeight: 600,
            }}>Batal</button>
            <button onClick={handleSave} disabled={saving} style={{
              background: cs.accent, border: "none", color: "#fff",
              borderRadius: 8, padding: "8px 16px", fontSize: 12, cursor: saving ? "not-allowed" : "pointer", fontWeight: 700,
              opacity: saving ? 0.6 : 1,
            }}>{saving ? "Menyimpan..." : "Simpan"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
