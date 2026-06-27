import { cs } from "../theme/cs.js";

// Dialog konfirmasi (pengganti window.confirm) — diekstrak dari App.jsx (Fase 0).
// Leaf murni: seluruh perilaku dibawa oleh objek `confirmModal` itu sendiri
// (title/message/icon/danger/onConfirm/onCancel/confirmText/cancelText).
// Sengaja import sinkron (bukan lazy) supaya muncul instan saat user klik —
// dialog konfirmasi tak boleh ada jeda load chunk. State + showConfirm tetap
// di App.jsx (dipakai 15+ pemanggil), komponen ini hanya merender.
export default function ConfirmModal({ confirmModal }) {
  if (!confirmModal) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000cc", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20
    }}>
      <div style={{
        background: cs.surface, border: "1px solid " + (confirmModal.danger ? cs.red : cs.border),
        borderRadius: 16, width: "100%", maxWidth: 400, padding: 24, boxShadow: "0 20px 60px #000a"
      }}>
        {/* Icon + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 28 }}>{confirmModal.icon || (confirmModal.danger ? "⚠️" : "❓")}</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: confirmModal.danger ? cs.red : cs.text }}>
            {confirmModal.title}
          </div>
        </div>
        {/* Message */}
        <div style={{
          fontSize: 13, color: cs.muted, lineHeight: 1.6, marginBottom: 20,
          whiteSpace: "pre-line", background: cs.card, borderRadius: 10, padding: "12px 14px"
        }}>
          {confirmModal.message}
        </div>
        {/* Buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={confirmModal.onCancel}
            style={{
              padding: "9px 20px", background: cs.surface, border: "1px solid " + cs.border,
              borderRadius: 10, color: cs.text, cursor: "pointer", fontWeight: 600, fontSize: 13
            }}>
            {confirmModal.cancelText || "Batal"}
          </button>
          <button onClick={confirmModal.onConfirm}
            style={{
              padding: "9px 20px", border: "none", borderRadius: 10, cursor: "pointer",
              fontWeight: 700, fontSize: 13, color: "#fff",
              background: confirmModal.danger
                ? "linear-gradient(135deg,#ef4444,#dc2626)"
                : "linear-gradient(135deg," + cs.accent + ",#3b82f6)"
            }}>
            {confirmModal.confirmText || (confirmModal.danger ? "Ya, Hapus" : "Ya, Lanjutkan")}
          </button>
        </div>
      </div>
    </div>
  );
}
