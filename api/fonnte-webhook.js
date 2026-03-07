// api/fonnte-webhook.js
// Vercel Serverless Function — ARA Customer Bot via WhatsApp
//
// SETUP (butuh Fonnte paket berbayar untuk webhook):
//   Fonnte Dashboard → Device → Settings → Webhook URL:
//   https://a-clean-webapp.vercel.app/api/fonnte-webhook
//
// ALUR KERJA:
//   Customer kirim WA → Fonnte forward ke sini → ARA balas otomatis
//   Setiap percakapan tersimpan di Supabase (wa_conversations + wa_messages)
//   Admin bisa lihat & reply manual dari WA Monitor panel di app

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Default Brain Customer (fallback jika tidak ada di DB) ───────────────────
const BRAIN_CUSTOMER_DEFAULT = `
# ARA CUSTOMER BRAIN v2.0 — AClean Service

## IDENTITAS
Nama: ARA, asisten virtual AClean — Jasa Cuci, Servis & Pasang AC Profesional.
Area: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan.
Jam operasional: Senin–Sabtu 08:00–17:00 WIB.

## TUGASMU
1. Balas sapaan customer dengan ramah & perkenalkan diri
2. Jawab pertanyaan layanan, harga, area kerja AClean
3. Bantu booking order baru — kumpulkan data step by step
4. Bantu customer cek status order mereka
5. Tampung komplain/feedback dengan empati

## BATASAN KERAS
- JANGAN tampilkan data customer lain
- JANGAN lakukan aksi admin (cancel order, approve invoice, dll)
- JANGAN sebut harga final untuk Perbaikan AC ("mulai dari" saja)
- Jika tidak yakin jawaban: arahkan ke admin (wa.me/6281234567890)

## LAYANAN & HARGA
| Layanan | Harga |
|---------|-------|
| Cuci AC Split | Rp 80.000/unit |
| Freon R22 | Rp 150.000/unit |
| Freon R32 | Rp 200.000/unit |
| Service AC | Rp 120.000/unit |
| Perbaikan AC | mulai Rp 100.000 (tergantung kerusakan) |
| Pasang AC Baru | Rp 300.000/unit |
| Bongkar AC | Rp 150.000/unit |
| Booking H-0 (hari ini) | +Rp 50.000 |

## ALUR BOOKING — kumpulkan satu per satu, jangan tanya sekaligus
1. Jenis layanan (Cuci/Freon/Service/Pasang/Perbaikan)
2. Jumlah unit
3. Alamat lengkap (nama jalan + RT/RW + kecamatan)
4. Tanggal preferensi (kalau bisa H+1 minimal)
5. Jam preferensi (08:00–16:00)
6. Konfirmasi nama

Setelah SEMUA data terkumpul, output JSON ini di akhir pesan (customer tidak perlu tahu):
[BOOKING]{"service":"...","units":1,"address":"...","date":"YYYY-MM-DD","time":"HH:MM","name":"...","phone":"[PHONE]"}[/BOOKING]

## CONTOH ALUR BOOKING YANG BENAR
Customer: "mau cuci ac"
ARA: "Halo kak! 😊 Untuk cuci AC, berapa unit yang mau dicuci?"
Customer: "2 unit"
ARA: "Siap! Boleh minta alamat lengkapnya kak? 📍"
...dan seterusnya sampai semua data lengkap.

## CEK STATUS ORDER
Jika customer minta cek status: output JSON:
[CEK_STATUS]{"phone":"[PHONE]"}[/CEK_STATUS]

## FORMAT JAWABAN
- Bahasa Indonesia santai & akrab (satu/dua kalimat pendek)
- Pakai emoji natural: 😊 ✅ 🔧 📍 📅
- Kalau customer marah: empati dulu, jangan defensif
- Kalau di luar jam operasional: informasikan & tawari booking untuk besok
`;

// ── Ambil brain customer dari DB (bisa di-override Owner dari Settings) ───────
async function getBrainCustomer() {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "brain_customer_md")
      .single();
    if (data?.value && data.value.length > 100) return data.value;
  } catch (_) {}
  return BRAIN_CUSTOMER_DEFAULT;
}

