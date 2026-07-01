import { cs } from "../theme/cs.js";

// Modal PIN proteksi data Komisi (teknisi/helper) — diekstrak dari App.jsx (Fase 3).
// Leaf: state PIN + handler dioper sebagai prop; `cs` di-import langsung. Tampil hanya
// bila sudah tahu ada PIN (livePin truthy) & belum unlock. Perilaku identik.
export default function CommissionPinModal({
  commissionUnlocked, livePin, commissionPinAttempt, commissionPinError,
  handleCommissionPinSubmit, setCommissionPinAttempt, setCommissionPinError,
  setCommissionUnlocked, setActiveMenu,
}) {
  if (commissionUnlocked || !livePin) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    }}>
      <div style={{
        background: cs.card,
        border: "2px solid " + cs.accent,
        borderRadius: 16,
        padding: 32,
        maxWidth: 380,
        width: "90%",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: cs.text, marginBottom: 8 }}>
          Komisi Terlindungi
        </div>
        <div style={{ fontSize: 13, color: cs.muted, marginBottom: 20 }}>
          Masukkan PIN 4-6 digit untuk mengakses data komisi Anda
        </div>

        {/* PIN Input */}
        <input
          type="password"
          value={commissionPinAttempt}
          onChange={(e) => {
            setCommissionPinAttempt(e.target.value);
            setCommissionPinError("");
          }}
          onKeyPress={(e) => e.key === "Enter" && handleCommissionPinSubmit()}
          placeholder="••••"
          maxLength="6"
          inputMode="numeric"
          style={{
            width: "100%",
            padding: "14px",
            fontSize: 24,
            textAlign: "center",
            borderRadius: 10,
            border: "2px solid " + (commissionPinError ? cs.red : cs.border),
            background: cs.surface,
            color: cs.text,
            letterSpacing: "0.3em",
            boxSizing: "border-box",
            marginBottom: commissionPinError ? 8 : 16,
          }}
          autoFocus
        />

        {/* Error Message */}
        {commissionPinError && (
          <div style={{
            fontSize: 12,
            color: cs.red,
            marginBottom: 16,
            fontWeight: 700,
          }}>
            {commissionPinError}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleCommissionPinSubmit}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              background: cs.accent,
              border: "none",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            ✓ Submit
          </button>
          <button
            onClick={() => {
              setActiveMenu("dashboard");
              setCommissionUnlocked(false);
              setCommissionPinAttempt("");
              setCommissionPinError("");
            }}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 10,
              background: "transparent",
              border: "1px solid " + cs.border,
              color: cs.muted,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Keluar
          </button>
        </div>
      </div>
    </div>
  );
}
