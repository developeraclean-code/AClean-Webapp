import { cs } from "../theme/cs.js";

const BRAIN_CUSTOMER_DEFAULT =
  "# ARA CUSTOMER BRAIN v1.0 — AClean Service\n\n## IDENTITAS\nNama: ARA, asisten virtual AClean Service — Jasa Cuci, Servis & Pasang AC.\nArea: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan.\nJam operasional: Senin–Sabtu 08:00–17:00 WIB.\n\n## TUGASMU\n1. Jawab pertanyaan layanan, harga, area AClean\n2. Bantu booking order baru\n3. Bantu cek status order customer (by nomor HP)\n4. Terima & catat komplain/feedback\n\n## BATASAN KERAS\n- JANGAN tampilkan data customer lain\n- JANGAN lakukan aksi admin (cancel, approve, update invoice, dll)\n- Jika tidak yakin: arahkan ke admin\n\n## LAYANAN & HARGA\n- Cuci AC: Rp 80.000/unit\n- Freon R22: Rp 150.000/unit | Freon R32: Rp 200.000/unit\n- Perbaikan AC: mulai Rp 100.000 (tergantung kerusakan)\n- Pasang AC Baru: Rp 300.000/unit | Bongkar AC: Rp 150.000/unit\n- Service AC: Rp 120.000/unit | Booking H-0: +Rp 50.000\n\n## FORMAT JAWABAN\n- Bahasa Indonesia ramah, maks 5 kalimat per respons\n- Gunakan emoji: 😊 ✅ 🔧 📱\n- Jika tidak bisa jawab: arahkan ke admin";

export default function BrainCustomerModal({
  open, onClose,
  brainMdCustomer, setBrainMdCustomer,
  currentUser, showNotif, addAgentLog,
  supabase, isMobile, _lsSave,
}) {
  if (!open) return null;

  const lineCount = (typeof brainMdCustomer === "string" ? brainMdCustomer : "").split("\n").length;
  const charCount = typeof brainMdCustomer === "string" ? brainMdCustomer.length : 0;

  const handleSave = async () => {
    showNotif("⏳ Menyimpan Brain Customer ke Supabase...");
    _lsSave("brainMdCustomer", brainMdCustomer);
    let dbOk = false;
    try {
      const payload = { key: "brain_customer", value: brainMdCustomer, updated_by: currentUser?.name || "Owner", updated_at: new Date().toISOString() };
      const { error: e1 } = await supabase.from("ara_brain").upsert(payload, { onConflict: "key" });
      if (!e1) {
        dbOk = true;
      } else {
        const { error: e2 } = await supabase.from("ara_brain")
          .update({ value: brainMdCustomer, updated_by: currentUser?.name || "Owner", updated_at: new Date().toISOString() })
          .eq("key", "brain_customer");
        if (!e2) {
          dbOk = true;
        } else {
          const { error: e3 } = await supabase.from("ara_brain")
            .insert({ key: "brain_customer", value: brainMdCustomer, updated_by: currentUser?.name || "Owner" });
          if (!e3) dbOk = true;
          else throw new Error("Upsert: " + e1.message + " | Update: " + e2.message + " | Insert: " + e3.message);
        }
      }
    } catch (e) {
      showNotif("⚠️ DB error: " + (e?.message || "") + " — Tersimpan lokal. Jalankan fix_ara_brain_table.sql di Supabase.");
      addAgentLog("BRAIN_CUST_SAVE_ERROR", "Brain Customer gagal ke DB: " + (e?.message || ""), "ERROR");
      onClose(); return;
    }
    if (dbOk) {
      addAgentLog("BRAIN_CUSTOMER_SAVED", "Brain Customer disimpan ke Supabase (" + charCount + " karakter)", "SUCCESS");
      showNotif("✅ Brain Customer tersimpan permanen di Supabase + localStorage!");
    }
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000d", zIndex: 500,
      display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: cs.surface, border: "1px solid #22c55e44",
        borderRadius: isMobile ? "16px 16px 0 0" : 20,
        width: "100%", maxWidth: isMobile ? "100%" : 700,
        maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background: "#22c55e12", borderBottom: "1px solid #22c55e33", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#22c55e" }}>💬 Edit Brain Customer Bot</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>System prompt khusus untuk customer via WhatsApp — TERPISAH dari Brain Owner/Admin</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>

        {/* Stats bar */}
        <div style={{ background: "#22c55e08", borderBottom: "1px solid " + cs.border, padding: "8px 22px", display: "flex", gap: 16, fontSize: 11 }}>
          <span style={{ color: cs.muted }}>📝 Baris: <strong style={{ color: cs.text }}>{lineCount}</strong></span>
          <span style={{ color: cs.muted }}>🔤 Karakter: <strong style={{ color: cs.text }}>{charCount}</strong></span>
          <span style={{ color: "#22c55e" }}>💡 Hanya aksi terbatas: booking, cek status, feedback</span>
        </div>

        {/* Textarea */}
        <textarea value={brainMdCustomer} onChange={e => setBrainMdCustomer(e.target.value)}
          style={{ flex: 1, background: cs.bg, border: "none", padding: "18px 22px", color: cs.text, fontSize: 13, fontFamily: "monospace", resize: "none", outline: "none", lineHeight: 1.7 }}
          placeholder={"Isi Brain Customer Bot di sini...\n\nPanduan: tentukan identitas, layanan & harga, SOP booking, batasan yang boleh/tidak boleh dilakukan ARA saat chat dengan customer via WA."}
        />

        {/* Footer */}
        <div style={{ background: cs.surface, borderTop: "1px solid " + cs.border, padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => { setBrainMdCustomer(BRAIN_CUSTOMER_DEFAULT); showNotif("Brain Customer direset ke default"); }}
            style={{ background: "#ef444418", border: "1px solid #ef444433", color: "#ef4444", padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            🔄 Reset Default
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}
              style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
              Batal
            </button>
            <button onClick={handleSave}
              style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "#fff", padding: "9px 22px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
              💾 Simpan Brain Customer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