// ── Panggil LLM ───────────────────────────────────────────────────────────────
async function callLLM(messages, systemPrompt) {
  const provider = process.env.LLM_PROVIDER || "gemini";
  const apiKey   = process.env.LLM_API_KEY;
  const model    = process.env.LLM_MODEL || (provider === "gemini" ? "gemini-2.5-flash" : "claude-sonnet-4-6");

  if (!apiKey) throw new Error("LLM_API_KEY tidak dikonfigurasi");

  if (provider === "gemini") {
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
        })
      }
    );
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";

  } else {
    // Claude / Anthropic
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({ model, max_tokens: 400, system: systemPrompt, messages })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || d.error);
    return d.content?.map(c => c.text || "").join("") || "";
  }
}

// ── Kirim balas WA via Fonnte ─────────────────────────────────────────────────
async function sendWAReply(phone, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) return false;
  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { "Authorization": token },
      body: new URLSearchParams({ target: phone, message, countryCode: "62" })
    });
    const d = await r.json();
    return d.status === true;
  } catch { return false; }
}

// ── Simpan ke Supabase ────────────────────────────────────────────────────────
async function saveMessages(phone, name, incomingMsg, replyMsg) {
  const now = new Date().toISOString();
  await supabase.from("wa_conversations").upsert({
    phone, name: name || phone,
    last_message: incomingMsg.slice(0, 120),
    last_reply:   replyMsg.slice(0, 120),
    updated_at:   now,
    unread:       0,
    source:       "customer_bot"
  }, { onConflict: "phone" });

  await supabase.from("wa_messages").insert([
    { phone, name, role: "customer", content: incomingMsg, created_at: now },
    { phone, name, role: "ara",      content: replyMsg,    created_at: now }
  ]).catch(() => {});
}

// ── Ambil history chat (10 pesan terakhir) ────────────────────────────────────
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
    role:    m.role === "ara" ? "assistant" : "user",
    content: m.content
  }));
}

// ── Ambil order customer ──────────────────────────────────────────────────────
async function getCustomerOrders(phone) {
  const { data } = await supabase
    .from("orders")
    .select("id,service,units,date,time,status,teknisi,address")
    .eq("phone", phone)
    .order("date", { ascending: false })
    .limit(5);
  return data || [];
}

