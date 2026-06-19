import { cs } from "../theme/cs.js";

const SNIPPETS = [
  ["Harga Baru",   "\n## Harga Update\n- Cleaning 1PK: Rp XX.000\n"],
  ["Aturan Baru",  "\n## Aturan Tambahan\n- Aturan: ...\n"],
  ["Promo Aktif",  "\n## Promo\n- Diskon X% untuk Y unit\n"],
];

export default function BrainEditModal({
  open, onClose,
  brainMd, setBrainMd,
  BRAIN_MD_DEFAULT,
  currentUser, showNotif, addAgentLog,
  supabase, isMobile, _lsSave,
}) {
  if (!open) return null;

  const lineCount  = (typeof brainMd === "string" ? brainMd : "").split("\n").length;
  const charCount  = typeof brainMd === "string" ? brainMd.length : 0;
  const hasBackup  = !!localStorage.getItem("aclean_brainMd");

  const handleSave = async () => {
    showNotif("⏳ Menyimpan Brain.md ke Supabase...");
    _lsSave("brainMd", brainMd);
    let dbOk = false;
    try {
      const payload = { key: "brain_md", value: brainMd, updated_by: currentUser?.name || "Owner", updated_at: new Date().toISOString() };
      const { error: e1 } = await supabase.from("ara_brain").upsert(payload, { onConflict: "key" });
      if (!e1) {
        dbOk = true;
      } else {
        const { error: e2 } = await supabase.from("ara_brain")
          .update({ value: brainMd, updated_by: currentUser?.name || "Owner", updated_at: new Date().toISOString() })
          .eq("key", "brain_md");
        if (!e2) {
          dbOk = true;
        } else {
          const { error: e3 } = await supabase.from("ara_brain")
            .insert({ key: "brain_md", value: brainMd, updated_by: currentUser?.name || "Owner" });
          if (!e3) dbOk = true;
          else throw new Error("Upsert: " + e1.message + " | Update: " + e2.message + " | Insert: " + e3.message);
        }
      }
    } catch (e) {
      showNotif("⚠️ DB error: " + (e?.message || "") + " — Tersimpan di localStorage saja.");
      addAgentLog("BRAIN_SAVE_ERROR", "Brain.md gagal ke DB: " + (e?.message || ""), "ERROR");
      onClose(); return;
    }
    if (dbOk) {
      addAgentLog("BRAIN_SAVED", "Brain.md disimpan ke Supabase (" + charCount + " karakter)", "SUCCESS");
      showNotif("✅ Brain.md tersimpan permanen di Supabase + localStorage!");
    }
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000d", zIndex: 500,
      display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: cs.surface, border: "1px solid " + cs.ara + "44",
        borderRadius: isMobile ? "16px 16px 0 0" : 20,
        width: "100%", maxWidth: isMobile ? "100%" : 780,
        maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background: cs.ara + "15", borderBottom: "1px solid " + cs.ara + "33", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, color: cs.ara, fontSize: 16 }}>🧠 Edit Brain.md — Memori Permanen ARA</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
              {hasBackup ? "💾 Backup lokal: ✅" : "💾 Backup lokal: ✗"}&nbsp;·&nbsp;☁️ Supabase: tersimpan permanen · Sync semua device
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer" }}>×</button>
        </div>

        {/* Stats bar */}
        <div style={{ background: cs.ara + "08", borderBottom: "1px solid " + cs.border, padding: "8px 22px", display: "flex", gap: 20, fontSize: 11, flexShrink: 0 }}>
          <span style={{ color: cs.muted }}>📝 Baris: <strong style={{ color: cs.text }}>{lineCount}</strong></span>
          <span style={{ color: cs.muted }}>🔤 Karakter: <strong style={{ color: cs.text }}>{charCount}</strong></span>
          <span style={{ color: cs.muted }}>💡 Gunakan # untuk heading</span>
        </div>

        {/* Textarea */}
        <textarea value={brainMd} onChange={e => setBrainMd(e.target.value)}
          style={{ flex: 1, background: cs.bg, border: "none", padding: "18px 22px", color: cs.text, fontSize: 13, fontFamily: "monospace", lineHeight: 1.7, outline: "none", resize: "none", minHeight: 400 }} />

        {/* Snippets */}
        <div style={{ background: cs.surface, borderTop: "1px solid " + cs.border, padding: "10px 22px", display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: cs.muted, alignSelf: "center" }}>Tambah section:</span>
          {SNIPPETS.map(([label, snippet]) => (
            <button key={label} onClick={() => setBrainMd(prev => prev + snippet)}
              style={{ background: cs.ara + "18", border: "1px solid " + cs.ara + "33", color: cs.ara, padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
              + {label}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div style={{ background: cs.surface, borderTop: "1px solid " + cs.border, padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <button onClick={() => { setBrainMd(BRAIN_MD_DEFAULT); showNotif("Brain.md direset ke default"); }}
            style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
            🔄 Reset ke Default
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}
              style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
              Batal
            </button>
            <button onClick={handleSave}
              style={{ background: "linear-gradient(135deg," + cs.ara + ",#7c3aed)", border: "none", color: "#fff", padding: "9px 22px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
              💾 Simpan Brain.md
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
