// api/upload-toolbag.js
// POST /api/upload-toolbag — cek kelengkapan Tas Teknisi langsung dari app (menu Alat Saya),
// alternatif in-app dari alur WA lama ("Pagi/Pulang Tas N" ke WA Owner) — keduanya tetap aktif
// berdampingan, sama-sama menulis ke tool_bag_checks (1 record per bag+session+hari).
// Vision prompt/parsing dipakai bersama dgn api/_handlers/wa.js lewat api/_tool-bag-vision.js.

import { validateInternalToken, checkRateLimit, setCorsHeaders } from "./_auth.js";
import { uploadBufferToR2, hasR2Config } from "./_r2-upload.js";
import { analyzeToolBagPhoto } from "./_tool-bag-vision.js";

const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
const OWNER_PHONE = process.env.OWNER_PHONE || "";
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;

const BAGS = Array.from({ length: 10 }, (_, i) => "Tas " + (i + 1));

async function sendWA(phone, message) {
  if (!FONNTE_TOKEN || !phone) return false;
  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message }),
    });
    return r.ok;
  } catch { return false; }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!await checkRateLimit(req, res, 20, 60000)) return;
  if (!await validateInternalToken(req, res)) return;
  if (!SU || !SK) return res.status(500).json({ error: "Server config error" });
  if (!hasR2Config()) return res.status(500).json({ error: "R2 belum dikonfigurasi" });

  const b = req.body || {};
  const bagId = b.bagId;
  const sessionType = b.sessionType === "pagi" ? "pagi" : b.sessionType === "pulang" ? "pulang" : null;
  const teknisiName = (b.teknisiName || "").trim();
  const teknisiPhone = b.teknisiPhone || null;
  const base64 = b.base64;
  const mimeType = b.mimeType || "image/jpeg";

  if (!BAGS.includes(bagId)) return res.status(400).json({ error: "bagId harus salah satu dari Tas 1 - Tas 10" });
  if (!sessionType) return res.status(400).json({ error: "sessionType harus 'pagi' atau 'pulang'" });
  if (!base64) return res.status(400).json({ error: "Foto kosong" });

  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length < 10240) return res.status(400).json({ error: "Foto terlalu kecil/rusak" });

    // Checklist alat aktif untuk tas ini
    const checklistRes = await fetch(
      REST("tool_bag_checklist?bag_id=eq." + encodeURIComponent(bagId) + "&qty_min=gt.0&select=tool_name,qty_min,is_priority"),
      { headers: H }
    );
    const checklist = checklistRes.ok ? await checklistRes.json() : [];
    if (checklist.length === 0) return res.status(400).json({ error: "Checklist " + bagId + " belum diisi Owner/Admin" });

    // Record existing hari ini (bag+session) → PATCH, kalau belum ada → INSERT
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const dupRes = await fetch(
      REST("tool_bag_checks?bag_id=eq." + encodeURIComponent(bagId) +
        "&session_type=eq." + sessionType +
        "&checked_at=gte." + encodeURIComponent(todayStart.toISOString()) +
        "&select=id&limit=1"),
      { headers: H }
    ).catch(() => null);
    const dupRows = dupRes?.ok ? await dupRes.json() : [];
    const existingId = dupRows.length > 0 ? dupRows[0].id : null;

    const { toolsFound, toolsMissing, checkStatus, rawText, analysisResult } =
      await analyzeToolBagPhoto({ imageBase64: base64, mimeType, checklist });

    // Upload foto ke R2 (skip kalau foto tidak layak dianalisa — hemat storage)
    let photoUrl = null;
    if (checkStatus !== "ERROR") {
      const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
      const bagSlug = bagId.toLowerCase().replace(/\s+/g, "-");
      const now = new Date();
      const monthStr = now.toISOString().slice(0, 7);
      const dateStr = now.toISOString().slice(0, 10);
      const r2Key = `tool-bag/${monthStr}/${bagSlug}/${dateStr}_${sessionType}_${Date.now()}.${ext}`;
      const up = await uploadBufferToR2({ buffer, key: r2Key, mimeType });
      if (up.ok) photoUrl = up.url;
    }

    const savePayload = {
      photo_url: photoUrl,
      sender_phone: teknisiPhone,
      ai_raw_response: rawText.slice(0, 2000),
      tools_found: toolsFound,
      tools_missing: toolsMissing,
      status: checkStatus,
      warning_sent: false,
      reply_sent: true, // in-app: hasil sudah langsung ditampilkan di UI, tidak perlu WA balasan ke pengirim
      checked_at: new Date().toISOString(),
      notes: analysisResult?.notes || analysisResult?.photo_quality || null,
    };
    const saveUrl = existingId ? REST("tool_bag_checks?id=eq." + existingId) : REST("tool_bag_checks");
    const saveMethod = existingId ? "PATCH" : "POST";
    if (!existingId) { savePayload.bag_id = bagId; savePayload.session_type = sessionType; }
    const saveRes = await fetch(saveUrl, {
      method: saveMethod,
      headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify(savePayload),
    });
    if (!saveRes.ok) {
      const errBody = await saveRes.text().catch(() => "");
      return res.status(500).json({ error: "Gagal simpan hasil cek: " + errBody.slice(0, 200) });
    }
    const savedRows = await saveRes.json().catch(() => []);
    const checkRecordId = existingId || savedRows[0]?.id || null;

    // Alert Owner kalau CRITICAL/WARNING
    if ((checkStatus === "WARNING" || checkStatus === "CRITICAL") && OWNER_PHONE) {
      const sessionLabel = sessionType === "pagi" ? "🌅 Pagi" : "🌇 Pulang";
      const dateLabel = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
      const priorityList = toolsMissing.filter(t => t.is_priority).map(t => `🔴 *${t.name}* (WAJIB)`).join("\n");
      const normalList = toolsMissing.filter(t => !t.is_priority).map(t => `🟡 ${t.name}`).join("\n");
      let warnMsg = checkStatus === "CRITICAL" ? `🚨 *ALERT — ${bagId}*\n` : `⚠️ *Warning — ${bagId}*\n`;
      warnMsg += `${sessionLabel} | ${dateLabel} | via app${teknisiName ? " · " + teknisiName : ""}\n\n`;
      if (priorityList) warnMsg += `*Alat WAJIB tidak terdeteksi:*\n${priorityList}\n\n`;
      if (normalList) warnMsg += `*Alat lain tidak terdeteksi:*\n${normalList}\n\n`;
      warnMsg += `_Cek detail di webapp → Inventori → Tas Teknisi_`;
      await sendWA(OWNER_PHONE, warnMsg);
    }

    return res.status(200).json({
      ok: true,
      checkId: checkRecordId,
      status: checkStatus,
      toolsFound,
      toolsMissing,
      notes: analysisResult?.notes || null,
      photoQuality: analysisResult?.photo_quality || null,
      photoUrl,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Gagal proses foto tas" });
  }
}
