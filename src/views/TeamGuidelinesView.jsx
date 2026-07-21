import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";

// TeamGuidelinesView — menu "Tata Tertib & Jobdesk".
// Konten dari tabel Supabase `team_guidelines` (migrasi 128). Teknisi/Helper baca;
// Owner/Admin bisa inline-edit teks tiap poin (edit teks saja — poin sudah fix).
// Struktur: 3 tab (Tata Tertib / Tugas & Kewajiban / Jobdesk); tab tugas & jobdesk
// punya sub-toggle Teknisi/Helper. RLS DB yang menjaga otorisasi write.
// Props: { supabase, currentUser, showNotif, showConfirm }

const TABS = [
  { key: "tata_tertib", label: "📋 Tata Tertib", roleScoped: false, color: cs.accent },
  { key: "tugas_kewajiban", label: "✅ Tugas & Kewajiban", roleScoped: true, color: cs.green },
  { key: "jobdesk", label: "🛠 Jobdesk", roleScoped: true, color: cs.yellow },
];

export default function TeamGuidelinesView({ supabase, currentUser, showNotif, showConfirm }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("tata_tertib");
  const [sub, setSub] = useState("teknisi"); // teknisi | helper (untuk tab role-scoped)
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");

  const canEdit = currentUser?.role === "Owner" || currentUser?.role === "Admin";

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("team_guidelines")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) showNotif?.("Gagal load: " + error.message);
    else setRows(data || []);
    setLoading(false);
  }, [supabase, showNotif]);

  useEffect(() => { load(); }, [load]);

  const tabCfg = TABS.find((t) => t.key === tab);
  const scope = tabCfg.roleScoped ? sub : "all";
  const items = rows
    .filter((r) => r.section === tab && r.role_scope === scope && (canEdit || (r.content || "").trim() !== ""))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const startEdit = (row) => { setEditId(row.id); setDraft(row.content || ""); };
  const cancelEdit = () => { setEditId(null); setDraft(""); };
  const cancelAdd = () => { setAdding(false); setNewText(""); };

  const handleAdd = async () => {
    const text = newText.trim();
    if (!text || saving) return;
    setSaving(true);
    const maxOrder = rows
      .filter((r) => r.section === tab && r.role_scope === scope)
      .reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
    const payload = { section: tab, role_scope: scope, content: text, sort_order: maxOrder + 1, updated_by: currentUser?.name || null };
    const { data, error } = await supabase.from("team_guidelines").insert(payload).select().single();
    setSaving(false);
    if (error) { showNotif?.("Gagal tambah: " + error.message); return; }
    setRows((prev) => [...prev, data]);
    showNotif?.("✅ Poin ditambahkan");
    cancelAdd();
  };

  const handleDelete = async (row) => {
    const ok = showConfirm
      ? await showConfirm({ icon: "🗑️", title: "Hapus poin?", danger: true, message: "Hapus poin ini permanen?", confirmText: "Hapus" })
      : window.confirm("Hapus poin ini?");
    if (!ok) return;
    const { error } = await supabase.from("team_guidelines").delete().eq("id", row.id);
    if (error) { showNotif?.("Gagal hapus: " + error.message); return; }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    showNotif?.("🗑️ Poin dihapus");
  };

  const saveEdit = async (row) => {
    if (saving) return;
    setSaving(true);
    const patch = { content: draft, updated_at: new Date().toISOString(), updated_by: currentUser?.name || null };
    const { error } = await supabase.from("team_guidelines").update(patch).eq("id", row.id);
    setSaving(false);
    if (error) { showNotif?.("Gagal simpan: " + error.message); return; }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    showNotif?.("✅ Poin diperbarui");
    cancelEdit();
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: cs.text }}>📋 Tata Tertib & Jobdesk</div>
        <div style={{ fontSize: 13, color: cs.muted, marginTop: 2 }}>
          Acuan aturan, tugas, dan jobdesk tim AClean.
          {canEdit && <span style={{ color: cs.accent }}> Kamu bisa edit teks tiap poin (✏️).</span>}
        </div>
      </div>

      {/* Tab utama */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); cancelEdit(); cancelAdd(); }}
              style={{
                padding: "9px 14px", borderRadius: 99, cursor: "pointer", fontSize: 13, fontWeight: 700,
                border: "1px solid " + (active ? t.color : cs.border),
                background: active ? t.color : cs.surface,
                color: active ? "#0a0f1e" : cs.muted,
              }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Sub-toggle Teknisi/Helper */}
      {tabCfg.roleScoped && (
        <div style={{ display: "flex", gap: 4, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 4, marginBottom: 14, width: "fit-content" }}>
          {["teknisi", "helper"].map((s) => (
            <button key={s} onClick={() => { setSub(s); cancelEdit(); cancelAdd(); }}
              style={{
                padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                background: sub === s ? cs.accent : "transparent", color: sub === s ? "#0a0f1e" : cs.muted,
                textTransform: "capitalize",
              }}>
              {s === "teknisi" ? "🔧 Teknisi" : "🧢 Helper"}
            </button>
          ))}
        </div>
      )}

      {/* Daftar poin */}
      {loading ? (
        <div style={{ textAlign: "center", color: cs.muted, fontSize: 13, padding: 24 }}>Memuat…</div>
      ) : items.length === 0 ? (
        <div style={{ background: cs.surface, border: "1px dashed " + cs.border, borderRadius: 12, padding: 20, textAlign: "center", fontSize: 12.5, color: cs.muted }}>
          Belum ada isi untuk bagian ini.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((row, idx) => {
            const isEditing = editId === row.id;
            const empty = (row.content || "").trim() === "";
            return (
              <div key={row.id} style={{
                background: cs.card, border: "1px solid " + (isEditing ? cs.accent : cs.border),
                borderRadius: 10, padding: "11px 13px", display: "flex", gap: 11, alignItems: "flex-start",
              }}>
                <span style={{ flex: "none", width: 24, height: 24, borderRadius: 99, background: tabCfg.color + "22", color: tabCfg.color, fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  {idx + 1}
                </span>
                {isEditing ? (
                  <div style={{ flex: 1, display: "grid", gap: 8 }}>
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={3}
                      style={{ width: "100%", boxSizing: "border-box", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, lineHeight: 1.5, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => saveEdit(row)} disabled={saving}
                        style={{ padding: "6px 14px", background: cs.green, color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                        {saving ? "…" : "Simpan"}
                      </button>
                      <button onClick={cancelEdit}
                        style={{ padding: "6px 12px", background: cs.surface, color: cs.muted, border: "1px solid " + cs.border, borderRadius: 7, cursor: "pointer", fontSize: 12 }}>
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1, fontSize: 13, color: empty ? cs.muted : cs.text, lineHeight: 1.55, fontStyle: empty ? "italic" : "normal", paddingTop: 2 }}>
                      {empty ? "(kosong — klik ✏️ untuk isi)" : row.content}
                    </div>
                    {canEdit && (
                      <div style={{ flex: "none", display: "flex", gap: 5 }}>
                        <button onClick={() => startEdit(row)}
                          style={{ padding: "4px 9px", background: cs.accent + "22", color: cs.accent, border: "1px solid " + cs.accent + "44", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                          ✏️
                        </button>
                        <button onClick={() => handleDelete(row)}
                          style={{ padding: "4px 9px", background: cs.red + "22", color: cs.red, border: "1px solid " + cs.red + "44", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                          🗑️
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tambah poin baru (Owner/Admin) */}
      {canEdit && !loading && (
        <div style={{ marginTop: 12 }}>
          {adding ? (
            <div style={{ background: cs.card, border: "1px solid " + cs.accent, borderRadius: 10, padding: "11px 13px", display: "grid", gap: 8 }}>
              <textarea value={newText} onChange={(e) => setNewText(e.target.value)} autoFocus rows={3}
                placeholder="Tulis poin baru…"
                style={{ width: "100%", boxSizing: "border-box", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, lineHeight: 1.5, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={handleAdd} disabled={saving || !newText.trim()}
                  style={{ padding: "7px 16px", background: newText.trim() ? cs.green : cs.muted + "44", color: newText.trim() ? "#fff" : cs.muted, border: "none", borderRadius: 7, fontWeight: 700, cursor: newText.trim() && !saving ? "pointer" : "not-allowed", fontSize: 12 }}>
                  {saving ? "…" : "+ Tambah"}
                </button>
                <button onClick={cancelAdd}
                  style={{ padding: "7px 12px", background: cs.surface, color: cs.muted, border: "1px solid " + cs.border, borderRadius: 7, cursor: "pointer", fontSize: 12 }}>
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setAdding(true); cancelEdit(); }}
              style={{ width: "100%", padding: "11px", background: "transparent", border: "1px dashed " + cs.border, color: cs.accent, borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              + Tambah Poin
            </button>
          )}
        </div>
      )}
    </div>
  );
}
