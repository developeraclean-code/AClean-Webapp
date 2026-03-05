// api/cron/payment-reminder.js — 17:00 WIB (10:00 UTC) setiap hari
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  try {
    const today = new Date().toISOString().slice(0,10);
    const { data: invs } = await sb.from("invoices").select("*").in("status",["UNPAID","OVERDUE"]).not("phone","is",null);
    if (!invs?.length) return res.json({success:true, message:"Tidak ada invoice perlu reminder"});

    // Tandai OVERDUE
    const overdueIds = invs.filter(i=>i.due && i.due<today && i.status!=="OVERDUE").map(i=>i.id);
    if (overdueIds.length) await sb.from("invoices").update({status:"OVERDUE"}).in("id",overdueIds);

    let sent = 0;
    for (const inv of invs) {
      if (!inv.phone) continue;
      const overdue = inv.status==="OVERDUE" || (inv.due && inv.due<today);
      const msg = overdue
        ? `⚠️ Halo ${inv.customer}, tagihan AClean *${inv.id}* sebesar *Rp ${(inv.total||0).toLocaleString("id-ID")}* sudah JATUH TEMPO sejak ${inv.due}.\n\nSegera transfer ke:\n*BCA 8830883011 a.n. Malda Retta*\n\nKonfirmasi di WA ini. Terima kasih 🙏`
        : `Halo ${inv.customer}, reminder tagihan AClean *${inv.id}* sebesar *Rp ${(inv.total||0).toLocaleString("id-ID")}*, jatuh tempo ${inv.due}.\n\nTransfer ke:\n*BCA 8830883011 a.n. Malda Retta*\n\nTerima kasih 😊`;

      await fetch("https://api.fonnte.com/send",{
        method:"POST",
        headers:{"Authorization":process.env.FONNTE_TOKEN,"Content-Type":"application/json"},
        body:JSON.stringify({target:inv.phone, message:msg, countryCode:"62"})
      });
      await sb.from("invoices").update({follow_up:(inv.follow_up||0)+1}).eq("id",inv.id);
      sent++;
    }

    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    await sb.from("agent_logs").insert({time:now,action:"PAYMENT_REMINDER",detail:`Cron: ${sent} reminder, ${overdueIds.length} jadi OVERDUE`,status:"SUCCESS"});
    return res.json({success:true, sent, overdue_marked:overdueIds.length});
  } catch(err) { return res.status(500).json({error:err.message}); }
}
