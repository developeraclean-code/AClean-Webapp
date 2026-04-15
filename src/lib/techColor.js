// Warna teknisi — deterministik dari hash nama. Override kalau ada di DB.
export const TECH_PALETTE = [
  "#38bdf8", "#22c55e", "#a78bfa", "#f59e0b", "#f97316",
  "#ec4899", "#14b8a6", "#ef4444", "#84cc16", "#06b6d4",
  "#8b5cf6", "#d946ef", "#fb923c", "#4ade80", "#60a5fa",
];

export const getTechColor = (name, teknisiDataArr) => {
  if (!name) return "#64748b";
  const tekFromDB = (teknisiDataArr || []).find(t => t.name === name);
  if (tekFromDB?.color) return tekFromDB.color;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return TECH_PALETTE[Math.abs(h) % TECH_PALETTE.length];
};
