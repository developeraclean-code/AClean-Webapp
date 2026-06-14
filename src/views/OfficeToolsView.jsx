import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { summarizeTools } from "../lib/officeTools.js";

const KAT_OPT = ["Power Tool", "AC Tool", "Safety", "Akses", "Ukur", "Umum"];
const KON_OPT = ["baik", "rusak", "servis"];

// Inventori → Alat Kantor. Registry alat (bor, vacuum, tambang) + status keluar/tersedia + riwayat gerak.
function OfficeToolsView({ supabase, currentUser, showNotif, showConfirm }) {
  const isOwnerAdmin = currentUser?.role === "Owner" || currentUser?.role === "Admin"; // tambah & edit
  const isOwner = currentUser?.role === "Owner";                                       // hapus only
  const [tools, setTools] = useState([]);
  const [moves, setMoves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expand, setExpand] = useState(null);   // tool id riwayat terbuka
  const [form, setForm] = useState(null);        // {id?, nama, kategori, qty, kondisi, catatan}
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: t }, { data: m }] = await Promise.all([
      supabase.from("office_tools").select("*").order("nama"),
      supabase.from("office_tool_movement").select("*").order("checkout_at", { ascending: false }).limit(300),
    ]);
    setTools(t || []); setMoves(m || []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const activeTools = tools.filter((t) => t.aktif !== false);
  const status = summarizeTools(activeTools, moves.filter((m) => m.status === "OUT"));

  const save = async () => {
    if (!form?.nama?.trim()) return showNotif("Nama alat wajib diisi");
    setBusy(true);
    try {
      const row = {
        nama: form.nama.trim(), kategori: form.kategori || "Umum",
        qty: parseInt(form.qty, 10) || 1, kondisi: form.kondisi || "baik",
        catatan: form.catatan || "", updated_at: new Date().toISOString(),
      };
      if (form.id) { const { error } = await supabase.from("office_tools").update(row).eq("id", form.id); if (error) throw error; }
      else { const { error } = await supabase.from("office_tools").insert(row); if (error) throw error; }
      showNotif("✅ Alat tersimpan"); setForm(null); await load();
    } catch (e) { showNotif("❌ Gagal: " + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const del = (t) => {
    if (!isOwner) return showNotif("Hapus alat hanya untuk Owner");
    showConfirm(`Hapus alat "${t.nama}"? Riwayat geraknya ikut terhapus.`, async () => {
    const { error } = await supabase.from("office_tools").delete().eq("id", t.id);
    if (error) return showNotif("❌ Gagal hapus: " + error.message);
    showNotif("🗑 Alat dihapus"); await load();
    });
  };

  const th = { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: cs.muted, textTransform: "uppercase", letterSpacing: ".5px" };
  const td = { padding: "9px 12px", fontSize: 13, color: cs.text };
  const inp = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" };
  const totalOut = activeTools.reduce((s, t) => s + (status[t.id]?.out || 0), 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>🛠 Alat Kantor <span style={{ fontSize: 12, color: cs.muted, fontWeight: 500 }}>({activeTools.length} jenis · {totalOut} unit sedang dibawa)</span></div>
        {isOwnerAdmin && <button onClick={() => setForm({ nama: "", kategori: "Umum", qty: 1, kondisi: "baik", catatan: "" })} style={{ background: "#f59e0b", border: "none", color: "#0a0f1e", padding: "9px 18px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+ Tambah Alat</button>}
      </div>
      <div style={{ fontSize: 11, color: cs.muted }}>Alat dibawa/dikembalikan dari tombol <b>🛠 Bawa Alat</b> / <b>📥 Kembali Alat</b> di kartu job (Jadwal &amp; mobile teknisi) dan di detail project.</div>

      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: cs.surface, borderBottom: "1px solid " + cs.border }}>
            {["Alat", "Kategori", "Total", "Tersedia", "Dibawa", "Kondisi", isOwnerAdmin ? "Aksi" : ""].filter(Boolean).map((h) => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...td, color: cs.muted, textAlign: "center", padding: 20 }}>Memuat…</td></tr>
            ) : activeTools.length === 0 ? (
              <tr><td colSpan={7} style={{ ...td, color: cs.muted, textAlign: "center", padding: 20 }}>Belum ada alat. Klik + Tambah Alat.</td></tr>
            ) : activeTools.map((t, i) => {
              const st = status[t.id] || { total: t.qty, out: 0, available: t.qty, holders: [] };
              const hist = moves.filter((m) => m.tool_id === t.id);
              const open = expand === t.id;
              return (
                <>
                  <tr key={t.id} style={{ borderTop: "1px solid " + cs.border, background: i % 2 ? cs.surface + "80" : "transparent" }}>
                    <td style={{ ...td, fontWeight: 600 }}>{t.nama}</td>
                    <td style={{ ...td, color: cs.muted, fontSize: 12 }}>{t.kategori}</td>
                    <td style={td}>{st.total}</td>
                    <td style={{ ...td, fontWeight: 700, color: st.available > 0 ? "#10b981" : cs.red }}>{st.available}</td>
                    <td style={td}>
                      {st.out > 0 ? (
                        <button onClick={() => setExpand(open ? null : t.id)} style={{ background: "#f59e0b22", border: "1px solid #f59e0b44", color: "#f59e0b", borderRadius: 99, padding: "2px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                          {st.out} dibawa {open ? "▲" : "▼"}
                        </button>
                      ) : <span style={{ color: cs.muted, fontSize: 12 }}>—</span>}
                    </td>
                    <td style={td}><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 700, background: (t.kondisi === "baik" ? "#10b981" : t.kondisi === "servis" ? cs.yellow : cs.red) + "22", color: t.kondisi === "baik" ? "#10b981" : t.kondisi === "servis" ? cs.yellow : cs.red }}>{t.kondisi}</span></td>
                    {isOwnerAdmin && <td style={td}><div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setForm({ id: t.id, nama: t.nama, kategori: t.kategori, qty: t.qty, kondisi: t.kondisi, catatan: t.catatan || "" })} style={{ background: "none", border: "1px solid " + cs.border, borderRadius: 6, cursor: "pointer", padding: "3px 8px", color: cs.muted }}>✏️</button>
                      {isOwner && <button onClick={() => del(t)} style={{ background: "none", border: "1px solid " + cs.border, borderRadius: 6, cursor: "pointer", padding: "3px 8px", color: cs.red }}>🗑</button>}
                    </div></td>}
                  </tr>
                  {open && (
                    <tr key={t.id + "-h"}><td colSpan={7} style={{ background: cs.surface + "55", padding: "8px 16px 12px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, margin: "4px 0 6px" }}>Sedang dibawa</div>
                      {st.holders.map((h) => (
                        <div key={h.movementId} style={{ fontSize: 12, color: cs.text, padding: "2px 0" }}>• <b>{h.qty}</b> oleh <b>{h.carriedBy || "—"}</b> → {h.scope === "project" ? "Project" : "Job"} {h.refLabel || h.refId} <span style={{ color: cs.muted }}>({(h.checkoutAt || "").slice(0, 10)})</span></div>
                      ))}
                      <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, margin: "10px 0 6px" }}>Riwayat terakhir</div>
                      {hist.slice(0, 8).map((m) => (
                        <div key={m.id} style={{ fontSize: 12, color: cs.muted, padding: "1px 0" }}>{(m.checkout_at || "").slice(0, 10)} · {m.carried_by || "—"} · {m.ref_label || m.ref_id} · <span style={{ color: m.status === "OUT" ? "#f59e0b" : "#10b981" }}>{m.status === "OUT" ? "dibawa" : "kembali " + (m.returned_at || "").slice(0, 10)}</span></div>
                      ))}
                    </td></tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {form && (
        <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 660, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => !busy && setForm(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: cs.panel, borderRadius: 16, padding: 20, width: "100%", maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: cs.text, marginBottom: 14 }}>{form.id ? "Edit Alat" : "Tambah Alat"}</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div><div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Nama Alat</div><input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} style={inp} placeholder="cth: Bor Listrik" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Kategori</div><select value={form.kategori} onChange={(e) => setForm({ ...form, kategori: e.target.value })} style={inp}>{KAT_OPT.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
                <div><div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Jumlah Unit</div><input type="number" min={1} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={inp} /></div>
              </div>
              <div><div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Kondisi</div><select value={form.kondisi} onChange={(e) => setForm({ ...form, kondisi: e.target.value })} style={inp}>{KON_OPT.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
              <div><div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Catatan</div><input value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} style={inp} placeholder="opsional" /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 16 }}>
              <button onClick={() => setForm(null)} disabled={busy} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: 11, borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Batal</button>
              <button onClick={save} disabled={busy} style={{ background: busy ? cs.border : "#f59e0b", border: "none", color: "#0a0f1e", padding: 11, borderRadius: 10, cursor: "pointer", fontWeight: 800 }}>{busy ? "Menyimpan…" : "Simpan"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OfficeToolsView;
