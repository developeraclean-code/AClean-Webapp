// api/_tasks/reminders.js — Task cron grup reminders (dipindah APA ADANYA dari
// api/cron-reminder.js, pemecahan _tasks/ Jul 2026). Entry & jadwal tetap di cron-reminder.js.
import { sb, sendWA, isCronJobEnabled, fmt, daysSince, log, OWNER_PHONE } from "./_shared.js";

// ══════════════════════════════════════════════════
// TASK 1: Invoice Reminder (default)
// ══════════════════════════════════════════════════
export async function taskReminder() {
  // Indonesia timezone (UTC+7)
  const today = new Date(Date.now() + 7*60*60*1000).toISOString().slice(0,10);
  const res = { reminder1:0, reminder2:0, reminder3:0, escalated:0, autoapproved:0 };

  // Fetch settings dari app_settings
  const { data: bankData } = await sb.from("app_settings")
    .select("key,value")
    .in("key", ["bank_name","bank_number","bank_holder","company_name","invoice_reminder_enabled","cron_jobs"]);
  const bankMap = Object.fromEntries((bankData||[]).map(s=>[s.key, s.value]));

  // Cek toggle — AND-logic canonical: cron_jobs JSON DAN standalone key === "true"
  if (!isCronJobEnabled(bankMap, "invoice_reminder_enabled") || bankMap["invoice_reminder_enabled"] !== "true") {
    await log("CRON_REMINDER", "Dilewati — Payment Reminder dinonaktifkan via Settings", "INFO");
    return { skipped: true, reason: "Payment Reminder dinonaktifkan via Settings" };
  }
  const BANK_NAME   = bankMap.bank_name   || process.env.BANK_NAME;
  const BANK_NUMBER = bankMap.bank_number || process.env.BANK_NUMBER;
  const BANK_HOLDER = bankMap.bank_holder || process.env.BANK_HOLDER;
  if (!BANK_NAME || !BANK_NUMBER || !BANK_HOLDER) {
    await log("CRON_REMINDER", "❌ Bank details tidak lengkap — set BANK_NAME, BANK_NUMBER, BANK_HOLDER di env", "ERROR");
    return { error: "Bank details incomplete", skipped: true };
  }

  // Limit to prevent timeout (Vercel max 30s). Process in batches if needed.
  const { data: invs } = await sb.from("invoices").select("*").in("status",["UNPAID","OVERDUE"]).limit(500);
  for (const inv of invs||[]) {
    const daysOverdue = daysSince(inv.due || inv.sent);
    if (inv.status==="UNPAID" && inv.due && inv.due<today) {
      await sb.from("invoices").update({status:"OVERDUE"}).eq("id",inv.id);
    }
    if (!inv.phone) continue;
    // Tagihan efektif: jika ada DP/paid_amount, tagih sisa (bukan total)
    const paid = Number(inv.paid_amount) || 0;
    const sisaBayar = Math.max(0, (inv.total || 0) - paid);
    const tagihLabel = paid > 0
      ? `sisa pembayaran *${fmt(sisaBayar)}* (total ${fmt(inv.total)} — sudah DP ${fmt(paid)})`
      : `total *${fmt(inv.total)}*`;
    let msg = null;
    if (daysOverdue>=1  && daysOverdue<=7)  { msg=`Halo ${inv.customer} 🙏\n\nPengingat invoice *${inv.id}* — ${tagihLabel}, jatuh tempo ${inv.due}.\n\nTransfer ke: *${BANK_NAME} ${BANK_NUMBER}* a.n. ${BANK_HOLDER}\nTerima kasih! — AClean`; res.reminder1++; }
    else if (daysOverdue>=8  && daysOverdue<=14) { msg=`Halo ${inv.customer},\n\nInvoice *${inv.id}* belum dibayar (${daysOverdue} hari). ${tagihLabel}.\n\nTransfer ke *${BANK_NAME} ${BANK_NUMBER}* a.n. ${BANK_HOLDER}.\n\n— AClean`; res.reminder2++; }
    else if (daysOverdue>=15 && daysOverdue<=21) { msg=`Halo ${inv.customer},\n\nInvoice *${inv.id}* sudah ${daysOverdue} hari lewat jatuh tempo (${tagihLabel}).\n\nAda kendala? Balas pesan ini. — AClean`; res.reminder3++; await sendWA(OWNER_PHONE,`⚠️ OVERDUE ${inv.id} — ${inv.customer} — ${daysOverdue}h — ${fmt(sisaBayar)}`); }
    else if (daysOverdue>=22) { res.escalated++; await sendWA(OWNER_PHONE,`🚨 ESKALASI ${inv.id} — ${inv.customer} — ${daysOverdue}h — ${fmt(sisaBayar)}`); continue; }
    if (msg) { await sendWA(inv.phone, msg); await log("REMINDER_SENT",`${inv.id} — ${daysOverdue}d`); }
  }

  // Auto-approve PENDING_APPROVAL > 6 jam
  // Cleaning/Install: UNPAID (ada tagihan)
  // Repair/Complain gratis (total=0): langsung PAID (tidak perlu tagih)
  const { data: pend } = await sb.from("invoices").select("*").eq("status","PENDING_APPROVAL").limit(300);
  for (const inv of pend||[]) {
    const hrs = (Date.now()-new Date(inv.created_at).getTime())/3600000;
    if (hrs < 6) continue;
    const isZero = (inv.total || 0) === 0;
    if (isZero) {
      // Invoice Rp 0 (repair gratis/garansi) — auto-PAID tanpa tagih
      await sb.from("invoices").update({status:"PAID",paid_at:new Date().toISOString(),approved_by:"CRON_AUTO",approved_at:new Date().toISOString()}).eq("id",inv.id);
      res.autoapproved++;
      await sendWA(OWNER_PHONE,`ℹ️ Invoice *${inv.id}* (${inv.customer}) Rp 0 — auto-PAID (gratis/garansi).`);
    } else if (/(Cleaning|Install|Repair|Complain)/.test(inv.service||"")) {
      const due = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      await sb.from("invoices").update({status:"UNPAID",sent:true,due,approved_by:"CRON_AUTO",approved_at:new Date().toISOString()}).eq("id",inv.id);
      res.autoapproved++;
      await sendWA(OWNER_PHONE,`ℹ️ Invoice *${inv.id}* (${inv.customer}) auto-approved setelah ${Math.round(hrs)}j. Total: ${fmt(inv.total)} — kirim manual dari app.`);
    }
  }

  // Update UNPAID lewat due → OVERDUE (Indonesia timezone UTC+7)
  const nowStr = new Date(Date.now() + 7*60*60*1000).toISOString().slice(0,10);
  await sb.from("invoices").update({status:"OVERDUE"}).eq("status","UNPAID").lt("due",nowStr);
  await log("CRON_REMINDER",`r1=${res.reminder1} r2=${res.reminder2} r3=${res.reminder3} esc=${res.escalated} auto=${res.autoapproved}`);
  return res;
}

