import { readWaIngressHealth } from "./_wa-ingress.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolvePaymentCaller(req, { supabaseUrl, serviceKey }) {
  if (req.appClaims?.role) return {
    id: UUID.test(String(req.appClaims.userId || "")) ? req.appClaims.userId : null,
    role: req.appClaims.role,
    name: req.appClaims.name || "Owner/Admin",
  };
  if (!req.authUser?.id) return null;
  const r = await fetch(`${supabaseUrl}/rest/v1/user_profiles?select=role,name&id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error("Role pemanggil tidak dapat diverifikasi");
  const profile = (await r.json())?.[0];
  return profile ? { id: UUID.test(String(req.authUser.id)) ? req.authUser.id : null, role: profile.role, name: profile.name || req.authUser.email || "Owner/Admin" } : null;
}

// Return only operational counters. Raw cron metadata can contain invoice IDs,
// provider errors or URLs; it must not be forwarded to the browser.
export function paymentWorkerRunSummary(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) throw new Error("Invalid worker run");
  const statuses = ["SUCCESS", "SKIPPED", "RUNNING", "FAILED", "TIMEOUT"];
  if (!statuses.includes(run.status) || !Number.isFinite(Date.parse(run.started_at))) throw new Error("Invalid worker run");
  const summary = { status: run.status, started_at: new Date(run.started_at).toISOString(), finished_at: null };
  if (run.finished_at && Number.isFinite(Date.parse(run.finished_at))) summary.finished_at = new Date(run.finished_at).toISOString();
  const metadata = run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata) ? run.metadata : {};
  for (const key of ["checked", "retried", "failed", "pendingReview", "suggestion", "ignored"]) {
    if (Number.isSafeInteger(metadata[key]) && metadata[key] >= 0) summary[key] = metadata[key];
  }
  if (typeof metadata.alreadySettled === "boolean") summary.alreadySettled = metadata.alreadySettled;
  if (metadata.reason === "wa_payment_detect_off") summary.reason = metadata.reason;
  return summary;
}

export async function readPaymentMediaHealth({ supabaseUrl, serviceKey, fetchImpl = fetch, includeWorkerRun = false }) {
  const r = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/get_payment_ingestion_health`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: "{}", signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`Status bukti WA belum tersedia (HTTP ${r.status}); periksa migrasi 210`);
  const health = await r.json();
  if (!health || !Array.isArray(health.incidents)) throw new Error("Respons status bukti WA tidak valid");
  // The watchdog only needs the existing RPC. The UI additionally reads the
  // latest run (including failures), rather than mistaking the last heartbeat
  // for a successful retry of every historical file.
  if (!includeWorkerRun) return health;
  const readRun = async () => { try {
    const runsResponse = await fetchImpl(`${supabaseUrl}/rest/v1/cron_runs?task_name=eq.payment-media-retry&select=status,started_at,finished_at,metadata&order=started_at.desc&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(5000),
    });
    if (!runsResponse.ok) throw new Error("Worker result unavailable");
    const runs = await runsResponse.json();
    if (!Array.isArray(runs)) throw new Error("Invalid worker results");
    return { last_run: runs.length ? paymentWorkerRunSummary(runs[0]) : null, last_run_error: false };
  } catch {
    // Preserve queue counters, but explicitly mark the missing result. Do not
    // leak a raw database/provider error or silently invent an empty queue.
    return { last_run: null, last_run_error: true };
  } };
  const [run, ingress] = await Promise.all([readRun(), readWaIngressHealth({ supabaseUrl, serviceKey, fetchImpl })]);
  return { ...health, ...run, ingress };
}

// Router has already authenticated App Token / Supabase session / internal secret.
export async function paymentMediaHealth(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  res.setHeader("Cache-Control", "no-store");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "Supabase belum dikonfigurasi" });
  try {
    const caller = await resolvePaymentCaller(req, { supabaseUrl, serviceKey });
    const internal = !req.appClaims && !req.authUser && process.env.INTERNAL_API_SECRET
      && req.headers?.["x-internal-token"] === process.env.INTERNAL_API_SECRET;
    if (!internal && !["owner", "admin"].includes(String(caller?.role || "").toLowerCase())) {
      return res.status(403).json({ error: "Status bukti WA hanya untuk Owner/Admin" });
    }
    const health = await readPaymentMediaHealth({ supabaseUrl, serviceKey, includeWorkerRun: true });
    return res.status(200).json(health);
  } catch (error) {
    return res.status(503).json({ error: error.message || "Status bukti WA gagal dibaca" });
  }
}

// Explicit user action. Legacy server tokens are deliberately rejected: every
// manual retry must be attributable to a signed Owner/Admin session.
export async function requestPaymentMediaRetry(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  res.setHeader("Cache-Control", "no-store");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "Supabase belum dikonfigurasi" });
  try {
    const caller = await resolvePaymentCaller(req, { supabaseUrl, serviceKey });
    if (!["owner", "admin"].includes(String(caller?.role || "").toLowerCase())) {
      return res.status(403).json({ error: "Retry AI hanya untuk Owner/Admin" });
    }
    const rawIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds : [];
    const jobIds = [...new Set(rawIds.map(value => String(value || "").trim()))];
    if (!jobIds.length || jobIds.length > 20 || jobIds.some(id => !UUID.test(id))) {
      return res.status(400).json({ error: "Pilih 1–20 media yang valid" });
    }
    const rpc = await fetch(`${supabaseUrl}/rest/v1/rpc/request_wa_payment_media_retry`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_job_ids: jobIds, p_actor_id: caller.id, p_actor_name: String(caller.name || "Owner/Admin").slice(0, 120) }),
      signal: AbortSignal.timeout(7000),
    });
    if (!rpc.ok) throw new Error("Permintaan retry belum dapat disimpan");
    const result = await rpc.json();
    if (!Number.isSafeInteger(result?.requested) || !Number.isSafeInteger(result?.skipped)) throw new Error("Respons retry tidak valid");
    return res.status(200).json({ requested: result.requested, skipped: result.skipped });
  } catch (error) {
    return res.status(503).json({ error: error.message || "Retry AI belum dapat dijalankan" });
  }
}
