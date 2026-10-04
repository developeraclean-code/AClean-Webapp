import { samePhone } from "./phone.js";
import { invoiceBalance } from "./waWorkspace.js";
export const WA_STATES = { NEEDS_REPLY: "Perlu dibalas", WAITING_CUSTOMER: "Menunggu pelanggan", WAITING_SCHEDULE: "Menunggu jadwal", PAYMENT_REVIEW: "Periksa pembayaran", DONE: "Selesai" };
export const SEND_STATES = { SENDING: "Sedang diproses · jangan kirim ulang", ACCEPTED: "Diterima gateway", FAILED: "Ditolak / gagal", UNCERTAIN: "Status belum pasti · periksa WhatsApp" };
export const jakartaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
export const toJakartaInput = iso => iso ? new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0,16) : "";
export const fromJakartaInput = text => text ? new Date(`${text}:00+07:00`).toISOString() : null;
export const isDue = row => row?.status !== "DONE" && row?.due_at && Date.parse(row.due_at) <= Date.now();
export function allocatePayment(invoices, amount) {
  let left = Number(amount);
  if (!Number.isFinite(left) || left <= 0) return [];
  return [...invoices].sort((a,b) => String(a.due || a.created_at || a.id).localeCompare(String(b.due || b.created_at || b.id))).flatMap(inv => {
    const used = Math.min(left, invoiceBalance(inv)); left -= used;
    return used > 0 ? [{ invoice_id: inv.id, amount: used }] : [];
  });
}
export function paymentCandidates(invoices, suggestion) {
  return invoices.filter(i => samePhone(i.phone,suggestion.phone) && invoiceBalance(i)>0)
    .sort((a,b) => (Number(b.id===suggestion.invoice_id)*10 + Number(invoiceBalance(b)===Number(suggestion.amount))) - (Number(a.id===suggestion.invoice_id)*10 + Number(invoiceBalance(a)===Number(suggestion.amount))));
}
const mins = time => { const m = /^(\d{2}):(\d{2})/.exec(time || ""); return m && Number(m[1])<24 && Number(m[2])<60 ? Number(m[1])*60+Number(m[2]) : NaN; };
const stamp = n => `${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`;
export function suggestWaSlots({ date, service, units, technicians, orders, absences, duration, now = new Date() }) {
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || date < today || !Number.isInteger(Number(units)) || Number(units)<1 || Number(units)>100) return [];
  const length = Math.ceil(Number(duration(service,units))*60);
  if (!Number.isFinite(length) || length<=0 || length>540) return [];
  const currentMinute = mins(now.toLocaleTimeString("en-GB",{timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit"}));
  return technicians.filter(t => t.role === "Teknisi" && t.active !== false && !["INACTIVE","NONAKTIF"].includes(String(t.status).toUpperCase())).flatMap(t => {
    if (absences.some(a => a.date===date && a.teknisi===t.name && (a.is_available===false || ["IJIN","SAKIT","ALPA","OFF"].includes(a.status)))) return [];
    const jobs=orders.filter(o => o.date===date && !["CANCELLED","PAID","COMPLETED"].includes(o.status) && [o.teknisi,o.helper,o.teknisi2,o.helper2,o.teknisi3,o.helper3].includes(t.name));
    if(jobs.length>=6) return [];
    const slots=[];
    for(let start=540;start+length<=1080;start+=30){
      if(date===today && start<=currentMinute) continue;
      if(jobs.some(o => { const a=mins(o.time), b=mins(o.time_end); const end=Number.isFinite(b)?b:a+Math.ceil(duration(o.service,o.units)*60); return !Number.isFinite(a)||!Number.isFinite(end)||end<=a||(start<end && start+length>a); })) continue;
      slots.push({ teknisi:t.name,date,time:stamp(start),end:stamp(start+length),jobs:jobs.length });
      if(slots.length===2) break;
    }
    return slots;
  }).sort((a,b)=>a.jobs-b.jobs || a.time.localeCompare(b.time)).slice(0,6);
}
export async function loadWaDay(db,date) {
  const results=await Promise.all([
    db.from("orders").select("id,date,time,time_end,status,service,units,teknisi,helper,teknisi2,helper2,teknisi3,helper3").eq("date",date).limit(1000),
    db.from("technician_availability").select("teknisi,date,status,is_available").eq("date",date).limit(1000),
  ]);
  for(const r of results) if(r.error || r.data?.length>=1000) throw new Error(r.error?.message || "Jadwal terlalu banyak; periksa di halaman Jadwal");
  return { orders:results[0].data || [], absences:results[1].data || [] };
}
export function serviceFollowup(orders, history, customerId, now = new Date(), legacyContact = null) {
  const done=orders.filter(o=>["COMPLETED","PAID"].includes(o.status) && /clean|maintenance/i.test(o.service || "") && o.date)
    .sort((a,b)=>b.date.localeCompare(a.date))[0];
  const contacts=history.filter(h=>h.kind==="SERVICE_REMINDER" && h.customer_id===String(customerId)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const blocked=contacts.find(h=>["ACCEPTED","UNCERTAIN","SENDING"].includes(h.status) && now-new Date(h.created_at)<30*86400000);
  const legacyBlocked=!!legacyContact && now-new Date(`${legacyContact}T00:00:00+07:00`)<30*86400000;
  const active=orders.some(o=>["PENDING","CONFIRMED","DISPATCHED","ON_SITE","IN_PROGRESS"].includes(o.status));
  const due=done ? new Date(new Date(`${done.date}T00:00:00+07:00`).getTime()+90*86400000) : null;
  return { last:done?.date || null, due, eligible:!!due && due<=now && !blocked && !legacyBlocked && !active, blocked, legacyBlocked, active, contacts };
}