// ══════════════════════════════════════════════════
// TASK 2: Daily Report
// ══════════════════════════════════════════════════
export async function taskDaily() {
  // Cek toggle — prioritas: cron_jobs JSON > key lama daily_report_enabled
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["daily_report_enabled","cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key, s.value]));
  if (!isCronJobEnabled(togMap, "daily_report_enabled") || togMap["daily_report_enabled"] !== "true") {
    await log("DAILY_REPORT", "Dilewati — Laporan Harian dinonaktifkan via Settings", "INFO");
    return { skipped: true };
  }
  // Indonesia timezone (UTC+7)
  const today = new Date(Date.now() + 7*60*60*1000).toISOString().slice(0,10);
  const [{ data:orders }, { data:invoices }, { data:laporan }, { data:expenses }] = await Promise.all([
    sb.from("orders").select("id,service,status").eq("date",today),
    sb.from("invoices").select("id,total,status").gte("created_at",today+"T00:00:00"),
    sb.from("service_reports").select("id,status").eq("date",today),
    sb.from("expenses").select("amount").gte("date",today).lte("date",today),
  ]);

  const ordArr = orders||[];
  const invArr = invoices||[];
  const lapArr = laporan||[];

  // Service breakdown
  const svcCount = {};
  ordArr.forEach(o => { const s = o.service||"Lainnya"; svcCount[s]=(svcCount[s]||0)+1; });
  const svcOrder = ["Cleaning","Install","Repair","Complain"];
  const svcLines = svcOrder.filter(s=>svcCount[s]).map(s=>`  • ${s}: ${svcCount[s]}`);
  Object.keys(svcCount).filter(s=>!svcOrder.includes(s)).forEach(s=>svcLines.push(`  • ${s}: ${svcCount[s]}`));

  const totalOrders = ordArr.length;
  const done   = ordArr.filter(o=>o.status==="COMPLETED").length;
  const proses = ordArr.filter(o=>["ON_SITE","WORKING"].includes(o.status)).length;

  // Invoice summary
  const invPaid    = invArr.filter(i=>i.status==="PAID");
  const invUnpaid  = invArr.filter(i=>["UNPAID","OVERDUE"].includes(i.status));
  const masuk  = invPaid.reduce((s,i)=>s+(i.total||0),0);
  const pending = invUnpaid.reduce((s,i)=>s+(i.total||0),0);

  // Expenses
  const totalExp = (expenses||[]).reduce((s,e)=>s+(Number(e.amount)||0),0);
  const nett = masuk - totalExp;

  // Report counts
  const lapVerified  = lapArr.filter(r=>r.status==="VERIFIED").length;
  const lapSubmitted = lapArr.filter(r=>r.status==="SUBMITTED").length;

  const tgl = new Date(Date.now()+7*60*60*1000).toLocaleDateString("id-ID",{weekday:"long",year:"numeric",month:"long",day:"numeric"});

  let msg = `📊 *LAPORAN HARIAN ACLEAN*\n${tgl}\n\n`;
  msg += `🔧 *ORDER HARI INI: ${totalOrders}*\n`;
  msg += svcLines.join("\n");
  msg += `\n  ✅ Selesai: ${done} · 🔄 Proses: ${proses}\n\n`;
  msg += `📝 *LAPORAN TEKNISI: ${lapArr.length}*\n`;
  msg += `  • Terverifikasi: ${lapVerified}\n`;
  msg += `  • Submitted: ${lapSubmitted}\n\n`;
  msg += `💳 *INVOICE: ${invArr.length}*\n`;
  msg += `  • Lunas: ${invPaid.length} (${fmt(masuk)})\n`;
  msg += `  • Belum bayar: ${invUnpaid.length} (${fmt(pending)})\n\n`;
  if (totalExp > 0) {
    msg += `💸 *PENGELUARAN: ${fmt(totalExp)}*\n`;
    msg += `📈 Nett Hari Ini: *${fmt(nett)}*\n\n`;
  } else {
    msg += `📈 Pemasukan Hari Ini: *${fmt(masuk)}*\n\n`;
  }
  msg += `_ARA AClean_`;

  const waSent = await sendWA(OWNER_PHONE, msg);
  await log("DAILY_REPORT",`${totalOrders} order, ${lapArr.length} laporan, ${fmt(masuk)} masuk`);
  return { orders:totalOrders, revenue:masuk, laporanCount:lapArr.length, waSent };
}

// ══════════════════════════════════════════════════
// TASK 3: Stock Alert
// ══════════════════════════════════════════════════
export async function taskStock() {
  // Cek toggle — prioritas: cron_jobs JSON > key lama stock_alert_enabled
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["stock_alert_enabled","cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key, s.value]));
  if (!isCronJobEnabled(togMap, "stock_alert_enabled") || togMap["stock_alert_enabled"] !== "true") {
    await log("STOCK_ALERT", "Dilewati — Stok Alert dinonaktifkan via Settings", "INFO");
    return { skipped: true };
  }
  const { data:items } = await sb.from("inventory").select("*").in("status",["CRITICAL","OUT"]);
  if (!items?.length) return { message:"Semua stok aman" };
  const out  = items.filter(i=>i.status==="OUT");
  const crit = items.filter(i=>i.status==="CRITICAL");
  let msg = `⚠️ *ALERT STOK ACLEAN*\n${new Date().toLocaleDateString("id-ID")}\n\n`;
  if (out.length)  { msg+=`🔴 *HABIS (${out.length}):*\n`;  out.forEach(i=>{msg+=`• ${i.name}: 0 ${i.unit}\n`;}); msg+="\n"; }
  if (crit.length) { msg+=`🟠 *KRITIS (${crit.length}):*\n`; crit.forEach(i=>{msg+=`• ${i.name}: ${i.stock} ${i.unit}\n`;}); }
  msg += "\n_Segera restock. — ARA AClean_";
  await sendWA(OWNER_PHONE, msg);
  await log("STOCK_ALERT",`${out.length} habis, ${crit.length} kritis`,"WARNING");
  return { out:out.length, critical:crit.length };
}

// ══════════════════════════════════════════════════
// TASK 10: Servis Reminder — customer >90 hari tidak servis
// ══════════════════════════════════════════════════
export async function taskServisReminder() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["servis_reminder_enabled","cron_jobs","customer_portal_enabled","voucher_winback_enabled","customer_portal_url"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key,s.value]));

  if (!isCronJobEnabled(togMap, "servis_reminder_enabled") || togMap["servis_reminder_enabled"] !== "true") {
    await log("SERVIS_REMINDER","Dilewati — servis_reminder_enabled OFF","INFO");
    return { skipped: true };
  }
  if (togMap["customer_portal_enabled"] !== "true") {
    await log("SERVIS_REMINDER","Dilewati — customer_portal_enabled OFF","INFO");
    return { skipped: true };
  }

  const APP_URL = togMap["customer_portal_url"] || process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  const today = new Date();
  const cutoff = new Date(today.getTime() - 90*24*60*60*1000).toISOString().slice(0,10);

  // Customer dengan last_service < 90 hari lalu, ada phone, aktif
  const { data: customers } = await sb.from("customers")
    .select("id,name,phone,last_service,last_rating_request,last_winback_sent")
    .not("phone","is",null)
    .lt("last_service", cutoff)
    .not("last_service","is",null)
    .limit(50); // max 50 per run agar tidak spam

  if (!customers?.length) return { sent: 0, reason: "Tidak ada customer yang perlu diingatkan" };

  const todayStr = today.toISOString().slice(0,10);
  let sent = 0, skipped = 0;

  for (const c of customers) {
    // Jangan kirimi yang sudah dapat reminder dalam 30 hari terakhir
    if (c.last_rating_request) {
      const daysSinceReminder = Math.floor((Date.now() - new Date(c.last_rating_request).getTime()) / 86400000);
      if (daysSinceReminder < 30) { skipped++; continue; }
    }

    const daysSince = Math.floor((Date.now() - new Date(c.last_service).getTime()) / 86400000);

    // Get portal token
    const { data: tokRows } = await sb.from("customer_tokens")
      .select("token,expires_at").eq("phone", c.phone).limit(1);
    let token = tokRows?.[0]?.token;
    const tokExpired = tokRows?.[0]?.expires_at && new Date(tokRows[0].expires_at) < new Date();
    if (!token || tokExpired) {
      const { randomBytes } = await import("crypto");
      token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
      if (tokRows?.length > 0) {
        await sb.from("customer_tokens").update({ token, expires_at: expiresAt, customer_name: c.name }).eq("phone", c.phone);
      } else {
        await sb.from("customer_tokens").insert({ phone: c.phone, token, expires_at: expiresAt, customer_name: c.name });
      }
    }

    const lastServiceFmt = new Date(c.last_service).toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"});
    const link = `${APP_URL}/status/${token}`;
    const msg =
      `Halo ${c.name}! 👋\n\n` +
      `AC Anda terakhir dirawat ${daysSince} hari lalu (${lastServiceFmt}).\n\n` +
      `Untuk menjaga performa AC tetap optimal, disarankan cuci AC setiap 3 bulan. ❄️\n\n` +
      `Mau jadwalkan servis berikutnya? Balas pesan ini atau:\n${link}\n\n` +
      `— AClean Service`;

    const ok = await sendWA(c.phone, msg);
    if (ok) {
      sent++;
      // Update last_rating_request agar tidak spam
      await sb.from("customers").update({ last_rating_request: todayStr }).eq("id", c.id);
      await log("SERVIS_REMINDER_SENT", `Reminder → ${c.name} (${daysSince} hari sejak servis terakhir)`, "SUCCESS");

      // Win-back voucher jika customer inactive >180 hari dan fitur aktif
      if (togMap["voucher_winback_enabled"] === "true" && daysSince >= 180) {
        try {
          // Cooldown 30 hari per customer untuk winback
          const lastWinback = c.last_winback_sent;
          if (!lastWinback || Math.floor((Date.now()-new Date(lastWinback).getTime())/86400000) >= 30) {
            const { randomBytes } = await import("crypto");
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            const wbCode = "ACL-" + Array.from(randomBytes(6)).map(b => chars[b % chars.length]).join("");
            const expiresAt = new Date(Date.now() + 60*24*60*60*1000).toISOString().slice(0,10);
            const { error: wbErr } = await sb.from("customer_vouchers").insert({
              phone: c.phone, customer_name: c.name,
              code: wbCode, type: "discount_pct", value: 10,
              description: "Diskon 10% spesial — kami kangen Anda! Gunakan saat servis berikutnya.",
              expires_at: expiresAt, trigger: "winback", is_valid: true,
            });
            if (!wbErr) {
              const wbMsg =
                `Halo ${c.name}! 💙\n\n` +
                `Sudah lama tidak berjumpa — kami kangen pelanggan setia kami!\n\n` +
                `Sebagai tanda rindu, kami siapkan voucher spesial untuk Anda:\n\n` +
                `🎁 *Diskon 10%* untuk servis berikutnya\n` +
                `Kode: *${wbCode}*\n` +
                `Berlaku hingga: ${expiresAt}\n\n` +
                `Sebutkan kode ini saat booking. Kami siap melayani! ❄️\n— AClean Service`;
              await sendWA(c.phone, wbMsg);
              await sb.from("customers").update({ last_winback_sent: todayStr }).eq("id", c.id);
              await log("WINBACK_VOUCHER", `Win-back ${wbCode} → ${c.name} (${daysSince} hari inactive)`, "SUCCESS");
            }
          }
        } catch(e) { /* winback opsional — tidak blok */ }
      }
    } else skipped++;
  }

  return { sent, skipped };
}

