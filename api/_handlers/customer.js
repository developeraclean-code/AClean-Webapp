// api/_handlers/customer.js — Handler grup customer/portal (Batch 2 pemecahan router, Jul 2026).
// Isi dipindah APA ADANYA dari api/[route].js — di-dispatch oleh api/[route].js.
import { checkRateLimit } from "../_auth.js";
import { validateAndNormalizePhone, buildPhoneVariants, sanitizeName } from "../_validate.js";

// ── CUSTOMER-STATUS (PUBLIC — portal customer /status/<token>) ──
export async function customerStatus(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!await checkRateLimit(req, res, 30, 60000)) return;
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).json({ error: "Token diperlukan" });

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SU || !SK) return res.status(500).json({ error: "Server config error" });

  const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

  // Lookup token — explicit select, jangan pakai select=*
  const tokRes = await fetch(`${SU}/rest/v1/customer_tokens?token=eq.${encodeURIComponent(token)}&select=id,phone,customer_name,expires_at,created_at,last_used`, { headers });
  if (!tokRes.ok) return res.status(500).json({ error: "DB error" });
  const tokRows = await tokRes.json();
  if (!tokRows.length) return res.status(404).json({ error: "Token tidak ditemukan", code: "NOT_FOUND" });

  const tokRow = tokRows[0];
  const isExpired = new Date(tokRow.expires_at) < new Date();

  // H-3 fix: block expired token di backend, jangan hanya informatif
  if (isExpired) return res.status(401).json({ error: "Link portal sudah expired. Minta link baru ke AClean.", code: "TOKEN_EXPIRED" });

  // Update last_used (fire and forget)
  fetch(`${SU}/rest/v1/customer_tokens?id=eq.${tokRow.id}`, {
    method: "PATCH", headers,
    body: JSON.stringify({ last_used: new Date().toISOString() })
  }).catch(() => {});

  const phone = tokRow.phone;
  const variants = buildPhoneVariants(phone);
  const phoneFilter = variants.map(v => `phone.eq.${encodeURIComponent(v)}`).join(",");

  // Query orders, invoices, owner_phone, dan customer membership paralel
  // phone & notes dihapus dari orders — tidak perlu ditampilkan ke customer
  // phone, paid_method, invoice_type, labor, material dihapus dari invoices
  const [ordRes, invRes, ownerRes, custRes] = await Promise.all([
    fetch(`${SU}/rest/v1/orders?or=(${phoneFilter})&order=date.desc,time.desc&limit=20&select=id,customer,address,area,service,type,units,teknisi,helper,teknisi2,helper2,date,time,time_end,status`, { headers }),
    fetch(`${SU}/rest/v1/invoices?or=(${phoneFilter})&order=created_at.desc&limit=20&select=id,job_id,customer,service,units,total,status,due,paid_at,paid_amount,remaining_amount,garansi_days,garansi_expires`, { headers }),
    fetch(`${SU}/rest/v1/app_settings?key=eq.owner_phone&select=value`, { headers }),
    fetch(`${SU}/rest/v1/customers?or=(${phoneFilter})&select=membership_tier,total_units_serviced&limit=1`, { headers }),
  ]);

  const orders = ordRes.ok ? await ordRes.json() : [];
  const invoices = invRes.ok ? await invRes.json() : [];
  const ownerRows = ownerRes.ok ? await ownerRes.json() : [];
  const custRows = custRes.ok ? await custRes.json() : [];
  const contactPhone = ownerRows[0]?.value || process.env.OWNER_PHONE || "";
  const membershipTier = custRows[0]?.membership_tier || "silver";
  const totalUnitsServiced = custRows[0]?.total_units_serviced || 0;

  // Ambil nama customer dari order pertama
  const customerName = orders[0]?.customer || tokRow.customer_name || "";

  // Fetch service reports VERIFIED untuk order-order ini (hanya field customer-safe)
  let reports = [];
  const jobIds = orders.map(o => o.id).filter(Boolean);
  if (jobIds.length > 0) {
    const rptFilter = jobIds.map(id => `job_id.eq.${encodeURIComponent(id)}`).join(",");
    const rptRes = await fetch(
      `${SU}/rest/v1/service_reports?or=(${rptFilter})&status=eq.VERIFIED&select=id,job_id,date,service,total_units,rekomendasi,catatan_rekomendasi,units,foto_urls,fotos,teknisi,helper&order=date.desc&limit=20`,
      { headers }
    );
    if (rptRes.ok) reports = await rptRes.json();
  }

  return res.status(200).json({
    expired: false,
    phone,
    customer_name: customerName,
    contact_phone: contactPhone,
    orders,
    invoices,
    reports,
    membership_tier: membershipTier,
    total_units_serviced: totalUnitsServiced,
    token_created: tokRow.created_at,
    token_expires: tokRow.expires_at,
  });
}

