export async function readPaymentMediaHealth({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  const r = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/get_payment_ingestion_health`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: "{}", signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`Status bukti WA belum tersedia (HTTP ${r.status}); periksa migrasi 210`);
  const health = await r.json();
  if (!health || !Array.isArray(health.incidents)) throw new Error("Respons status bukti WA tidak valid");
  return health;
}

// Router has already authenticated App Token / Supabase session / internal secret.
export async function paymentMediaHealth(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  res.setHeader("Cache-Control", "no-store");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "Supabase belum dikonfigurasi" });
  try {
    let role = req.appClaims?.role;
    if (!role && req.authUser?.id) {
      const r = await fetch(`${supabaseUrl}/rest/v1/user_profiles?select=role&id=eq.${encodeURIComponent(req.authUser.id)}&limit=1`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error("Role pemanggil tidak dapat diverifikasi");
      role = (await r.json())?.[0]?.role;
    }
    const internal = !req.appClaims && !req.authUser && process.env.INTERNAL_API_SECRET
      && req.headers?.["x-internal-token"] === process.env.INTERNAL_API_SECRET;
    if (!internal && !["owner", "admin"].includes(String(role || "").toLowerCase())) {
      return res.status(403).json({ error: "Status bukti WA hanya untuk Owner/Admin" });
    }
    const health = await readPaymentMediaHealth({ supabaseUrl, serviceKey });
    return res.status(200).json(health);
  } catch (error) {
    return res.status(503).json({ error: error.message || "Status bukti WA gagal dibaca" });
  }
}