// ══════════════════════════════════════════════════
// TASK 11: Voucher Expiry Reminder — H-3 sebelum expired
// ══════════════════════════════════════════════════
export async function taskVoucherExpiryReminder() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["voucher_expiry_reminder_enabled","cron_jobs","customer_portal_enabled","customer_portal_url"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key,s.value]));

  if (!isCronJobEnabled(togMap, "voucher_expiry_reminder_enabled") || togMap["voucher_expiry_reminder_enabled"] !== "true") {
    await log("VOUCHER_EXPIRY","Dilewati — voucher_expiry_reminder_enabled OFF","INFO");
    return { skipped: true };
  }

  const APP_URL = togMap["customer_portal_url"] || process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  const today = new Date();
  const in3days = new Date(today.getTime() + 3*24*60*60*1000).toISOString().slice(0,10);
  const todayStr = today.toISOString().slice(0,10);

  // Cari voucher: expires dalam 3 hari, belum diklaim, valid, reminder belum dikirim
  const { data: vouchers } = await sb.from("customer_vouchers")
    .select("id,phone,customer_name,code,type,value,expires_at")
    .is("claimed_at", null)
    .eq("is_valid", true)
    .eq("reminder_sent", false)
    .gte("expires_at", todayStr)
    .lte("expires_at", in3days)
    .limit(100);

  if (!vouchers?.length) return { sent: 0, reason: "Tidak ada voucher yang akan expired dalam 3 hari" };

  let sent = 0;
  for (const v of vouchers) {
    if (!v.phone) continue;

    const typeLabel = v.type === "discount_pct" ? `Diskon ${v.value}%`
      : v.type === "free_unit" ? `${v.value} Unit Cuci Gratis`
      : "Voucher Servis";

    // Get portal token untuk link
    const { data: tokRows } = await sb.from("customer_tokens")
      .select("token").eq("phone", v.phone).limit(1);
    const token = tokRows?.[0]?.token;
    const portalLine = token
      ? `\n\nLihat voucher di portal Anda:\n${APP_URL}/status/${token}`
      : "";

    const msg =
      `Halo ${v.customer_name || "Pelanggan"}! ⏰\n\n` +
      `Voucher Anda *${typeLabel}* (kode: *${v.code}*) akan habis masa berlakunya pada *${v.expires_at}*.\n\n` +
      `Segera gunakan sebelum expired! Sebutkan kode ini saat booking.${portalLine}\n\n` +
      `— AClean Service`;

    const ok = await sendWA(v.phone, msg);
    if (ok) {
      sent++;
      await sb.from("customer_vouchers").update({ reminder_sent: true }).eq("id", v.id);
      await log("VOUCHER_EXPIRY_SENT", `Reminder → ${v.customer_name} kode ${v.code} exp ${v.expires_at}`, "SUCCESS");
    }
  }

  return { sent, total: vouchers.length };
}

