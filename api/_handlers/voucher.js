import Sentry from '../sentry-init.js';
import { checkRateLimit } from '../_auth.js';
import { buildPhoneVariants } from '../_validate.js';
import { normalizeVoucherEdit, voucherTodayWib } from '../../src/lib/voucherPolicy.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9][A-Z0-9-]{3,40}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
function config() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw fail(503, 'Layanan voucher belum dikonfigurasi');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}
async function rest(path, { method = 'GET', body } = {}) {
  const { url, headers } = config();
  let response;
  try { response = await fetch(`${url}/rest/v1/${path}`, { method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); }
  catch { throw fail(503, 'Layanan voucher sedang tidak tersedia; coba konfirmasi kembali dengan ID transaksi yang sama'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.code;
    if (code === '42501') throw fail(403, 'Akses voucher ditolak');
    if (code === 'P0002') throw fail(404, 'Invoice atau voucher tidak ditemukan');
    if (['40001', '23505'].includes(code)) throw fail(409, 'Invoice atau voucher berubah; muat ulang dan validasi kembali');
    if (['23514', '22023', '22P02'].includes(code)) {
      const known = /^(Voucher (sudah|bukan|tidak)|Invoice (sudah|dengan|tidak)|Persentase|Jumlah unit|Jenis voucher|Potongan|Rincian|Ringkasan|Payload|ID transaksi|Validasi hasil)/;
      throw fail(400, known.test(data?.message || '') ? data.message : 'Permintaan voucher tidak valid');
    }
    throw fail(503, 'Database voucher tidak tersedia atau migrasi voucher belum diterapkan');
  }
  if (data == null) throw fail(503, 'Respons layanan voucher tidak valid');
  return data;
}
const rpc = (name, body) => rest(`rpc/${name}`, { method: 'POST', body });
async function actor(req) {
  if (req.appClaims?.role && !['Owner', 'Admin'].includes(req.appClaims.role)) throw fail(403, 'Hanya Owner/Admin aktif');
  const id = req.appClaims?.userId || req.authUser?.id;
  if (!UUID.test(id || '')) throw fail(403, 'Identitas Owner/Admin diperlukan');
  const rows = await rest(`user_profiles?id=eq.${encodeURIComponent(id)}&select=id,name,role,active&limit=1`);
  const profile = rows[0];
  if (!profile || profile.id !== id || !profile.active || !['Owner', 'Admin'].includes(profile.role)) throw fail(403, 'Hanya Owner/Admin aktif');
  return profile;
}
async function input(req) {
  const who = await actor(req), body = req.body || {};
  const code = String(body.code || '').trim().toUpperCase(), invoiceId = String(body.invoice_id || '').trim();
  if (!CODE.test(code) || !invoiceId || invoiceId.length > 120 || !body.edit) throw fail(400, 'Kode, invoice, dan rincian edit wajib tersedia');
  const rows = await rest(`invoices?id=eq.${encodeURIComponent(invoiceId)}&select=id,customer,address,phone,updated_at,status&limit=1`);
  if (!rows[0]) throw fail(404, 'Invoice tidak ditemukan');
  let edit;
  try { edit = normalizeVoucherEdit(rows[0], body.edit); } catch (error) { throw fail(400, error.message); }
  return { who, code, invoiceId, edit, body };
}
function privateEndpoint(method, fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== method) return res.status(405).json({ error: 'Method not allowed' });
    try { return await fn(req, res); }
    catch (error) { if(!error.status || error.status>=500)Sentry.captureException(error,{tags:{component:'voucher-api',route:req.query?.route,method:req.method}});return res.status(error.status || 503).json({ ok: false, error: error.status ? error.message : 'Layanan voucher gagal; hasil belum terkonfirmasi', uncertain: !error.status || error.status >= 500 }); }
  };
}

