// api/_report.js — Helper pelaporan error bersama (dipindah dari api/[route].js, Batch 3).
import * as Sentry from "@sentry/node";

// Lightweight helper utk fire-and-forget catch yang tetap ke-track di Sentry
export const sentryCatch = (op, extra) => (e) => {
  try { Sentry.captureException(e, { tags: { op }, extra: extra || {} }); } catch (_) {}
};