// ══════════════════════════════════════════════════
// TASK 12: Laporan Stale Alert — Notif owner jika laporan >3 hari belum diverifikasi
// ══════════════════════════════════════════════════
export async function taskLaporanStaleAlert() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["laporan_stale_alert_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "laporan_stale_alert_enabled") || togMap["laporan_stale_alert_enabled"] !== "true") {
    await log("LAPORAN_STALE", "Dilewati — laporan_stale_alert_enabled OFF", "INFO");
    return { skipped: true };
  }

  // Cari laporan yang submitted > 3 hari lalu dan belum diverifikasi
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await sb
    .from("service_reports")
    .select("id,job_id,teknisi,customer,date,submitted_at,status")
    .in("status", ["SUBMITTED", "REVISION"])
    .lte("submitted_at", threeDaysAgo)
    .order("submitted_at", { ascending: true })
    .limit(50);

  if (!stale?.length) {
    await log("LAPORAN_STALE", "Tidak ada laporan tertunda >3 hari", "INFO");
    return { checked: true, staleCount: 0 };
  }

  const tgl = new Date(Date.now() + 7 * 60 * 60 * 1000).toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let msg = `⚠️ *LAPORAN BELUM DIVERIFIKASI*\n${tgl}\n\n`;
  msg += `${stale.length} laporan sudah lebih dari 3 hari belum diverifikasi:\n\n`;

  stale.forEach((r, i) => {
    const submittedDate = r.submitted_at
      ? new Date(r.submitted_at).toLocaleDateString("id-ID")
      : (r.date || "?");
    const hariLewat = r.submitted_at
      ? Math.floor((Date.now() - new Date(r.submitted_at).getTime()) / (1000 * 60 * 60 * 24))
      : "?";
    msg += `${i + 1}. *${r.teknisi || "?"}* — ${r.customer || "?"}\n`;
    msg += `   Job: ${r.job_id} · Submit: ${submittedDate} (${hariLewat} hari)\n`;
    if (r.status === "REVISION") msg += `   Status: 🔄 Perlu Revisi dari teknisi\n`;
    msg += `\n`;
  });

  msg += `_Segera verifikasi di menu Laporan Tim. — ARA AClean_`;

  const waSent = await sendWA(OWNER_PHONE, msg);
  await log("LAPORAN_STALE", `Alert: ${stale.length} laporan tertunda >3 hari`, waSent ? "SUCCESS" : "WARNING");
  return { staleCount: stale.length, waSent };
}

