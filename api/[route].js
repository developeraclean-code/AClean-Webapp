// api/[route].js - AClean Unified API Router
import { setCorsHeaders, checkRateLimit, validateInternalToken } from "./_auth.js";
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
// upload-foto & monitor sengaja TIDAK di sini — memerlukan auth (validateInternalToken)
const PUBLIC_ROUTES = ["receive-wa", "test-connection", "_auth", "foto", "get-llm-config", "get-api-token", "customer-status", "submit-rating", "customer-vouchers"];

// ── VALIDATION HELPERS ──
function validateAndNormalizePhone(phone) {
  if (!phone) return null;
  let normalized = String(phone).replace(/[^0-9+]/g, "");
  if (normalized.startsWith("+62")) normalized = normalized.substring(1);
  if (normalized.startsWith("0")) normalized = "62" + normalized.substring(1);
  if (!normalized.startsWith("62")) normalized = "62" + normalized;

  // Must be valid Indonesian phone: 62 + 9-12 digits (total 11-14 digits)
  if (!/^62\d{9,12}$/.test(normalized)) return null;
  return normalized;
}

// Semua format phone yang mungkin tersimpan di DB — untuk query OR matching
function buildPhoneVariants(normalized) {
  // normalized = "628xxx" (output dari validateAndNormalizePhone)
  if (!normalized || !normalized.startsWith("62")) return [normalized];
  const digits = normalized.slice(2); // hilangkan "62"
  return [
    normalized,            // 628xxx  (Fonnte format)
    "0" + digits,          // 08xxx   (format lokal)
    "+" + normalized,      // +628xxx (format internasional)
  ];
}

function validateMessage(msg, maxLen = 4096) {
  if (!msg || typeof msg !== "string") return null;
  const trimmed = msg.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  return trimmed;
}

function sanitizeName(s) {
  return (s||"").replace(/[\r\n\t]/g, " ").slice(0, 100);
}

