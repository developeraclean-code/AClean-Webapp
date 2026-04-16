import { cs } from "../theme/cs.js";

export default function AraView({
  araMessages, setAraMessages, araInput, setAraInput, araLoading,
  araImageData, setAraImageData, setAraImageType, araImagePreview, setAraImagePreview,
  araBottomRef, priceListSyncedAt, llmStatus,
  sendToARA, forceReloadPriceList, connectAraBrain,
}) {
  const quickPrompts = [
    "Berapa total revenue bulan ini?",
    "Invoice mana yang belum dibayar?",
    "Stok material apa yang kritis?",
    "Buat ringkasan order hari ini",
    "Tampilkan semua harga layanan terbaru",
  ];
  const syncLabel = priceListSyncedAt
    ? "Harga terakhir sync: " + priceListSyncedAt.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "Harga belum di-sync dari Supabase";
  return (
    <div style={{ display: "grid", gap: 0, height: "calc(100vh - 120px)", maxHeight: 700 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>🤖 ARA — AI Agent AClean</div>
          <div style={{ fontSize: 12, color: cs.muted }}>Chat langsung · Bisa update data invoice, cek stok, analisa bisnis</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "4px 10px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: priceListSyncedAt ? cs.green : cs.yellow }} />
            <span style={{ fontSize: 10, color: cs.muted }}>
              Harga: {priceListSyncedAt
                ? priceListSyncedAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
                : "belum sync"}
            </span>
          </div>
          <button onClick={forceReloadPriceList} title="Sync harga terbaru dari Supabase"
            style={{ background: cs.green + "18", border: "1px solid " + cs.green + "44", color: cs.green, padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
            🔄 Sync Harga
          </button>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: araLoading ? cs.yellow : cs.green }} />
          <span style={{ fontSize: 11, color: cs.muted }}>{araLoading ? "Berpikir..." : "Online"}</span>
          <button onClick={() => setAraMessages([{ role: "assistant", content: "Halo! Saya ARA 🤖 — AI Agent AClean. Ada yang bisa saya bantu?" }])}
            style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>🗑 Reset</button>
          <button onClick={connectAraBrain} disabled={araLoading}
            title="Hubungkan ARA Brain dengan Minimax 2.5"
            style={{ background: cs.ara + "18", border: "1px solid " + cs.ara + "44", color: cs.ara, padding: "5px 12px", borderRadius: 6, cursor: araLoading ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700, opacity: araLoading ? 0.6 : 1 }}>🧠 Konek Brain</button>
        </div>
      </div>
      <div style={{ background: priceListSyncedAt ? cs.green + "12" : cs.yellow + "18", border: "1px solid " + (priceListSyncedAt ? cs.green : cs.yellow) + "33", borderRadius: 8, padding: "6px 12px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: priceListSyncedAt ? cs.green : cs.yellow }}>
          {priceListSyncedAt ? "✅ " : "⚠️ "}{syncLabel}
        </span>
        {!priceListSyncedAt && (
          <button onClick={forceReloadPriceList} style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
            Sync Sekarang
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {quickPrompts.map(p => (
          <button key={p} onClick={() => sendToARA(p)}
            style={{ background: cs.ara + "15", border: "1px solid " + cs.ara + "33", color: cs.ara, padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap" }}>
            {p}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12, minHeight: 0, height: 380 }}>
        {araMessages.map((msg, i) => (
          <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "85%", padding: "10px 14px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              background: msg.role === "user" ? cs.accent + "22" : cs.surface,
              border: "1px solid " + (msg.role === "user" ? cs.accent + "33" : cs.border),
              fontSize: 13, color: cs.text, lineHeight: 1.5, whiteSpace: "pre-wrap"
            }}>
              {msg.role === "assistant" && <span style={{ fontSize: 11, color: cs.ara, fontWeight: 800, display: "block", marginBottom: 4 }}>🤖 ARA</span>}
              {msg.content}
            </div>
          </div>
        ))}
        {araLoading && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 14px", background: cs.surface, borderRadius: 14, border: "1px solid " + cs.border, width: "fit-content" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: cs.ara, animation: "pulse 1s infinite" }} />
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: cs.ara, animation: "pulse 1s infinite 0.2s" }} />
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: cs.ara, animation: "pulse 1s infinite 0.4s" }} />
          </div>
        )}
        <div ref={araBottomRef} />
      </div>
      {araImagePreview && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "6px 10px", background: cs.card, borderRadius: 8, border: "1px solid #22c55e44" }}>
          <img src={araImagePreview} alt="preview" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />
          <span style={{ fontSize: 12, color: "#22c55e", flex: 1 }}>🖼️ Foto siap dikirim ke ARA</span>
          <button onClick={() => { setAraImageData(null); setAraImageType(null); setAraImagePreview(null); }}
            style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input id="araInput"
          value={araInput} onChange={e => setAraInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendToARA(araInput); } }}
          placeholder="Tanya ARA atau minta update data... (Enter untuk kirim)"
          disabled={araLoading}
          style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "11px 14px", color: cs.text, fontSize: 13, outline: "none" }}
        />
        <>
          <input type="file" id="ara-img-upload" accept="image/*" style={{ display: "none" }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => {
                const dataUrl = ev.target.result;
                const base64 = dataUrl.split(",")[1];
                setAraImageData(base64);
                setAraImageType(file.type || "image/jpeg");
                setAraImagePreview(dataUrl);
              };
              reader.readAsDataURL(file);
              e.target.value = "";
            }} />
          <button onClick={() => document.getElementById("ara-img-upload").click()}
            title="Upload foto (bukti bayar / complain / dokumen)"
            style={{
              background: araImagePreview ? "#22c55e22" : "#1e40af22", border: "1px solid " + (araImagePreview ? "#22c55e44" : "#1e40af44"),
              color: araImagePreview ? "#22c55e" : "#60a5fa", borderRadius: 10, padding: "10px 12px", cursor: "pointer", fontSize: 16, flexShrink: 0
            }}>
            {araImagePreview ? "🖼️" : "📎"}
          </button>
        </>
        <button onClick={() => sendToARA(araInput)} disabled={araLoading || (!araInput.trim() && !araImageData)}
          style={{ background: araLoading || !araInput.trim() ? "#333" : "linear-gradient(135deg," + cs.ara + ",#7c3aed)", border: "none", color: "#fff", padding: "11px 20px", borderRadius: 10, cursor: araLoading ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 14 }}>
          {araLoading ? "⏳" : "→"}
        </button>
      </div>
      {llmStatus !== "connected" && <div style={{ fontSize: 11, color: cs.yellow, marginTop: 8 }}>⚠️ ARA belum terkoneksi. Buka <b>Pengaturan → ARA Brain</b> → klik <b>Test &amp; Simpan</b> untuk mengaktifkan.</div>}
    </div>
  );
}