// TASK: Reminder Material Pulang — 22:00 WIB (15:00 UTC)
// Teknisi yang pagi-nya catat material tapi belum input "pulang" → WA ke teknisi + helper job-nya.
// ══════════════════════════════════════════════════
export async function taskMaterialPulangReminder() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["material_pulang_reminder_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "material_pulang_reminder_enabled") || togMap["material_pulang_reminder_enabled"] !== "true") {
    await log("MATERIAL_PULANG_REMINDER", "Dilewati — material_pulang_reminder_enabled OFF", "INFO");
    return { skipped: true };
  }
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: rows } = await sb.from("teknisi_material_checkout")
    .select("id,teknisi_name,session_type,pulang_reminder_sent").eq("checkout_date", today);
  const byTek = {};
  for (const r of rows || []) {
    const t = (byTek[r.teknisi_name] ||= { name: r.teknisi_name });
    if (r.session_type === "pagi") t.pagi = r; else t.pulang = r;
  }
  // pagi ada, pulang belum, dan belum pernah di-reminder
  const need = Object.values(byTek).filter(t => t.pagi && !t.pulang && !t.pagi.pulang_reminder_sent);
  if (!need.length) {
    await log("MATERIAL_PULANG_REMINDER", "Tidak ada teknisi yang belum konfirmasi pulang", "INFO");
    return { checked: true, reminded: 0 };
  }
  const { data: profs } = await sb.from("user_profiles").select("name,phone");
  const phoneByName = Object.fromEntries((profs || []).filter(p => p.phone).map(p => [p.name, p.phone]));
  const { data: ords } = await sb.from("orders").select("teknisi,helper,teknisi2,helper2,teknisi3,helper3").eq("date", today);
  const msg = `🌙 *Belum Konfirmasi Material Pulang*\nMaterial yang dibawa hari ini (${today}) belum dicatat pengembaliannya.\n\nMohon segera isi *Material Pulang* di app (menu Material Harian) agar stok bisa dicocokkan & dikonfirmasi. — AClean`;
  let waCount = 0;
  for (const t of need) {
    const targets = new Set([t.name]);
    for (const o of ords || []) {
      const slots = [o.teknisi, o.helper, o.teknisi2, o.helper2, o.teknisi3, o.helper3];
      if (slots.includes(t.name)) slots.forEach(n => { if (n) targets.add(n); });
    }
    for (const name of targets) {
      const ph = phoneByName[name];
      if (ph) { const ok = await sendWA(ph, msg); if (ok) waCount++; }
    }
    if (t.pagi?.id) await sb.from("teknisi_material_checkout").update({ pulang_reminder_sent: true }).eq("id", t.pagi.id);
  }
  if (OWNER_PHONE) await sendWA(OWNER_PHONE, `🌙 Reminder Material Pulang: ${need.length} teknisi belum konfirmasi (${today}). WA terkirim: ${waCount}.`);
  await log("MATERIAL_PULANG_REMINDER", `Reminded ${need.length} teknisi, ${waCount} WA`, "SUCCESS");
  return { reminded: need.length, waCount };
}

