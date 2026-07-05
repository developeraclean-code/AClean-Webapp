// api/_report.js — Helper pelaporan error bersama (dipindah dari api/[route].js, Batch 3).
import * as Sentry from "@sentry/node";

// Lightweight helper utk fire-and-forget catch yang tetap ke-track di Sentry
export const sentryCatch = (op, extra) => (e) => {
  try { Sentry.captureException(e, { tags: { op }, extra: extra || {} }); } catch (_) {}
};

// ── Reporter: wrap critical write fetch(...) supaya silent fail (ngga sampai DB) tetap ke-track di Sentry. ──
// Bug 3 Juni style: regex extract OK tapi INSERT silent-fail → biaya hilang.
// Pakai: criticalFetch("expense_insert", url, opts, { sender, date, amount, ... })
export async function criticalFetch(op, url, opts, ctx = {}) {
  try {
    const r = await fetch(url, opts);
    if (r.status === 409) {
      // Unique constraint conflict (mis. expenses.dedup_key, migrasi 094) — duplikat
      // tertangkap di level DB, bukan kegagalan write. Log info, jangan Sentry warning.
      console.log(`[CRITICAL_WRITE_${op.toUpperCase()}] HTTP 409 (duplicate, dicegah DB constraint)`, ctx);
    } else if (!r.ok) {
      const body = await r.text().catch(() => "");
      Sentry.captureMessage(`[CRITICAL_WRITE_${op.toUpperCase()}] HTTP ${r.status}: ${body.slice(0, 300)}`, {
        level: "warning",
        tags: { op, http_status: String(r.status) },
        extra: ctx,
      });
    }
    return r;
  } catch (e) {
    Sentry.captureException(e, { tags: { op }, extra: ctx });
    console.error(`[CRITICAL_WRITE_${op.toUpperCase()}]`, e.message);
    return null;
  }
}
