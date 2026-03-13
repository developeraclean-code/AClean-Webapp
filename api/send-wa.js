// api/send-wa.js
// POST /api/send-wa  { phone, message }
// Proxy ke Fonnte — token aman di server

import { validateInternalToken, checkRateLimit, setCorsHeaders } from "./_auth.js";

export default async function handler(req, res) {
  // ── SEC-02 + SEC-05: CORS + rate limit ketat untuk WA ──
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({error:"Method not allowed"});

  // SEC-05: Max 10 WA per menit per IP (anti-spam)
  if (!checkRateLimit(req, res, 10, 60000)) return;

  // SEC-02: Validasi internal token
  if (!validateInternalToken(req, res)) return;

  const { phone, message } = req.body || {};
  if (!phone || !message) return res.status(400).json({error:"phone dan message wajib diisi"});

  const token = process.env.FONNTE_TOKEN;
  if (!token) return res.status(500).json({error:"FONNTE_TOKEN belum diset di Vercel Environment Variables"});

  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method:"POST",
      headers:{ "Authorization": token, "Content-Type":"application/json" },
      body: JSON.stringify({ target: phone, message, countryCode:"62", typing:true, delay:1 }),
    });
    const data = await r.json();
    if (!r.ok || data.status === false)
      return res.status(500).json({error: data.reason || "Gagal kirim WA", detail: data});
    return res.status(200).json({success:true, data});
  } catch(err) {
    return res.status(500).json({error: err.message});
  }
}
