// api/test-connection.js
// POST /api/test-connection { type: "wa"|"llm"|"storage"|"db", provider? }
// Test koneksi nyata semua provider dari halaman Settings

import { createClient } from "@supabase/supabase-js";

const sb = () => createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({error:"Method not allowed"});

  const { type, provider } = req.body || {};

  try {
    // ──────────── WA ────────────
    if (type === "wa") {
      const token = process.env.FONNTE_TOKEN;
      if (!token) return res.json({success:false, message:"❌ FONNTE_TOKEN belum diset di Vercel"});
      const r = await fetch("https://api.fonnte.com/validate", {
        method:"POST", headers:{"Authorization": token}
      });
      const d = await r.json();
      if (d.status === true)
        return res.json({success:true, message:`✅ WhatsApp terhubung — ${d.target||"nomor aktif"}`});
      return res.json({success:false, message:"❌ Token tidak valid: " + (d.reason||"Unknown")});
    }

    // ──────────── LLM ────────────
    if (type === "llm") {
      const prov = provider || "claude";

      if (prov === "claude") {
        if (!process.env.ANTHROPIC_API_KEY)
          return res.json({success:false, message:"❌ ANTHROPIC_API_KEY belum diset di Vercel"});
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST",
          headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
          body: JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:5,messages:[{role:"user",content:"hi"}]})
        });
        const d = await r.json();
        if (r.ok) return res.json({success:true, message:"✅ Claude (Anthropic) terhubung"});
        return res.json({success:false, message:"❌ Claude error: " + d.error?.message});
      }

      if (prov === "openai") {
        if (!process.env.OPENAI_API_KEY)
          return res.json({success:false, message:"❌ OPENAI_API_KEY belum diset di Vercel"});
        const r = await fetch("https://api.openai.com/v1/models", {
          headers:{"Authorization":"Bearer "+process.env.OPENAI_API_KEY}
        });
        if (r.ok) return res.json({success:true, message:"✅ OpenAI terhubung"});
        return res.json({success:false, message:"❌ OpenAI API key tidak valid"});
      }

      if (prov === "gemini") {
        if (!process.env.GEMINI_API_KEY)
          return res.json({success:false, message:"❌ GEMINI_API_KEY belum diset di Vercel"});
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        if (r.ok) return res.json({success:true, message:"✅ Google Gemini terhubung"});
        return res.json({success:false, message:"❌ Gemini API key tidak valid"});
      }

      if (prov === "groq") {
        if (!process.env.GROQ_API_KEY)
          return res.json({success:false, message:"❌ GROQ_API_KEY belum diset di Vercel"});
        const r = await fetch("https://api.groq.com/openai/v1/models", {
          headers:{"Authorization":"Bearer "+process.env.GROQ_API_KEY}
        });
        if (r.ok) return res.json({success:true, message:"✅ Groq / LLaMA terhubung"});
        return res.json({success:false, message:"❌ Groq API key tidak valid"});
      }

      return res.json({success:false, message:"Provider tidak dikenal: " + prov});
    }

    // ──────────── STORAGE ────────────
    if (type === "storage") {
      const id  = process.env.R2_ACCOUNT_ID;
      const key = process.env.R2_ACCESS_KEY;
      const sec = process.env.R2_SECRET_KEY;
      const bkt = process.env.R2_BUCKET_NAME || "aclean-files";
      if (!id || !key || !sec)
        return res.json({success:false, message:"❌ R2 credentials belum diset (R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY)"});

      // Test dengan HEAD request ke bucket
      const { createHmac, createHash } = await import("crypto");
      const now   = new Date();
      const dts   = now.toISOString().replace(/[:\-]|\.\d{3}/g,"").slice(0,15)+"Z";
      const dshrt = dts.slice(0,8);
      const ph    = createHash("sha256").update("").digest("hex");
      const ch    = ["GET",`/${bkt}`,"",`host:${id}.r2.cloudflarestorage.com\nx-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`,"host;x-amz-content-sha256;x-amz-date",ph].join("\n");
      const sc    = `${dshrt}/auto/s3/aws4_request`;
      const sts   = ["AWS4-HMAC-SHA256",dts,sc,createHash("sha256").update(ch).digest("hex")].join("\n");
      const sk    = [dshrt,"auto","s3","aws4_request"].reduce((k,d)=>createHmac("sha256",k).update(d).digest(),`AWS4${sec}`);
      const sig   = createHmac("sha256",sk).update(sts).digest("hex");
      const auth  = `AWS4-HMAC-SHA256 Credential=${key}/${sc}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${sig}`;

      const r = await fetch(`https://${id}.r2.cloudflarestorage.com/${bkt}`, {
        headers:{"Host":`${id}.r2.cloudflarestorage.com`,"x-amz-content-sha256":ph,"x-amz-date":dts,"Authorization":auth}
      });
      if (r.ok || r.status === 200)
        return res.json({success:true, message:`✅ Cloudflare R2 terhubung — bucket: ${bkt}`});
      return res.json({success:false, message:`❌ R2 error ${r.status} — cek credentials`});
    }

    // ──────────── DB ────────────
    if (type === "db") {
      const { count, error } = await sb().from("orders").select("*",{count:"exact",head:true});
      if (error) return res.json({success:false, message:"❌ Supabase: "+error.message});
      return res.json({success:true, message:`✅ Supabase terhubung — ${count} orders`});
    }

    return res.status(400).json({error:"type tidak valid"});
  } catch(err) {
    return res.status(500).json({success:false, message:"Server error: "+err.message});
  }
}
