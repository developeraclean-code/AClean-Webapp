// api/cron/stock-alert.js — 08:00 WIB (01:00 UTC) setiap hari
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  try {
    const ownerPhone = process.env.OWNER_PHONE || "6281299898937";
    const { data:items } = await sb.from("inventory").select("*").in("status",["CRITICAL","OUT"]);
    if (!items?.length) return res.json({success:true, message:"Semua stok aman"});

    const out  = items.filter(i=>i.status==="OUT");
    const crit = items.filter(i=>i.status==="CRITICAL");
    let msg = `⚠️ *ALERT STOK ACLEAN*\n${new Date().toLocaleDateString("id-ID")}\n\n`;
    if (out.length)  { msg+=`🔴 *HABIS (${out.length}):*\n`;  out.forEach(i=>{msg+=`• ${i.name}: 0 ${i.unit}\n`;});  msg+="\n"; }
    if (crit.length) { msg+=`🟠 *KRITIS (${crit.length}):*\n`; crit.forEach(i=>{msg+=`• ${i.name}: ${i.stock} ${i.unit}\n`;}); }
    msg += "\n_Segera restock. — ARA AClean_";

    if (process.env.FONNTE_TOKEN) {
      await fetch("https://api.fonnte.com/send",{
        method:"POST",
        headers:{"Authorization":process.env.FONNTE_TOKEN,"Content-Type":"application/json"},
        body:JSON.stringify({target:ownerPhone, message:msg, countryCode:"62"})
      });
    }

    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    await sb.from("agent_logs").insert({time:now,action:"STOCK_ALERT",detail:`${out.length} habis, ${crit.length} kritis`,status:"WARNING"});
    return res.json({success:true, out:out.length, critical:crit.length});
  } catch(err) { return res.status(500).json({error:err.message}); }
}
