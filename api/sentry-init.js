import * as Sentry from "@sentry/node";
import { sentryBeforeSend, monitoringUrl } from "../src/lib/sentryPrivacy.js";

let initialized = false;

export function initSentry() {
  if (initialized) return;

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      release: process.env.SOURCE_COMMIT || process.env.ACLEAN_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA,
      sendDefaultPii: false,
      beforeSend: sentryBeforeSend,
      tracesSampleRate: 0, // Error tracking only; no performance transaction payloads.
      attachStacktrace: true,
      includeLocalVariables: false, // Jangan expose local vars untuk security
    });
    initialized = true;
  }
}

// Wrap handler untuk automatic error capture
export function withSentry(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          route: monitoringUrl(req.url),
          method: req.method,
        },
      });
      throw error;
    }
  };
}

// Capture context untuk cron jobs
export function setCronContext(taskName) {
  Sentry.setContext("cron", {
    task: taskName,
    timestamp: new Date().toISOString(),
  });
}

export default Sentry;
