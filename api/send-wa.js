// api/send-wa.js — v3 FIXED (auth + better error reporting)
// POST /api/send-wa  { phone, message }
// Proxy ke Fonnte — token aman di server

import { validateInternalToken, checkRateLimit, setCorsHeaders } from "./_auth.js";

export default async function handler(req, res) {
  // SEC-02 + SEC-05: CORS + rate limit + auth
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({error:"Method not allowed"});

  // SEC-05: Max 10 WA per menit per IP (anti-spam)
  if (!checkRateLimit(req, res, 10, 60000)) return;

  // SEC-02: Validasi internal token
  if (!validateInternalToken(req, res)) return;

  const { phone, message } = req.body || {};

  // Validasi input — berikan error spesifik
  if (!phone)   return res.status(400).json({error:"phone wajib diisi", detail:"phone kosong atau undefined"});
  if (!message) return res.status(400).json({error:"message wajib diisi", detail:"message kosong atau undefined"});

  // Normalisasi phone — pastikan format 628xxx
  const normPhone = String(phone).replace(/^0/, "62").replace(/[^0-9]/g, "");
  if (normPhone.length < 8) {
    return res.status(400).json({error:"Format nomor HP tidak valid", detail:`Phone: "${phone}" → "${normPhone}"`});
  }

  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: "FONNTE_TOKEN belum diset di Vercel Environment Variables",
      detail: "Tambahkan FONNTE_TOKEN di Vercel → Settings → Environment Variables"
    });
  }

  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method:"POST",
      headers:{ "Authorization": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        target: normPhone,
        message,
        countryCode: "62",
        typing: true,
        delay: 1
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok || data.status === false) {
      // Log detail error dari Fonnte untuk debugging
      const reason = data.reason || data.message || "Unknown error from Fonnte";
      console.error("Fonnte error:", r.status, reason, "| target:", normPhone);

      // Berikan error yang informatif
      let userMsg = "Gagal kirim WA via Fonnte";
      if (reason.includes("invalid") || reason.includes("body")) {
        userMsg = "Token Fonnte tidak valid atau device tidak connected";
      } else if (reason.includes("quota") || reason.includes("limit")) {
        userMsg = "Quota Fonnte habis";
      } else if (reason.includes("device") || reason.includes("offline")) {
        userMsg = "Device WhatsApp Fonnte offline — scan ulang QR";
      }

      return res.status(500).json({
        error: userMsg,
        detail: reason,
        fonnte_status: r.status
      });
    }

    return res.status(200).json({success:true, data, target: normPhone});

  } catch(err) {
    console.error("send-wa exception:", err.message);
    return res.status(500).json({error: err.message});
  }
}