export default async function handler(req, res) {
  const route = String(req.query.route || "");
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!PUBLIC_ROUTES.includes(route)) {
    const authOk = await validateInternalToken(req, res);
    if (!authOk) return;
  }

  try {

    // ── SEND-WA ──
    if (route === "send-wa") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};

      // ── VALIDATION: Phone number ──
      const target = validateAndNormalizePhone(b.phone);
      if (!target) return res.status(400).json({ error: "Invalid phone number format" });

      // ── VALIDATION: Message ──
      const msg = validateMessage(b.message, 4096);
      if (!msg) return res.status(400).json({ error: "Message is required and must be 1-4096 characters" });

      const FT = process.env.FONNTE_TOKEN;
      if (!FT) return res.status(500).json({ error: "FONNTE_TOKEN belum diset", detail: "FONNTE_TOKEN_NOT_SET" });

      // ── ATTACHMENT: kirim URL langsung ke Fonnte (tanpa re-fetch di server) ──
      // Fonnte support parameter "url" untuk file yang bisa diakses publik.
      // Jika URL adalah proxy internal (/api/foto?key=...), resolve ke direct R2 URL
      // agar Fonnte bisa fetch langsung — jauh lebih cepat, tidak makan waktu serverless.
      const hasAttachment = b.url && typeof b.url === "string" && b.url.startsWith("http");

      // Resolve proxy URL → direct R2 public URL
      const resolveDirectUrl = (proxyUrl) => {
        try {
          const u = new URL(proxyUrl);
          const key = u.searchParams.get("key");
          if (!key) return proxyUrl;
          const r2Account = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
          const r2Bucket  = process.env.R2_BUCKET_NAME || "aclean-files";
          const r2PublicUrl = process.env.R2_PUBLIC_URL; // e.g. https://pub-xxx.r2.dev
          if (r2PublicUrl) return `${r2PublicUrl}/${key}`;
          if (r2Account)   return `https://${r2Account}.r2.cloudflarestorage.com/${r2Bucket}/${key}`;
        } catch { /* fallback ke URL asli */ }
        return proxyUrl;
      };

      let fonnteRes;
      if (hasAttachment) {
        const directUrl = resolveDirectUrl(b.url);
        const fname = b.filename || "dokumen.pdf";
        console.log("[send-wa] Sending URL attachment:", directUrl, "filename:", fname);
        try {
          fonnteRes = await fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: { "Authorization": FT, "Content-Type": "application/json" },
            body: JSON.stringify({ target, message: msg, url: directUrl, filename: fname, delay: "2", countryCode: "62" })
          });
        } catch (fetchErr) {
          console.warn("[send-wa] Gagal kirim URL ke Fonnte:", fetchErr.message);
          fonnteRes = null;
        }
      }

      if (!hasAttachment || !fonnteRes) {
        fonnteRes = await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { "Authorization": FT, "Content-Type": "application/json" },
          body: JSON.stringify({ target, message: msg, delay: "2", countryCode: "62" })
        });
      }

      const d = await fonnteRes.json().catch(() => ({}));
      console.log("[send-wa] Fonnte response:", JSON.stringify({ status: fonnteRes.status, body: d, hasAttachment }));

      // Jika attachment gagal, fallback: teks + link
      if (hasAttachment && (!fonnteRes.ok || d.status === false)) {
        const reason = d.reason || JSON.stringify(d);
        console.warn("[send-wa] Attachment REJECTED:", reason);
        const msgWithLink = msg + "\n\n📄 " + b.url;
        const fallbackRes = await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { "Authorization": FT, "Content-Type": "application/json" },
          body: JSON.stringify({ target, message: msgWithLink, delay: "2", countryCode: "62" })
        });
        const fd = await fallbackRes.json().catch(() => ({}));
        if (!fallbackRes.ok || fd.status === false) return res.status(502).json({ success: false, error: fd.reason || "Fonnte error" });
        return res.status(200).json({ success: true, target, withAttachment: false, fallback: true, fallbackReason: reason });
      }
      if (!fonnteRes.ok || d.status === false) return res.status(502).json({ success: false, error: d.reason || "Fonnte error" });
      return res.status(200).json({ success: true, target, withAttachment: hasAttachment });
    }

    // ── RECEIVE-WA (public) ──
    if (route === "receive-wa") {
      if (req.method === "GET") return res.status(200).json({ status: "ok", service: "AClean WA Webhook" });
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      if (!await checkRateLimit(req, res, 60, 60000)) return;

      // H-08: Webhook signature verification (opsional — aktif jika FONNTE_WEBHOOK_SECRET diset)
      const webhookSecret = process.env.FONNTE_WEBHOOK_SECRET;
      if (webhookSecret) {
        const sig = req.headers["x-fonnte-signature"] || req.headers["x-signature"] || "";
        if (!sig) {
          console.warn("[receive-wa] Missing webhook signature — rejecting");
          return res.status(401).json({ error: "Missing webhook signature" });
        }
        try {
          const { createHmac } = await import("node:crypto");
          const payload = JSON.stringify(req.body);
          const computed = "sha256=" + createHmac("sha256", webhookSecret).update(payload).digest("hex");
          const sigBuf = Buffer.from(sig);
          const compBuf = Buffer.from(computed);
          const valid = sigBuf.length === compBuf.length &&
            (() => { try { const { timingSafeEqual } = require("crypto"); return timingSafeEqual(sigBuf, compBuf); } catch { return sig === computed; } })();
          if (!valid) {
            console.warn("[receive-wa] Invalid webhook signature — rejecting");
            return res.status(401).json({ error: "Invalid webhook signature" });
          }
        } catch (sigErr) {
          console.warn("[receive-wa] Signature check error:", sigErr.message, "— allowing through");
        }
      }

      const wb = req.body || {};

      // ── VALIDATION: Phone number ──
      const sender = validateAndNormalizePhone(wb.sender);
      if (!sender) return res.status(400).json({ error: "Invalid phone number format" });

      // ── VALIDATION: Message length & content ──
      // Saat Fonnte kirim gambar, message bisa berupa URL atau kosong (ada di wb.url)
      const isMediaType = wb.type === "image" || wb.type === "document";
      const rawMessage = wb.message || (isMediaType && wb.url ? wb.url : "");
      const message = validateMessage(rawMessage, 4096);
      if (!message) return res.status(400).json({ error: "Message is required and must be 1-4096 characters" });

      // ── VALIDATION: Group message check ──
      if (wb.isGroup === true || wb.isGroup === "true") {
        // Group messages: proses sebagai input satu arah ke ARA (no AI reply, no personal flow)
        const SU_g = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const SK_g = process.env.SUPABASE_SERVICE_KEY;
        const FT_g = process.env.FONNTE_TOKEN;
        const OP_g = process.env.OWNER_PHONE;

        // Step 1: Validasi pengirim (wb.participant = nomor anggota grup)
        const participantRaw = wb.participant || "";
        // Fonnte format: "628xxx@s.whatsapp.net" atau "628xxx"
        const participantClean = participantRaw.replace(/@s\.whatsapp\.net$/i, "").replace(/@.*$/, "");
        const participantNorm = validateAndNormalizePhone(participantClean);

        if (!participantNorm || !SU_g || !SK_g) {
          return res.status(200).json({ status: "skipped", reason: "invalid_participant" });
        }

        // Cek user_profiles — coba 628xxx dan 08xxx variant
        let senderProfile = null;
        try {
          const variants = buildPhoneVariants(participantNorm);
          for (const v of variants) {
            const pRes = await fetch(
              SU_g + "/rest/v1/user_profiles?select=name,role,phone&phone=eq." + encodeURIComponent(v) + "&active=eq.true&limit=1",
              { headers: { apikey: SK_g, Authorization: "Bearer " + SK_g } }
            );
            if (pRes.ok) {
              const rows = await pRes.json();
              if (rows && rows.length > 0) { senderProfile = rows[0]; break; }
            }
          }
        } catch(pErr) {
          console.warn("[receive-wa] group participant lookup failed:", pErr.message);
        }

        if (!senderProfile) {
          return res.status(200).json({ status: "skipped", reason: "not_registered" });
        }

        const profileName = senderProfile.name || participantNorm;
        const groupId = wb.sender || wb.group || null; // grup ID dari Fonnte
        let parsedType = "general";
        let parsedAmount = null;
        let parsedJobId = null;
        let parsedOk = false;
        let expenseSaved = false;

        // Step 2: Parse format pesan
        const msgLower = message.toLowerCase();

        // BIAYA pattern
        const biayaMatch = message.match(/^(bensin|makan|parkir|tol|belanja|beli|transport|bbm|solar|pertamax|consumable)[\s:]+(.+)/i);
        if (biayaMatch) {
          parsedType = "biaya";
          const rawBiaya = biayaMatch[2];
          // Parse nominal: rb/k → *1000, jt → *1000000
          let nominalStr = rawBiaya
            .replace(/(\d+)\s*(jt|juta)/gi, (_, n) => String(parseInt(n) * 1000000))
            .replace(/(\d+)\s*(rb|ribu|k)/gi, (_, n) => String(parseInt(n) * 1000));
          const nominalMatch = nominalStr.match(/[\d]{4,}/);
          if (nominalMatch) {
            parsedAmount = parseInt(nominalMatch[0]);
            parsedOk = true;
            // Simpan ke operational_expenses
            if (SU_g && SK_g) {
              const today = new Date().toISOString().slice(0, 10);
              fetch(SU_g + "/rest/v1/operational_expenses", {
                method: "POST",
                headers: { "Content-Type": "application/json", apikey: SK_g, Authorization: "Bearer " + SK_g, Prefer: "return=minimal" },
                body: JSON.stringify({
                  date: today,
                  category: biayaMatch[1].toLowerCase(),
                  description: message,
                  amount: parsedAmount,
                  teknisi: profileName,
                  source: "wa_group",
                  notes: "via WA grup"
                })
              }).catch(e => console.error("[WA_GROUP_EXPENSE]", e.message));
              expenseSaved = true;
            }
          }
        }

        // LAPORAN SINGKAT pattern
        if (parsedType === "general") {
          const laporanMatch = message.match(/^(selesai|done|finish|beres|kelar)[\s]+([A-Z0-9\-]+)/i);
          if (laporanMatch) {
            parsedType = "laporan";
            parsedJobId = laporanMatch[2];
            parsedOk = true;
          }
        }

        // STOK HABIS pattern
        if (parsedType === "general") {
          const stokMatch = message.match(/^(stok|material|freon|bahan)\s+(.+?)\s+(habis|kosong|mau habis)/i);
          if (stokMatch) {
            parsedType = "stok_alert";
            parsedOk = true;
          }
        }

        // Step 3: Simpan ke wa_group_logs
        if (SU_g && SK_g) {
          fetch(SU_g + "/rest/v1/wa_group_logs", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK_g, Authorization: "Bearer " + SK_g, Prefer: "return=minimal" },
            body: JSON.stringify({
              sender_phone: participantNorm,
              sender_name: profileName,
              group_id: groupId,
              type: parsedType,
              content: message,
              job_id: parsedJobId,
              amount: parsedAmount,
              parsed_ok: parsedOk
            })
          }).catch(e => console.error("[WA_GROUP_LOG]", e.message));
        }

        // Step 4: Notif owner jika biaya atau stok_alert
        if ((parsedType === "biaya" || parsedType === "stok_alert") && FT_g && OP_g) {
          const ownerMsg = "📋 *Laporan Grup*\n👤 " + profileName + ": " + message + "\n✅ Dicatat otomatis";
          fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: { Authorization: FT_g, "Content-Type": "application/json" },
            body: JSON.stringify({ target: OP_g, message: ownerMsg, delay: "1", countryCode: "62" })
          }).catch(() => {});
        }

        return res.status(200).json({ status: "group_processed", type: parsedType });
      }

      const FT = process.env.FONNTE_TOKEN;
      const OP = process.env.OWNER_PHONE;
      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;

      // Read toggles
      let autoOn     = process.env.AUTOREPLY_ENABLED === "true";
      let fwdOn      = process.env.FORWARD_TO_OWNER !== "false";
      let chatbotOn  = false;
      let payDetectOn = true;
      if (SU && SK) {
        try {
          const sR = await fetch(
            SU + "/rest/v1/app_settings?select=key,value&key=in.(wa_autoreply_enabled,wa_forward_to_owner,wa_chatbot_enabled,wa_payment_detect)",
            { headers: { apikey: SK, Authorization: "Bearer " + SK } }
          );
          if (sR.ok) {
            const sArr = await sR.json();
            const sMap = Object.fromEntries((sArr||[]).map(s => [s.key, s.value]));
            if (sMap.wa_autoreply_enabled !== undefined) autoOn      = sMap.wa_autoreply_enabled === "true";
            if (sMap.wa_forward_to_owner  !== undefined) fwdOn       = sMap.wa_forward_to_owner  !== "false";
            if (sMap.wa_chatbot_enabled   !== undefined) chatbotOn   = sMap.wa_chatbot_enabled   === "true";
            if (sMap.wa_payment_detect    !== undefined) payDetectOn = sMap.wa_payment_detect    !== "false";
          }
        } catch(sErr) {
          console.warn("[receive-wa] settings fetch failed, using defaults:", sErr.message);
        }
      }

      const nowIso = new Date().toISOString();
      const senderName = sanitizeName(wb.name || ("+" + sender));

      // ── Save inbound message ke wa_messages (schema: phone,name,content,role,created_at) ──
      // Simpan created_at sebagai anchor agar image classifier bisa PATCH record yang tepat
      const msgCreatedAt = nowIso;
      if (SU && SK) fetch(SU + "/rest/v1/wa_messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
        body: JSON.stringify({ phone: sender, name: senderName, content: message, role: "customer", created_at: msgCreatedAt })
      }).catch(err => console.error("[WA_MSG_SAVE]", err.message));

      // ── Upsert wa_conversations (phone unik, increment unread, update last) ──
      if (SU && SK) {
        fetch(SU + "/rest/v1/wa_conversations?phone=eq." + encodeURIComponent(sender) + "&select=unread", {
          headers: { apikey: SK, Authorization: "Bearer " + SK }
        }).then(r => r.json()).then(rows => {
          const prevUnread = (rows?.[0]?.unread) || 0;
          return fetch(SU + "/rest/v1/wa_conversations?on_conflict=phone", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ phone: sender, name: senderName, last_message: message.slice(0, 80), updated_at: nowIso, unread: prevUnread + 1 })
          });
        }).then(r => { if (r && !r.ok) r.text().then(t => console.error("[WA_CONV_UPSERT] error:", r.status, t)); })
         .catch(err => console.error("[WA_CONV_UPSERT]", err.message));
      }

      // ── DETECT MEDIA MESSAGE (Fonnte image/document webhook) ──
      // Fonnte kirim url gambar di field "message" sebagai URL string, atau di field "url"
      const fonnteMediaUrl = (wb.type === "image" || wb.type === "document") && wb.url ? wb.url : null;
      const isMediaMessage = wb.type === "image" || wb.type === "document" ||
        (typeof message === "string" && /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|pdf)(\?|$)/i.test(message));
      const mediaUrl = fonnteMediaUrl || (isMediaMessage ? message : null);

      // ── DETECT TOOL BAG PHOTO ──
      // Caption format: "Pagi Tas 1" / "Pulang Tas 5" / "Pagi tas1" — angka 1-10
      const toolBagCaption = (() => {
        const cap = (wb.caption || message || "").trim();
        if (!cap || cap.length > 50) return null;
        // Match: (pagi|pulang|sore|selesai) + tas + digit 1-10
        const m = cap.match(/^(pagi|pulang|sore|selesai|morning)\s+tas\s*(\d{1,2})$/i);
        if (!m) return null;
        const sessionType = /^(pagi|morning)$/i.test(m[1]) ? "pagi" : "pulang";
        const bagNum = parseInt(m[2]);
        if (bagNum < 1 || bagNum > 10) return { sessionType, bagId: null, bagNumRaw: m[2] };
        return { sessionType, bagId: "Tas " + bagNum, bagNumRaw: m[2] };
      })();
      const isToolBagPhoto = !!(toolBagCaption && isMediaMessage);

      // ── PAYMENT DETECTION (TEXT) ──
      // Hanya trigger jika ADA keyword bayar DAN ada nominal angka sekaligus (bukan salah satu)
      if (payDetectOn && SU && SK) {
        const BAYAR_KW_DETECT = ["bayar","transfer","lunas","pembayaran","invoice","tagihan","dp","uang"];
        const mlCheck = message.toLowerCase();
        const looksLikePayment = BAYAR_KW_DETECT.some(k => mlCheck.includes(k));
        const amountMatch = message.match(/(?:rp\.?\s*)?([\d.,]{4,})/i);
        const hasAmount = amountMatch && parseInt(amountMatch[1].replace(/[.,]/g,"")) >= 10000;

        if (looksLikePayment && hasAmount) {
          const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
          if (AK) {
            try {
              const extractRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
                body: JSON.stringify({
                  model: "claude-haiku-4-5",
                  max_tokens: 150,
                  messages: [{ role: "user", content:
                    `Analisa pesan ini: "${message.slice(0,500)}"\nApakah ini bukti pembayaran atau info transfer bank? Jika ya: {"is_payment":true,"amount":150000,"bank":"BCA","transfer_date":"2026-04-22"}\nJika bukan: {"is_payment":false}\nJawab HANYA JSON, tidak ada teks lain.`
                  }]
                })
              });
              if (extractRes.ok) {
                const extractData = await extractRes.json();
                const rawText = ((extractData.content||[])[0]?.text || "").trim();
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const extracted = JSON.parse(jsonMatch[0]);
                  if (extracted.is_payment) {
                    let matchedInvoiceId = null;
                    let matchedOrderId = null;
                    try {
                      // Fix Bug 1: cari semua format phone yang mungkin (628xxx, 08xxx, +628xxx)
                      const phoneVariants = buildPhoneVariants(sender);
                      const phoneFilter = phoneVariants.map(p => "phone.eq." + encodeURIComponent(p)).join(",");
                      const [invRes, ordRes] = await Promise.all([
                        // Fix Bug 2: tambah filter status UNPAID/OVERDUE/PARTIAL_PAID
                        fetch(SU + "/rest/v1/invoices?select=id,total,status,job_id&or=(" + phoneFilter + ")" +
                          "&status=in.(UNPAID,OVERDUE,PARTIAL_PAID)&order=created_at.desc&limit=1",
                          { headers: { apikey: SK, Authorization: "Bearer " + SK } }),
                        fetch(SU + "/rest/v1/orders?select=id,status&or=(" + phoneFilter + ")" +
                          "&order=created_at.desc&limit=1",
                          { headers: { apikey: SK, Authorization: "Bearer " + SK } })
                      ]);
                      if (invRes.ok) {
                        const invs = await invRes.json();
                        if (invs?.length > 0) { matchedInvoiceId = invs[0].id; matchedOrderId = invs[0].job_id || null; }
                      }
                      if (!matchedOrderId && ordRes.ok) {
                        const ords = await ordRes.json(); if (ords?.length > 0) matchedOrderId = ords[0].id;
                      }
                    } catch(_) {}
                    fetch(SU + "/rest/v1/payment_suggestions", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
                      body: JSON.stringify({
                        phone: sender, sender_name: senderName, raw_message: message.slice(0,500),
                        amount: extracted.amount || null, bank: extracted.bank || null,
                        transfer_date: extracted.transfer_date || null,
                        invoice_id: matchedInvoiceId, order_id: matchedOrderId,
                        status: "PENDING", source: "text", created_at: nowIso
                      })
                    }).catch(e => console.error("[PAY_SUGGEST_SAVE]", e.message));
                    // Notif WA ke owner — agar tidak terlewat saat webapp tidak dibuka
                    if (FT && OP) {
                      const ownerNotif = "💰 *Bukti Bayar Masuk (Teks)*\n"
                        + "Dari: " + senderName + " (" + sender + ")\n"
                        + (extracted.amount ? "Nominal: Rp" + Number(extracted.amount).toLocaleString("id-ID") + "\n" : "")
                        + (extracted.bank ? "Bank: " + extracted.bank + "\n" : "")
                        + (matchedInvoiceId ? "Invoice: " + matchedInvoiceId + "\n" : "")
                        + (matchedOrderId ? "Order: " + matchedOrderId + "\n" : "")
                        + "\nPesan: \"" + message.slice(0,100) + "\"\n\n_Cek & konfirmasi di menu Invoice → WA Monitor_";
                      fetch("https://api.fonnte.com/send", {
                        method: "POST",
                        headers: { Authorization: FT, "Content-Type": "application/json" },
                        body: JSON.stringify({ target: OP, message: ownerNotif, delay: "1", countryCode: "62" })
                      }).catch(() => {});
                    }
                  }
                }
              }
            } catch(pe) {
              console.warn("[receive-wa] Payment text extraction failed:", pe.message);
            }
          }
        }
      }

      // ── TOOL BAG ANALYSIS (Foto Tas Teknisi via WA) ──
      // Trigger: caption "Pagi/Pulang [Nama Teknisi]" + media image
      // Flow: download foto → Claude Vision analisa vs checklist → upload R2 → simpan DB → WA warning ke Owner
      if (isToolBagPhoto && mediaUrl && SU && SK) {
        const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (AK && toolBagCaption.bagId) {
          try {
            const bagId = toolBagCaption.bagId;
            const sessionType = toolBagCaption.sessionType;

            // Cek apakah sudah ada record untuk bag+sesi hari ini (untuk di-overwrite)
            const todayStart = new Date(); todayStart.setHours(0,0,0,0);
            const dupCheckRes = await fetch(
              SU + "/rest/v1/tool_bag_checks?bag_id=eq." + encodeURIComponent(bagId) +
              "&session_type=eq." + sessionType +
              "&checked_at=gte." + encodeURIComponent(todayStart.toISOString()) +
              "&select=id&limit=1",
              { headers: { apikey: SK, Authorization: "Bearer " + SK } }
            ).catch(() => null);
            const dupRows = dupCheckRes?.ok ? await dupCheckRes.json() : [];
            const existingId = dupRows.length > 0 ? dupRows[0].id : null;

            {
              // Ambil checklist dari DB
              const checklistRes = await fetch(
                SU + "/rest/v1/tool_bag_checklist?bag_id=eq." + encodeURIComponent(bagId) +
                "&qty_min=gt.0&select=tool_name,qty_min,is_priority",
                { headers: { apikey: SK, Authorization: "Bearer " + SK } }
              );
              const checklist = checklistRes.ok ? await checklistRes.json() : [];

              if (checklist.length === 0) {
                console.warn("[TOOL_BAG] Checklist kosong untuk", bagId);
              } else {
                const imgFetch = await fetch(mediaUrl, { signal: AbortSignal.timeout(15000) });
                if (imgFetch.ok) {
                  const imgBuf = await imgFetch.arrayBuffer();
                  if (imgBuf.byteLength >= 10240) {
                    const base64Img = Buffer.from(imgBuf).toString("base64");
                    const mimeType = (imgFetch.headers.get("content-type") || "image/jpeg").split(";")[0].trim();

                    // Filter out qty_min=0 items (known absent from this bag)
                    const activeChecklist = checklist.filter(t => (t.qty_min ?? 1) > 0);
                    const toolListText = activeChecklist.map(t =>
                      `- ${t.tool_name} (dibutuhkan: ${t.qty_min || 1}×)${t.is_priority ? " [WAJIB]" : ""}`
                    ).join("\n");
                    const absentItems = checklist.filter(t => (t.qty_min ?? 1) === 0);

                    const TOOL_VISUAL_GUIDE = `
PANDUAN VISUAL ALAT (gunakan untuk identifikasi):
- Tang Ampere: tang berbentuk seperti tang biasa tapi ada kepala/rahang bulat besar di tengah (clamp meter) untuk mengukur arus, biasanya ada layar LCD digital di badan tang, warna dominan kuning/hitam/merah
- Manifold: alat dengan 2-3 selang warna merah, biru, kuning/hijau terhubung ke blok logam dengan 2-3 gauge/manometer bulat besar, dipakai untuk mengukur tekanan freon AC
- Kunci Inggris Ukuran 10: kunci pas/wrench logam kecil ukuran kepala ~10mm, rahang bisa diputar, lebih kecil dari kunci inggris ukuran 8 yang lebih besar
- Kunci Inggris Ukuran 8: kunci pas/wrench logam ukuran kepala ~8mm, lebih besar dari ukuran 10 — PERHATIAN: ukuran 8 justru lebih besar fisiknya dari ukuran 10 karena nomor merujuk ke ukuran baut bukan ukuran kunci
- Kunci L Set: set kunci berbentuk huruf L (hex/allen key), biasanya dalam satu set/pouch berisi banyak ukuran dari kecil ke besar, bentuk silinder panjang dengan ujung segi enam
- Palu: gagang panjang kayu/plastik dengan kepala logam berat di ujung, digunakan untuk memukul
- Pahat: batang logam panjang lurus dengan ujung pipih/runcing, lebih kecil dari palu, biasanya 20-30cm
- Tang Lancip: tang dengan rahang panjang runcing/lancip seperti jarum di ujungnya, untuk memegang benda kecil di tempat sempit
- Tang Kombinasi: tang serbaguna dengan rahang bergerigi di bagian depan dan pemotong kawat di tengah, ukuran sedang
- Tang Potong: tang dengan rahang berbentuk V tanpa gigi, khusus untuk memotong kawat/kabel, ujung rahang tajam/rata
- Obeng Standar: obeng kepala plus/bintang (+) berukuran sedang-panjang, gagang biasanya merah/kuning/hitam
- Obeng Cebol: obeng pendek/kecil kepala plus (+) untuk ruang sempit, panjang total hanya 10-15cm
- Obeng Minus: obeng kepala minus/flat (-) ujung pipih lurus, gagang biasanya berwarna
- Water Pass: alat pengukur kerataan berbentuk tabung panjang (30-60cm) dengan gelembung udara di dalam tabung kaca di tengahnya, berwarna kuning/hijau/silver
- Meteran Roll 5 Meter: pita ukur dalam kotak plastik kecil, bisa ditarik dan otomatis menggulung kembali, biasanya kuning atau oranye
- Flaring Tool: alat khusus pipa tembaga terdiri dari klem/ragum logam dengan lubang berbagai ukuran dan cone/bor kerucut terpisah, untuk membuat flare di ujung pipa AC
- Cutter Pipa AC: pemotong pipa berbentuk lingkaran kecil dengan roda pemotong, cara pakai diputar mengelilingi pipa, ukuran kecil genggaman satu tangan
- Mata Las Hicook: tabung/botol kecil gas las portabel dengan selang kecil dan torch/nozel pembakar di ujung, atau kepala torch-nya saja, digunakan untuk menyolder pipa
- Kunci Pas 10: kunci pas/wrench berbentuk U di kedua ujung (double end), salah satu ujung ukuran 10mm, logam silver/chrome, bentuk lurus
- Kunci Pas 12: kunci pas/wrench double end salah satu ujung ukuran 12mm, sedikit lebih besar dari kunci pas 10
- Kabel Roll: gulungan kabel listrik/extension cord panjang dengan stop kontak di ujungnya, digulung rapi berbentuk lingkaran/koil besar
- Test Pen Kecil: obeng kecil transparan dengan lampu indikator di dalamnya untuk mendeteksi arus listrik, ukuran kecil seperti pulpen
- Gergaji Besi: gergaji dengan bingkai logam berbentuk U/C dan bilah bergerigi tipis di tengahnya, digunakan untuk memotong logam/pipa
- Cutter Standar: pisau cutter biasa dengan bilah bisa digeser masuk-keluar dari gagang plastik, ukuran standar genggaman tangan`;

                    const visionPrompt = `Kamu adalah quality control untuk tim teknisi AC. Analisa foto tas alat teknisi ini dengan teliti.

DAFTAR ALAT YANG HARUS ADA DI TAS (cek keberadaan & jumlahnya):
${toolListText}

${absentItems.length > 0 ? `ALAT YANG SUDAH DIKETAHUI TIDAK ADA DI TAS INI (ABAIKAN — jangan cari di foto):
${absentItems.map(t => `- ${t.tool_name}`).join("\n")}

` : ""}${TOOL_VISUAL_GUIDE}

INSTRUKSI:
1. Gunakan panduan visual di atas untuk mengidentifikasi setiap alat dengan benar
2. Identifikasi setiap alat yang TERLIHAT JELAS di foto dan hitung jumlahnya
3. Bandingkan jumlah ditemukan vs jumlah yang dibutuhkan (qty_min)
4. Tandai sebagai hilang jika tidak ditemukan ATAU jumlahnya kurang dari yang dibutuhkan
5. Abaikan alat yang sudah ada di daftar "TIDAK ADA DI TAS INI" di atas
6. Jika foto buram, gelap, atau terlalu jauh sehingga tidak bisa dianalisa → status "foto_tidak_layak"
7. Gunakan confidence "high" hanya jika yakin betul, "medium" jika cukup yakin, "low" jika tidak yakin

FORMAT RESPONSE — JSON SAJA, tanpa teks lain:
{
  "photo_quality": "ok" | "blur" | "too_dark" | "too_far" | "foto_tidak_layak",
  "tools_found": [{"name":"Tang Ampere","qty":1,"confidence":"high"}],
  "tools_missing": [{"name":"Manifold","is_priority":true,"qty_expected":1,"qty_found":0}],
  "notes": "catatan singkat opsional"
}`;

                    const visionRes = await fetch("https://api.anthropic.com/v1/messages", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
                      body: JSON.stringify({
                        model: "claude-haiku-4-5",
                        max_tokens: 800,
                        messages: [{ role: "user", content: [
                          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Img } },
                          { type: "text", text: visionPrompt }
                        ]}]
                      })
                    });

                    let analysisResult = null;
                    let rawText = "";
                    if (visionRes.ok) {
                      const visionData = await visionRes.json();
                      rawText = (visionData.content||[]).map(c=>c.text||"").join("").trim();
                      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                      if (jsonMatch) {
                        try { analysisResult = JSON.parse(jsonMatch[0]); } catch(_) {}
                      }
                    }

                    let toolsFound = [];
                    let toolsMissing = [];
                    let checkStatus = "ERROR";

                    if (analysisResult && analysisResult.photo_quality !== "foto_tidak_layak") {
                      toolsFound = analysisResult.tools_found || [];
                      toolsMissing = analysisResult.tools_missing || [];
                      // Cross-reference: tools_missing harus include is_priority + qty_expected dari activeChecklist
                      toolsMissing = toolsMissing.map(t => {
                        const cl = activeChecklist.find(c => c.tool_name.toLowerCase() === (t.name||"").toLowerCase());
                        return { name: t.name, is_priority: cl?.is_priority || t.is_priority || false, qty_expected: cl?.qty_min || 1, qty_found: t.qty_found || 0 };
                      });
                      const hasCriticalMissing = toolsMissing.some(t => t.is_priority);
                      const hasWarning = toolsMissing.length > 0;
                      checkStatus = hasCriticalMissing ? "CRITICAL" : hasWarning ? "WARNING" : "OK";
                    }

                    // Upload foto ke R2 (kompres via Sharp tidak dipakai — WA sudah auto-compress)
                    let photoR2Path = null;
                    if (analysisResult && checkStatus !== "ERROR") {
                      const r2Key = process.env.R2_ACCESS_KEY;
                      const r2Secret = process.env.R2_SECRET_KEY;
                      const r2Account = process.env.R2_ACCOUNT_ID;
                      const r2Bucket = process.env.R2_BUCKET_NAME || "aclean-files";
                      if (r2Key && r2Secret && r2Account) {
                        try {
                          const crypto = await import("crypto");
                          const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
                          const bagSlug = bagId.toLowerCase().replace(/\s+/g, "-");
                          const now0 = new Date();
                          const monthStr = now0.toISOString().slice(0, 7); // "2026-05"
                          const dateStr = now0.toISOString().slice(0, 10);  // "2026-05-18"
                          const r2ObjectKey = `tool-bag/${monthStr}/${bagSlug}/${dateStr}_${sessionType}_${Date.now()}.${ext}`;
                          const r2Host = r2Account + ".r2.cloudflarestorage.com";
                          const r2Endpoint = "https://" + r2Host + "/" + r2Bucket + "/" + r2ObjectKey;
                          const imgBuffer = Buffer.from(imgBuf);
                          const now2    = new Date();
                          const dateStr2 = now2.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
                          const amzDate = now2.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
                          const payloadHash = crypto.createHash("sha256").update(imgBuffer).digest("hex");
                          const canonicalHeaders = "content-type:" + mimeType + "\nhost:" + r2Host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
                          const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
                          const canonicalUri = "/" + r2Bucket + "/" + encodeURIComponent(r2ObjectKey).replace(/%2F/g, "/");
                          const canonicalReq = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
                          const credScope = dateStr2 + "/auto/s3/aws4_request";
                          const reqHash = crypto.createHash("sha256").update(canonicalReq).digest("hex");
                          const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");
                          const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
                          const signingKey = hmac(hmac(hmac(hmac("AWS4" + r2Secret, dateStr2), "auto"), "s3"), "aws4_request");
                          const signature = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
                          const authorization = "AWS4-HMAC-SHA256 Credential=" + r2Key + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

                          const r2UploadRes = await fetch(r2Endpoint, {
                            method: "PUT",
                            headers: { "Authorization": authorization, "Content-Type": mimeType, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, "Content-Length": String(imgBuffer.length) },
                            body: imgBuffer
                          });
                          if (r2UploadRes.ok) {
                            photoR2Path = "/api/foto?key=" + encodeURIComponent(r2ObjectKey);
                          }
                        } catch(r2Err) { console.warn("[TOOL_BAG_R2]", r2Err.message); }
                      }
                    }

                    // Simpan record ke tool_bag_checks — UPDATE jika sudah ada hari ini, INSERT jika baru
                    try {
                      const savePayload = {
                        photo_url: photoR2Path,
                        sender_phone: sender,
                        ai_raw_response: rawText.slice(0, 2000),
                        tools_found: toolsFound,
                        tools_missing: toolsMissing,
                        status: checkStatus,
                        warning_sent: false,
                        checked_at: new Date().toISOString(),
                        notes: analysisResult?.notes || (analysisResult?.photo_quality || null)
                      };
                      const saveUrl = existingId
                        ? SU + "/rest/v1/tool_bag_checks?id=eq." + existingId
                        : SU + "/rest/v1/tool_bag_checks";
                      const saveMethod = existingId ? "PATCH" : "POST";
                      if (!existingId) { savePayload.bag_id = bagId; savePayload.session_type = sessionType; }
                      const saveRes = await fetch(saveUrl, {
                        method: saveMethod,
                        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
                        body: JSON.stringify(savePayload)
                      });
                      if (!saveRes.ok) {
                        const errBody = await saveRes.text().catch(() => "");
                        console.error("[TOOL_BAG_SAVE] HTTP", saveRes.status, errBody.slice(0, 200));
                      }
                    } catch(saveErr) { console.error("[TOOL_BAG_SAVE]", saveErr.message); }

                    // Kirim WA Warning ke Owner jika ada masalah
                    if ((checkStatus === "WARNING" || checkStatus === "CRITICAL") && FT && OP) {
                      const sessionLabel = sessionType === "pagi" ? "🌅 Pagi" : "🌇 Pulang";
                      const dateLabel = new Date().toLocaleDateString("id-ID", { day:"numeric", month:"long", year:"numeric" });
                      const priorityList = toolsMissing.filter(t => t.is_priority).map(t => `🔴 *${t.name}* (WAJIB)`).join("\n");
                      const normalList = toolsMissing.filter(t => !t.is_priority).map(t => `🟡 ${t.name}`).join("\n");
                      let warnMsg = checkStatus === "CRITICAL"
                        ? `🚨 *ALERT — ${bagId}*\n`
                        : `⚠️ *Warning — ${bagId}*\n`;
                      warnMsg += `${sessionLabel} | ${dateLabel}\n\n`;
                      if (priorityList) warnMsg += `*Alat WAJIB tidak terdeteksi:*\n${priorityList}\n\n`;
                      if (normalList) warnMsg += `*Alat lain tidak terdeteksi:*\n${normalList}\n\n`;
                      warnMsg += `_Cek detail di webapp → Inventori → Tas Teknisi_`;
                      await fetch("https://api.fonnte.com/send", {
                        method: "POST",
                        headers: { Authorization: FT, "Content-Type": "application/json" },
                        body: JSON.stringify({ target: OP, message: warnMsg, delay: "1", countryCode: "62" })
                      }).catch(()=>{});
                    }

                    // Konfirmasi balik ke teknisi
                    if (FT) {
                      let konfirMsg;
                      const updateLabel = existingId ? " _(diperbarui)_" : "";
                      const sessionLabel = sessionType === "pagi" ? "Pagi" : "Pulang";

                      // Bagian 1: List alat sesuai checklist (qty_min > 0 = ada di tas)
                      const activeNames = new Set(checklist.map(t => t.tool_name.toLowerCase()));
                      const checklistList = checklist.map(t => `${t.is_priority ? "🔴" : "⚪"} ${t.tool_name}${t.is_priority ? " (WAJIB)" : ""}`).join("\n");

                      // Bagian 2: Alat terdeteksi AI — hanya yang ada di checklist aktif
                      const foundInChecklist = toolsFound.filter(t => activeNames.has(t.name.toLowerCase()));
                      const foundList = foundInChecklist.length > 0
                        ? foundInChecklist.map(t => `✅ ${t.name}`).join("\n")
                        : "_Tidak ada alat yang terdeteksi_";

                      // Bagian 3: Alat tidak terdeteksi — hanya yang ada di checklist aktif
                      const missingInChecklist = toolsMissing.filter(t => activeNames.has(t.name.toLowerCase()));
                      const priorityMissing = missingInChecklist.filter(t => t.is_priority).map(t => `🔴 ${t.name} (WAJIB)`).join("\n");
                      const normalMissing = missingInChecklist.filter(t => !t.is_priority).map(t => `🟡 ${t.name}`).join("\n");
                      const missingList = [priorityMissing, normalMissing].filter(Boolean).join("\n") || "_Semua alat lengkap!_";

                      if (checkStatus === "ERROR") {
                        konfirMsg = `⚠️ Foto tas tidak bisa dianalisa (${analysisResult?.photo_quality || "blur/gelap"}).\n\n📝 *Note:* Foto ulang yang jelas agar terbaca dengan benar. Pastikan pencahayaan cukup, dekat, dan semua alat terlihat. Terima kasih!`;
                      } else if (checkStatus === "OK") {
                        konfirMsg = `✅ *${bagId} — ${sessionLabel}*${updateLabel}\nSemua alat lengkap! 👍\n\n📋 *List Alat ${bagId}:*\n${checklistList}\n\n🔍 *Alat Terdeteksi AI:*\n${foundList}`;
                      } else {
                        konfirMsg = `📸 *${bagId} — ${sessionLabel}*${updateLabel}\n\n📋 *List Alat ${bagId}:*\n${checklistList}\n\n🔍 *Alat Terdeteksi AI:*\n${foundList}\n\n❌ *Alat Tidak Terdeteksi AI:*\n${missingList}\n\n📝 *Note:* Foto ulang yang jelas agar terbaca dengan benar. Pastikan semua alat terlihat di foto.`;
                      }
                      await fetch("https://api.fonnte.com/send", {
                        method: "POST",
                        headers: { Authorization: FT, "Content-Type": "application/json" },
                        body: JSON.stringify({ target: sender, message: konfirMsg, delay: "2", countryCode: "62" })
                      }).catch(()=>{});
                    }
                  }
                }
              }
            }
          } catch(tbErr) {
            console.warn("[TOOL_BAG] error:", tbErr.message);
          }
        } else if (toolBagCaption && !toolBagCaption.bagId) {
          // Nomor tas di luar range 1-10
          if (FT) fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: { Authorization: FT, "Content-Type": "application/json" },
            body: JSON.stringify({
              target: sender,
              message: `❓ Nomor tas "${toolBagCaption.bagNumRaw}" tidak valid.\nMohon kirim ulang dengan format:\n"Pagi Tas 1" atau "Pulang Tas 5"\n\nNomor tas yang terdaftar: Tas 1 - Tas 10`,
              delay: "1", countryCode: "62"
            })
          }).catch(()=>{});
        }
      }

      // ── IMAGE CLASSIFIER + SELECTIVE R2 UPLOAD (Opsi C) ──
      // Optimasi: cek Content-Length dulu via HEAD request — skip gambar < 10 KB (sticker/icon)
      // Download gambar hanya dilakukan setelah lolos size check
      // PENTING: skip jika ini tool bag photo (sudah diproses di branch di atas)
      if (isMediaMessage && mediaUrl && SU && SK && !isToolBagPhoto) {
        const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (AK) {
          try {
            // HEAD request dulu untuk cek ukuran — tidak download isi gambar
            let skipDueToSize = false;
            try {
              const headRes = await fetch(mediaUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
              if (headRes.ok) {
                const contentLength = parseInt(headRes.headers.get("content-length") || "0");
                if (contentLength > 0 && contentLength < 10240) skipDueToSize = true; // < 10 KB = sticker/icon
              }
            } catch (_) {}

            if (skipDueToSize) {
              console.log("[WA_IMG] Skip: ukuran < 10 KB (sticker/icon), tidak diproses");
            } else {
            const imgFetch = await fetch(mediaUrl, { signal: AbortSignal.timeout(10000) });
            if (imgFetch.ok) {
              const imgBuf = await imgFetch.arrayBuffer();
              // Double-check ukuran setelah download — buang jika < 10 KB
              if (imgBuf.byteLength < 10240) {
                console.log("[WA_IMG] Skip setelah download: ukuran < 10 KB");
              } else {
              const base64Img = Buffer.from(imgBuf).toString("base64");
              const mimeType = (imgFetch.headers.get("content-type") || "image/jpeg").split(";")[0].trim();

              // Step 1: Classify gambar — satu API call untuk dua tujuan
              const classifyRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
                body: JSON.stringify({
                  model: "claude-haiku-4-5",
                  max_tokens: 250,
                  messages: [{ role: "user", content: [
                    { type: "image", source: { type: "base64", media_type: mimeType, data: base64Img } },
                    { type: "text", text: 'Klasifikasikan gambar ini. Pilih SATU kategori: "bukti_transfer" (struk transfer/screenshot m-banking), "kerusakan_ac" (foto AC rusak/error/bocor/kotor), "dokumen" (dokumen/teks lain yang relevan), atau "tidak_relevan" (foto tidak terkait AC/pembayaran). Jika bukti_transfer, ekstrak: amount (angka), bank (nama bank), transfer_date (YYYY-MM-DD). Format JSON SAJA:\n{"category":"bukti_transfer","amount":150000,"bank":"BCA","transfer_date":"2026-04-22"}\natau\n{"category":"kerusakan_ac"}\natau\n{"category":"tidak_relevan"}' }
                  ]}]
                })
              });

              let savedImageUrl = null;
              if (classifyRes.ok) {
                const classifyData = await classifyRes.json();
                const rawClassify = (classifyData.content||[]).map(c=>c.text||"").join("").trim();
                const jsonMatchC = rawClassify.match(/\{[\s\S]*\}/);
                if (jsonMatchC) {
                  let classified;
                  try { classified = JSON.parse(jsonMatchC[0]); } catch(_) {}

                  // Hanya simpan bukti_transfer — kategori lain tidak perlu disimpan di R2
                  const shouldSave = classified && classified.category === "bukti_transfer";

                  // Step 2: Upload ke R2 hanya jika kategori relevan
                  if (shouldSave) {
                    const r2Key = process.env.R2_ACCESS_KEY;
                    const r2Secret = process.env.R2_SECRET_KEY;
                    const r2Account = process.env.R2_ACCOUNT_ID;
                    const r2Bucket = process.env.R2_BUCKET_NAME || "aclean-files";
                    const r2PublicUrl = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

                    if (r2Key && r2Secret && r2Account) {
                      try {
                        const crypto = await import("crypto");
                        const ext = mimeType === "image/png" ? "png" : mimeType === "image/gif" ? "gif" : mimeType === "image/webp" ? "webp" : "jpg";
                        const r2ObjectKey = "wa-images/" + classified.category + "/" + Date.now() + "_" + sender + "." + ext;
                        const r2Host = r2Account + ".r2.cloudflarestorage.com";
                        const r2Endpoint = "https://" + r2Host + "/" + r2Bucket + "/" + r2ObjectKey;
                        const imgBuffer = Buffer.from(imgBuf);

                        const now2    = new Date();
                        const dateStr = now2.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
                        const amzDate = now2.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
                        const payloadHash = crypto.createHash("sha256").update(imgBuffer).digest("hex");
                        const canonicalHeaders = "content-type:" + mimeType + "\nhost:" + r2Host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
                        const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
                        const canonicalUri = "/" + r2Bucket + "/" + encodeURIComponent(r2ObjectKey).replace(/%2F/g, "/");
                        const canonicalReq = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
                        const credScope = dateStr + "/auto/s3/aws4_request";
                        const reqHash = crypto.createHash("sha256").update(canonicalReq).digest("hex");
                        const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");
                        const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
                        const signingKey = hmac(hmac(hmac(hmac("AWS4" + r2Secret, dateStr), "auto"), "s3"), "aws4_request");
                        const signature = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
                        const authorization = "AWS4-HMAC-SHA256 Credential=" + r2Key + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

                        const r2UploadRes = await fetch(r2Endpoint, {
                          method: "PUT",
                          headers: { "Authorization": authorization, "Content-Type": mimeType, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, "Content-Length": String(imgBuffer.length) },
                          body: imgBuffer
                        });
                        if (r2UploadRes.ok) {
                          // Simpan key R2 saja — frontend render via /api/foto?key=...
                          // Hindari hardcode domain agar tidak berubah tiap deploy
                          savedImageUrl = "/api/foto?key=" + encodeURIComponent(r2ObjectKey);
                        } else {
                          const errTxt = await r2UploadRes.text().catch(() => "");
                          console.warn("[WA_IMG_R2] Upload failed:", r2UploadRes.status, errTxt.slice(0,200));
                        }
                      } catch(r2Err) {
                        console.warn("[WA_IMG_R2] R2 upload error:", r2Err.message);
                      }
                    }
                  }

                  // Step 3: Update wa_messages dengan image_url — match exact record via phone+created_at
                  if (savedImageUrl && SU && SK) {
                    fetch(SU + "/rest/v1/wa_messages?phone=eq." + encodeURIComponent(sender) + "&created_at=eq." + encodeURIComponent(msgCreatedAt), {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
                      body: JSON.stringify({ image_url: savedImageUrl })
                    }).catch(e => console.warn("[WA_IMG_PATCH]", e.message));
                  }

                  // Step 4: Payment suggestion + auto-patch invoice jika bukti_transfer
                  if (payDetectOn && classified && classified.category === "bukti_transfer") {
                    let matchedInvoice = null;
                    let matchedOrderId = null;
                    try {
                      // Fix Bug 1: cari semua format phone yang mungkin (628xxx, 08xxx, +628xxx)
                      const phoneVariants = buildPhoneVariants(sender);
                      const phoneFilter = phoneVariants.map(p => "phone.eq." + encodeURIComponent(p)).join(",");

                      // Fix Bug 2: tambah PARTIAL_PAID ke status filter
                      const [invRes2, ordRes] = await Promise.all([
                        fetch(SU + "/rest/v1/invoices?select=id,job_id,total,status&or=(" + phoneFilter + ")" +
                          "&status=in.(UNPAID,OVERDUE,PARTIAL_PAID)&order=created_at.desc&limit=1",
                          { headers: { apikey: SK, Authorization: "Bearer " + SK } }),
                        fetch(SU + "/rest/v1/orders?select=id,status&or=(" + phoneFilter + ")" +
                          "&order=created_at.desc&limit=1",
                          { headers: { apikey: SK, Authorization: "Bearer " + SK } })
                      ]);
                      if (invRes2.ok) {
                        const invs2 = await invRes2.json();
                        if (invs2?.length > 0) {
                          matchedInvoice = invs2[0];
                          matchedOrderId = invs2[0].job_id || null;
                        }
                      }
                      // Fallback: cari invoice PAID tanpa bukti bayar dari HP yang sama
                      // Fix Bug 4: fallback ini sekarang juga bisa di-patch karena savedImageUrl
                      // sudah tersedia di titik ini (setelah R2 upload selesai)
                      if (!matchedInvoice) {
                        const invPaidRes = await fetch(
                          SU + "/rest/v1/invoices?select=id,job_id,total,status&or=(" + phoneFilter + ")" +
                          "&status=eq.PAID&payment_proof_url=is.null&order=created_at.desc&limit=1",
                          { headers: { apikey: SK, Authorization: "Bearer " + SK } }
                        );
                        if (invPaidRes.ok) {
                          const invsPaid = await invPaidRes.json();
                          if (invsPaid?.length > 0) {
                            matchedInvoice = invsPaid[0];
                            matchedOrderId = invsPaid[0].job_id || null;
                          }
                        }
                      }
                      if (!matchedOrderId && ordRes.ok) {
                        const ords = await ordRes.json();
                        if (ords?.length > 0) matchedOrderId = ords[0].id;
                      }
                    } catch(_) {}

                    const matchedInvoiceId = matchedInvoice?.id || null;

                    // ── Auto-patch payment_proof_url ke invoice (tanpa auto-PAID) ──
                    // Owner tetap konfirmasi manual setelah cek bukti
                    if (matchedInvoiceId && savedImageUrl) {
                      fetch(SU + "/rest/v1/invoices?id=eq." + encodeURIComponent(matchedInvoiceId), {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
                        body: JSON.stringify({ payment_proof_url: savedImageUrl, updated_at: new Date().toISOString() })
                      }).catch(e => console.warn("[PAY_AUTO_PATCH]", e.message));
                    }
                    // Fix Bug 3: jika invoice tidak ditemukan tapi bukti ada, log warning ke owner
                    if (!matchedInvoiceId && savedImageUrl) {
                      console.warn("[PAY_AUTO_PATCH] Bukti transfer tersimpan di R2 tapi invoice tidak ditemukan untuk", sender, savedImageUrl);
                    }

                    // Simpan ke payment_suggestions
                    fetch(SU + "/rest/v1/payment_suggestions", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
                      body: JSON.stringify({
                        phone: sender, sender_name: senderName, raw_message: "(gambar bukti transfer)",
                        amount: classified.amount || null, bank: classified.bank || null,
                        transfer_date: classified.transfer_date || null,
                        invoice_id: matchedInvoiceId, order_id: matchedOrderId,
                        status: "PENDING", source: "image",
                        image_url: savedImageUrl || mediaUrl, created_at: nowIso
                      })
                    }).catch(e => console.error("[PAY_SUGGEST_IMG_SAVE]", e.message));

                    // Notif WA ke owner — selalu konfirmasi manual
                    if (FT && OP) {
                      const ownerNotifImg = "💰 *Bukti Bayar Masuk (Foto)*\n"
                        + "Dari: " + senderName + " (" + sender + ")\n"
                        + (classified.amount ? "Nominal: Rp" + Number(classified.amount).toLocaleString("id-ID") + "\n" : "Nominal: tidak terbaca\n")
                        + (classified.bank ? "Bank: " + classified.bank + "\n" : "")
                        + (matchedInvoiceId ? "Invoice: " + matchedInvoiceId + " (" + (matchedInvoice?.status || "UNPAID") + ")\n" : "⚠️ Invoice tidak ditemukan\n")
                        + "\n📷 Foto bukti tersimpan otomatis.\n✅ Cek & klik *Paid* manual di menu Invoice.";
                      fetch("https://api.fonnte.com/send", {
                        method: "POST",
                        headers: { Authorization: FT, "Content-Type": "application/json" },
                        body: JSON.stringify({ target: OP, message: ownerNotifImg, delay: "1", countryCode: "62" })
                      }).catch(() => {});
                    }
                  }
                }
              }
              } // end: double-check size setelah download
            }
            } // end: skipDueToSize else
          } catch(imgErr) {
            console.warn("[receive-wa] Image classifier failed:", imgErr.message);
          }
        }
      }

      // ── ARA CUSTOMER CHATBOT ──
      const ml = message.toLowerCase().trim();
      let reply = null;
      if (chatbotOn && SU && SK) {
        const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (AK) {
          try {
            const [brainRes, histRes] = await Promise.all([
              fetch(SU + "/rest/v1/ara_brain?select=key,value&key=eq.brain_customer&limit=1",
                { headers: { apikey: SK, Authorization: "Bearer " + SK } }),
              fetch(SU + "/rest/v1/wa_messages?phone=eq." + encodeURIComponent(sender) +
                "&order=created_at.desc&limit=10&select=role,content",
                { headers: { apikey: SK, Authorization: "Bearer " + SK } })
            ]);
            const brainRows = brainRes.ok ? await brainRes.json() : [];
            const histRows  = histRes.ok  ? await histRes.json()  : [];
            const customerBrain = brainRows?.[0]?.value ||
              "Kamu adalah ARA, asisten virtual AClean Service AC. Jawab ramah dalam Bahasa Indonesia. Bantu customer soal layanan cuci/servis/pasang AC, booking, harga, dan status order.";
            const history = [...histRows].reverse().map(r => ({
              role: r.role === "customer" ? "user" : "assistant",
              content: r.content
            }));
            history.push({ role: "user", content: message });

            const araRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": AK,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "prompt-caching-2024-07-31",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5",
                max_tokens: 500,
                system: [{ type: "text", text: customerBrain, cache_control: { type: "ephemeral" } }],
                messages: history
              })
            });
            if (araRes.ok) {
              const araData = await araRes.json();
              reply = (araData.content||[]).map(c=>c.text||"").join("").trim() || null;
              if (reply && FT) {
                fetch("https://api.fonnte.com/send", {
                  method: "POST",
                  headers: { Authorization: FT, "Content-Type": "application/json" },
                  body: JSON.stringify({ target: sender, message: reply, delay: "1", countryCode: "62" })
                }).catch(e => console.error("[WA_ARA_REPLY_FAILED]", e.message));
                if (SU && SK) fetch(SU + "/rest/v1/wa_messages", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
                  body: JSON.stringify({ phone: sender, name: "ARA", content: reply, role: "ara", created_at: new Date(Date.now() + 7*3600000).toISOString() })
                }).catch(() => {});
              }
            }
          } catch(araErr) {
            console.warn("[receive-wa] ARA chatbot failed, falling back to keyword:", araErr.message);
            reply = null;
          }
        }
      }

      // Auto-reply (keyword fallback — runs only if ARA chatbot did not reply)
      if (autoOn && !reply) {
        const SALAM = ["halo","hi","hello","hai","pagi","siang","sore","malam","selamat","assalamu","permisi"];
        const HARGA_KW = ["harga","tarif","biaya","berapa","rate","pricelist","price","harganya"];
        const ORDER_KW = ["order","pesan","booking","buat","jadwal","service","cuci","cleaning","install","pasang","perbaikan","repair","complain","garansi","bongkar"];
        const STATUS_KW = ["status","cek order","cek jadwal","kapan","sudah","selesai","belum","progress"];
        const BAYAR_KW  = ["bayar","transfer","lunas","pembayaran","invoice","tagihan","dp","uang"];
        const LOKASI_KW = ["alamat","lokasi","dimana","area","jangkauan","coverage","bisa ke"];

        if (SALAM.some(k => ml.startsWith(k) || ml.includes(k + " ")))
          reply = "Halo! 👋 Selamat datang di *AClean Service AC*.\n\nKami melayani:\n✅ Cuci/Service AC\n✅ Perbaikan & Isi Freon\n✅ Pasang AC Baru\n✅ Bongkar & Pindah AC\n\nKetik *HARGA* untuk info tarif, atau *ORDER* untuk pesan layanan. Ada yang bisa kami bantu? 😊";
        else if (HARGA_KW.some(k => ml.includes(k))) {
          try {
            const pR = await fetch(SU + "/rest/v1/harga_layanan?select=service,type,harga&order=service.asc,type.asc", {
              headers: { apikey: SK, Authorization: "Bearer " + SK }
            });
            if (pR.ok) {
              const prices = await pR.json();
              if (prices && prices.length > 0) {
                const priceText = prices.map(p => `  • ${p.service} ${p.type}: Rp${(p.harga||0).toLocaleString("id-ID")}`).join("\n");
                reply = `💰 *Harga AClean Service AC*\n\n${priceText}\n\nKetik *ORDER* untuk pesan! 😊\n\n_Jam operasional: 08.00–17.00 WIB_`;
              } else {
                reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru, hubungi admin kami.\n\nAdmin akan segera membalas! 😊";
              }
            } else {
              reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru, hubungi admin kami.\n\nAdmin akan segera membalas! 😊";
            }
          } catch(_) {
            reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru, hubungi admin kami.\n\nAdmin akan segera membalas! 😊";
          }
        }
        else if (LOKASI_KW.some(k => ml.includes(k)))
          reply = "📍 *Area Layanan AClean*\n\nKami melayani area:\nAlam Sutera • BSD • Gading Serpong • Graha Raya • Karawaci • Tangerang Selatan\n\nArea lain: ada biaya transport tambahan.\n\nKetik *ORDER* untuk pesan layanan! 😊";
        else if (ORDER_KW.some(k => ml.includes(k)) || ml === "order")
          reply = "📋 *Pesan Layanan AClean*\n\nSilakan kirim info berikut:\n1️⃣ Nama lengkap\n2️⃣ Alamat lengkap\n3️⃣ Jenis layanan (Cuci AC / Perbaikan / Pasang / dll)\n4️⃣ Jumlah unit AC\n5️⃣ Tanggal & jam yang diinginkan\n\nAdmin akan konfirmasi jadwal & harga segera! ⚡";
        else if (STATUS_KW.some(k => ml.includes(k)))
          reply = "🔍 Untuk cek status order, sebutkan *nama* dan *nomor order* atau nomor HP yang didaftarkan.\n\nAdmin akan segera membantu! 😊";
        else if (BAYAR_KW.some(k => ml.includes(k)))
          reply = "💳 *Info Pembayaran AClean*\n\nSetelah transfer, kirim bukti pembayaran beserta:\n📌 Nama & nomor order\n💰 Nominal transfer\n\nAdmin konfirmasi dalam 30 menit. Terima kasih! 🙏";

        if (reply && FT) {
          fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: { Authorization: FT, "Content-Type": "application/json" },
            body: JSON.stringify({ target: sender, message: reply, delay: "1", countryCode: "62" })
          }).catch(err => console.error("[WA_AUTO_REPLY_FAILED]", err.message));
          // Simpan auto-reply ke wa_messages
          if (SU && SK) fetch(SU + "/rest/v1/wa_messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
            body: JSON.stringify({ phone: sender, name: "ARA", content: reply, role: "ara", created_at: new Date().toISOString() })
          }).catch(() => {});
        }
      }

      // Forward ke Owner — hanya jika toggle ON, pesan tidak di-auto-reply,
      // dan pesan bukan dari Owner itu sendiri (cegah loop)
      if (!reply && fwdOn && FT && OP && sender !== OP.replace(/^0/, "62").replace(/[^0-9]/g, "")) {
        const fwdMsg = "📲 *WA Masuk*\nDari: " + senderName + " (" + sender + ")\nPesan: " + message + "\n\n_Balas langsung di app WA Monitor_";
        fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FT, "Content-Type": "application/json" },
          body: JSON.stringify({ target: OP, message: fwdMsg, delay: "2", countryCode: "62" })
        }).catch(err => console.error("[WA_FORWARD_FAILED]", err.message));
      }

      return res.status(200).json({ status: "ok", sender, autoreply: autoOn, replied: !!reply, forwarded: !reply && fwdOn });
    }

    // ── ARA-CHAT ──
    if (route === "ara-chat") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const { messages, bizContext, brainMd, provider, model, ollamaUrl, imageData, imageType } = req.body || {};
      if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array wajib" });

      console.log("[ROUTE.JS ara-chat] Received:", { provider, model, hasMessages: messages.length });
      const sysP = (brainMd || "Kamu adalah ARA, asisten AI untuk AClean Service AC.") +
        (bizContext ? "\n\n## DATA BISNIS LIVE\n" + JSON.stringify(bizContext) : "");
      const prov = provider || "claude";
      console.log("[ROUTE.JS ara-chat] Provider detection: requested=", provider, "=> using=", prov);

      if (prov === "claude" || prov === "anthropic") {
        const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (!AK) return res.status(500).json({ error: "LLM_API_KEY belum diset di Vercel Environment Variables" });
        const mdl = model || process.env.LLM_MODEL || "claude-sonnet-4-6";
        const cMsgs = messages.map((m, i) => {
          const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
          if (i === messages.length-1 && imageData && m.role === "user")
            return { role: "user", content: [{ type: "image", source: { type: "base64", media_type: imageType||"image/jpeg", data: imageData }},{ type: "text", text: c }]};
          return { role: m.role, content: c };
        });
        const cr = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: mdl, max_tokens: 2048, system: sysP, messages: cMsgs })
        });
        const cd = await cr.json();
        if (!cr.ok) return res.status(502).json({ error: (cd.error && cd.error.message) || "Claude API error" });
        return res.status(200).json({ reply: (cd.content||[]).map(c => c.text||"").join(""), model: mdl, provider: "claude" });
      }

      if (prov === "minimax") {
        const MK = process.env.MINIMAX_API_KEY || process.env.LLM_API_KEY;
        if (!MK) return res.status(500).json({ error: "MINIMAX_API_KEY belum diset" });
        // Support Minimax 2.5, 2.7-highspeed
        const mm = model || process.env.MINIMAX_MODEL || "MiniMax-M2.5";
        const mg = process.env.MINIMAX_GROUP_ID || "";

        try {
          const mmPayload = {
            model: mm, max_tokens: 2048,
            messages: [{ role:"system", content: sysP }, ...messages.map(m=>({ role:m.role, content:typeof m.content==="string"?m.content:JSON.stringify(m.content) }))],
          };
          if (mg) mmPayload.group_id = mg;

          const mr = await fetch("https://api.minimaxi.chat/v1/text/chatcompletion_v2", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MK },
            body: JSON.stringify(mmPayload)
          });
          const md = await mr.json();

          if (!mr.ok) {
            const errMsg = md.base_resp?.status_msg || md.error?.message || "Minimax API error";
            console.error(`Minimax error (${mm}):`, errMsg, "Status:", mr.status);
            return res.status(502).json({ error: errMsg, detail: md, model: mm });
          }

          const reply = md.choices?.[0]?.message?.content || "";
          if (!reply) {
            console.warn("Minimax returned empty reply:", md);
            return res.status(502).json({ error: "Minimax returned empty response", model: mm });
          }

          return res.status(200).json({ reply, model: mm, provider: "minimax" });
        } catch(e) {
          console.error("Minimax request error:", e.message);
          return res.status(502).json({ error: "Minimax request failed: " + e.message, model: mm });
        }
      }

      if (prov === "ollama") {
        const bu = ollamaUrl || "http://localhost:11434";
        const om = model || "llama3.1";
        const or = await fetch(bu + "/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: om, stream: false, messages: [{ role:"system", content:sysP }, ...messages.map(m=>({ role:m.role, content:m.content }))] })
        });
        const od = await or.json();
        return res.status(200).json({ reply: (od.message&&od.message.content)||"", model: om, provider: "ollama" });
      }

      return res.status(400).json({ error: "Provider tidak didukung: " + prov });
    }

    // ── TEST-CONNECTION (public) ──
    if (route === "test-connection") {
      const type = (req.query&&req.query.type) || (req.body&&req.body.type) || "";

      if (type === "wa" || type === "fonnte") {
        const FT = process.env.FONNTE_TOKEN;
        if (!FT) return res.status(200).json({ ok: false, success: false, error: "FONNTE_TOKEN belum diset" });
        try {
          const r = await fetch("https://api.fonnte.com/validate", { method:"POST", headers:{ Authorization:FT, "Content-Type":"application/json" }, body:JSON.stringify({}) });
          const d = await r.json().catch(()=>({}));
          const isOk = r.ok && d.status !== false;
          // Return both `ok` and `success` for compatibility
          return res.status(200).json({ ok: isOk, success: isOk, message: isOk ? "Fonnte terhubung" : (d.reason || "Gagal terkoneksi"), detail: d });
        } catch(e) { return res.status(200).json({ ok: false, success: false, error: e.message }); }
      }

      if (type === "storage" || type === "r2") {
        const CA=process.env.CLOUDFLARE_ACCOUNT_ID, CT=process.env.CLOUDFLARE_API_TOKEN, CB=process.env.R2_BUCKET_NAME||"aclean-fotos";
        if (!CA||!CT) return res.status(200).json({ ok:false, error:"Cloudflare env vars tidak diset" });
        try {
          const r = await fetch("https://api.cloudflare.com/client/v4/accounts/"+CA+"/r2/buckets/"+CB, { headers:{ Authorization:"Bearer "+CT } });
          const d = await r.json().catch(()=>({}));
          return res.status(200).json({ ok: r.ok && d.success, detail: d });
        } catch(e) { return res.status(200).json({ ok:false, error:e.message }); }
      }

      if (type === "llm" || type === "claude") {
        const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (!AK) return res.status(200).json({ ok: false, error: "LLM_API_KEY tidak diset" });
        try {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method:"POST", headers:{ "Content-Type":"application/json", "x-api-key":AK, "anthropic-version":"2023-06-01" },
            body: JSON.stringify({ model:"claude-haiku-4-5", max_tokens:10, messages:[{ role:"user", content:"ping" }] })
          });
          const d = await r.json().catch(()=>({}));
          return res.status(200).json({ ok: r.ok, provider: "claude", model: d.model||null, error: (d.error&&d.error.message)||null });
        } catch(e) { return res.status(200).json({ ok:false, provider: "claude", error:e.message }); }
      }

      if (type === "minimax") {
        const MK = process.env.MINIMAX_API_KEY;
        if (!MK) return res.status(200).json({ ok: false, error: "MINIMAX_API_KEY tidak diset di env" });
        try {
          const mm = process.env.MINIMAX_MODEL || "MiniMax-M2.5";
          const r = await fetch("https://api.minimaxi.chat/v1/text/chatcompletion_v2", {
            method:"POST",
            headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+MK },
            body: JSON.stringify({ model: mm, max_tokens: 10, messages: [{ role:"system", content:"Respond with 'OK'" }, { role:"user", content:"ping" }] })
          });
          const d = await r.json().catch(()=>({}));
          const hasReply = d.choices?.[0]?.message?.content || d.reply || null;
          return res.status(200).json({ ok: r.ok && !!hasReply, provider: "minimax", model: mm, error: (d.base_resp?.status_msg||d.error?.message)||null, raw: !r.ok?d:null });
        } catch(e) { return res.status(200).json({ ok:false, provider: "minimax", error:e.message }); }
      }

      if (type === "groq") {
        const GK = process.env.GROQ_API_KEY;
        if (!GK) return res.status(200).json({ ok: false, error: "GROQ_API_KEY tidak diset di env" });
        try {
          const gm = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method:"POST",
            headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+GK },
            body: JSON.stringify({ model: gm, max_tokens: 10, messages: [{ role:"system", content:"Respond with 'OK'" }, { role:"user", content:"ping" }] })
          });
          const d = await r.json().catch(()=>({}));
          const hasReply = d.choices?.[0]?.message?.content || null;
          return res.status(200).json({ ok: r.ok && !!hasReply, provider: "groq", model: gm, error: (d.error?.message)||null });
        } catch(e) { return res.status(200).json({ ok:false, provider: "groq", error:e.message }); }
      }

      // Jangan ekspos detail service yang aktif ke public endpoint
      return res.status(200).json({ ok: true, success: true, service: "AClean API" });
    }

    // ── UPLOAD-FOTO ──
    if (route === "upload-foto") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const body = req.body || {};

      // App.jsx mengirim: { base64, filename, reportId, mimeType }
      const rawData  = body.base64 || body.fileData || "";
      const fileName = body.filename || body.fileName || ("foto_" + Date.now() + ".jpg");
      const mimeType = body.mimeType || body.fileType || "image/jpeg";
      const folder   = body.reportId ? ("laporan/" + body.reportId) : (body.folder || "laporan");

      if (!rawData) {
        console.error("[upload-foto] body kosong. Fields:", Object.keys(body));
        return res.status(400).json({ error: "Tidak ada data foto", fields_received: Object.keys(body) });
      }

      // Strip "data:image/jpeg;base64," prefix jika ada
      let base64Data = rawData;
      if (rawData.startsWith("data:")) base64Data = rawData.split(",")[1] || "";
      if (!base64Data) return res.status(400).json({ error: "base64 kosong setelah strip prefix" });

      // ── Cloudflare R2 via S3-compatible API (AWS Sig V4) ──
      const accessKeyId     = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId       = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
      const bucket          = process.env.R2_BUCKET_NAME || "aclean-files";
      const publicUrl       = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

      if (!accessKeyId || !secretAccessKey || !accountId) {
        console.error("[upload-foto] Missing R2 env vars:", {
          has_access_key: !!accessKeyId,
          has_secret_key: !!secretAccessKey,
          has_account_id: !!accountId,
        });
        return res.status(500).json({
          error: "R2 credentials belum lengkap di Vercel. Butuh: R2_ACCESS_KEY, R2_SECRET_KEY, R2_ACCOUNT_ID",
          env_check: { has_access_key: !!accessKeyId, has_secret_key: !!secretAccessKey, has_account_id: !!accountId }
        });
      }

      const ts   = Date.now();
      const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      // Jika hash dikirim dari client, gunakan sebagai nama file → idempotent
      // Upload foto yang sama = overwrite file yang sama di R2, tidak bikin duplikat
      const clientHash = body.hash || "";
      const key = clientHash
        ? folder + "/" + clientHash + ".jpg"          // deterministic key dari hash
        : folder + "/" + ts + "_" + safe;             // fallback: timestamp_filename
      const host = accountId + ".r2.cloudflarestorage.com";
      const endpoint = "https://" + host + "/" + bucket + "/" + key;

      try {
        const imgBuffer = Buffer.from(base64Data, "base64");
        console.log("[upload-foto] Uploading to R2 S3:", key, imgBuffer.length, "bytes");

        // AWS Signature V4 signing (manual, no SDK needed)
        const crypto = await import("crypto");
        const now    = new Date();
        const dateStr  = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);   // YYYYMMDD
        const timeStr  = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15);  // YYYYMMDDTHHmmss + Z
        const amzDate  = timeStr + "Z";
        const region   = "auto";
        const service  = "s3";

        // Hash of payload
        const payloadHash = crypto.createHash("sha256").update(imgBuffer).digest("hex");

        // Canonical request
        const canonicalHeaders = "content-type:" + mimeType + "\n" +
          "host:" + host + "\n" +
          "x-amz-content-sha256:" + payloadHash + "\n" +
          "x-amz-date:" + amzDate + "\n";
        const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
        const canonicalUri  = "/" + bucket + "/" + encodeURIComponent(key).replace(/%2F/g, "/");
        const canonicalReq  = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

        // String to sign
        const credScope   = dateStr + "/" + region + "/" + service + "/aws4_request";
        const reqHash     = crypto.createHash("sha256").update(canonicalReq).digest("hex");
        const strToSign   = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

        // Signing key
        const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
        const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
        const signature  = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");

        // Authorization header
        const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope +
          ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

        const r2res = await fetch(endpoint, {
          method: "PUT",
          headers: {
            "Authorization":        authorization,
            "Content-Type":         mimeType,
            "x-amz-date":           amzDate,
            "x-amz-content-sha256": payloadHash,
            "Content-Length":       String(imgBuffer.length),
          },
          body: imgBuffer,
        });

        if (!r2res.ok) {
          const errBody = await r2res.text();
          console.error("[upload-foto] R2 PUT failed:", r2res.status, errBody);
          return res.status(502).json({
            success: false,
            error: "R2 upload gagal (" + r2res.status + "): " + errBody.slice(0, 300),
          });
        }

        // Build public URL
        const finalUrl = publicUrl
          ? publicUrl + "/" + key
          : "https://" + host + "/" + bucket + "/" + key;

        console.log("[upload-foto] Success:", finalUrl);
        return res.status(200).json({
          success: true,
          url:     finalUrl,
          key:     key,
          bucket:  bucket,
          size:    imgBuffer.length,
        });

      } catch (err) {
        console.error("[upload-foto] Exception:", err.message, err.stack);
        return res.status(500).json({ success: false, error: "Server error: " + err.message });
      }
    }

        // ── FOTO PROXY: serve R2 images via server (bypass CORS & auth) ──
    if (route === "foto") {
      const key = req.query?.key || (req.body?.key) || "";
      if (!key) return res.status(400).json({ error: "key wajib" });

      const accessKeyId     = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId       = process.env.R2_ACCOUNT_ID;
      const bucket          = process.env.R2_BUCKET_NAME || "aclean-files";

      // Selalu serve via AWS Sig V4 (tidak redirect ke public URL)
      // karena R2 public access mungkin belum diaktifkan
      if (!accessKeyId || !secretAccessKey || !accountId) {
        return res.status(503).json({ error: "R2 credentials tidak tersedia" });
      }

      const crypto  = await import("crypto");
      const host    = accountId + ".r2.cloudflarestorage.com";
      const now     = new Date();
      const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
      const region  = "auto";
      const service = "s3";
      const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // empty body

      const canonicalUri  = "/" + bucket + "/" + key;
      const canonicalHeaders = "host:" + host + "\n" +
        "x-amz-content-sha256:" + payloadHash + "\n" +
        "x-amz-date:" + amzDate + "\n";
      const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
      const canonicalReq  = ["GET", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

      const credScope = dateStr + "/" + region + "/" + service + "/aws4_request";
      const reqHash   = crypto.createHash("sha256").update(canonicalReq).digest("hex");
      const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

      const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
      const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
      const signature  = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
      const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope +
        ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

      try {
        const r2res = await fetch("https://" + host + canonicalUri, {
          headers: {
            "Authorization": authorization,
            "x-amz-date": amzDate,
            "x-amz-content-sha256": payloadHash,
          },
        });
        if (!r2res.ok) return res.status(r2res.status).json({ error: "Foto tidak ditemukan" });
        const ct = r2res.headers.get("content-type") || "image/jpeg";
        res.setHeader("Content-Type", ct);
        if (ct.includes("text/html") || ct.includes("application/pdf")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Content-Disposition", "inline");
        } else {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
        const buf = await r2res.arrayBuffer();
        return res.status(200).send(Buffer.from(buf));
      } catch (err) {
        return res.status(500).json({ error: "Gagal fetch foto: " + err.message });
      }
    }

        // ── MONITORING: Get health metrics and recent errors ──
    if (route === "monitor") {
      if (req.method !== "GET") return res.status(405).json({error: "Method not allowed"});
      const SU=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, SK=process.env.SUPABASE_SERVICE_KEY;
      if (!SU||!SK) return res.status(200).json({ status: "limited", message: "Supabase not configured" });

      try {
        // Get recent errors and warnings from agent_logs (last 24 hours)
        const since24h = new Date(Date.now() - 24*60*60*1000).toISOString();
        // Status values: SUCCESS, WARNING, ERROR
        const response = await fetch(SU+"/rest/v1/agent_logs?select=action,status,detail,created_at&or=(status.eq.ERROR,status.eq.WARNING)&created_at=gte."+encodeURIComponent(since24h)+"&order=created_at.desc&limit=100", {
          headers: { apikey: SK, Authorization: "Bearer " + SK }
        });
        const logs = response.ok ? await response.json() : [];

        // Calculate metrics
        const logsArray = Array.isArray(logs) ? logs : [];
        const errorCount = logsArray.filter(l => l.status === "ERROR").length;
        const warningCount = logsArray.filter(l => l.status === "WARNING").length;
        const metrics = {
          totalErrors: errorCount,
          totalWarnings: warningCount,
          errorRate: logsArray.length > 0 ? errorCount / logsArray.length : 0,
          totalLogsChecked: logsArray.length,
          recentErrors: logsArray.slice(0, 10).map(l => ({
            action: l.action || "UNKNOWN",
            status: l.status || "UNKNOWN",
            detail: (l.detail || "").slice(0, 100),
            time: l.created_at || new Date().toISOString()
          }))
        };

        return res.status(200).json({
          status: "ok",
          timestamp: new Date().toISOString(),
          health: metrics.errorRate < 0.05 ? "healthy" : metrics.errorRate < 0.1 ? "degraded" : "unhealthy",
          metrics
        });
      } catch(err) {
        return res.status(200).json({
          status: "error",
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    // ── GET-LLM-CONFIG (secure backend config endpoint) ──
    if (route === "get-llm-config") {
      if (req.method !== "GET") return res.status(405).json({error: "Method not allowed"});
      // ── Security: Only return safe config, never expose API keys ──
      // Determines which provider is available based on env vars
      const providers = [];
      if (process.env.ANTHROPIC_API_KEY) providers.push({name: "claude", label: "Claude (Anthropic)", disabled: false});
      if (process.env.OPENAI_API_KEY) providers.push({name: "openai", label: "OpenAI (GPT-4)", disabled: false});
      if (process.env.MINIMAX_API_KEY) providers.push({name: "minimax", label: "MiniMax 2.5", disabled: false});
      if (process.env.GROQ_API_KEY) providers.push({name: "groq", label: "Groq (Llama)", disabled: false});

      // Determine default provider based on what's actually available
      // Priority: claude > openai > minimax > groq > first available
      let defaultProvider = "claude"; // fallback default
      if (process.env.ANTHROPIC_API_KEY) {
        defaultProvider = "claude";
      } else if (process.env.OPENAI_API_KEY) {
        defaultProvider = "openai";
      } else if (process.env.MINIMAX_API_KEY) {
        defaultProvider = "minimax";
      } else if (process.env.GROQ_API_KEY) {
        defaultProvider = "groq";
      }

      return res.status(200).json({
        providers,
        defaultProvider,
        message: "Use 'defaultProvider' to determine initial LLM choice"
      });
    }

    // ── GET-API-TOKEN — exchange Supabase JWT for internal API token (session-only) ──
    if (route === "get-api-token") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const authH = req.headers["authorization"] || "";
      const jwt = authH.startsWith("Bearer ") ? authH.slice(7) : "";
      if (!jwt) return res.status(401).json({ error: "Missing Bearer token" });
      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) return res.status(500).json({ error: "Supabase config missing" });
      try {
        const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { "Authorization": `Bearer ${jwt}`, "apikey": supabaseAnonKey }
        });
        if (!r.ok) return res.status(401).json({ error: "Invalid session" });
        const secret = process.env.INTERNAL_API_SECRET;
        if (!secret) return res.status(500).json({ error: "Server misconfiguration" });
        return res.status(200).json({ token: secret });
      } catch (e) {
        return res.status(500).json({ error: "Auth check failed" });
      }
    }

    // ── CRON-REMINDER ──
    if (route === "cron-reminder") {
      const SU=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, SK=process.env.SUPABASE_SERVICE_KEY, FT=process.env.FONNTE_TOKEN;
      if (!SU||!SK||!FT) return res.status(200).json({ ok:false, error:"Env vars tidak lengkap" });
      const today = new Date().toISOString().slice(0,10);
      const invR = await fetch(SU+"/rest/v1/invoices?select=*&status=eq.UNPAID&due=lt."+today, { headers:{ apikey:SK, Authorization:"Bearer "+SK } });
      const invs = await invR.json().catch(err => {
        console.error("[CRON_INVOICE_FETCH_ERROR]", {error: err.message});
        return [];
      });
      let sent=0, updated=0;
      for (const inv of (invs||[])) {
        await fetch(SU+"/rest/v1/invoices?id=eq."+inv.id, { method:"PATCH", headers:{ "Content-Type":"application/json", apikey:SK, Authorization:"Bearer "+SK, Prefer:"return=minimal" }, body:JSON.stringify({ status:"OVERDUE" }) });
        updated++;
        if (inv.phone) {
          const np = String(inv.phone).replace(/^0/,"62").replace(/[^0-9]/g,"");
          await fetch("https://api.fonnte.com/send", { method:"POST", headers:{ Authorization:FT, "Content-Type":"application/json" }, body:JSON.stringify({ target:np, message:"Halo "+( inv.customer||"Bapak/Ibu")+", tagihan AClean Rp"+Number(inv.total||0).toLocaleString("id-ID")+" (Invoice "+inv.id+") sudah jatuh tempo. Mohon segera lakukan pembayaran.", delay:"3", countryCode:"62" }) }).catch(err => {
            console.error("[CRON_OVERDUE_REMINDER_FAILED]", {invoiceId: inv.id, customerPhone: np, error: err.message});
          });
          sent++;
        }
      }
      return res.status(200).json({ ok:true, overdue_found:(invs||[]).length, updated, reminders_sent:sent });
    }

    // ── SYNC-FOTOS: Auto-populate foto_urls from R2 files ──
    if (route === "sync-fotos") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Supabase tidak configured" });

      const accessKeyId = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId = process.env.R2_ACCOUNT_ID;
      const bucket = process.env.R2_BUCKET_NAME || "aclean-files";
      if (!accessKeyId || !secretAccessKey || !accountId) {
        return res.status(500).json({ error: "R2 credentials tidak lengkap" });
      }

      try {
        // Step 1: Fetch laporan yang foto_urls kosong/null
        const lapRes = await fetch(SU + "/rest/v1/service_reports?select=id,job_id,foto_urls&foto_urls=is.null,eq.{}", {
          headers: { apikey: SK, Authorization: "Bearer " + SK }
        });
        const laporan = lapRes.ok ? await lapRes.json() : [];
        console.log(`[sync-fotos] Found ${laporan.length} laporan with empty foto_urls`);

        const crypto = await import("crypto");
        const synced = [];
        const errors = [];

        // Step 2: Untuk setiap laporan, list files di R2
        for (const lap of laporan) {
          try {
            const host = accountId + ".r2.cloudflarestorage.com";
            const now = new Date();
            const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
            const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
            const region = "auto";
            const service = "s3";
            const prefix = `laporan/${lap.job_id}/`;
            const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
            const canonicalUri = "/" + bucket + "/";
            const queryString = "list-type=2&prefix=" + encodeURIComponent(prefix);

            const canonicalHeaders = "host:" + host + "\n" + "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + amzDate + "\n";
            const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
            const canonicalReq = ["GET", canonicalUri, queryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");

            const credScope = dateStr + "/" + region + "/" + service + "/aws4_request";
            const reqHash = crypto.createHash("sha256").update(canonicalReq).digest("hex");
            const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

            const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
            const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
            const signature = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
            const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

            // Query R2 list objects
            const r2Url = "https://" + host + "/" + bucket + "/?prefix=" + encodeURIComponent(prefix) + "&list-type=2";
            const r2res = await fetch(r2Url, {
              headers: { "Authorization": authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash }
            });

            if (!r2res.ok) {
              errors.push({ job_id: lap.job_id, error: "R2 list failed: " + r2res.status });
              continue;
            }

            const xmlBody = await r2res.text();
            // Simple XML parsing: extract <Key> tags
            const keyRegex = /<Key>([^<]+)<\/Key>/g;
            const matches = [...xmlBody.matchAll(keyRegex)];
            const files = matches
              .map(m => m[1])
              .filter(k => k !== prefix) // Exclude folder itself
              .map(k => k.replace(prefix, "")); // Remove prefix, keep only filename

            console.log(`[sync-fotos] ${lap.job_id}: found ${files.length} files`);

            // Build foto_urls array with full paths
            const fotoUrls = files.map(f => prefix + f);

            // Update database
            const upRes = await fetch(SU + "/rest/v1/service_reports?id=eq." + lap.id, {
              method: "PATCH",
              headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" },
              body: JSON.stringify({ foto_urls: fotoUrls })
            });

            if (upRes.ok) {
              synced.push({ job_id: lap.job_id, fotos: files.length });
            } else {
              const err = await upRes.text();
              errors.push({ job_id: lap.job_id, error: "Update failed: " + err.slice(0, 100) });
            }
          } catch (e) {
            errors.push({ job_id: lap.job_id, error: e.message });
          }
        }

        return res.status(200).json({
          ok: true,
          synced: synced.length,
          errors: errors.length,
          details: { synced, errors }
        });
      } catch (err) {
        console.error("[sync-fotos] Exception:", err.message);
        return res.status(500).json({ error: "Sync failed: " + err.message });
      }
    }

    // ── MANAGE-USER: Create/Update/Deactivate/Reset-Password via Admin API ──
    if (route === "manage-user") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      // M-04: Rate limiting — max 20 req/menit per IP untuk endpoint sensitif ini
      if (!await checkRateLimit(req, res, 20, 60000)) return;
      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Supabase service key tidak dikonfigurasi" });

      // ── Role check: verifikasi caller adalah Owner atau Admin ──
      // Menggunakan callerRole dari frontend (sudah divalidasi INTERNAL_API_SECRET di atas).
      // Tidak pakai callerUserId karena session lama bisa tidak punya UUID.
      const { action, userId, name, email, password, role, phone, callerRole: rawCallerRole } = req.body || {};
      const callerRole = (rawCallerRole || "").trim();

      if (!["Owner", "Admin"].includes(callerRole)) {
        return res.status(403).json({ error: "Forbidden: hanya Owner/Admin yang bisa manage user" });
      }
      // Admin tidak boleh create/delete/toggle akun Owner
      const isOwnerAction = role === "Owner" || (action === "delete" && callerRole === "Admin");
      if (callerRole === "Admin" && isOwnerAction) {
        return res.status(403).json({ error: "Forbidden: Admin tidak bisa kelola akun Owner" });
      }
      const adminUrl = SU + "/auth/v1/admin/users";
      const headers = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };

      // ── CREATE USER ──
      if (action === "create") {
        if (!email || !password || !name || !role) return res.status(400).json({ error: "email, password, name, role wajib diisi" });
        const authRes = await fetch(adminUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, role } })
        });
        const authData = await authRes.json();
        if (!authRes.ok) {
          // M-03: Log detail internal, expose pesan generic ke client
          console.warn("[manage-user] Auth create error:", authData.message || authData.error);
          const safeMsg = authData.message?.includes("already") ? "Email sudah terdaftar" : "Gagal buat user. Coba lagi atau hubungi admin.";
          return res.status(400).json({ error: safeMsg });
        }

        const uid = authData.id;
        const colorMap = { Owner: "#f59e0b", Admin: "#38bdf8", Teknisi: "#22c55e", Helper: "#a78bfa" };
        const profileRes = await fetch(SU + "/rest/v1/user_profiles", {
          method: "POST",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify({ id: uid, name, role, phone: phone || "", avatar: name.charAt(0).toUpperCase(), color: colorMap[role] || "#38bdf8", active: true })
        });
        const profileData = await profileRes.json();
        if (!profileRes.ok) return res.status(207).json({ ok: true, warning: "Auth OK, profile gagal: " + JSON.stringify(profileData), user: authData });
        return res.status(200).json({ ok: true, user: { ...authData, ...profileData[0] } });
      }

      // ── UPDATE PROFILE ──
      if (action === "update") {
        if (!userId) return res.status(400).json({ error: "userId wajib" });
        const upd = {};
        if (name) upd.name = name;
        if (role) upd.role = role;
        if (phone !== undefined) upd.phone = phone;
        const profileRes = await fetch(SU + "/rest/v1/user_profiles?id=eq." + userId, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify(upd)
        });
        if (!profileRes.ok) { console.warn("[manage-user] update failed:", await profileRes.text()); return res.status(400).json({ error: "Update gagal. Coba lagi." }); }
        return res.status(200).json({ ok: true });
      }

      // ── TOGGLE ACTIVE (nonaktifkan/aktifkan) ──
      if (action === "toggle-active") {
        if (!userId) return res.status(400).json({ error: "userId wajib" });
        const { active } = req.body;
        // Ban/unban di Supabase Auth
        const authUpd = active ? { ban_duration: "none" } : { ban_duration: "876600h" };
        await fetch(adminUrl + "/" + userId, { method: "PUT", headers, body: JSON.stringify(authUpd) });
        // Update flag di user_profiles
        await fetch(SU + "/rest/v1/user_profiles?id=eq." + userId, {
          method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({ active })
        });
        return res.status(200).json({ ok: true });
      }

      // ── RESET PASSWORD ──
      if (action === "reset-password") {
        if (!userId || !password) return res.status(400).json({ error: "userId dan password wajib" });
        if (password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter" });
        const authRes = await fetch(adminUrl + "/" + userId, {
          method: "PUT", headers,
          body: JSON.stringify({ password })
        });
        if (!authRes.ok) { const e = await authRes.json(); return res.status(400).json({ error: e.message || "Reset gagal" }); }
        return res.status(200).json({ ok: true });
      }

      // ── DELETE PERMANENT ──
      if (action === "delete") {
        if (!userId) return res.status(400).json({ error: "userId wajib" });
        await fetch(SU + "/rest/v1/user_profiles?id=eq." + userId, { method: "DELETE", headers });
        const authRes = await fetch(adminUrl + "/" + userId, { method: "DELETE", headers });
        if (!authRes.ok && authRes.status !== 404) { const e = await authRes.json(); return res.status(400).json({ error: e.message || "Delete Auth gagal" }); }
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "Action tidak dikenal: " + action });
    }

    // ── CUSTOMER-STATUS (PUBLIC) ──
    // Dipanggil oleh halaman portal customer — tidak butuh auth, hanya token customer
    if (route === "customer-status") {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      if (!checkRateLimit(req, "customer-status", 30)) return res.status(429).json({ error: "Terlalu banyak request, coba lagi sebentar" });
      const token = String(req.query.token || "").trim();
      if (!token) return res.status(400).json({ error: "Token diperlukan" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Server config error" });

      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

      // Lookup token
      const tokRes = await fetch(`${SU}/rest/v1/customer_tokens?token=eq.${encodeURIComponent(token)}&select=*`, { headers });
      if (!tokRes.ok) return res.status(500).json({ error: "DB error" });
      const tokRows = await tokRes.json();
      if (!tokRows.length) return res.status(404).json({ error: "Token tidak ditemukan", code: "NOT_FOUND" });

      const tokRow = tokRows[0];
      const isExpired = new Date(tokRow.expires_at) < new Date();

      // Update last_used (fire and forget)
      fetch(`${SU}/rest/v1/customer_tokens?id=eq.${tokRow.id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ last_used: new Date().toISOString() })
      }).catch(() => {});

      const phone = tokRow.phone;
      const variants = buildPhoneVariants(phone);
      const phoneFilter = variants.map(v => `phone=eq.${encodeURIComponent(v)}`).join(",");

      // Query orders & invoices berdasarkan phone (ambil 20 terbaru)
      const [ordRes, invRes] = await Promise.all([
        fetch(`${SU}/rest/v1/orders?or=(${phoneFilter})&order=date.desc,time.desc&limit=20&select=id,customer,phone,address,area,service,type,units,teknisi,helper,teknisi2,helper2,date,time,time_end,status,notes`, { headers }),
        fetch(`${SU}/rest/v1/invoices?or=(${phoneFilter})&order=created_at.desc&limit=20&select=id,job_id,customer,phone,service,units,labor,material,total,status,due,paid_at,paid_amount,remaining_amount,garansi_days,garansi_expires,paid_method,invoice_type`, { headers }),
      ]);

      const orders = ordRes.ok ? await ordRes.json() : [];
      const invoices = invRes.ok ? await invRes.json() : [];

      // Ambil nama customer dari order pertama
      const customerName = orders[0]?.customer || tokRow.customer_name || "";

      return res.status(200).json({
        expired: isExpired,
        phone,
        customer_name: customerName,
        orders,
        invoices,
        token_created: tokRow.created_at,
        token_expires: tokRow.expires_at,
      });
    }

    // ── SUBMIT-RATING (PUBLIC — dari portal customer) ──
    if (route === "submit-rating") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      if (!checkRateLimit(req, "submit-rating", 10)) return res.status(429).json({ error: "Terlalu banyak request" });
      const b = req.body || {};
      const token = String(b.token || "").trim();
      const rating = parseInt(b.rating);
      const comment = String(b.comment || "").trim().slice(0, 500);

      if (!token) return res.status(400).json({ error: "Token diperlukan" });
      if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating 1-5 diperlukan" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Server config error" });
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json", "Prefer": "return=representation" };

      // Validasi token → dapat phone
      const tokRes = await fetch(`${SU}/rest/v1/customer_tokens?token=eq.${encodeURIComponent(token)}&select=phone,customer_name`, { headers });
      const tokRows = tokRes.ok ? await tokRes.json() : [];
      if (!tokRows.length) return res.status(404).json({ error: "Token tidak valid" });
      const { phone, customer_name } = tokRows[0];

      // Cek order_id dari body atau ambil job terakhir
      const orderId = String(b.order_id || "").trim();
      let jobData = { order_id: orderId, service: "", teknisi: "" };
      if (orderId) {
        const orRes = await fetch(`${SU}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,service,teknisi`, { headers });
        const orRows = orRes.ok ? await orRes.json() : [];
        if (orRows[0]) jobData = { order_id: orRows[0].id, service: orRows[0].service, teknisi: orRows[0].teknisi };
      }

      // Cek duplikasi rating untuk order yang sama
      if (jobData.order_id) {
        const dupRes = await fetch(`${SU}/rest/v1/customer_feedback?order_id=eq.${encodeURIComponent(jobData.order_id)}&phone=eq.${encodeURIComponent(phone)}&select=id`, { headers });
        const dupRows = dupRes.ok ? await dupRes.json() : [];
        if (dupRows.length) return res.status(409).json({ error: "Rating sudah diberikan untuk job ini" });
      }

      // Simpan rating
      const insRes = await fetch(`${SU}/rest/v1/customer_feedback`, {
        method: "POST", headers,
        body: JSON.stringify({
          order_id: jobData.order_id || "unknown",
          phone, customer: customer_name || "",
          teknisi: jobData.teknisi || "",
          service: jobData.service || "",
          rating, comment: comment || null,
        }),
      });
      if (!insRes.ok) return res.status(500).json({ error: "Gagal simpan rating" });

      // Alert ke owner via WA jika rating ≤ 2
      if (rating <= 2) {
        const FT = process.env.FONNTE_TOKEN;
        const ownerPhone = process.env.OWNER_PHONE;
        if (FT && ownerPhone) {
          const alertMsg =
            `⚠️ *Rating Rendah dari Customer*\n\n` +
            `⭐ Rating: ${rating}/5\n` +
            `👤 Customer: ${customer_name || phone}\n` +
            `🔧 Job: ${jobData.order_id || "-"}\n` +
            `🛠 Teknisi: ${jobData.teknisi || "-"}\n` +
            `💬 Komentar: ${comment || "(tidak ada)"}\n\n` +
            `Segera follow-up untuk cegah churn! — AClean System`;
          fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: { "Authorization": FT, "Content-Type": "application/json" },
            body: JSON.stringify({ target: ownerPhone, message: alertMsg }),
          }).catch(() => {});
        }
      }

      return res.status(200).json({ ok: true, message: "Rating berhasil disimpan. Terima kasih! 🙏" });
    }

    // ── CUSTOMER-VOUCHERS (PUBLIC — dari portal customer) ──
    if (route === "customer-vouchers") {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      if (!checkRateLimit(req, "customer-vouchers", 20)) return res.status(429).json({ error: "Terlalu banyak request" });
      const token = String(req.query.token || "").trim();
      if (!token) return res.status(400).json({ error: "Token diperlukan" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Server config error" });
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

      // Validasi token
      const tokRes = await fetch(`${SU}/rest/v1/customer_tokens?token=eq.${encodeURIComponent(token)}&select=phone`, { headers });
      const tokRows = tokRes.ok ? await tokRes.json() : [];
      if (!tokRows.length) return res.status(404).json({ error: "Token tidak valid" });
      const { phone } = tokRows[0];

      const variants = buildPhoneVariants(phone);
      const phoneFilter = variants.map(v => `phone=eq.${encodeURIComponent(v)}`).join(",");

      // Ambil voucher aktif (belum diklaim, belum expired)
      const today = new Date().toISOString().slice(0, 10);
      const vRes = await fetch(
        `${SU}/rest/v1/customer_vouchers?or=(${phoneFilter})&claimed_at=is.null&order=created_at.desc&select=*`,
        { headers }
      );
      const vouchers = vRes.ok ? await vRes.json() : [];
      const active = vouchers.filter(v => !v.expires_at || v.expires_at >= today);

      return res.status(200).json({ vouchers: active });
    }

    // ── GENERATE-CUSTOMER-TOKEN (PRIVATE — admin/owner) ──
    if (route === "generate-customer-token") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};
      const phone = validateAndNormalizePhone(b.phone);
      if (!phone) return res.status(400).json({ error: "Nomor HP tidak valid" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Server config error" });

      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json", "Prefer": "return=representation" };

      // Generate token 24 bytes hex
      const { randomBytes } = await import("crypto");
      const token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 hari

      // Upsert: satu token per phone (replace jika sudah ada)
      const delRes = await fetch(`${SU}/rest/v1/customer_tokens?phone=eq.${encodeURIComponent(phone)}`, { method: "DELETE", headers });
      if (!delRes.ok && delRes.status !== 404) return res.status(500).json({ error: "Gagal reset token lama" });

      const insRes = await fetch(`${SU}/rest/v1/customer_tokens`, {
        method: "POST", headers,
        body: JSON.stringify({ phone, token, expires_at: expiresAt, customer_name: sanitizeName(b.customer_name || "") }),
      });
      if (!insRes.ok) {
        const e = await insRes.json().catch(() => ({}));
        return res.status(500).json({ error: "Gagal simpan token", detail: e });
      }

      const appUrl = process.env.APP_URL || "https://aclean.id";
      const link = `${appUrl}/status/${token}`;
      return res.status(200).json({ ok: true, token, link, expires_at: expiresAt });
    }

    // ─── validate-voucher (POST, private) ─────────────────────────────────────
    if (route === "validate-voucher") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};
      const { code, phone, invoice_id } = b;
      if (!code || !phone) return res.status(400).json({ error: "code dan phone wajib diisi" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

      const vRes = await fetch(
        `${SU}/rest/v1/customer_vouchers?code=eq.${encodeURIComponent(code)}&select=*&limit=1`,
        { headers }
      );
      const vList = vRes.ok ? await vRes.json() : [];
      const v = vList[0];

      if (!v) return res.status(404).json({ error: "Kode voucher tidak ditemukan", code });
      if (!v.is_valid) return res.status(400).json({ error: "Voucher sudah dibatalkan", code });
      if (v.claimed_at) return res.status(400).json({ error: "Voucher sudah pernah digunakan", claimed_order_id: v.claimed_order_id });

      const today = new Date().toISOString().slice(0, 10);
      if (v.expires_at && v.expires_at < today) return res.status(400).json({ error: "Voucher sudah expired", expires_at: v.expires_at });

      // Validasi phone match (semua variant)
      const normalizedPhone = validateAndNormalizePhone(phone);
      const variants = normalizedPhone ? buildPhoneVariants(normalizedPhone) : [phone];
      const vPhone = validateAndNormalizePhone(v.phone) || v.phone;
      const phoneMatch = variants.some(vt => {
        const vtn = validateAndNormalizePhone(vt) || vt;
        return vtn === vPhone;
      });
      if (!phoneMatch) return res.status(400).json({ error: "Voucher bukan milik customer ini", code });

      const typeLabel = v.type === "discount_pct" ? `Diskon ${v.value}%`
        : v.type === "free_unit" ? `${v.value} Unit Cuci Gratis`
        : v.type === "free_service" ? "Servis Gratis"
        : v.type;

      return res.status(200).json({
        ok: true, valid: true,
        voucher: { id: v.id, code: v.code, type: v.type, value: v.value, type_label: typeLabel, description: v.description, customer_name: v.customer_name, expires_at: v.expires_at },
      });
    }

    // ─── claim-voucher (POST, private) ────────────────────────────────────────
    if (route === "claim-voucher") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};
      const { code, invoice_id } = b;
      if (!code || !invoice_id) return res.status(400).json({ error: "code dan invoice_id wajib diisi" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json", "Prefer": "return=representation" };

      // Pastikan belum diklaim
      const chkRes = await fetch(`${SU}/rest/v1/customer_vouchers?code=eq.${encodeURIComponent(code)}&select=id,claimed_at,is_valid&limit=1`, { headers });
      const chkList = chkRes.ok ? await chkRes.json() : [];
      const chk = chkList[0];
      if (!chk) return res.status(404).json({ error: "Kode voucher tidak ditemukan" });
      if (chk.claimed_at) return res.status(400).json({ error: "Voucher sudah diklaim sebelumnya" });
      if (!chk.is_valid) return res.status(400).json({ error: "Voucher sudah dibatalkan" });

      const upRes = await fetch(
        `${SU}/rest/v1/customer_vouchers?code=eq.${encodeURIComponent(code)}`,
        { method: "PATCH", headers, body: JSON.stringify({ claimed_at: new Date().toISOString(), claimed_order_id: invoice_id }) }
      );
      if (!upRes.ok) return res.status(500).json({ error: "Gagal mengklaim voucher" });

      return res.status(200).json({ ok: true, message: "Voucher berhasil diklaim", code, invoice_id });
    }

    // ─── admin-vouchers (GET, private) ────────────────────────────────────────
    if (route === "admin-vouchers") {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

      const { status: filterStatus, search } = req.query;
      const today = new Date().toISOString().slice(0, 10);

      let url = `${SU}/rest/v1/customer_vouchers?select=*&order=created_at.desc&limit=200`;
      if (filterStatus === "active") {
        url += `&claimed_at=is.null&is_valid=eq.true&expires_at=gte.${today}`;
      } else if (filterStatus === "claimed") {
        url += `&claimed_at=not.is.null`;
      } else if (filterStatus === "expired") {
        url += `&claimed_at=is.null&expires_at=lt.${today}`;
      }
      if (search) {
        const s = encodeURIComponent(search.trim());
        url += `&or=(code.ilike.*${s}*,phone.ilike.*${s}*,customer_name.ilike.*${s}*)`;
      }

      const vRes = await fetch(url, { headers });
      if (!vRes.ok) return res.status(500).json({ error: "Gagal mengambil data voucher" });
      const vouchers = await vRes.json();

      // Hitung stats ringkas
      const allRes = await fetch(`${SU}/rest/v1/customer_vouchers?select=claimed_at,is_valid,expires_at`, { headers });
      const all = allRes.ok ? await allRes.json() : [];
      const stats = {
        total: all.length,
        active: all.filter(v => !v.claimed_at && v.is_valid && (!v.expires_at || v.expires_at >= today)).length,
        claimed: all.filter(v => v.claimed_at).length,
        expired: all.filter(v => !v.claimed_at && v.expires_at && v.expires_at < today).length,
      };

      return res.status(200).json({ ok: true, vouchers, stats });
    }

    // ─── cancel-voucher (POST, private) ───────────────────────────────────────
    if (route === "cancel-voucher") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};
      const { id } = b;
      if (!id) return res.status(400).json({ error: "id wajib diisi" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      const headers = { "apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json" };

      const upRes = await fetch(
        `${SU}/rest/v1/customer_vouchers?id=eq.${encodeURIComponent(id)}`,
        { method: "PATCH", headers, body: JSON.stringify({ is_valid: false }) }
      );
      if (!upRes.ok) return res.status(500).json({ error: "Gagal membatalkan voucher" });

      return res.status(200).json({ ok: true, message: "Voucher dibatalkan" });
    }

    return res.status(404).json({ error: "Route tidak ditemukan: /api/" + route });

  } catch(err) {
    console.error("[api/" + route + "] Error:", err.message);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
