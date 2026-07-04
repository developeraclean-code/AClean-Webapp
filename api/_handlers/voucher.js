// api/_handlers/voucher.js — Handler grup voucher (Batch 1 pemecahan router, Jul 2026).
// Isi dipindah APA ADANYA dari api/[route].js — bukan endpoint sendiri (prefix _
// tidak dihitung serverless function Vercel); di-dispatch oleh api/[route].js.
import { checkRateLimit } from "../_auth.js";
import { validateAndNormalizePhone, buildPhoneVariants } from "../_validate.js";

// ── CUSTOMER-VOUCHERS (PUBLIC — dari portal customer) ──
export async function customerVouchers(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!await checkRateLimit(req, res, 20, 60000)) return;
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).json({ error: "Token diperlukan" });

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SU || !SK) return res.status(500).json({ error: "Server config error" });
  const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

  // Validasi token, cek expired
  const tokRes = await fetch(`${SU}/rest/v1/customer_tokens?token=eq.${encodeURIComponent(token)}&select=phone,expires_at`, { headers });
  const tokRows = tokRes.ok ? await tokRes.json() : [];
  if (!tokRows.length) return res.status(404).json({ error: "Token tidak valid" });
  if (new Date(tokRows[0].expires_at) < new Date()) return res.status(401).json({ error: "Link portal sudah expired", code: "TOKEN_EXPIRED" });
  const { phone } = tokRows[0];

  const variants = buildPhoneVariants(phone);
  const phoneFilter = variants.map(v => `phone.eq.${encodeURIComponent(v)}`).join(",");

  // Ambil voucher aktif (belum diklaim, belum expired)
  const today = new Date().toISOString().slice(0, 10);
  const vRes = await fetch(
    `${SU}/rest/v1/customer_vouchers?or=(${phoneFilter})&claimed_at=is.null&order=created_at.desc&select=id,code,type,value,description,expires_at,created_at`,
    { headers }
  );
  const vouchers = vRes.ok ? await vRes.json() : [];
  const active = vouchers.filter(v => !v.expires_at || v.expires_at >= today);

  return res.status(200).json({ vouchers: active });
}

// ─── validate-voucher (POST, private) ─────────────────────────────────────
export async function validateVoucher(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const b = req.body || {};
  const { code, phone } = b;
  if (!code || !phone) return res.status(400).json({ error: "code dan phone wajib diisi" });

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

  const vRes = await fetch(
    `${SU}/rest/v1/customer_vouchers?code=eq.${encodeURIComponent(code)}&select=*&limit=1`,
    { headers }
  );
  const vList = vRes.ok ? await vRes.json() : [];
  const v = vList[0];

  if (!v) return res.status(404).json({ error: "Kode voucher tidak ditemukan", code });
  if (!v.is_valid) return res.status(400).json({ error: "Voucher sudah dibatalkan", code });
  if (v.claimed_at) return res.status(400).json({ error: "Voucher sudah pernah digunakan", claimed_order_id: v.claimed_order_id });

  const today = new Date().toISOString().slice(0, 10);
  if (v.expires_at && v.expires_at < today) return res.status(400).json({ error: "Voucher sudah expired", expires_at: v.expires_at });

  // Validasi phone match (semua variant)
  const normalizedPhone = validateAndNormalizePhone(phone);
  const variants = normalizedPhone ? buildPhoneVariants(normalizedPhone) : [phone];
  const vPhone = validateAndNormalizePhone(v.phone) || v.phone;
  const phoneMatch = variants.some(vt => {
    const vtn = validateAndNormalizePhone(vt) || vt;
    return vtn === vPhone;
  });
  if (!phoneMatch) return res.status(400).json({ error: "Voucher bukan milik customer ini", code });

  const typeLabel = v.type === "discount_pct" ? `Diskon ${v.value}%`
    : v.type === "free_unit" ? `${v.value} Unit Cuci Gratis`
    : v.type === "free_service" ? "Servis Gratis"
    : v.type;

  return res.status(200).json({
    ok: true, valid: true,
    voucher: { id: v.id, code: v.code, type: v.type, value: v.value, type_label: typeLabel, description: v.description, customer_name: v.customer_name, expires_at: v.expires_at },
  });
}

