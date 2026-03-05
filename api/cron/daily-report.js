// api/cron/daily-report.js — 18:00 WIB (11:00 UTC) setiap hari
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  try {
    const today = new Date().toISOString().slice(0,10);
    const ownerPhone = process.env.OWNER_PHONE || "6281299898937";

    const [{ data:orders }, { data:invoices }, { data:laporan }] = await Promise.all([
      sb.from("orders").select("*").eq("date",today),
      sb.from("invoices").select("*").gte("created_at",today+"T00:00:00"),
      sb.from("service_reports").select("*").eq("date",today),
    ]);

    const done    = (orders||[]).filter(o=>o.status==="COMPLETED").length;
    const proses  = (orders||[]).filter(o=>o.status==="IN_PROGRESS").length;
    const jadwal  = (orders||[]).filter(o=>o.status==="CONFIRMED").length;
    const masuk   = (invoices||[]).filter(i=>i.status==="PAID").reduce((s,i)=>s+(i.total||0),0);
    const pending = (invoices||[]).filter(i=>["UNPAID","OVERDUE"].includes(i.status)).reduce((s,i)=>s+(i.total||0),0);

    const tgl = new Date().toLocaleDateString("id-ID",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    const msg = `📊 *LAPORAN HARIAN ACLEAN*\n${tgl}\n\n🔧 *ORDER*\n✅ Selesai: ${done}\n🔄 Proses: ${proses}\n📋 Terjadwal: ${jadwal}\n📝 Laporan masuk: ${(laporan||[]).length}\n\n💰 *KEUANGAN*\n✅ Lunas: Rp ${masuk.toLocaleString("id-ID")}\n⏳ Pending: Rp ${pending.toLocaleString("id-ID")}\n\n_Laporan otomatis — ARA AClean_`;

    if (process.env.FONNTE_TOKEN) {
      await fetch("https://api.fonnte.com/send",{
        method:"POST",
        headers:{"Authorization":process.env.FONNTE_TOKEN,"Content-Type":"application/json"},
        body:JSON.stringify({target:ownerPhone, message:msg, countryCode:"62"})
      });
    }

    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    await sb.from("agent_logs").insert({time:now,action:"DAILY_REPORT",detail:`${done} selesai, Rp ${masuk.toLocaleString("id-ID")} masuk`,status:"SUCCESS"});
    return res.json({success:true, orders:orders?.length, revenue:masuk});
  } catch(err) { return res.status(500).json({error:err.message}); }
}