export const validateVoucher = privateEndpoint('POST', async (req, res) => {
  const { who, code, invoiceId, edit } = await input(req);
  const quote = await rpc('voucher_quote_241', { p_actor: who.id, p_invoice: invoiceId, p_code: code, p_edit: edit });
  const v = quote.voucher;
  v.type_label = v.type === 'discount_pct' ? `Diskon ${v.value}% jasa` : v.type === 'free_unit' ? `${v.value} unit Cleaning gratis` : 'Jasa gratis';
  return res.status(200).json({ ok: true, valid: true, voucher: v, quote });
});
export const applyInvoiceVoucher = privateEndpoint('POST', async (req, res) => {
  const { who, code, invoiceId, edit, body } = await input(req);
  if (!UUID.test(body.request_id || '') || !body.expected_updated_at || !/^[0-9a-f]{64}$/.test(body.quote_hash || '')) throw fail(400, 'ID transaksi dan hasil validasi voucher wajib tersedia');
  const result = await rpc('save_invoice_voucher_241', { p_actor: who.id, p_request: body.request_id, p_invoice: invoiceId,
    p_code: code, p_edit: edit, p_expected_at: body.expected_updated_at, p_quote_hash: body.quote_hash });
  return res.status(200).json({ ok: true, ...result });
});
// Old clients must never redeem independently of invoice persistence.
export const claimVoucher = privateEndpoint('POST', async (req, res) => {
  await actor(req);
  return res.status(409).json({ ok: false, code: 'ATOMIC_REDEMPTION_REQUIRED', error: 'Muat ulang aplikasi. Voucher hanya digunakan saat invoice berhasil disimpan.' });
});
export const adminVouchers = privateEndpoint('GET', async (req, res) => {
  const who = await actor(req), q = req.query || {};
  const offset = Number(q.offset ?? 0), limit = Number(q.limit ?? 50), status = q.status || 'active', search = String(q.search || '').trim();
  if (!Number.isInteger(offset) || offset < 0 || offset > 1e7 || !Number.isInteger(limit) || limit < 1 || limit > 100 || search.length > 100 || !['active','claimed','expired','cancelled','all'].includes(status)) throw fail(400, 'Filter voucher tidak valid');
  const data = await rpc('voucher_admin_page_241', { p_actor: who.id, p_status: status, p_search: search, p_offset: offset, p_limit: limit });
  return res.status(200).json({ ok: true, ...data });
});
export const cancelVoucher = privateEndpoint('POST', async (req, res) => {
  const who = await actor(req), body = req.body || {};
  if (!UUID.test(body.id || '')) throw fail(400, 'ID voucher tidak valid');
  const result = await rpc('cancel_voucher_241', { p_actor: who.id, p_id: body.id, p_reason: String(body.reason || '').slice(0,500) || null });
  return res.status(200).json(result);
});

export async function customerVouchers(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await checkRateLimit(req, res, 20, 60000)) return;
  const token = String(req.query?.token || '').trim();
  if (!/^[a-f0-9]{48}$/i.test(token)) return res.status(400).json({ error: 'Token portal tidak valid' });
  try {
    const rows = await rest(`customer_tokens?token=eq.${encodeURIComponent(token)}&select=phone,expires_at&limit=1`);
    if (!rows[0]) return res.status(404).json({ error: 'Token portal tidak ditemukan' });
    if (rows[0].expires_at && Date.parse(rows[0].expires_at) < Date.now()) return res.status(401).json({ error: 'Link portal sudah expired', code: 'TOKEN_EXPIRED' });
    const variants = buildPhoneVariants(rows[0].phone), all = [], today = voucherTodayWib();
    if (!variants.length) throw fail(503, 'Identitas portal belum tersedia');
    for (let offset = 0; ; offset += 100) {
      const query = new URLSearchParams({ select: 'id,code,type,value,description,expires_at,created_at',
        or: `(${variants.map(p => `phone.eq.${p}`).join(',')})`, claimed_at: 'is.null', is_valid: 'eq.true',
        and: `(or(expires_at.is.null,expires_at.gte.${today}))`, order: 'created_at.desc,id', limit: '100', offset: String(offset) });
      const page = await rest(`customer_vouchers?${query}`);
      if (!Array.isArray(page)) throw fail(503, 'Respons voucher tidak valid');
      all.push(...page);
      if (page.length < 100) break;
    }
    return res.status(200).json({ vouchers: all });
  } catch (error) { return res.status(error.status || 503).json({ error: error.status ? error.message : 'Voucher belum dapat dimuat' }); }
}
