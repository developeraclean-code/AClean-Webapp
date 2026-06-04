// Phase 2 shadow parsers — Gap 1/2/3
// SEMUA fungsi di sini HANYA mengembalikan structured data; TIDAK ada DB write
// langsung ke tabel produksi (orders, mat_track, expenses). Caller (webhook)
// log ke wa_ai_observations utk review manual Owner.

// ═══════════════════════════════════════════════════════════════
// GAP 1 — "dibawa <name>" carrier extractor
// ═══════════════════════════════════════════════════════════════
// Format real-world:
//   "Pr32 dibawa putra 4.6kg"
//   "Vakum silver dibawa pak dedi"
//   "Aluminium tape di bawa rey"
//   "Sealen di bawa putra"
//   "Pr32 terpakai di ibu Tika provence sisa 4.1kg"  ← bukan dibawa, skip
//
// Output: { carrier_name_raw, has_carrier } | null
const DIBAWA_RE = /\bdi\s*bawa\s+(?:pak|bapak|bu|ibu|mas|mbak|kak|bg|abang|kang)?\s*([a-z][a-z\s]+?)(?:\s+\d|$)/i;

export function parseCarrierFromCaption(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(DIBAWA_RE);
  if (!m) return null;
  // Strip trailing words yang bukan nama (mis. "putra 4.6kg" → m[1]="putra")
  const nameRaw = m[1].trim().replace(/\s+(team|tim|hari|ini|sisa|kg|gram|ml|liter)\s*.*$/i, "").trim();
  if (!nameRaw || nameRaw.length < 2) return null;
  // First token (handle "pak dedi" → "dedi")
  const tokens = nameRaw.split(/\s+/).filter(Boolean);
  const main = tokens[tokens.length - 1]; // last token = nama, prefix sudah di-strip
  return { carrier_name_raw: nameRaw, carrier_main_token: main };
}

// Match carrier name ke user_profiles (Teknisi/Helper, active=true)
export async function matchCarrierName({ SU, SK, mainToken }) {
  if (!SU || !SK || !mainToken) return { matched: null, candidates: [] };
  const url = SU + "/rest/v1/user_profiles?select=id,name,role"
    + "&role=in.(Teknisi,Helper)&active=eq.true"
    + "&name=ilike." + encodeURIComponent("%" + mainToken + "%") + "&limit=10";
  try {
    const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    if (!r.ok) return { matched: null, candidates: [] };
    const rows = await r.json();
    if (rows.length === 1) return { matched: rows[0], candidates: rows };
    const exact = rows.find(r => String(r.name).toLowerCase() === mainToken.toLowerCase());
    if (exact) return { matched: exact, candidates: rows };
    return { matched: null, candidates: rows.slice(0, 5) };
  } catch (_) { return { matched: null, candidates: [] }; }
}

// ═══════════════════════════════════════════════════════════════
// GAP 2 — "team X dan Y" laporan selesai parser
// ═══════════════════════════════════════════════════════════════
// Format real-world (variasi):
//   "team Agung dan Ari\nbapak Calvin (sutera winina 3 no 58)\n\nservis dan cuci\nAC 2pk 1 unit AC..."
//   "Team Eri dan Yusuf ibu Yenni service 1 unit AC 1,5pk Pembayaran via transfer"
//   "team pak dedi dan ezra\nservice 1 unit dan pergantian kapasitas tf\nac 3/4pk"
//   "team putra dan bg ramdana, bapak Fendy onyx, service AC split wall 3 unit..."
//
// Returns: { team: [name1, name2], customer_name, service_keywords, units, payment_method, has_team, has_customer, has_service, has_payment } | null
// Team: cari "Team X dan|& Y" di awal baris atau di awal pesan. End: space|newline|comma|titik|trailing keyword
const TEAM_LINE_RE = /^team\s+(?:pak|bapak|bu|ibu|mas|mbak|bg|kak|abang|kang)?\s*([a-z][a-z]+(?:\s+[a-z]+)?)\s+(?:dan|&|\+)\s+(?:pak|bapak|bu|ibu|mas|mbak|bg|kak|abang|kang)?\s*([a-z][a-z]+)\b/i;
// Customer: pakai "bapak/ibu X" tapi BUKAN yang sudah jadi anggota team (extract di luar team line)
const CUSTOMER_RE = /(?:bapak|pak|ibu|bu|mr\.?|mrs\.?)\s+([a-z][a-z\s.]+?)(?=\s*\(|\s*[\n,]|\s+(?:di|untuk|service|servis|cuci|cek)|$)/i;
const SERVICE_RE = /(servis|service|cuci|cleaning|pasang|bongkar|repair|perbaiki|cek|tambah\s+freon|isi\s+freon|pergantian|ganti)/gi;
const UNITS_RE = /(\d+(?:[.,]\d+)?)\s*(?:pk|PK)/gi;
const UNIT_COUNT_RE = /(\d+)\s*unit/gi;
const PAYMENT_RE = /\b(tf|transfer|pembayaran\s+tf|pmbyrn\s+tf|pmb\s+tf|cash|tunai|qris|edc)\b/i;

export function parseLaporanTeam(text) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase();

  // Quick reject: harus mengandung tanda laporan
  const teamMatch = text.match(TEAM_LINE_RE);
  const hasService = SERVICE_RE.test(text); SERVICE_RE.lastIndex = 0;
  const hasUnit = /\d+\s*(pk|unit)/i.test(text);
  if (!teamMatch && !hasService) return null;

  const team = teamMatch ? [teamMatch[1].trim(), teamMatch[2].trim()] : [];
  // Cari customer di teks SETELAH team line (kalau team detected) supaya tidak mismatch "team pak dedi"
  let restText = text;
  if (teamMatch) restText = text.slice(teamMatch.index + teamMatch[0].length);
  const customerMatch = restText.match(CUSTOMER_RE);
  const customer_name = customerMatch ? customerMatch[1].trim().replace(/[.,]$/, "") : null;

  const serviceKeywords = [];
  let m;
  while ((m = SERVICE_RE.exec(text)) !== null) serviceKeywords.push(m[1].toLowerCase());
  const uniqueServices = [...new Set(serviceKeywords)];

  const units = [];
  while ((m = UNITS_RE.exec(text)) !== null) units.push(m[1].replace(",", ".") + "pk");

  const unitCounts = [];
  while ((m = UNIT_COUNT_RE.exec(text)) !== null) unitCounts.push(parseInt(m[1]));
  const totalUnits = unitCounts.reduce((a, b) => a + b, 0) || null;

  const paymentMatch = text.match(PAYMENT_RE);
  const payment_method = paymentMatch ? paymentMatch[1].toLowerCase() : null;

  const has_team = team.length === 2;
  const has_customer = !!customer_name;
  const has_service = uniqueServices.length > 0;
  const has_payment = !!payment_method;

  // Quality gate: minimal harus ada team+customer+service ATAU customer+service+payment
  const score = (has_team ? 2 : 0) + (has_customer ? 1 : 0) + (has_service ? 1 : 0) + (has_payment ? 1 : 0);
  if (score < 3) return null;

  let confidence = "LOW";
  if (has_team && has_customer && has_service && has_payment) confidence = "HIGH";
  else if (has_team && has_customer && has_service) confidence = "MEDIUM";

  return {
    team, customer_name,
    services: uniqueServices,
    capacities: units,
    total_units: totalUnits,
    payment_method,
    flags: { has_team, has_customer, has_service, has_payment },
    confidence,
  };
}

