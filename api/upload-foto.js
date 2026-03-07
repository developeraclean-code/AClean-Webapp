// api/upload-foto.js
// Vercel Serverless Function — upload foto laporan teknisi ke Supabase Storage

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, filename, reportId } = req.body || {};
  if (!base64 || !filename) return res.status(400).json({ error: "base64 and filename required" });

  try {
    // Strip data URL prefix jika ada (data:image/jpeg;base64,...)
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Path di Supabase Storage: laporan/{reportId}/{filename}
    const folder = reportId ? `laporan/${reportId}` : "laporan/misc";
    const path   = `${folder}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from("laporan-foto")
      .upload(path, buffer, {
        contentType: "image/jpeg",
        upsert: true
      });

    if (uploadErr) throw new Error(uploadErr.message);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("laporan-foto")
      .getPublicUrl(path);

    return res.status(200).json({ success: true, url: urlData.publicUrl, path });

  } catch (err) {
    console.error("upload-foto error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
