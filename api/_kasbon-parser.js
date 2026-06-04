// Kasbon phrase parser — Phase 2 (Finance grup only)
// Format yang di-support (sesuai konfirmasi Owner):
//   "Kasbon Andi 500k"
//   "Kasbon Budi 200rb"
//   "Kasbon Caca 1.5jt"
//
// Multi-name belum di-support. Prefix "Teknisi"/"Helper" opsional.
// Validasi nama wajib match user_profiles (role IN Teknisi/Helper, active=true).

// Single-line kasbon (legacy / quick path)
const KASBON_RE_SINGLE = /^kasbon\s+(?:(?:teknisi|helper)\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s*(k|ribu|rb|jt|juta|m|jt\.|jt,)?\s*\.?$/i;
// Per-line item dlm multi-list, mis: "1. Rizal 100" / "- Putra 100" / "Ezra 100"
const KASBON_LINE_ITEM = /^(?:\s*[-•*]?\s*\d+[.)]?\s+|\s*[-•*]\s+|\s*)([A-Za-z][A-Za-z\s.'-]+?)\s+(\d+(?:[.,]\d+)?)\s*(k|ribu|rb|jt|juta|m)?\.?$/i;

function normalizeAmount(numRaw, unit, { defaultThousand }) {
  const num = parseFloat(String(numRaw).replace(",", "."));
  if (!Number.isFinite(num) || num <= 0) return null;
  unit = (unit || "").toLowerCase();
  let amount;
  if (unit === "k" || unit === "ribu" || unit === "rb") amount = num * 1000;
  else if (unit === "jt" || unit === "juta" || unit === "m") amount = num * 1_000_000;
  else if (defaultThousand) amount = num * 1000; // dlm konteks list multi-kasbon, "100" = 100rb
  else amount = num;
  if (!unit && !defaultThousand && amount < 1000) return null; // single-line anti-typo
  if (amount > 10_000_000) return null;
  return Math.round(amount);
}

export function parseKasbonText(message) {
  if (!message || typeof message !== "string") return null;
  const text = message.trim();

  // ── PATH 1: Single-line "Kasbon <name> <amount>" (legacy quick) ──
  const single = text.match(KASBON_RE_SINGLE);
  if (single) {
    const amt = normalizeAmount(single[2], single[3], { defaultThousand: false });
    if (amt !== null) return { nameRaw: single[1].trim(), amount: amt, unit: (single[3] || "rupiah").toLowerCase(), items: null };
  }

  // ── PATH 2: Multi-line list — message mengandung kata "kasbon" + lines with "name <number>" ──
  // Pattern Santi: "Sore Bu, untuk kasbon\n1. Rizal 100\n2. Putra 100\n3. Ezra 100\nApakah bisa Bu?"
  if (/kasbon/i.test(text)) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      // Skip header line (mengandung "kasbon" tapi bukan item, e.g. "untuk kasbon", "kasbon hari ini")
      if (/kasbon/i.test(line) && !/^\s*[-•*\d]/.test(line)) continue;
      // Skip tanya/closing line
      if (/^(apakah|tolong|mohon|terima|trims|thx|ok|baik|siap)/i.test(line)) continue;
      const m = line.match(KASBON_LINE_ITEM);
      if (!m) continue;
      const nameRaw = m[1].trim().replace(/[.,]$/, "");
      if (!nameRaw || nameRaw.length < 2) continue;
      // Reject jika nama kebanyakan bukan-huruf (mis. "Bu 100" – "Bu" cuma 2 huruf, OK; tapi "ya 5")
      if (!/[a-zA-Z]/.test(nameRaw)) continue;
      const amt = normalizeAmount(m[2], m[3], { defaultThousand: true });
      if (amt === null) continue;
      items.push({ nameRaw, amount: amt, unit: (m[3] || "rupiah").toLowerCase() });
    }
    if (items.length >= 2) {
      // Total guard
      const totalAmt = items.reduce((s, i) => s + i.amount, 0);
      if (totalAmt > 0 && totalAmt <= 50_000_000) {
        return { multi: true, items, total: totalAmt };
      }
    } else if (items.length === 1) {
      // Single item ditemukan via list pattern — treat as single (e.g. user kirim "kasbon\n- Andi 100")
      const it = items[0];
      return { nameRaw: it.nameRaw, amount: it.amount, unit: it.unit, items: null };
    }
  }

  return null;
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
// Mengakomodasi kalimat informal: "Oke San pada masuk semua ya", "Iya masuk semua Bu", "approve semua"
const APPROVAL_RE_STRICT = /^(ok|oke|okay|baik|siap|acc|approve|approved|setuju|yes|ya|gas|👍|✅)\.?!?$/i;
const APPROVAL_RE_PHRASE = /\b(ok(?:e|ay)?|baik|siap|acc|approve[ds]?|setuju|gas|masuk\s+semua|iya\s+masuk|ya\s+masuk|silakan|silahkan|boleh|gass)\b/i;

export function isKasbonApprovalMessage(message) {
  if (!message || typeof message !== "string") return false;
  const text = message.trim();
  if (text.length > 200) return false; // Approval biasanya pendek; long-form text bukan approval
  if (APPROVAL_RE_STRICT.test(text)) return true;
  // Phrase mode: harus ada keyword approve DAN pesan pendek (<= 80 char) untuk kurangi false-positive
  if (text.length <= 80 && APPROVAL_RE_PHRASE.test(text)) return true;
  return false;
}
