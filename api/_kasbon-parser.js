// Kasbon phrase parser — Phase 2 (Finance grup only)
// Format yang di-support (sesuai konfirmasi Owner):
//   "Kasbon Andi 500k"
//   "Kasbon Budi 200rb"
//   "Kasbon Caca 1.5jt"
//
// Multi-name belum di-support. Prefix "Teknisi"/"Helper" opsional.
// Validasi nama wajib match user_profiles (role IN Teknisi/Helper, active=true).

const KASBON_RE = /^kasbon\s+(?:(?:teknisi|helper)\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s*(k|ribu|rb|jt|juta|m|jt\.|jt,)?\s*\.?$/i;

export function parseKasbonText(message) {
  if (!message || typeof message !== "string") return null;
  const text = message.trim();
  const m = text.match(KASBON_RE);
  if (!m) return null;
  const nameRaw = m[1].trim();
  const numRaw = m[2].replace(",", ".");
  const num = parseFloat(numRaw);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = (m[3] || "").toLowerCase();
  let amount;
  if (unit === "k" || unit === "ribu" || unit === "rb") amount = num * 1000;
  else if (unit === "jt" || unit === "juta" || unit === "m") amount = num * 1_000_000;
  else amount = num;
  // Anti-typo: kalau tidak pakai unit dan amount < 1000, anggap ambigu (skip)
  if (!unit && amount < 1000) return null;
  // Sanity cap (Rp 10jt per single entry)
  if (amount > 10_000_000) return null;
  return { nameRaw, amount: Math.round(amount), unit: unit || "rupiah" };
}

// Match nama ke user_profiles (Teknisi/Helper, active=true)
// Strategy: first-token ILIKE %X%
// Returns: { matched: {name, role} | null, candidates: [...], reason: "unique"|"ambiguous"|"none" }
export async function matchKasbonName({ SU, SK, nameRaw }) {
  if (!SU || !SK || !nameRaw) return { matched: null, candidates: [], reason: "none" };
  const firstToken = nameRaw.split(/\s+/)[0];
  if (!firstToken || firstToken.length < 2) return { matched: null, candidates: [], reason: "none" };
  const url = SU + "/rest/v1/user_profiles?select=id,name,role,active"
    + "&role=in.(Teknisi,Helper)"
    + "&active=eq.true"
    + "&name=ilike." + encodeURIComponent("%" + firstToken + "%")
    + "&limit=10";
  try {
    const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    if (!r.ok) return { matched: null, candidates: [], reason: "none" };
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return { matched: null, candidates: [], reason: "none" };
    if (rows.length === 1) return { matched: rows[0], candidates: rows, reason: "unique" };
    // Multi → coba exact match dulu (case-insensitive) sebelum nyerah
    const exact = rows.find(r => String(r.name).toLowerCase() === firstToken.toLowerCase());
    if (exact) return { matched: exact, candidates: rows, reason: "unique" };
    return { matched: null, candidates: rows.slice(0, 5), reason: "ambiguous" };
  } catch (_) {
    return { matched: null, candidates: [], reason: "none" };
  }
}

// Approval message detector — phrase reply oleh approver
const APPROVAL_RE = /^(ok|oke|okay|baik|siap|acc|approve|approved|setuju|yes|ya|gas|👍|✅)\.?!?$/i;

export function isKasbonApprovalMessage(message) {
  if (!message || typeof message !== "string") return false;
  return APPROVAL_RE.test(message.trim());
}