// ── Proses booking ────────────────────────────────────────────────────────────
async function processBooking(bookingJson, phone, name) {
  try {
    const b     = JSON.parse(bookingJson.replace(/\[PHONE\]/g, phone));
    const today = new Date().toISOString().slice(0, 10);
    const seq   = Date.now().toString(36).slice(-4).toUpperCase();
    const newId = "ORD-" + (b.date || today).replace(/-/g, "").slice(2) + "-" + seq;

    const { error } = await supabase.from("orders").insert({
      id:         newId,
      customer:   b.name || name || phone,
      phone:      phone,
      address:    b.address || "",
      service:    b.service || "Cuci AC",
      units:      parseInt(b.units) || 1,
      date:       b.date || today,
      time:       b.time || "09:00",
      status:     "PENDING",
      dispatch:   false,
      notes:      "Booking via WhatsApp (ARA Customer Bot)",
      created_at: new Date().toISOString()
    });

    if (error) throw error;

    await supabase.from("agent_logs").insert({
      action:     "CUSTOMER_BOOKING_WA",
      detail:     `Booking WA dari ${b.name || phone} — ${b.service} ${b.units}x, ${b.date} ${b.time}`,
      status:     "SUCCESS",
      created_at: new Date().toISOString()
    }).catch(() => {});

    return newId;
  } catch (e) {
    console.error("processBooking error:", e.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body    = req.body || {};
    const phone   = (body.sender || body.phone || "").replace(/\D/g, "");
    const msgType = body.type || "text";   // "text" | "image" | "document" | "audio"
    const mediaUrl= body.url  || body.media_url || null;
    const rawMsg  = (body.message || body.text || "").trim();

    // Jika customer kirim foto/gambar → deteksi konteks (mungkin bukti bayar)
    const isMedia  = ["image","document"].includes(msgType) || !!mediaUrl;
    const message  = isMedia
      ? (rawMsg ? rawMsg : "[customer mengirim foto/dokumen]")
      : rawMsg;

    const name    = body.name || body.pushname || phone;

    if (!phone || (!message && !isMedia)) {
      return res.status(200).json({ ok: true, skip: "no phone or message" });
    }

    // Ignore pesan dari diri sendiri (outgoing)
    if (body.me === true || body.from_me === "1" || body.from_me === true) {
      return res.status(200).json({ ok: true, skip: "own message" });
    }

    // Ambil brain + history + orders secara paralel
    const [brainMd, history, orders] = await Promise.all([
      getBrainCustomer(),
      getChatHistory(phone),
      getCustomerOrders(phone)
    ]);

    // Bangun system prompt dengan data order customer
    let systemPrompt = brainMd.replace(/\[PHONE\]/g, phone);
    // Jika customer kirim foto → beri tahu ARA
    if (isMedia) {
      systemPrompt += `\n\n## INFO TAMBAHAN\nCustomer baru mengirim ${msgType === "image" ? "foto/gambar" : "dokumen"}. Kemungkinan: bukti transfer pembayaran, foto AC bermasalah, atau dokumen lain. Minta customer konfirmasi konteks foto jika belum jelas.`;
    }
    if (orders.length > 0) {
      const orderList = orders.map(o =>
        `- ${o.id}: ${o.service} ${o.units}x | ${o.date} ${o.time} | ${o.status}${o.teknisi ? " | Teknisi: " + o.teknisi : ""}`
      ).join("\n");
      systemPrompt += `\n\n## RIWAYAT ORDER CUSTOMER (${phone})\n${orderList}`;
    }

    // Cek jam operasional
    const jakartaHour = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta", hour: "numeric", hour12: false });
    const hour = parseInt(jakartaHour);
    const isOpen = hour >= 8 && hour < 17;
    if (!isOpen) {
      systemPrompt += `\n\n## INFO TAMBAHAN\nSekarang di luar jam operasional (${hour}:00 WIB). Informasikan customer bahwa kami tutup dan tawari booking untuk besok.`;
    }

    // Tambah pesan baru ke history
    const messages = [...history, { role: "user", content: message }];

    // ── Deteksi pesan pembayaran SEBELUM LLM (fast path) ──────────────────
    const msgLower = message.toLowerCase().replace(/[^a-z0-9\s]/g,'');
    const isPaymentKeyword = /(lunas|sudah transfer|sudah bayar|transfer sudah|bukti bayar|bukti tf|udah bayar|dibayar)/.test(msgLower);
    const invoiceInMsg    = message.match(/INV[-_]?\w+/i)?.[0] || null;

    if (isPaymentKeyword || isMedia) {
      // Cari invoice UNPAID milik customer ini dari orders
      const { data: custOrders } = await supabase
        .from("orders")
        .select("id,customer,invoice_id")
        .eq("phone", phone)
        .in("status", ["DISPATCHED","COMPLETED","ON_SITE","WORKING","REPORT_SUBMITTED","INVOICE_APPROVED"])
        .order("created_at", { ascending: false })
        .limit(3);

      const { data: pendingInvs } = await supabase
        .from("invoices")
        .select("id,customer,total,due")
        .eq("phone", phone)
        .in("status", ["UNPAID","OVERDUE"])
        .order("created_at", { ascending: false })
        .limit(3);

      // Notif ke admin/owner untuk manual verifikasi
      const OWNER_PHONE = process.env.OWNER_PHONE;
      if (OWNER_PHONE && (pendingInvs?.length > 0 || invoiceInMsg)) {
        const targetInv = invoiceInMsg
          ? pendingInvs?.find(i => i.id.toUpperCase() === invoiceInMsg.toUpperCase())
          : pendingInvs?.[0];

        const adminMsg = isMedia
          ? `📸 *Bukti Bayar Masuk!*

` +
            `Customer: *${name}* (${phone})
` +
            (targetInv ? `Invoice: *${targetInv.id}* — Rp ${(targetInv.total||0).toLocaleString("id-ID")}` : `Invoice belum teridentifikasi`) + `

` +
            `Customer mengirim ${msgType === "image" ? "foto bukti transfer" : "dokumen"}.
` +
            `${targetInv ? `Ketik di ARA Chat: *"MARK_PAID ${targetInv.id}"* setelah verifikasi manual ✅` : "Cek manual dan tandai lunas jika sudah diterima."}`
          : `💬 *Konfirmasi Bayar dari Customer*

` +
            `Customer: *${name}* (${phone})
` +
            `Pesan: "${message}"
` +
            (targetInv ? `Invoice: *${targetInv.id}* — Rp ${(targetInv.total||0).toLocaleString("id-ID")}

Ketik di ARA Chat: *"MARK_PAID ${targetInv.id}"* setelah verifikasi manual ✅` : "Cek invoice manual.");

        await sendWA(OWNER_PHONE, adminMsg);

        // Balas customer dengan konfirmasi pending
        const custReply = `✅ Terima kasih ${name}! ${isMedia ? "Bukti bayar" : "Konfirmasi pembayaran"} Anda sudah kami terima.

` +
          `Tim kami sedang memverifikasi. Anda akan mendapat konfirmasi setelah pembayaran terverifikasi.

` +
          `📋 ${targetInv ? "Invoice: " + targetInv.id : "Info invoice akan dikirimkan segera"}

` +
          `Terima kasih telah menggunakan layanan *AClean* 🙏`;
        await sendWA(phone, custReply);
        return res.status(200).json({ ok: true, payment_pending: true, invoice: targetInv?.id });
      }
    }
    // ── End deteksi pembayaran ─────────────────────────────────────────────

    // Panggil LLM
    let reply = await callLLM(messages, systemPrompt);

    // ── Proses [BOOKING] ──────────────────────────────────────────────────────
    const bookingMatch = reply.match(/\[BOOKING\]([\s\S]*?)\[\/BOOKING\]/);
    if (bookingMatch) {
      const orderId = await processBooking(bookingMatch[1].trim(), phone, name);
      reply = reply.replace(/\[BOOKING\][\s\S]*?\[\/BOOKING\]/g, "").trim();
      reply += orderId
        ? `\n\n✅ Booking diterima! No. Order: *${orderId}*\nAdmin akan konfirmasi & hubungi kamu dalam 1–2 jam. Terima kasih! 😊`
        : `\n\n⚠️ Ada kendala simpan booking. Coba lagi atau hubungi admin langsung ya.`;
    }

    // ── Proses [CEK_STATUS] ───────────────────────────────────────────────────
    const cekMatch = reply.match(/\[CEK_STATUS\][\s\S]*?\[\/CEK_STATUS\]/);
    if (cekMatch) {
      reply = reply.replace(/\[CEK_STATUS\][\s\S]*?\[\/CEK_STATUS\]/g, "").trim();
      if (orders.length > 0) {
        const statusList = orders.slice(0, 3).map(o =>
          `📋 *${o.id}*\n🔧 ${o.service} ${o.units} unit\n📍 ${o.address || "—"}\n📅 ${o.date} jam ${o.time}\n🚦 ${o.status}`
        ).join("\n\n");
        reply = (reply ? reply + "\n\n" : "") + statusList;
      } else {
        reply = "Belum ada order aktif untuk nomor ini. Mau booking sekarang? 😊";
      }
    }

    if (!reply) {
      reply = "Mohon maaf, ada gangguan teknis. Coba lagi atau hubungi admin kami langsung ya 😊";
    }

    // Kirim & simpan secara paralel
    await Promise.all([
      sendWAReply(phone, reply),
      saveMessages(phone, name, message, reply)
    ]);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
