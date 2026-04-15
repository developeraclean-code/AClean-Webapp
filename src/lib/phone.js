// Normalisasi: 08xxx / +62xxx / 628xxx / 8xxx → 628xxx
export const normalizePhone = (p) => {
  if (!p) return "";
  const d = p.toString().replace(/[\s\-().+]/g, "");
  if (d.startsWith("08")) return "62" + d.slice(1);
  if (d.startsWith("62")) return d;
  if (d.startsWith("8")) return "62" + d;
  return d;
};

export const samePhone = (a, b) => {
  if (!a || !b) return false;
  return normalizePhone(a) === normalizePhone(b);
};