// Match team + customer → order today (read-only: cuma cek ada/tidak)
export async function matchLaporanToOrder({ SU, SK, parsed }) {
  if (!SU || !SK || !parsed?.customer_name) return { matched: [], reason: "no_customer" };
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 7 * 3600_000 - 86400_000).toISOString().slice(0, 10);
  const custLower = parsed.customer_name.toLowerCase();
  const firstToken = custLower.split(/\s+/).filter(Boolean)[0];
  if (!firstToken || firstToken.length < 2) return { matched: [], reason: "short_name" };

  const url = SU + "/rest/v1/orders?select=id,customer,phone,service,status,teknisi,teknisi2,teknisi3,helper,helper2,helper3,date"
    + "&date=in.(" + encodeURIComponent(today) + "," + encodeURIComponent(yesterday) + ")"
    + "&order=date.desc,created_at.desc&limit=200";
  try {
    const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    if (!r.ok) return { matched: [], reason: "fetch_fail" };
    const orders = await r.json();
    const matches = orders.filter(o => {
      const oname = String(o.customer || "").toLowerCase();
      return oname.includes(firstToken);
    }).slice(0, 5);
    return { matched: matches, reason: matches.length === 1 ? "unique" : matches.length > 1 ? "multi" : "none" };
  } catch (_) { return { matched: [], reason: "exc" }; }
}

// ═══════════════════════════════════════════════════════════════
// GAP 3 — Extended biaya regex
// ═══════════════════════════════════════════════════════════════
// Live di webhook (sudah PENDING_AI gated), tinggal tambah keyword + subcategory.
// Helper ini return {matched, subcategory, amount} kalau cocok, null kalau tidak.
const BIAYA_EXT_RE = /^(perbaikan\s+motor|tol|cuci\s+motor|service\s+motor|kasbon|gas\s+sepeda)[\s:]+(.+)/i;

export function parseBiayaExtended(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(BIAYA_EXT_RE);
  if (!m) return null;
  const kw = m[1].toLowerCase();
  let nominalStr = m[2]
    .replace(/(\d+)\s*(jt|juta)/gi, (_, n) => String(parseInt(n) * 1000000))
    .replace(/(\d+)\s*(rb|ribu|k)/gi, (_, n) => String(parseInt(n) * 1000));
  // Ambil LAST number (kalau "Perbaikan motor B 2345 ABC 50k" → 50000, bukan 2345 dari plat)
  const all = nominalStr.match(/[\d]{4,}/g);
  if (!all || all.length === 0) return null;
  const amount = parseInt(all[all.length - 1]);
  let subcategory;
  if (/perbaikan\s+motor|service\s+motor/i.test(kw)) subcategory = "Perbaikan Motor";
  else if (/^tol$/i.test(kw)) subcategory = "Lain-lain"; // belum ada subcat Tol; pakai Lain-lain + note
  else if (/cuci\s+motor/i.test(kw)) subcategory = "Lain-lain";
  else if (/gas\s+sepeda/i.test(kw)) subcategory = "Bensin Motor";
  else subcategory = "Lain-lain";
  return { matched: true, keyword: kw, subcategory, amount };
}
