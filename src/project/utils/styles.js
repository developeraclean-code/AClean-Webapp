// Style helper untuk modul Project — inline style menggunakan cs.
import { cs } from "../../theme/cs.js";

export const card = { background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 16 };
export const cardBig = { ...card, padding: 20 };
export const cardZero = { ...card, padding: 0 };

export const btn = (kind = "primary") => {
  const base = { border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
  const colors = {
    primary: { background: cs.accent, color: "#04121f" },
    ghost: { background: "transparent", border: `1px solid ${cs.border}`, color: cs.text },
    green: { background: cs.green, color: "#04121f" },
    red: { background: cs.red, color: "#fff" },
    yellow: { background: cs.yellow, color: "#04121f" },
    sun: { background: "#fbbf24", color: "#3a2a00" },
    moon: { background: "#6366f1", color: "#fff" },
  };
  return { ...base, ...colors[kind] };
};
export const btnSm = (kind) => ({ ...btn(kind), padding: "6px 10px", fontSize: 12 });

export const pill = (kind = "gray") => {
  const m = {
    green: { background: "rgba(34,197,94,.15)", color: cs.green },
    yellow: { background: "rgba(245,158,11,.15)", color: cs.yellow },
    red: { background: "rgba(239,68,68,.15)", color: cs.red },
    accent: { background: "rgba(56,189,248,.15)", color: cs.accent },
    gray: { background: "rgba(100,116,139,.18)", color: cs.muted },
    ara: { background: "rgba(167,139,250,.15)", color: cs.ara },
  };
  return { display: "inline-block", padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, ...(m[kind] || m.gray) };
};

export const tag = { fontSize: 11, color: cs.muted, background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 7, padding: "3px 8px", display: "inline-block" };
export const chip = (active) => ({ display: "inline-block", padding: "5px 11px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: `1px solid ${active ? cs.ara : cs.border}`, background: active ? cs.ara : cs.surface, color: active ? "#160b2e" : cs.text, cursor: "pointer" });

export const note = { background: "rgba(56,189,248,.08)", border: "1px solid rgba(56,189,248,.3)", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#bae6fd", marginBottom: 14 };
export const alert = (warn = false) => ({
  background: warn ? "rgba(245,158,11,.1)" : "rgba(239,68,68,.1)",
  border: `1px solid ${warn ? "rgba(245,158,11,.45)" : "rgba(239,68,68,.45)"}`,
  borderRadius: 10, padding: "10px 14px", fontSize: 13, color: warn ? "#fde68a" : "#fecaca",
  marginBottom: 14, display: "flex", alignItems: "center", gap: 10,
});

export const row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
export const between = { ...row, justifyContent: "space-between" };
export const spacer = { flex: 1 };
export const muted = { color: cs.muted };

export const tableStyles = {
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "9px 12px", fontSize: 11, borderBottom: `1px solid ${cs.border}`, color: cs.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" },
  td: { textAlign: "left", padding: "9px 12px", fontSize: 13, borderBottom: `1px solid ${cs.border}`, verticalAlign: "top", color: cs.text },
};

export const bar = (w, color) => ({ height: 8, background: "#0f1b30", borderRadius: 999, overflow: "hidden", marginTop: 6, position: "relative" });
export const barFill = (w, color) => ({ display: "block", height: "100%", width: `${w}%`, background: color || cs.accent });

export const sectionTitle = { display: "flex", alignItems: "center", gap: 10, margin: "6px 0 14px" };
export const sectionTitleH = { fontSize: 18, fontWeight: 800, color: cs.text };

export const minicard = { background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: "9px 14px", minWidth: 140 };
export const minicardL = { fontSize: 11, color: cs.muted };
export const minicardV = { fontSize: 18, fontWeight: 800, marginTop: 2 };

export const select = { background: cs.card, border: `1px solid ${cs.border}`, color: cs.text, borderRadius: 9, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

export const colorOf = (kind) => ({ red: cs.red, green: cs.green, yellow: cs.yellow, accent: cs.accent, ara: cs.ara, muted: cs.muted }[kind] || cs.text);
