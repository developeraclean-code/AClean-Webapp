import { cs } from "../theme/cs.js";

// A notification is navigation only. Payment confirmation stays in the reviewed
// invoice flow with atomic proof/ledger checks; closing never dismisses evidence.
export default function PaymentSuggestionBanner({ suggestion, onReview, onClose }) {
  if (!suggestion) return null;
  return <aside aria-label="Bukti WA baru perlu diperiksa" style={{ position: "fixed", bottom: 80, right: 16, zIndex: 9500, width: "min(360px, calc(100vw - 32px))", boxSizing: "border-box", background: cs.surface, border: `2px solid ${cs.accent}`, borderRadius: 14, padding: 16, boxShadow: "0 8px 32px #0008", overflowWrap: "anywhere" }}>
    <strong style={{ color: cs.accent }}>💳 Media/Bukti WA Perlu Diperiksa</strong>
    <p style={{ color: cs.text, fontSize: 12 }}>{suggestion.sender_name || suggestion.phone}{suggestion.sender_name ? ` · ${suggestion.phone}` : ""}</p>
    <p style={{ color: cs.muted, fontSize: 12 }}>Belum merupakan konfirmasi pembayaran. Buka media dan cocokkan nominal, rekening serta invoice sebelum menandai lunas.</p>
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={onReview} style={{ flex: 1, background: cs.accent, color: "#05131d", border: "none", padding: 10, borderRadius: 8, fontWeight: 700 }}>Periksa di Invoice</button>
      <button onClick={onClose} style={{ background: cs.card, color: cs.muted, border: `1px solid ${cs.border}`, padding: 10, borderRadius: 8 }}>Tutup</button>
    </div>
  </aside>;
}
