import { cs } from "../theme/cs.js";

export default function ApproveInvoiceModal({ open, invoice, onClose, approveAndSend, approveSaveOnly, fmt }) {
  if (!open || !invoice) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 500,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: cs.surface, border: "1px solid " + cs.border, borderRadius: 18,
        padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>✅ Approve Invoice</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>Setelah approve, invoice tidak bisa diedit lagi</div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: cs.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent, fontSize: 14 }}>{invoice.id}</span>
            <span style={{ fontWeight: 800, color: cs.green, fontSize: 14 }}>{fmt(invoice.total)}</span>
          </div>
          <div style={{ fontSize: 12, color: cs.muted }}>👤 {invoice.customer}</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>🔧 {invoice.service}</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>📱 {invoice.phone}</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <button onClick={() => approveAndSend(invoice)}
            style={{
              display: "flex", alignItems: "center", gap: 14,
              background: "linear-gradient(135deg," + cs.green + ",#059669)",
              border: "none", borderRadius: 12, padding: "14px 18px", cursor: "pointer", textAlign: "left",
            }}>
            <span style={{ fontSize: 24 }}>📤</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Approve & Kirim ke Customer</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>
                Invoice langsung dikirim via WA ke {invoice.phone}
              </div>
            </div>
          </button>

          <button onClick={() => approveSaveOnly(invoice)}
            style={{
              display: "flex", alignItems: "center", gap: 14, background: cs.card,
              border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 18px", cursor: "pointer", textAlign: "left",
            }}>
            <span style={{ fontSize: 24 }}>💾</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Approve & Simpan Dahulu</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                Invoice diapprove tapi belum dikirim — kirim manual nanti dari halaman Invoice
              </div>
            </div>
          </button>

          <button onClick={onClose}
            style={{ background: "none", border: "none", color: cs.muted, fontSize: 12, cursor: "pointer", padding: "6px 0" }}>
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}
