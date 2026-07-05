// api/[route].js - AClean Unified API Router
import { setCorsHeaders, validateInternalToken } from "./_auth.js";
import * as Sentry from "@sentry/node";
import { customerVouchers, validateVoucher, claimVoucher, adminVouchers, cancelVoucher } from "./_handlers/voucher.js";
import { monitor } from "./_handlers/monitor.js";
import { customerStatus, submitRating, generateCustomerToken } from "./_handlers/customer.js";
import { testConnection, health, getLlmConfig, getApiToken, manageUser } from "./_handlers/auth-token.js";
import { projectDelete, maintenance, mPortal, projectPortal } from "./_handlers/portal.js";
import { sendWa, notifyAbsence, receiveWa, waGroups } from "./_handlers/wa.js";
import { uploadFoto, foto, syncFotos } from "./_handlers/foto.js";
import { araChat, cronReminder } from "./_handlers/misc.js";
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
// upload-foto & monitor sengaja TIDAK di sini — memerlukan auth (validateInternalToken)
const PUBLIC_ROUTES = ["receive-wa", "test-connection", "_auth", "foto", "get-llm-config", "get-api-token", "customer-status", "submit-rating", "customer-vouchers", "health", "m-portal", "project-portal"];

// ── HANDLER MAP: route → modul di api/_handlers/ (pemecahan router bertahap) ──
const HANDLERS = {
  "monitor": monitor,
  "customer-vouchers": customerVouchers,
  "validate-voucher": validateVoucher,
  "claim-voucher": claimVoucher,
  "admin-vouchers": adminVouchers,
  "cancel-voucher": cancelVoucher,
  "customer-status": customerStatus,
  "submit-rating": submitRating,
  "generate-customer-token": generateCustomerToken,
  "test-connection": testConnection,
  "health": health,
  "get-llm-config": getLlmConfig,
  "get-api-token": getApiToken,
  "manage-user": manageUser,
  "project-delete": projectDelete,
  "maintenance": maintenance,
  "m-portal": mPortal,
  "project-portal": projectPortal,
  "send-wa": sendWa,
  "notify-absence": notifyAbsence,
  "receive-wa": receiveWa,
  "wa-groups": waGroups,
  "upload-foto": uploadFoto,
  "foto": foto,
  "sync-fotos": syncFotos,
  "ara-chat": araChat,
  "cron-reminder": cronReminder,
};

export default async function handler(req, res) {
  const route = String(req.query.route || "");
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!PUBLIC_ROUTES.includes(route)) {
    const authOk = await validateInternalToken(req, res);
    if (!authOk) return;
  }

  try {
    // Semua route hidup di modul api/_handlers/ (bukan endpoint terpisah —
    // prefix _ tidak dihitung serverless function Vercel).
    if (HANDLERS[route]) return await HANDLERS[route](req, res);

    return res.status(404).json({ error: "Route tidak ditemukan: /api/" + route });

  } catch(err) {
    console.error("[api/" + route + "] Error:", err.message);

    // Capture error to Sentry
    Sentry.captureException(err, {
      tags: {
        route,
        method: req.method,
      },
      extra: {
        url: req.url,
        // Don't log sensitive data like phone numbers
      },
    });

    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