// ── SUBMIT-RATING (PUBLIC — dari portal customer) ──
export async function submitRating(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!await checkRateLimit(req, res, 10, 60000)) return;
  const b = req.body || {};
  const token = String(b.token || "").trim();
  const rating = parseInt(b.rating);
  const comment = String(b.comment || "").trim().slice(0, 500);

  if (!token) return res.status(400).json({ error: "Token diperlukan" });
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating 1-5 diperlukan" });

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SU || !SK) return res.status(500).json({ error: "Server config error" });
  const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json", "Prefer": "return=representation" };

  // Validasi token → dapat phone, cek expired
  const tokRes = await fetch(`${SU}/rest/v1/customer_tokens?token=eq.${encodeURIComponent(token)}&select=phone,customer_name,expires_at`, { headers });
  const tokRows = tokRes.ok ? await tokRes.json() : [];
  if (!tokRows.length) return res.status(404).json({ error: "Token tidak valid" });
  if (new Date(tokRows[0].expires_at) < new Date()) return res.status(401).json({ error: "Link portal sudah expired", code: "TOKEN_EXPIRED" });
  const { phone, customer_name } = tokRows[0];

  // Cek order_id dari body atau ambil job terakhir
  const orderId = String(b.order_id || "").trim();
  let jobData = { order_id: orderId, service: "", teknisi: "" };
  if (orderId) {
    // Validasi: order harus milik phone ini (IDOR fix) dan status COMPLETED/INVOICE_APPROVED
    const variants = buildPhoneVariants(phone);
    const phoneFilter = variants.map(v => `phone.eq.${encodeURIComponent(v)}`).join(",");
    const orRes = await fetch(
      `${SU}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&or=(${phoneFilter})&status=in.(COMPLETED,INVOICE_APPROVED)&select=id,service,teknisi`,
      { headers }
    );
    const orRows = orRes.ok ? await orRes.json() : [];
    if (!orRows[0]) return res.status(403).json({ error: "Order tidak ditemukan atau tidak dapat diberi rating" });
    jobData = { order_id: orRows[0].id, service: orRows[0].service, teknisi: orRows[0].teknisi };
  }

  // Cek duplikasi rating untuk order yang sama
  if (jobData.order_id) {
    const dupRes = await fetch(`${SU}/rest/v1/customer_feedback?order_id=eq.${encodeURIComponent(jobData.order_id)}&phone=eq.${encodeURIComponent(phone)}&select=id`, { headers });
    const dupRows = dupRes.ok ? await dupRes.json() : [];
    if (dupRows.length) return res.status(409).json({ error: "Rating sudah diberikan untuk job ini" });
  }

  // Simpan rating
  const insRes = await fetch(`${SU}/rest/v1/customer_feedback`, {
    method: "POST", headers,
    body: JSON.stringify({
      order_id: jobData.order_id || "unknown",
      phone, customer: customer_name || "",
      teknisi: jobData.teknisi || "",
      service: jobData.service || "",
      rating, comment: comment || null,
    }),
  });
  if (!insRes.ok) return res.status(500).json({ error: "Gagal simpan rating" });

  // Alert ke owner via WA jika rating ≤ 2
  if (rating <= 2) {
    const FT = process.env.FONNTE_TOKEN;
    const ownerPhone = process.env.OWNER_PHONE;
    if (FT && ownerPhone) {
      const alertMsg =
        `⚠️ *Rating Rendah dari Customer*\n\n` +
        `⭐ Rating: ${rating}/5\n` +
        `👤 Customer: ${customer_name || phone}\n` +
        `🔧 Job: ${jobData.order_id || "-"}\n` +
        `🛠 Teknisi: ${jobData.teknisi || "-"}\n` +
        `💬 Komentar: ${comment || "(tidak ada)"}\n\n` +
        `Segera follow-up untuk cegah churn! — AClean System`;
      fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { "Authorization": FT, "Content-Type": "application/json" },
        body: JSON.stringify({ target: ownerPhone, message: alertMsg }),
      }).catch(() => {});
    }
  }

  return res.status(200).json({ ok: true, message: "Rating berhasil disimpan. Terima kasih! 🙏" });
}

