// api/fonnte-webhook.js
// Vercel Serverless Function — menerima pesan WA masuk dari Fonnte
// Setup: di Fonnte Dashboard → Settings → Webhook URL → https://a-clean-webapp.vercel.app/api/fonnte-webhook

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service key (bukan anon key) untuk server-side
);

// ── Brain Customer MD (sistem prompt untuk customer) ──────────────────────────
const BRAIN_CUSTOMER = `
# ARA CUSTOMER BRAIN v1.0 — AClean Service

## IDENTITAS
Nama: ARA, asisten virtual AClean Service — Jasa Cuci, Servis & Pasang AC Profesional.
Area: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan.
Jam operasional: Senin–Sabtu 08:00–17:00 WIB.

## TUGASMU
1. Jawab pertanyaan layanan, harga, area AClean
2. Bantu booking order baru (kumpulkan data lengkap dulu)
3. Bantu customer cek status order mereka (by nomor HP pengirim)
4. Terima & catat komplain/feedback

## BATASAN KERAS
- JANGAN tampilkan data customer lain
- JANGAN lakukan aksi admin (cancel, approve, update invoice, dll)
- JANGAN sebut harga final untuk Perbaikan AC — bilang "ditentukan setelah diagnosa"
- Jika tidak yakin: arahkan ke admin

## LAYANAN & HARGA
- Cuci AC: Rp 80.000/unit
- Freon R22: Rp 150.000/unit
- Freon R32: Rp 200.000/unit
- Perbaikan AC: mulai Rp 100.000 (tergantung kerusakan)
- Pasang AC Baru: Rp 300.000/unit
- Bongkar AC: Rp 150.000/unit
- Service AC: Rp 120.000/unit
- Booking H-0 (hari ini): +Rp 50.000

## ALUR BOOKING
Kumpulkan: layanan → jumlah unit → alamat lengkap → tanggal preferensi → jam preferensi → nama → konfirmasi.
Setelah semua lengkap: output JSON di akhir pesan dalam format:
[BOOKING]{"service":"...","units":1,"address":"...","date":"YYYY-MM-DD","time":"HH:MM","name":"...","phone":"[PHONE]"}[/BOOKING]

## AKSI CEK STATUS
Jika customer minta cek status order: output JSON:
[CEK_STATUS]{"phone":"[PHONE]"}[/CEK_STATUS]

## FORMAT JAWABAN
- Bahasa Indonesia, ramah dan singkat (maks 5 kalimat)
- Gunakan emoji: 😊 ✅ 🔧 📱
- Jika customer marah: empati dulu, tawarkan solusi
`;

// ── Helper: Panggil LLM (Gemini atau Claude) ─────────────────────────────────
async function callLLM(messages, systemPrompt) {
  const provider = process.env.LLM_PROVIDER || "gemini";
  const apiKey   = process.env.LLM_API_KEY;
  const model    = process.env.LLM_MODEL || (provider === "gemini" ? "gemini-2.5-flash" : "claude-sonnet-4-6");

  if (provider === "gemini") {
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 500 }
        })
      }
    );
    const d = await res.json();
    return d.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";

  } else {
    // Claude / Anthropic
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "messages-2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: systemPrompt,
        messages
      })
    });
    const d = await res.json();
    return d.content?.map(c => c.text || "").join("") || "";
  }
}

// ── Helper: Kirim balas WA via Fonnte ─────────────────────────────────────────
async function sendWAReply(phone, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { "Authorization": token },
      body: new URLSearchParams({ target: phone, message, countryCode: "62" })
    });
    return res.ok;
  } catch { return false; }
}

// ── Helper: Simpan percakapan ke Supabase ─────────────────────────────────────
async function saveConversation(phone, name, incomingMsg, replyMsg) {
  const now = new Date().toISOString();

  // Upsert wa_conversations
  await supabase.from("wa_conversations").upsert({
    phone,
    name: name || phone,
    last_message: incomingMsg.slice(0, 100),
    last_reply: replyMsg.slice(0, 100),
    updated_at: now,
    source: "customer_bot"
  }, { onConflict: "phone" });

  // Insert ke wa_messages jika tabel tersedia
  await supabase.from("wa_messages").insert([
    { phone, name, role: "customer", content: incomingMsg, created_at: now },
    { phone, name, role: "ara",      content: replyMsg,    created_at: now }
  ]).catch(() => {}); // silent — tabel mungkin belum ada
}

// ── Helper: Ambil history chat customer (maks 10 pesan terakhir) ──────────────
async function getChatHistory(phone) {
  const { data } = await supabase
    .from("wa_messages")
    .select("role, content")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(10)
    .catch(() => ({ data: null }));

  if (!data) return [];
  return data.reverse().map(m => ({
    role: m.role === "ara" ? "assistant" : "user",
    content: m.content
  }));
}

