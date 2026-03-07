// api/send-wa.js
// Vercel Serverless Function — kirim pesan WA via Fonnte
// Dipanggil dari App.jsx frontend (sendWA function)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { phone, message } = req.body || {};

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: "phone and message required" });
  }

  // Token bisa dari env var (production) atau dari request body (testing/fallback)
  const token = process.env.FONNTE_TOKEN || req.body.token;
  if (!token) {
    return res.status(503).json({ success: false, error: "FONNTE_TOKEN belum dikonfigurasi di Vercel env vars" });
  }

  try {
    const formData = new URLSearchParams({
      target:      phone.replace(/\D/g, ""),
      message,
      countryCode: "62"
    });

    const fonRes = await fetch("https://api.fonnte.com/send", {
      method:  "POST",
      headers: { "Authorization": token },
      body:    formData
    });

    const data = await fonRes.json();

    if (!fonRes.ok || data.status === false) {
      return res.status(200).json({
        success: false,
        error:   data.reason || data.message || "Fonnte error"
      });
    }

    return res.status(200).json({ success: true, data });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
