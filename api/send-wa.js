// api/send-wa.js
// POST /api/send-wa  { phone, message }
// Proxy ke Fonnte — token aman di server

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({error:"Method not allowed"});

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