// ── Helper: Ambil data order customer by phone ───────────────────────────────
async function getCustomerOrders(phone) {
  const { data } = await supabase
    .from("orders")
    .select("id, service, units, date, time, status, teknisi")
    .eq("phone", phone)
    .order("date", { ascending: false })
    .limit(5);
  return data || [];
}

// ── Helper: Proses booking dari reply ARA ────────────────────────────────────
async function processBooking(bookingJson, phone, name) {
  try {
    const b = JSON.parse(bookingJson.replace("[PHONE]", phone));
    const today = new Date().toISOString().slice(0, 10);
    const seq   = Math.floor(Math.random() * 900 + 100);
    const newId = "ORD-" + (b.date || today).replace(/-/g, "").slice(2) + "-" + seq;

    await supabase.from("orders").insert({
      id:         newId,
      customer:   b.name || name || phone,
      phone:      phone,
      address:    b.address || "",
      service:    b.service || "Cuci AC",
      units:      parseInt(b.units) || 1,
      date:       b.date || today,
      time:       b.time || "09:00",
      status:     "PENDING",
      notes:      "Booking via WA (ARA Customer Bot)",
      dispatch:   false,
      created_at: new Date().toISOString()
    });

    // Log ke agent_logs
    await supabase.from("agent_logs").insert({
      type:       "CUSTOMER_BOOKING",
      message:    `Booking WA: ${b.name||phone} — ${b.service} ${b.units}x, ${b.date}`,
      status:     "SUCCESS",
      created_at: new Date().toISOString()
    }).catch(() => {});

    return newId;
  } catch (e) {
    console.error("processBooking error:", e);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // Fonnte mengirim webhook via POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body    = req.body || {};
    const phone   = (body.sender || body.phone || "").replace(/\D/g, "");
    const message = (body.message || body.text || "").trim();
    const name    = body.name || body.pushname || phone;

    // Validasi
    if (!phone || !message) {
      return res.status(200).json({ ok: true, skip: "no phone or message" });
    }

    // Ignore pesan dari diri sendiri (outgoing)
    if (body.me === true || body.from_me === "1" || body.from_me === true) {
      return res.status(200).json({ ok: true, skip: "own message" });
    }

    // Ambil history chat
    const history = await getChatHistory(phone);

    // Tambah pesan baru ke history
    const messages = [
      ...history,
      { role: "user", content: message }
    ];

    // Tambah konteks data order customer ke system prompt
    const orders = await getCustomerOrders(phone);
    let systemPrompt = BRAIN_CUSTOMER.replace("[PHONE]", phone);
    if (orders.length > 0) {
      const orderList = orders.map(o =>
        `- ${o.id}: ${o.service} ${o.units}x | ${o.date} ${o.time} | Status: ${o.status}${o.teknisi ? " | Teknisi: " + o.teknisi : ""}`
      ).join("\n");
      systemPrompt += `\n\n## ORDER CUSTOMER INI (${phone})\n${orderList}`;
    }

    // Panggil LLM
    let reply = await callLLM(messages, systemPrompt);

    // ── Proses [BOOKING] action ──
    const bookingMatch = reply.match(/\[BOOKING\](.*?)\[\/BOOKING\]/s);
    if (bookingMatch) {
      const orderId = await processBooking(bookingMatch[1].trim(), phone, name);
      reply = reply.replace(/\[BOOKING\].*?\[\/BOOKING\]/s, "").trim();
      if (orderId) {
        reply += `\n\n✅ Booking diterima! No. Order: *${orderId}*\nAdmin akan konfirmasi dalam 1–2 jam. Terima kasih! 😊`;
      }
    }

    // ── Proses [CEK_STATUS] action ──
    const cekMatch = reply.match(/\[CEK_STATUS\](.*?)\[\/CEK_STATUS\]/s);
    if (cekMatch) {
      reply = reply.replace(/\[CEK_STATUS\].*?\[\/CEK_STATUS\]/s, "").trim();
      if (orders.length > 0) {
        const statusList = orders.map(o =>
          `📋 *${o.id}*\n🔧 ${o.service} ${o.units} unit\n📅 ${o.date} jam ${o.time}\n🚦 Status: ${o.status}`
        ).join("\n\n");
        reply = (reply ? reply + "\n\n" : "") + statusList;
      } else {
        reply = "Belum ada order aktif untuk nomor ini. Mau booking sekarang? 😊";
      }
    }

    // Fallback jika reply kosong
    if (!reply) {
      reply = "Mohon maaf, saya tidak bisa memproses permintaan ini. Silakan hubungi admin kami langsung ya 😊";
    }

    // Kirim balasan WA
    await sendWAReply(phone, reply);

    // Simpan percakapan ke DB
    await saveConversation(phone, name, message, reply);

    return res.status(200).json({ ok: true, reply: reply.slice(0, 100) });

  } catch (err) {
    console.error("Webhook error:", err);
    // Tetap return 200 ke Fonnte agar tidak retry terus-menerus
    return res.status(200).json({ ok: false, error: err.message });
  }
}
