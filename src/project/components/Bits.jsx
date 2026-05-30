import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { statusColor } from "../utils/finance.js";

export const StatusPill = ({ s }) => <span style={S.pill(statusColor(s))}>{s}</span>;

export const MiniCard = ({ label, value, color }) => (
  <div style={S.minicard}>
    <div style={S.minicardL}>{label}</div>
    <div style={{ ...S.minicardV, color: S.colorOf(color) || cs.text }}>{value}</div>
  </div>
);

export const Bar = ({ pct, color }) => (
  <div style={{ height: 8, background: "#0f1b30", borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
    <div style={{ height: "100%", width: `${pct}%`, background: color || cs.accent }} />
  </div>
);

export const Tag = ({ children }) => <span style={S.tag}>{children}</span>;
