// api/webhook-fonnte.js
// POST — terima pesan WA masuk dari Fonnte
// Set di Fonnte Dashboard: Webhook URL = https://a-clean-webapp.vercel.app/api/webhook-fonnte

import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { sender, message, name } = req.body||{};
    if (!sender||!message) return res.status(400).json({error:"Invalid payload"});

    const phone = sender.replace(/[^0-9]/g,"");
    const ml    = message.toLowerCase();
    let intent  = "UNKNOWN";
    if (/order|booking|servis|cleaning|pasang|install|perbaik|ac/.test(ml))  intent = "ORDER_NEW";
    else if (/transfer|bayar|payment|lunas|bukti/.test(ml))                   intent = "PAYMENT";
    else if (/komplain|masih|belum|rusak|panas|bocor|tidak dingin/.test(ml))  intent = "COMPLAINT";
    else if (/harga|berapa|info|tanya|jadwal|jam/.test(ml))                   intent = "FAQ";

    const { data: conv } = await sb.from("wa_conversations").select("id,unread").eq("phone",phone).single();
    let convId;
    if (conv) {
      convId = conv.id;
      await sb.from("wa_conversations").update({
        last_message: message.slice(0,100),
        time: new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}),
        unread: (conv.unread||0)+1, intent,
        status: intent==="COMPLAINT"?"ESCALATED":"ACTIVE",
        updated_at: new Date().toISOString()
      }).eq("id",convId);
    } else {
      const { data: nc } = await sb.from("wa_conversations").insert({
        phone, name:name||phone,
        last_message: message.slice(0,100),
        time: new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}),
        unread:1, intent, status:"ACTIVE"
      }).select("id").single();
      convId = nc?.id;
    }

    if (convId) await sb.from("wa_messages").insert({conversation_id:convId, role:"user", content:message});

    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    await sb.from("agent_logs").insert({
      time:now, action:"WA_RECEIVED",
      detail:`Pesan dari ${phone} (${name||"Unknown"}) — intent: ${intent}`,
      status:"SUCCESS"
    });

    return res.status(200).json({success:true});
  } catch(err) {
    return res.status(500).json({error:err.message});
  }
}
