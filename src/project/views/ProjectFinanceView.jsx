import React from "react";
import { cs } from "../../theme/cs.js";

// Owner only — di-gate juga di ProjectApp.jsx (item menu disembunyikan utk Admin).
export default function ProjectFinanceView({ currentUser }) {
  const role = currentUser?.role || "Owner";
  if (role !== "Owner") {
    return (
      <div style={{ padding: 22 }}>
        <div style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: 24, textAlign: "center", color: cs.red }}>
          🔒 Keuangan Project hanya untuk <b>Owner</b>.
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: 22 }}>
      <h2 style={{ color: cs.text, marginBottom: 4, fontSize: 18 }}>Keuangan Project</h2>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 16 }}>
        Terpisah dari bisnis utama. Nilai kontrak, DP termin, pengeluaran per kelompok, estimasi vs aktual profit.
      </div>
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 24, color: cs.muted }}>
        Coming soon.
      </div>
    </div>
  );
}
