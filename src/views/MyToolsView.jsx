import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { outMovementsForCarrier } from "../lib/officeTools.js";
import OfficeToolModal from "./OfficeToolModal.jsx";

// MyToolsView — "🧰 Alat Saya" (Fase 4 rencana satu-pintu).
// Checkout alat kantor HARIAN per teknisi (bukan per job). Pagi bawa, sore kembali.
// - Daftar alat yang sedang saya pegang (status OUT, carried_by = saya) + tombol Kembalikan.
// - Tombol "Bawa Alat Hari Ini" → OfficeToolModal scope='daily' (dirender di sini supaya
//   daftar auto-refresh saat modal ditutup — fix silent-error: held tak update setelah bawa).
// Props: { supabase, currentUser, showNotif, TODAY, teknisiData? }
export default function MyToolsView({ supabase, currentUser, showNotif, TODAY, teknisiData = [] }) {
  const myName = currentUser?.name || "";
  const [tools, setTools] = useState([]);
  const [held, setHeld] = useState([]); // movement OUT yang saya pegang
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bawaOpen, setBawaOpen] = useState(false); // modal "Bawa Alat" daily

  const load = useCallback(async () => {
    setLoading(true);
    const { data: t } = await supabase.from("office_tools").select("*").eq("aktif", true).order("nama");
    setTools(t || []);
    const { data: out } = await supabase.from("office_tool_movement").select("*").eq("status", "OUT");
    setHeld(outMovementsForCarrier(out || [], myName));
    setLoading(false);
  }, [supabase, myName]);

  useEffect(() => { load(); }, [load]);

  const toolName = (id) => (tools.find((t) => t.id === id) || {}).nama || id;

  const kembalikan = async (m) => {
    setBusy(m.id);
    try {
      const { error } = await supabase.from("office_tool_movement").update({
        status: "RETURNED", returned_at: new Date().toISOString(),
        returned_by: myName, kondisi_in: "baik", updated_at: new Date().toISOString(),
      }).eq("id", m.id);
      if (error) throw error;
      showNotif?.(`✅ ${toolName(m.tool_id)} dikembalikan`);
      load();
    } catch (e) { showNotif?.("❌ Gagal: " + (e?.message || e)); }
    finally { setBusy(null); }
  };

  const totalHeld = held.reduce((s, m) => s + (Number(m.qty) || 0), 0);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 4px", display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: cs.text }}>🧰 Alat Saya</div>
        <div style={{ fontSize: 13, color: cs.muted }}>{myName} · {TODAY}</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 6, background: cs.panel, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 11px", lineHeight: 1.5 }}>
          Alat kantor (bor, vacuum, tambang, dll) yang kamu bawa hari ini. <b>Bawa</b> pagi,
          <b> kembalikan</b> sore. Bukan stok material — hanya tracking pemegang.
        </div>
      </div>

      {/* Bawa alat hari ini */}
      <button onClick={() => setBawaOpen(true)}
        style={{ width: "100%", background: "#f59e0b", border: "none", color: "#0a0f1e", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
        🛠 Bawa Alat Hari Ini
      </button>

      {bawaOpen && (
        <OfficeToolModal
          job={{ id: TODAY, customer: "Harian", date: TODAY }}
          scope="daily"
          mode="bawa"
          onClose={() => { setBawaOpen(false); load(); }}
          supabase={supabase}
          currentUser={currentUser}
          showNotif={showNotif}
          teknisiData={teknisiData}
        />
      )}

      {/* Alat sedang dipegang */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: cs.text, marginBottom: 10 }}>
          Sedang Saya Pegang {totalHeld > 0 && <span style={{ fontSize: 12, color: "#f59e0b" }}>({totalHeld} unit)</span>}
        </div>
        {loading ? (
          <div style={{ fontSize: 12, color: cs.muted, padding: "8px 0" }}>Memuat…</div>
        ) : held.length === 0 ? (
          <div style={{ fontSize: 12, color: cs.muted, padding: "8px 0" }}>Tidak ada alat yang sedang kamu pegang. 👍</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {held.map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{toolName(m.tool_id)} × {m.qty}</div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                    {m.scope === "daily" ? "Harian" : (m.ref_label || m.scope)} · dibawa {(m.checkout_at || "").slice(0, 10)}
                  </div>
                </div>
                <button disabled={busy === m.id} onClick={() => kembalikan(m)}
                  style={{ flexShrink: 0, background: "#10b98122", border: "1px solid #10b98155", color: "#10b981", borderRadius: 9, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: busy === m.id ? 0.6 : 1 }}>
                  {busy === m.id ? "…" : "↩️ Kembalikan"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