// ── GENERATE-CUSTOMER-TOKEN (PRIVATE — admin/owner) ──
export async function generateCustomerToken(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const b = req.body || {};
  const phone = validateAndNormalizePhone(b.phone);
  if (!phone) return res.status(400).json({ error: "Nomor HP tidak valid" });

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SU || !SK) return res.status(500).json({ error: "Server config error" });

  const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json", "Prefer": "return=representation" };

  // ── Jika order dari maintenance client (B2B): pakai portal_token permanen mereka.
  // Tidak buat customer_token baru — link maintenance tidak expired selama kontrak aktif.
  if (b.maintenance_client_id) {
    const mcRes = await fetch(`${SU}/rest/v1/maintenance_clients?id=eq.${encodeURIComponent(b.maintenance_client_id)}&select=id,name,portal_token,token_active`, { headers });
    if (mcRes.ok) {
      const mcRows = await mcRes.json();
      const mc = mcRows[0];
      if (mc?.portal_token && mc.token_active) {
        // B2B selalu pakai status.aclean.id — dedicated maintenance domain, tidak bergantung setting DB
        const link = `https://status.aclean.id/status/${mc.portal_token}`;
        return res.status(200).json({ ok: true, token: mc.portal_token, link, is_maintenance: true, client_name: mc.name });
      }
    }
    // Jika maintenance client tidak ditemukan / token nonaktif → fall through ke regular token
  }

  // ── Token: REUSE yang masih aktif, atau buat baru. Expiry 30 hari (cover garansi).
  // Reuse = link customer STABIL (tidak berubah tiap dispatch) → customer bisa cek
  // status pakai link yang sama selama masa garansi 30 hari. Expiry selalu di-refresh
  // ke 30 hari dari dispatch terakhir.
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 hari
  const custName = sanitizeName(b.customer_name || "");

  const existRes = await fetch(`${SU}/rest/v1/customer_tokens?phone=eq.${encodeURIComponent(phone)}&select=token,expires_at&order=created_at.desc&limit=1`, { headers });
  const existRows = existRes.ok ? await existRes.json() : [];
  let token = existRows[0]?.token;
  const tokExpired = existRows[0]?.expires_at && new Date(existRows[0].expires_at) < new Date();

  if (token && !tokExpired) {
    // Reuse token aktif — extend expiry + update nama/last_used (token TIDAK berubah)
    await fetch(`${SU}/rest/v1/customer_tokens?phone=eq.${encodeURIComponent(phone)}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ expires_at: expiresAt, customer_name: custName, last_used: new Date().toISOString() }),
    });
  } else {
    // Belum ada / sudah expired → buat token baru
    const { randomBytes } = await import("crypto");
    token = randomBytes(24).toString("hex");
    if (existRows.length > 0) {
      const upd = await fetch(`${SU}/rest/v1/customer_tokens?phone=eq.${encodeURIComponent(phone)}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ token, expires_at: expiresAt, customer_name: custName }),
      });
      if (!upd.ok) { const e = await upd.json().catch(() => ({})); console.error("[generate-customer-token] update error:", JSON.stringify(e)); return res.status(500).json({ error: "Gagal simpan token" }); }
    } else {
      const insRes = await fetch(`${SU}/rest/v1/customer_tokens`, {
        method: "POST", headers,
        body: JSON.stringify({ phone, token, expires_at: expiresAt, customer_name: custName }),
      });
      if (!insRes.ok) { const e = await insRes.json().catch(() => ({})); console.error("[generate-customer-token] DB error:", JSON.stringify(e)); return res.status(500).json({ error: "Gagal simpan token" }); }
    }
  }

  // Base URL: prioritas customer_portal_url (status.aclean.id) — konsisten dgn cron-reminder.
  // process.env.APP_URL bisa ke-set ke aclean.id (landing page) yang TIDAK punya portal → 404.
  let appUrl = process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  try {
    const setRes = await fetch(`${SU}/rest/v1/app_settings?key=eq.customer_portal_url&select=value`, { headers });
    if (setRes.ok) { const rows = await setRes.json(); if (rows[0]?.value) appUrl = rows[0].value; }
  } catch { /* fallback ke APP_URL */ }
  const link = `${appUrl}/status/${token}`;
  return res.status(200).json({ ok: true, token, link, expires_at: expiresAt });
}