// ─── claim-voucher (POST, private) ────────────────────────────────────────
export async function claimVoucher(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const b = req.body || {};
  const { code, invoice_id } = b;
  if (!code || !invoice_id) return res.status(400).json({ error: "code dan invoice_id wajib diisi" });

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json", "Prefer": "return=representation" };

  // Pastikan belum diklaim
  const chkRes = await fetch(`${SU}/rest/v1/customer_vouchers?code=eq.${encodeURIComponent(code)}&select=id,claimed_at,is_valid&limit=1`, { headers });
  const chkList = chkRes.ok ? await chkRes.json() : [];
  const chk = chkList[0];
  if (!chk) return res.status(404).json({ error: "Kode voucher tidak ditemukan" });
  if (chk.claimed_at) return res.status(400).json({ error: "Voucher sudah diklaim sebelumnya" });
  if (!chk.is_valid) return res.status(400).json({ error: "Voucher sudah dibatalkan" });

  const upRes = await fetch(
    `${SU}/rest/v1/customer_vouchers?code=eq.${encodeURIComponent(code)}`,
    { method: "PATCH", headers, body: JSON.stringify({ claimed_at: new Date().toISOString(), claimed_order_id: invoice_id }) }
  );
  if (!upRes.ok) return res.status(500).json({ error: "Gagal mengklaim voucher" });

  return res.status(200).json({ ok: true, message: "Voucher berhasil diklaim", code, invoice_id });
}

// ─── admin-vouchers (GET, private) ────────────────────────────────────────
export async function adminVouchers(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

  const { status: filterStatus, search } = req.query;
  const today = new Date().toISOString().slice(0, 10);

  let url = `${SU}/rest/v1/customer_vouchers?select=*&order=created_at.desc&limit=200`;
  if (filterStatus === "active") {
    url += `&claimed_at=is.null&is_valid=eq.true&expires_at=gte.${today}`;
  } else if (filterStatus === "claimed") {
    url += `&claimed_at=not.is.null`;
  } else if (filterStatus === "expired") {
    url += `&claimed_at=is.null&expires_at=lt.${today}`;
  }
  if (search) {
    const s = encodeURIComponent(search.trim());
    url += `&or=(code.ilike.*${s}*,phone.ilike.*${s}*,customer_name.ilike.*${s}*)`;
  }

  const vRes = await fetch(url, { headers });
  if (!vRes.ok) return res.status(500).json({ error: "Gagal mengambil data voucher" });
  const vouchers = await vRes.json();

  // Hitung stats ringkas
  const allRes = await fetch(`${SU}/rest/v1/customer_vouchers?select=claimed_at,is_valid,expires_at`, { headers });
  const all = allRes.ok ? await allRes.json() : [];
  const stats = {
    total: all.length,
    active: all.filter(v => !v.claimed_at && v.is_valid && (!v.expires_at || v.expires_at >= today)).length,
    claimed: all.filter(v => v.claimed_at).length,
    expired: all.filter(v => !v.claimed_at && v.expires_at && v.expires_at < today).length,
  };

  return res.status(200).json({ ok: true, vouchers, stats });
}

// ─── cancel-voucher (POST, private) ───────────────────────────────────────
export async function cancelVoucher(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const b = req.body || {};
  const { id } = b;
  if (!id) return res.status(400).json({ error: "id wajib diisi" });

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

  const upRes = await fetch(
    `${SU}/rest/v1/customer_vouchers?id=eq.${encodeURIComponent(id)}`,
    { method: "PATCH", headers, body: JSON.stringify({ is_valid: false }) }
  );
  if (!upRes.ok) return res.status(500).json({ error: "Gagal membatalkan voucher" });

  return res.status(200).json({ ok: true, message: "Voucher dibatalkan" });
}
