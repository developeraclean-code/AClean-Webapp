import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { outMovementsForCarrier } from "../lib/officeTools.js";
import OfficeToolModal from "./OfficeToolModal.jsx";

const TOOLBAG_LIST = Array.from({ length: 10 }, (_, i) => "Tas " + (i + 1));

// Kompres foto tas → base64 (tanpa prefix data:). Max 1280px, JPEG q0.75.
function compressToolBagPhoto(file, maxDim = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ base64: dataUrl.split(",")[1], preview: dataUrl, mimeType: "image/jpeg" });
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// MyToolsView — "🧰 Alat Saya" (Fase 4 rencana satu-pintu).
// Checkout alat kantor HARIAN per teknisi (bukan per job). Pagi bawa, sore kembali.
// - Daftar alat yang sedang saya pegang (status OUT, carried_by = saya) + tombol Kembalikan.
// - Tombol "Bawa Alat Hari Ini" → OfficeToolModal scope='daily' (dirender di sini supaya
//   daftar auto-refresh saat modal ditutup — fix silent-error: held tak update setelah bawa).
// - Card "Cek Tas Teknisi": upload foto in-app, AI vision cek kelengkapan alat vs checklist,
//   hasil tampil langsung (tanpa perlu WA). Alur WA lama ("Pagi/Pulang Tas N" ke WA Owner)
//   tetap aktif berdampingan — keduanya menulis ke tabel tool_bag_checks yang sama.
// Props: { supabase, currentUser, showNotif, TODAY, teknisiData?, _apiFetch, _apiHeaders }
export default function MyToolsView({ supabase, currentUser, showNotif, TODAY, teknisiData = [], _apiFetch, _apiHeaders }) {
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

      {/* Cek Tas Teknisi — upload foto in-app (alternatif alur WA lama) */}
      <ToolBagCheckCard currentUser={currentUser} showNotif={showNotif} _apiFetch={_apiFetch} _apiHeaders={_apiHeaders} />
    </div>
  );
}

const TOOLBAG_STATUS_COLOR = { OK: cs.green, WARNING: cs.yellow, CRITICAL: cs.red, ERROR: cs.muted };
const TOOLBAG_STATUS_ICON = { OK: "✅", WARNING: "⚠️", CRITICAL: "🚨", ERROR: "❌" };

function ToolBagCheckCard({ currentUser, showNotif, _apiFetch, _apiHeaders }) {
  const [bagId, setBagId] = useState("");
  const [session, setSession] = useState("pagi");
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!bagId) { showNotif?.("Pilih tas dulu sebelum foto"); return; }
    setResult(null);
    setUploading(true);
    try {
      const { base64, preview: prev, mimeType } = await compressToolBagPhoto(file);
      setPreview(prev);
      const headers = _apiHeaders ? await _apiHeaders() : { "Content-Type": "application/json" };
      const r = await (_apiFetch
        ? _apiFetch("/api/upload-toolbag", { method: "POST", body: JSON.stringify({
            bagId, sessionType: session, base64, mimeType,
            teknisiName: currentUser?.name || "", teknisiPhone: currentUser?.phone || null,
          }) })
        : fetch("/api/upload-toolbag", { method: "POST", headers, body: JSON.stringify({
            bagId, sessionType: session, base64, mimeType,
            teknisiName: currentUser?.name || "", teknisiPhone: currentUser?.phone || null,
          }) }));
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) throw new Error(data.error || "Gagal proses foto");
      setResult(data);
      if (data.status === "ERROR") showNotif?.("⚠️ Foto tidak terbaca — foto ulang");
      else if (data.status === "CRITICAL") showNotif?.("🚨 Ada alat WAJIB tidak terdeteksi");
      else if (data.status === "WARNING") showNotif?.("⚠️ Ada alat tidak terdeteksi");
      else showNotif?.("✅ Tas lengkap!");
    } catch (err) {
      showNotif?.("❌ " + (err?.message || "Gagal upload foto tas"));
      setResult(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px", display: "grid", gap: 10 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: cs.text }}>🎒 Cek Tas Teknisi</div>
        <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
          Pilih tas & sesi, lalu foto isi tas — AI langsung cek kelengkapan di sini.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={bagId} onChange={(e) => setBagId(e.target.value)}
          style={{ flex: 1, minWidth: 120, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13 }}>
          <option value="">Pilih Tas...</option>
          {TOOLBAG_LIST.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <div style={{ display: "flex", gap: 4, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: 3 }}>
          {["pagi", "pulang"].map((s) => (
            <button key={s} onClick={() => setSession(s)}
              style={{
                padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700,
                background: session === s ? cs.accent : "transparent", color: session === s ? "#000" : cs.muted,
              }}>
              {s === "pagi" ? "🌅 Pagi" : "🌇 Pulang"}
            </button>
          ))}
        </div>
      </div>

      <label style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        background: bagId ? cs.accent : cs.muted + "44", color: bagId ? "#000" : cs.muted,
        borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 700,
        cursor: bagId && !uploading ? "pointer" : "not-allowed",
      }}>
        {uploading ? "⏳ Menganalisa foto… (±15 detik)" : "📸 Foto Isi Tas"}
        <input type="file" accept="image/*" capture="environment" disabled={!bagId || uploading}
          onChange={handleFile} style={{ display: "none" }} />
      </label>

      {preview && (
        <img src={preview} alt="preview tas" style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 8, border: "1px solid " + cs.border }} />
      )}

      {result && (
        <div style={{
          border: "1px solid " + (TOOLBAG_STATUS_COLOR[result.status] || cs.border) + "66",
          background: (TOOLBAG_STATUS_COLOR[result.status] || cs.muted) + "11",
          borderRadius: 10, padding: "10px 12px", display: "grid", gap: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: TOOLBAG_STATUS_COLOR[result.status] || cs.text }}>
            {TOOLBAG_STATUS_ICON[result.status]} {result.status === "OK" ? "Semua alat lengkap!" : result.status === "ERROR" ? "Foto tidak bisa dianalisa" : bagId + " ada yang kurang"}
          </div>
          {result.status === "ERROR" ? (
            <div style={{ fontSize: 12, color: cs.muted }}>
              Foto ulang yang jelas — pastikan pencahayaan cukup, dekat, dan semua alat terlihat.
            </div>
          ) : (
            <>
              {result.toolsFound?.length > 0 && (
                <div style={{ fontSize: 12, color: cs.text }}>
                  <b>Terdeteksi:</b> {result.toolsFound.map(t => t.name).join(", ")}
                </div>
              )}
              {result.toolsMissing?.length > 0 && (
                <div style={{ fontSize: 12, color: cs.red }}>
                  <b>Tidak terdeteksi:</b> {result.toolsMissing.map(t => (t.is_priority ? "🔴 " : "🟡 ") + t.name).join(", ")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
