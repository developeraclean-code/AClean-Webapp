import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry() {
  if (initialized) return;

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      tracesSampleRate: 0.1, // 10% sampling untuk cost efficiency
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
          route: req.url,
          method: req.method,
        },
        extra: {
          body: req.method === "POST" ? { ...req.body, phone: "[REDACTED]" } : undefined,
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
