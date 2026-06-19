import { cs } from "../theme/cs.js";

const WA_GREEN = "#25D366";

export default function WaTekModal({ open, target, onClose, appName, openWA }) {
  if (!open || !target) return null;

  const name = appName || "AClean";

  const templates = [
    {
      icon: "🚗",
      label: "Konfirmasi sedang menuju",
      msg: `Halo ${target.customer}, saya dari ${name} Service sedang dalam perjalanan menuju lokasi Anda. Estimasi tiba pkl ${target.time || "sebentar lagi"}. Mohon ditunggu ya! 🙏`,
    },
    {
      icon: "📍",
      label: "Tanya patokan / lokasi",
      msg: `Halo ${target.customer}, saya teknisi ${name} yang akan servis hari ini. Boleh minta patokan lokasi rumah Bapak/Ibu? Alamat yang tercatat: ${target.address || "—"}. Terima kasih 🙏`,
    },
    {
      icon: "✅",
      label: "Konfirmasi jadwal hari ini",
      msg: `Halo ${target.customer}, kami konfirmasi jadwal servis AC dari ${name} hari ini pkl ${target.time || "—"} untuk ${target.service || "servis AC"}. Apakah masih bisa? 🙏`,
    },
    {
      icon: "⏰",
      label: "Info terlambat / minta reschedule",
      msg: `Halo ${target.customer}, mohon maaf kami dari ${name} ada keterlambatan. Kami akan tiba sedikit lebih lama dari jadwal. Terima kasih atas pengertiannya 🙏`,
    },
    {
      icon: "✔️",
      label: "Pekerjaan selesai — terima kasih",
      msg: `Halo ${target.customer}, pekerjaan servis AC (${target.service || "—"}) telah selesai. Terima kasih sudah mempercayakan ke ${name} Service. Semoga AC-nya nyaman kembali! 😊`,
    },
  ];

  const handleTemplate = async (msg) => {
    onClose();
    await openWA(target.phone, msg);
  };

  const handleFreeText = () => {
    onClose();
    window.open("https://wa.me/" + String(target.phone).replace(/^0/, "62").replace(/[^0-9]/g, ""), "_blank");
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 600,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: cs.surface, borderRadius: "18px 18px 0 0",
        width: "100%", maxWidth: 480, padding: "24px 20px 32px",
        border: "1px solid " + cs.border,
      }} onClick={e => e.stopPropagation()}>

        {/* Handle bar */}
        <div style={{ width: 40, height: 4, background: cs.border, borderRadius: 99, margin: "0 auto 18px" }} />

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📱 WA ke Customer</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>{target.customer} · {target.phone}</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>🔧 {target.service}</div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {templates.map(({ icon, label, msg }) => (
            <button key={label} onClick={() => handleTemplate(msg)}
              style={{
                display: "flex", alignItems: "center", gap: 12, background: cs.card,
                border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px",
                cursor: "pointer", textAlign: "left", width: "100%",
              }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{label}</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{msg.slice(0, 60)}...</div>
              </div>
            </button>
          ))}

          <button onClick={handleFreeText}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              background: WA_GREEN + "15", border: "1px solid " + WA_GREEN + "33",
              borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left", width: "100%",
            }}>
            <span style={{ fontSize: 20 }}>💬</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: WA_GREEN }}>Ketik pesan sendiri</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Buka WhatsApp — tulis pesan bebas</div>
            </div>
          </button>

          <button onClick={onClose}
            style={{ background: "none", border: "none", color: cs.muted, fontSize: 12, cursor: "pointer", padding: "6px 0", marginTop: 4 }}>
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}
