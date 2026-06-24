import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { toolStatus, outMovementsForRef } from "../lib/officeTools.js";

// Modal Bawa / Kembali "Alat Kantor" untuk satu job (order atau project).
// Non-consumable: hanya catat keluar/masuk + pemegang. Tidak menyentuh stok material.
// Props: { job:{id,customer?,nama?,date?}, scope:'order'|'project', mode:'bawa'|'kembali',
//          onClose, supabase, currentUser, showNotif, teknisiData? }
function OfficeToolModal({ job, scope = "order", mode = "bawa", onClose, supabase, currentUser, showNotif, teknisiData = [] }) {
  const isBawa = mode === "bawa";
  const refLabel = job?.customer || job?.nama || job?.id || "";
  const [tools, setTools] = useState([]);
  const [outAll, setOutAll] = useState([]);   // semua movement OUT (utk hitung tersedia)
  const [jobOut, setJobOut] = useState([]);   // movement OUT utk job ini (utk Kembali)
  const [take, setTake] = useState({});       // {toolId: qty} yang akan dibawa
  const [carriedBy, setCarriedBy] = useState(currentUser?.name || "");
  const [retSel, setRetSel] = useState({});   // {movementId: true} yang akan dikembalikan
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: t } = await supabase.from("office_tools").select("*").eq("aktif", true).order("nama");
    setTools(t || []);
    const { data: out } = await supabase.from("office_tool_movement").select("*").eq("status", "OUT");
    setOutAll(out || []);
    setJobOut(outMovementsForRef(out || [], scope, job.id));
  }, [supabase, job.id, scope]);

  useEffect(() => { load(); }, [load]);

  const setQty = (toolId, v, max) => {
    let q = parseInt(v, 10); if (!Number.isFinite(q) || q < 0) q = 0; if (q > max) q = max;
    setTake((s) => ({ ...s, [toolId]: q }));
  };

  const saveBawa = async () => {
    const rows = tools
      .map((t) => ({ t, q: take[t.id] || 0 }))
      .filter((x) => x.q > 0)
      .map(({ t, q }) => ({
        tool_id: t.id, scope, ref_id: job.id, ref_label: refLabel, qty: q,
        carried_by: carriedBy || (currentUser?.name || ""), status: "OUT",
        kondisi_out: "baik", checkout_at: new Date().toISOString(),
      }));
    if (!rows.length) return showNotif("Pilih minimal 1 alat (qty > 0)");
    if (!carriedBy.trim()) return showNotif("Isi siapa yang membawa alat");
    setBusy(true);
    try {
      const { error } = await supabase.from("office_tool_movement").insert(rows);
      if (error) throw error;
      showNotif(`✅ ${rows.reduce((s, r) => s + r.qty, 0)} alat tercatat dibawa ${carriedBy}`);
      onClose();
    } catch (e) { showNotif("❌ Gagal: " + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const saveKembali = async () => {
    const ids = Object.keys(retSel).filter((k) => retSel[k]);
    if (!ids.length) return showNotif("Pilih alat yang dikembalikan");
    setBusy(true);
    try {
      const patch = { status: "RETURNED", returned_at: new Date().toISOString(), returned_by: currentUser?.name || "", kondisi_in: "baik", updated_at: new Date().toISOString() };
      const { error } = await supabase.from("office_tool_movement").update(patch).in("id", ids);
      if (error) throw error;
      showNotif(`✅ ${ids.length} alat dikembalikan`);
      onClose();
    } catch (e) { showNotif("❌ Gagal: " + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const inp = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 14, outline: "none" };
  const accent = "#f59e0b"; // alat = oranye (beda dari material biru)
  const tekNames = [...new Set([currentUser?.name, ...teknisiData.map((t) => t.name || t.nama)].filter(Boolean))];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 650, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: cs.panel, borderRadius: "16px 16px 0 0", padding: 18, width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: cs.text }}>{isBawa ? "🛠 Bawa Alat" : "📥 Kembalikan Alat"}</div>
            <div style={{ fontSize: 12, color: cs.muted }}>{scope === "project" ? "Project" : scope === "daily" ? "Harian" : "Job"} · {refLabel}{job?.date ? " · " + job.date : ""}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: cs.muted, background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "7px 10px", margin: "8px 0 14px" }}>
          {isBawa ? "Catat alat kantor (bor, vacuum, tambang, dll) yang dibawa ke job ini. Alat dikembalikan saat selesai — bukan stok material." : "Centang alat yang sudah kembali ke gudang."}
        </div>

        {isBawa ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Dibawa oleh</div>
              <input list="otm-tek" value={carriedBy} onChange={(e) => setCarriedBy(e.target.value)} placeholder="nama teknisi/helper" style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
              <datalist id="otm-tek">{tekNames.map((n) => <option key={n} value={n} />)}</datalist>
            </div>
            {tools.length === 0 && <div style={{ fontSize: 12, color: cs.muted }}>Belum ada alat di registry. Tambah di Inventori → Alat Kantor.</div>}
            {tools.map((t) => {
              const st = toolStatus(t, outAll);
              const dis = st.available <= 0;
              return (
                <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, opacity: dis ? 0.5 : 1 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: cs.text }}>{t.nama}</div>
                    <div style={{ fontSize: 11, color: cs.muted }}>{t.kategori} · tersedia <b style={{ color: st.available > 0 ? "#10b981" : cs.red }}>{st.available}</b>/{st.total}</div>
                  </div>
                  <input type="number" min={0} max={st.available} value={take[t.id] ?? ""} disabled={dis}
                    onChange={(e) => setQty(t.id, e.target.value, st.available)} placeholder="0" style={{ ...inp, width: 70, textAlign: "center" }} />
                </div>
              );
            })}
          </>
        ) : (
          <>
            {jobOut.length === 0 && <div style={{ fontSize: 12, color: cs.muted }}>Tidak ada alat yang sedang dibawa untuk job ini.</div>}
            {jobOut.map((m) => {
              const tn = (tools.find((t) => t.id === m.tool_id) || {}).nama || m.tool_id;
              return (
                <label key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, cursor: "pointer", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 11px" }}>
                  <input type="checkbox" checked={!!retSel[m.id]} onChange={(e) => setRetSel((s) => ({ ...s, [m.id]: e.target.checked }))} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: cs.text }}>{tn} × {m.qty}</div>
                    <div style={{ fontSize: 11, color: cs.muted }}>dibawa {m.carried_by || "—"} · {(m.checkout_at || "").slice(0, 10)}</div>
                  </div>
                </label>
              );
            })}
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 14 }}>
          <button onClick={onClose} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: 12, borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Tutup</button>
          <button disabled={busy} onClick={isBawa ? saveBawa : saveKembali} style={{ background: busy ? cs.border : accent, border: "none", color: "#0a0f1e", padding: 12, borderRadius: 10, cursor: "pointer", fontWeight: 800 }}>
            {busy ? "Menyimpan…" : isBawa ? "Simpan Bawa Alat" : "Tandai Kembali"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default OfficeToolModal;