// TASK 8: Weekly Report — Minggu 09:00 WIB (02:00 UTC)
// Ringkasan 7 hari terakhir: order, revenue, laporan, top teknisi
// ══════════════════════════════════════════════════
export async function taskWeeklyReport() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["weekly_report_enabled","cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key, s.value]));
  if (!isCronJobEnabled(togMap, "weekly_report_enabled") || togMap["weekly_report_enabled"] !== "true") {
    await log("WEEKLY_REPORT", "Dilewati — Laporan Mingguan dinonaktifkan via Settings", "INFO");
    return { skipped: true };
  }

  const nowWib = new Date(Date.now() + 7*60*60*1000);
  const todayStr = nowWib.toISOString().slice(0,10);
  const weekAgo = new Date(nowWib.getTime() - 7*24*60*60*1000).toISOString().slice(0,10);

  const [{ data: orders }, { data: invoices }, { data: expenses }] = await Promise.all([
    sb.from("orders").select("id,service,status,teknisi,date").gte("date", weekAgo).lte("date", todayStr),
    sb.from("invoices").select("id,total,status,teknisi").gte("created_at", weekAgo+"T00:00:00").lte("created_at", todayStr+"T23:59:59"),
    sb.from("expenses").select("amount,category").gte("date", weekAgo).lte("date", todayStr),
  ]);

  const ordArr = orders||[];
  const invArr = invoices||[];
  const expArr = expenses||[];

  const totalOrders = ordArr.length;
  const completed   = ordArr.filter(o=>o.status==="COMPLETED").length;

  // Service breakdown
  const svcCount = {};
  ordArr.forEach(o => { const s = o.service||"Lainnya"; svcCount[s]=(svcCount[s]||0)+1; });
  const svcOrder = ["Cleaning","Install","Repair","Complain"];
  const svcLines = svcOrder.filter(s=>svcCount[s]).map(s=>`  • ${s}: ${svcCount[s]}`);
  Object.keys(svcCount).filter(s=>!svcOrder.includes(s)).forEach(s=>svcLines.push(`  • ${s}: ${svcCount[s]}`));

  // Revenue
  const paid    = invArr.filter(i=>i.status==="PAID");
  const unpaid  = invArr.filter(i=>["UNPAID","OVERDUE"].includes(i.status));
  const revenue = paid.reduce((s,i)=>s+(i.total||0),0);
  const pending = unpaid.reduce((s,i)=>s+(i.total||0),0);

  // Expenses
  const totalExp = expArr.reduce((s,e)=>s+(Number(e.amount)||0),0);
  const nett = revenue - totalExp;

  // Top teknisi by order count
  const tekCount = {};
  ordArr.filter(o=>o.teknisi).forEach(o => { tekCount[o.teknisi]=(tekCount[o.teknisi]||0)+1; });
  const topTek = Object.entries(tekCount).sort((a,b)=>b[1]-a[1]).slice(0,3);

  const tglRange = `${new Date(weekAgo+"T00:00:00+07:00").toLocaleDateString("id-ID",{day:"numeric",month:"short"})} – ${nowWib.toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"})}`;

  let msg = `📅 *LAPORAN MINGGUAN ACLEAN*\n${tglRange}\n\n`;
  msg += `🔧 *ORDER: ${totalOrders}* (selesai: ${completed})\n`;
  msg += svcLines.join("\n") + "\n\n";
  msg += `💳 *INVOICE: ${invArr.length}*\n`;
  msg += `  • Lunas: ${paid.length} (${fmt(revenue)})\n`;
  msg += `  • Belum bayar: ${unpaid.length} (${fmt(pending)})\n\n`;
  if (totalExp > 0) {
    msg += `💸 *PENGELUARAN: ${fmt(totalExp)}*\n`;
    msg += `📈 Nett Minggu Ini: *${fmt(nett)}*\n\n`;
  } else {
    msg += `📈 Pemasukan Minggu Ini: *${fmt(revenue)}*\n\n`;
  }
  if (topTek.length > 0) {
    msg += `🏆 *TOP TEKNISI:*\n`;
    topTek.forEach(([name, count], i) => { msg += `  ${i+1}. ${name}: ${count} order\n`; });
    msg += "\n";
  }
  msg += `_ARA AClean_`;

  const waSent = await sendWA(OWNER_PHONE, msg);
  await log("WEEKLY_REPORT", `${totalOrders} order | rev ${fmt(revenue)} | exp ${fmt(totalExp)}`, "SUCCESS");
  return { orders: totalOrders, revenue, expenses: totalExp, nett, waSent };
}

// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// TASK: Morning Dispatch — kirim WA konfirmasi + link portal ke customer hari ini (09:30 WIB)
// Hanya order yang punya teknisi + phone customer + belum dapat WA (portal_wa_sent_at IS NULL)
// ══════════════════════════════════════════════════
export async function taskMorningDispatch() {
  const { data: togData } = await sb.from("app_settings").select("key,value")
    .in("key", ["morning_dispatch_enabled", "cron_jobs", "customer_portal_enabled", "customer_portal_url"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));

  if (!isCronJobEnabled(togMap, "morning_dispatch_enabled") || togMap["morning_dispatch_enabled"] !== "true") {
    await log("MORNING_DISPATCH", "Dilewati — morning_dispatch_enabled OFF", "INFO");
    return { skipped: true };
  }
  if (togMap["customer_portal_enabled"] !== "true") {
    await log("MORNING_DISPATCH", "Dilewati — customer_portal_enabled OFF", "INFO");
    return { skipped: true };
  }

  const APP_URL = togMap["customer_portal_url"] || process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD WIB

  // Ambil order hari ini: ada teknisi, ada phone, belum dapat portal WA
  // maintenance_client_id disertakan untuk kirim link portal B2B yang berbeda
  const { data: orders } = await sb.from("orders")
    .select("id,customer,phone,service,date,time,teknisi,helper,address,maintenance_client_id")
    .eq("date", today)
    .not("teknisi", "is", null)
    .not("phone", "is", null)
    .is("portal_wa_sent_at", null)
    .not("status", "in", "(CANCELLED,REJECTED)")
    .limit(100);

  if (!orders?.length) return { sent: 0, reason: "Tidak ada order hari ini yang perlu dispatch WA" };

  // Cache maintenance clients yang dibutuhkan (batch lookup untuk efisiensi)
  const mcIds = [...new Set(orders.map(o => o.maintenance_client_id).filter(Boolean))];
  const mcMap = {};
  if (mcIds.length > 0) {
    const { data: mcRows } = await sb.from("maintenance_clients")
      .select("id,name,portal_token,token_active")
      .in("id", mcIds);
    (mcRows || []).forEach(mc => { mcMap[mc.id] = mc; });
  }

  let sent = 0, failed = 0;
  for (const order of orders) {
    try {
      // ── Tentukan link portal: B2B (permanen) atau reguler (30 hari) ──
      const mc = order.maintenance_client_id ? mcMap[order.maintenance_client_id] : null;
      const isMaintenance = !!(mc?.portal_token && mc.token_active);

      let link, isMaintenanceLink = false;
      if (isMaintenance) {
        // B2B selalu pakai status.aclean.id — dedicated maintenance domain, tidak bergantung APP_URL setting
        link = `https://status.aclean.id/status/${mc.portal_token}`;
        isMaintenanceLink = true;
      } else {
        // Generate / refresh customer token reguler
        const { data: tokRows } = await sb.from("customer_tokens")
          .select("token,expires_at").eq("phone", order.phone).limit(1);
        let token = tokRows?.[0]?.token;
        const tokExpired = tokRows?.[0]?.expires_at && new Date(tokRows[0].expires_at) < new Date();
        if (!token || tokExpired) {
          const { randomBytes } = await import("crypto");
          token = randomBytes(24).toString("hex");
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          if (tokRows?.length > 0) {
            await sb.from("customer_tokens").update({ token, expires_at: expiresAt, customer_name: order.customer }).eq("phone", order.phone);
          } else {
            await sb.from("customer_tokens").insert({ phone: order.phone, token, expires_at: expiresAt, customer_name: order.customer });
          }
        }
        link = `${APP_URL}/status/${token}`;
      }

      const tgl = new Date(order.date).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
      const team = [order.teknisi, order.helper].filter(Boolean).join(" & ");
      const msg = isMaintenanceLink
        ? `Halo ${order.customer}! 👋\n` +
          `Konfirmasi Jadwal Maintenance Aset AC Anda 😊\n` +
          `Tim AClean sedang menuju lokasi Anda sekarang 🚗\n\n` +
          `📋 Detail Servis:\n` +
          `• Layanan  : ${order.service}\n` +
          `• Jadwal   : ${tgl} · ${order.time || "--:--"}\n` +
          `• Tim      : ${team}\n` +
          `• Lokasi   : ${order.address || "-"}\n\n` +
          `🔗 Portal Maintenance Aset AC Anda:\n${link}\n\n` +
          `Akses laporan, history, dan status aset AC Perusahaan Anda secara lengkap. Jika Ada Pertanyaan? Balas pesan ini.\n— AClean Service`
        : `Halo ${order.customer}! 👋\n` +
          `Ini adalah Pesan Otomatis Konfirmasi Pesanan Anda 😊\n` +
          `Tim AClean sedang menuju lokasi Anda sekarang 🚗\n\n` +
          `📋 Detail Servis:\n` +
          `• Layanan  : ${order.service}\n` +
          `• Jadwal   : ${tgl} · ${order.time || "--:--"}\n` +
          `• Tim      : ${team}\n` +
          `• Lokasi   : ${order.address || "-"}\n\n` +
          `🔗 Pantau status tim secara langsung:\n${link}\n\n` +
          `Link aktif 30 hari sejak Pemesanan Anda. Detail Service, Pembayaran, Complain dan History Pengerjaan Di Lokasi. Jika Ada Pertanyaan? Balas pesan ini.\n— AClean Service`;

      const ok = await sendWA(order.phone, msg);
      if (ok) {
        // Tandai sudah dikirim agar tidak dobel
        await sb.from("orders").update({ portal_wa_sent_at: new Date().toISOString() }).eq("id", order.id);
        sent++;
        const tag = isMaintenanceLink ? "[B2B]" : "[REG]";
        await log("MORNING_DISPATCH_SENT", `WA dispatch ${tag} → ${order.customer} (${order.id})`, "SUCCESS");
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      await log("MORNING_DISPATCH_ERR", `Gagal dispatch → ${order.id}: ${e.message}`, "ERROR");
    }
  }

  return { sent, failed, total: orders.length };
}

// TASK 9: Rating Prompt H+1 — cek order COMPLETED kemarin, kirim WA minta rating
// ══════════════════════════════════════════════════
export async function taskRatingPrompt() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["rating_prompt_enabled","cron_jobs","customer_portal_enabled","voucher_loyalty_enabled","customer_portal_url"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key,s.value]));

  if (!isCronJobEnabled(togMap, "rating_prompt_enabled") || togMap["rating_prompt_enabled"] !== "true") {
    await log("RATING_PROMPT","Dilewati — rating_prompt_enabled OFF","INFO");
    return { skipped: true };
  }
  if (togMap["customer_portal_enabled"] !== "true") {
    await log("RATING_PROMPT","Dilewati — customer_portal_enabled OFF","INFO");
    return { skipped: true };
  }

  const APP_URL = togMap["customer_portal_url"] || process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);

  // Order COMPLETED/INVOICE_APPROVED kemarin, ada phone, belum dapat rating
  const { data: orders } = await sb.from("orders")
    .select("id,customer,phone,service,teknisi,date")
    .eq("date", yesterday)
    .in("status",["COMPLETED","INVOICE_APPROVED"])
    .not("phone","is",null);

  if (!orders?.length) return { sent: 0, reason: "Tidak ada order selesai kemarin" };

  // Ambil order_id yang sudah punya rating
  const orderIds = orders.map(o => o.id);
  const { data: existing } = await sb.from("customer_feedback").select("order_id").in("order_id", orderIds);
  const ratedSet = new Set((existing||[]).map(r => r.order_id));

  let sent = 0, skipped = 0;
  for (const o of orders) {
    if (ratedSet.has(o.id) || !o.phone) { skipped++; continue; }

    // Get atau buat portal token
    const { data: tokRows } = await sb.from("customer_tokens")
      .select("token,expires_at").eq("phone", o.phone).limit(1);

    let token = tokRows?.[0]?.token;
    const tokExpired = tokRows?.[0]?.expires_at && new Date(tokRows[0].expires_at) < new Date();
    // Buat token baru jika belum ada atau sudah expired
    if (!token || tokExpired) {
      const { randomBytes } = await import("crypto");
      token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
      if (tokRows?.length > 0) {
        // Update token yang expired
        await sb.from("customer_tokens").update({ token, expires_at: expiresAt, customer_name: o.customer }).eq("phone", o.phone);
      } else {
        await sb.from("customer_tokens").insert({ phone: o.phone, token, expires_at: expiresAt, customer_name: o.customer });
      }
    }

    const link = `${APP_URL}/status/${token}#rating`;
    const msg =
      `Halo ${o.customer}! 😊\n\n` +
      `Terima kasih telah mempercayakan servis AC ke AClean.\n\n` +
      `Bagaimana pengalaman servis Anda kemarin?\n` +
      `⭐ Beri rating di sini (5 detik):\n${link}\n\n` +
      `Masukan Anda sangat berarti untuk kami 🙏\n— AClean Service`;

    const ok = await sendWA(o.phone, msg);
    if (ok) { sent++; await log("RATING_PROMPT_SENT", `Rating WA → ${o.customer} (${o.phone}) job ${o.id}`, "SUCCESS"); }
    else skipped++;

    // Phase 3B — cek milestone voucher jika fitur aktif
    if (togMap["voucher_loyalty_enabled"] === "true") {
      try {
        const { count } = await sb.from("orders")
          .select("id", { count: "exact", head: true })
          .eq("phone", o.phone)
          .in("status",["COMPLETED","INVOICE_APPROVED"]);

        const MILESTONES = [
          { at: 2,  type: "discount_pct", value: 5,  desc: "Diskon 5% untuk servis berikutnya — terima kasih sudah kembali!" },
          { at: 5,  type: "discount_pct", value: 10, desc: "Diskon 10% untuk servis berikutnya — pelanggan setia ke-5 kali!" },
          { at: 10, type: "free_unit",    value: 1,  desc: "1 unit cuci AC GRATIS — terima kasih sudah setia 10 kali servis!" },
          { at: 15, type: "discount_pct", value: 15, desc: "Diskon 15% untuk servis berikutnya — VIP Member 15x servis!" },
        ];

        const milestone = MILESTONES.find(m => m.at === count);
        if (milestone) {
          const { randomBytes } = await import("crypto");
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          const code = "ACL-" + Array.from(randomBytes(6)).map(b => chars[b % chars.length]).join("");
          const expiresAt = new Date(Date.now() + 90*24*60*60*1000).toISOString().slice(0,10);
          const { error: insErr } = await sb.from("customer_vouchers").insert({
            phone: o.phone, customer_name: o.customer,
            code, type: milestone.type, value: milestone.value,
            description: milestone.desc, expires_at: expiresAt,
            trigger: "milestone", milestone_at: milestone.at, is_valid: true,
          });
          if (!insErr) {
            const voucherMsg =
              `🎁 *Voucher Spesial untuk ${o.customer}!*\n\n` +
              `${milestone.desc}\n\n` +
              `Kode voucher Anda: *${code}*\n` +
              `Berlaku hingga: ${expiresAt}\n\n` +
              `Lihat voucher di portal: ${APP_URL}/status/${token}\n\n` +
              `Sebutkan kode ini saat booking berikutnya 😊\n— AClean Service`;
            await sendWA(o.phone, voucherMsg);
            await log("VOUCHER_CREATED", `Voucher ${code} → ${o.customer} (milestone ${milestone.at}x)`, "SUCCESS");
          }
        }
      } catch(e) { /* voucher opsional — tidak blok */ }
    }
  }

  return { sent, skipped };
}

