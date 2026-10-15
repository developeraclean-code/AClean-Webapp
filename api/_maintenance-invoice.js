import { randomUUID } from "node:crypto";
import { buildMaintenanceInvoiceQuote } from "../src/lib/maintenanceInvoice.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chunks = rows => Array.from({ length: Math.ceil(rows.length / 50) }, (_, i) => rows.slice(i * 50, i * 50 + 50));

// Only called after the maintenance endpoint's Owner/Admin role gate.
export async function maintenanceInvoice(req, res, SU, SK) {
  const body = req.body || {};
  const isPreview = body.action === "preview-invoice";
  const ids = body.log_ids;
  if (!uuid.test(body.client_id || "") || !Array.isArray(ids) || !ids.length || ids.length > 200
      || ids.some(id => typeof id !== "string" || !uuid.test(id)) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: "Pilih 1–200 log unik dengan perusahaan yang valid" });
  }
  if (body.notes != null && (typeof body.notes !== "string" || body.notes.length > 2000)) {
    return res.status(400).json({ error: "Catatan maksimal 2000 karakter" });
  }
  const headers = { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" };
  const read = async (query, label) => {
    const r = await fetch(`${SU}/rest/v1/${query}`, { headers });
    if (!r.ok) throw new Error(`Gagal memuat ${label}; proses invoice dihentikan. Muat ulang sebelum mencoba lagi.`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`Respons ${label} tidak valid; proses invoice dihentikan`);
    return rows;
  };
  const readIds = async (table, list, select, extra = "") => (await Promise.all(chunks(list).map(part =>
    read(`${table}?id=in.(${encodeURIComponent(part.join(","))})&select=${select}${extra}`, table)
  ))).flat();
  try {
    const [clients, rawLogs, prices, catalog] = await Promise.all([
      read(`maintenance_clients?id=eq.${body.client_id}&select=id,name,pic_phone,address`, "perusahaan"),
      readIds("maintenance_logs", ids, "*", `&client_id=eq.${body.client_id}`),
      read(`maintenance_client_prices?client_id=eq.${body.client_id}&select=*`, "harga khusus maintenance"),
      read("price_list?service=eq.Cleaning&is_active=eq.true&select=service,type,price,is_active", "price list"),
    ]);
    // Photos/descriptions/material payloads are not needed in the atomic pricing snapshot.
    const logFields = ["id", "client_id", "unit_id", "service_type", "service_category", "service_date", "cost", "order_id", "invoiced", "invoice_id"];
    const logs = rawLogs.map(log => Object.fromEntries(logFields.map(key => [key, log[key]])));
    const client = clients[0];
    if (!client) return res.status(404).json({ error: "Perusahaan tidak ditemukan" });
    if (logs.length !== ids.length || logs.some(l => l.client_id !== client.id)) {
      return res.status(400).json({ error: "Ada log hilang atau bukan milik perusahaan ini. Tidak ada invoice dibuat." });
    }
    const unitIds = [...new Set(logs.map(l => l.unit_id).filter(Boolean))];
    const orderIds = [...new Set(logs.map(l => l.order_id).filter(Boolean))];
    const [units, orders, jobInvoices] = await Promise.all([
      readIds("maintenance_units", unitIds, "id,client_id,unit_code,location,brand,ac_type,capacity_pk"),
      readIds("orders", orderIds, "id,invoice_id,status"),
      Promise.all(chunks(orderIds).map(part => read(`invoices?job_id=in.(${encodeURIComponent(part.join(","))})&status=neq.CANCELLED&select=id,job_id`, "invoice pekerjaan"))).then(rows => rows.flat()),
    ]);
    if (units.length !== unitIds.length || units.some(u => u.client_id !== client.id)) {
      return res.status(400).json({ error: "Aset hilang atau bukan milik perusahaan ini. Perbaiki tautan log dahulu." });
    }
    const linkedIds = [...new Set(orders.map(o => o.invoice_id).filter(Boolean))];
    const linkedInvoices = await readIds("invoices", linkedIds, "id,status");
    const activeLinked = new Set(linkedInvoices.filter(i => i.status !== "CANCELLED").map(i => i.id));
    const billedJobs = new Set(jobInvoices.map(i => i.job_id));
    const invalidOrders = new Set(orders.filter(o => o.status === "CANCELLED" || activeLinked.has(o.invoice_id)).map(o => o.id));
    const billedLogs = logs.filter(l => l.invoiced === true || l.invoice_id || billedJobs.has(l.order_id) || invalidOrders.has(l.order_id));
    // Same-set retry may reach the atomic RPC; it can only replay the original invoice, never re-bill.
    const sameInvoiceRetry = !isPreview && logs.every(l => l.invoice_id && l.invoice_id === logs[0].invoice_id);
    if (billedLogs.length && !sameInvoiceRetry) {
      return res.status(409).json({ error: "Sebagian log sudah ditagih atau order dibatalkan. Gunakan invoice yang ada / Mode Gabung Invoice, bukan membuat tagihan baru.", blocked_log_ids: billedLogs.map(l => l.id) });
    }
    if (logs.some(l => String(l.order_id || "").trim())) {
      return res.status(409).json({ error: "Log dari Order/Laporan ditagih melalui verifikasi laporan. Invoice B2B hanya untuk log servis manual tanpa order; gabungkan invoice yang sudah ada melalui Mode Gabung Invoice.", blocked_log_ids: logs.filter(l => l.order_id).map(l => l.id) });
    }
    let quote;
    try {
      quote = buildMaintenanceInvoiceQuote({ clientId: client.id, logs, units, clientPrices: prices, priceListData: catalog, discount: body.discount ?? 0 });
    } catch (error) { return res.status(422).json({ error: error.message }); }
    if (isPreview) return res.status(200).json(quote);
    if (body.expected_quote !== quote.quote_key) {
      return res.status(409).json({ error: "Pilihan/harga berubah atau belum dipreview. Klik Preview server kembali sebelum membuat invoice." });
    }
    const dates = [...new Set(quote.line_items.map(i => i.service_date))].sort();
    const period = dates.length === 1 ? dates[0] : `${dates[0]} s/d ${dates[dates.length - 1]}`;
    const invoice = {
      id: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
      maintenance_client_id: client.id,
      service: `Maintenance ${quote.count} servis — ${period}`,
      units: quote.count, labor: quote.labor, material: 0, discount: quote.discount, total: quote.total,
      materials_detail: JSON.stringify(quote.line_items), notes: body.notes?.trim() || null,
    };
    const r = await fetch(`${SU}/rest/v1/rpc/create_maintenance_invoice_atomic`, {
      method: "POST", headers,
      body: JSON.stringify({ p_invoice: invoice, p_log_ids: ids, p_snapshot: { logs, units, prices, catalog }, p_actor_name: req.appClaims?.name || null }),
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) {
      const missing = ["PGRST202", "42883"].includes(result.code);
      return res.status(missing ? 503 : 409).json({ error: missing
        ? "Pembuatan invoice aman memerlukan migrasi 208. Preview tetap dapat digunakan; belum ada invoice dibuat."
        : result.message || "Invoice tidak dibuat; data berubah atau log telah ditagih. Muat ulang sebelum mencoba lagi." });
    }
    if (!result.invoice?.id) return res.status(502).json({ error: "Hasil penyimpanan belum dapat dipastikan. Muat ulang sebelum mencoba lagi." });
    return res.status(200).json({ ...result, line_items: quote.line_items, total: Number(result.invoice.total) });
  } catch (error) {
    return res.status(503).json({ error: error.message || "Sumber data invoice tidak tersedia; proses dihentikan" });
  }
}
