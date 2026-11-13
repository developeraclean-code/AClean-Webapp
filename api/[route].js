// api/[route].js - AClean Unified API Router
import { setCorsHeaders, validateInternalToken } from "./_auth.js";
import * as Sentry from "@sentry/node";
import { customerVouchers, validateVoucher, claimVoucher, adminVouchers, cancelVoucher, applyInvoiceVoucher } from "./_handlers/voucher.js";
import { monitor } from "./_handlers/monitor.js";
import { paymentMediaHealth } from "./_payment-health.js";
import { paymentMediaManualUpload, paymentMediaRetry } from "./_payment-recovery.js";
import { customerStatus, submitRating, generateCustomerToken } from "./_handlers/customer.js";
import { testConnection, setWaProvider, health, getLlmConfig, getApiToken, manageUser } from "./_handlers/auth-token.js";
import { projectDelete, maintenance, mPortal, projectPortal } from "./_handlers/portal.js";
import { sendWa, notifyAbsence, receiveWa, waGroups } from "./_handlers/wa.js";
import { waWorkspaceSend } from "./_handlers/wa-workspace.js";
import { uploadFoto, foto, syncFotos } from "./_handlers/foto.js";
import { araChat, cronReminder } from "./_handlers/misc.js";
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
// upload-foto & monitor sengaja TIDAK di sini — memerlukan auth (validateInternalToken)
const PUBLIC_ROUTES = ["receive-wa", "fonnte-webhook", "whacenter-webhook", "wablas-webhook", "test-connection", "_auth", "foto", "get-llm-config", "get-api-token", "customer-status", "submit-rating", "customer-vouchers", "health", "m-portal", "project-portal"];

// ── HANDLER MAP: route → modul di api/_handlers/ (pemecahan router bertahap) ──
const HANDLERS = {
  "monitor": monitor,
  "payment-media-health": paymentMediaHealth,
  "payment-media-retry": paymentMediaRetry,
  "payment-media-manual-upload": paymentMediaManualUpload,
  "customer-vouchers": customerVouchers,
  "validate-voucher": validateVoucher,
  "claim-voucher": claimVoucher,
  "apply-invoice-voucher": applyInvoiceVoucher,
  "admin-vouchers": adminVouchers,
  "cancel-voucher": cancelVoucher,
  "customer-status": customerStatus,
  "submit-rating": submitRating,
  "generate-customer-token": generateCustomerToken,
  "test-connection": testConnection,
  "set-wa-provider": setWaProvider,
  "health": health,
  "get-llm-config": getLlmConfig,
  "get-api-token": getApiToken,
  "manage-user": manageUser,
  "project-delete": projectDelete,
  "maintenance": maintenance,
  "m-portal": mPortal,
  "project-portal": projectPortal,
  "send-wa": sendWa,
  "wa-workspace-send": waWorkspaceSend,
  "notify-absence": notifyAbsence,
  "receive-wa": receiveWa,
  // Compatibility with the old URL previously displayed in Settings. The same
  // webhook-secret validation and durable intake apply to both paths.
  "fonnte-webhook": receiveWa,
  "whacenter-webhook": receiveWa,
  "wablas-webhook": receiveWa,
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
    if (Object.hasOwn(HANDLERS, route)) return await HANDLERS[route](req, res);

    return res.status(404).json({ error: "Route tidak ditemukan: /api/" + route });

  } catch(err) {
    console.error("[api/" + route + "] Error:", err.message);
    const safeRequestUrl = String(req.url || "").replace(/([?&]token=)[^&]*/gi, "$1[redacted]");

    // Capture error to Sentry
    Sentry.captureException(err, {
      tags: {
        route,
        method: req.method,
      },
      extra: {
        url: safeRequestUrl,
        // Don't log sensitive data like phone numbers
      },
    });

    // Detail exception belongs in server logs/Sentry, not in a public API
    // response where SQL, provider or configuration details may be exposed.
    return res.status(500).json({ error: "Internal server error" });
  }
}
