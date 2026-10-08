import React, { useState } from "react";
import { invoiceBalance } from "../../src/lib/waWorkspace.js";
import WaPanel from "../../src/views/WaPanel.jsx";
import SchedulePlanModal from "../../src/views/SchedulePlanModal.jsx";
import TeamScheduleBoard from "../../src/views/TeamScheduleBoard.jsx";
import { planningWeek, planningWeekOffset, planSnapshot } from "../../src/lib/teamPlanning.js";
import { getLocalDate, shiftDateStr } from "../../src/lib/dateTime.js";
import { buildOrderTeamAssignment } from "../../src/lib/teamAssignment.js";
import { rosterMembers, planConflict } from "../../src/lib/teamPlanning.js";
import OrderInboxView from "../../src/views/OrderInboxView.jsx";
import { AppContext } from "../../src/context/AppContext.js";

const phones = ["6281234567890", "6281234567891", "6281234567892"];
const conversations = [
  { id: "c1", name: "Andi", phone: phones[0], unread: 3, last_message: "Bisa dijadwalkan hari Senin?", updated_at: "2026-10-04T09:15:00Z" },
  { id: "c2", name: "Maya", phone: phones[1], unread: 1, last_message: "Terima kasih, AClean", updated_at: "2026-10-04T08:10:00Z" },
  { id: "c3", name: "Kontak baru", phone: phones[2], unread: 0, last_message: "Mau tanya jasa cuci AC", updated_at: "2026-10-04T07:00:00Z" },
];
const customers = [
  { id: "a", name: "Bapak Andi Rumah", phone: phones[0], address: "Jl. Melati 12, Tangerang", area: "Serpong", is_vip: true },
  { id: "b", name: "Bapak Andi Kantor", phone: phones[0], address: "Ruko Melati 8" },
  { id: "c", name: "Ibu Maya", phone: phones[1], address: "Jl. Anggrek 5", area: "BSD" },
];
const messages = {
  [phones[0]]: [
    { id: 1, phone: phones[0], name: "Andi", role: "customer", content: "Halo kak, saya ingin cuci AC lagi untuk di rumah.", created_at: "2026-10-04T09:10:00Z" },
    { id: 2, phone: phones[0], name: "Dedy", role: "admin", content: "Halo Pak Andi, tentu bisa. Untuk 3 unit seperti servis sebelumnya ya, Pak?", created_at: "2026-10-04T09:12:00Z" },
    { id: 3, phone: phones[0], name: "Andi", role: "customer", content: "Iya kak, 3 unit. Bisa dijadwalkan hari Senin?", created_at: "2026-10-04T09:15:00Z" },
  ],
  [phones[1]]: [{ id: 4, phone: phones[1], role: "customer", content: "Pesan khusus Maya", created_at: "2026-10-04T08:10:00Z" }],
  [phones[2]]: [],
};
const demoOrders = [
      { id: "JOB-101", customer_id: "a", customer: customers[0].name, phone: phones[0], service: "Cleaning", units: 3, status: "CONFIRMED", date: "2026-10-05", time: "09:00", teknisi: "Tim Rian" },
      { id: "JOB-100", customer_id: "a", customer: customers[0].name, phone: phones[0], service: "Cleaning", units: 3, status: "PAID", date: "2026-07-05", time: "10:00" },
    ];
demoOrders.push({id:"JOB-MAYA",customer_id:"c",customer:customers[2].name,phone:phones[1],service:"Cleaning",units:2,status:"PAID",date:"2026-01-01"});
const demoToday = getLocalDate();
const presets = Array.from({length:8},(_,i)=>({slot:`Team ${String(i+1).padStart(2,'0')}`,teknisi:i===1?"Rey":"",sort_order:i}));
const rosters = [
  {date:shiftDateStr(demoToday,1),slot:"Team 01",member1:"Rian",member1_role:"teknisi",member2:"Danu",member2_role:"helper"},
  {date:shiftDateStr(demoToday,2),slot:"Team 01",member1:"Budi",member1_role:"teknisi",member2:"Sari",member2_role:"helper"},
];
const absences=[{date:shiftDateStr(demoToday,2),teknisi:"Budi",status:"SAKIT",is_available:false}];
demoOrders.push({id:"JOB-TEAM-A",customer_id:"extra-a",customer:"Ibu Ratna",phone:phones[1],address:"De Park BSD City, Tangerang Selatan",date:shiftDateStr(demoToday,1),time:"09:00",time_end:"11:00",service:"Cleaning",units:2,status:"CONFIRMED",team_slot:"Team 01",teknisi:"Rian",helper:"Danu"},
  {id:"JOB-TEAM-B",customer_id:"extra-b",customer:"Bapak Hendra",phone:phones[0],area:"Graha Raya",address:"Graha Raya Bintaro",date:shiftDateStr(demoToday,2),time:"10:00",time_end:"12:00",service:"Cleaning",units:2,status:"CONFIRMED",team_slot:"Team 01",teknisi:"Budi",helper:"Sari"});
const planReceipts = new Map();
let demoInvoices = [
      { id: "INV-RUMAH", customer: customers[0].name, phone: phones[0], status: "PARTIAL_PAID", total: 500000, paid_amount: 200000, due: "2026-10-08", service: "Cleaning" },
      { id: "INV-KANTOR", customer: customers[1].name, phone: phones[0], status: "UNPAID", total: 900000 },
    ];
const demoProofs = [{id:"p1",phone:phones[0],status:"PENDING",amount:200000,bank:"BCA"},{id:"p2",phone:phones[0],status:"PENDING",amount:600000,bank:"Mandiri"}];
const followups = new Map(), outbox = new Map(), receipts = new Map();
window.waTest = { sendResult: true, sendDelay: 0, delays: {}, calls: [], historyError: false, sendUncertain: false, paymentError: false, scheduleError: false, followupConflict: false };
window.waTest.proofs = demoProofs;
window.waTest.invoices = demoInvoices;
window.waTest.customers = customers;
window.waTest.conversations = conversations;
window.waTest.presets = presets;
window.waTest.rosters = rosters;
window.waTest.absences = absences;
window.waTest.orders = demoOrders;
const mockSend = async payload => {
  if(outbox.has(payload.id))return outbox.get(payload.id);
  const row={...payload,status:"SENDING",actor:"Dedy",created_at:new Date().toISOString()};outbox.set(payload.id,row);
  window.waTest.calls.push({type:"send",phone:payload.phone,text:payload.message,kind:payload.kind});
  await new Promise(r=>setTimeout(r,window.waTest.sendDelay));
  row.status=window.waTest.sendUncertain?"UNCERTAIN":window.waTest.sendResult?"ACCEPTED":"FAILED";
  if(row.status==="ACCEPTED")messages[payload.phone].push({id:payload.id,phone:payload.phone,content:payload.message,role:"admin",name:"Dedy",created_at:row.created_at});
  return {...row};
};
const db = {
  async rpc(name,p) {
    window.waTest.calls.push({type:"rpc",name,p});
    if(name==="save_schedule_plan") {
      if(planReceipts.has(p.p_request_id)) return {data:planReceipts.get(p.p_request_id)};
      window.waTest.calls.push({type:"planning-save",row:{...p.p_plan,id:p.p_order_id}});
      if(window.waTest.planningSaveError) return {error:{message:"Database tidak tersedia",code:"P0001"}};
      const existing=demoOrders.find(o=>o.id===p.p_order_id);
      if(existing && JSON.stringify(planSnapshot(existing))!==JSON.stringify(p.p_expected))return {error:{message:"Planning berubah oleh admin lain",code:"40001"}};
      const conflict=planConflict({...p.p_plan,id:p.p_order_id},demoOrders,rosters);
      if(conflict && p.p_plan.status!=="CANCELLED")return {error:{message:conflict,code:"P0001"}};
      const before=existing?{...existing}:null;
      const notes=existing?`${p.p_plan.notes || ""}\n[Planning demo] ${p.p_reason.trim()}`:p.p_plan.notes;
      const row={...existing,...p.p_plan,id:p.p_order_id,team_slot:p.p_plan.team_slot||null,notes,...buildOrderTeamAssignment(rosterMembers(rosters.find(r=>r.date===p.p_plan.date && r.slot===p.p_plan.team_slot))),dispatch:false};
      if(existing)Object.assign(existing,row);else demoOrders.push(row);
      const result={order:row,before};planReceipts.set(p.p_request_id,result);
      if(window.waTest.planningLostResponse)return {error:{message:"Koneksi terputus"}};
      return {data:result};
    }
    if(name==="save_wa_followup") {
      if(window.waTest.followupConflict || (followups.get(p.p_phone)?.version || 0)!==p.p_version)return {error:{message:"Tindak lanjut diubah admin lain. Muat ulang."}};
      const row={phone:p.p_phone,status:p.p_status,due_at:p.p_due_at,assignee:p.p_assignee,note:p.p_note,version:p.p_version+1,updated_by:"Dedy"};followups.set(p.p_phone,row);return {data:row};
    }
    if(name==="apply_wa_payment") {
      if(receipts.has(p.p_id))return {data:receipts.get(p.p_id)};
      if(window.waTest.paymentError)return {error:{message:"Koneksi terputus"}};
      const rows=p.p_allocations.map(a=>{const inv=demoInvoices.find(i=>i.id===a.invoice_id);const left=invoiceBalance(inv)-a.amount;return {...inv,paid_amount:Number(inv.paid_amount||0)+a.amount,remaining_amount:left,status:left===0?"PAID":"PARTIAL_PAID"};});
      demoInvoices=demoInvoices.map(i=>rows.find(r=>r.id===i.id)||i);receipts.set(p.p_id,rows);return {data:rows};
    }
    return {error:{message:"Unknown RPC"}};
  },
  from(table) {
    const q = { mode: "read", phone: null, payload: null, date: null, from: null, to: null,
      select() { return this; }, eq(key, value) { if (key === "phone") this.phone = value; if(key==="date")this.date=value; return this; },
      in(key,values) { if(key==="phone")this.phones=values; return this; }, gte(key,value) { if(key==="date")this.from=value; return this; }, neq() { return this; }, ilike() { return this; }, or() { return this; },
      lte(key,value) { if(key==="date")this.to=value; return this; }, order() { return this; }, limit() { return this; }, single() { return this; },
      range(start,end) { this.pageStart=start;this.pageEnd=end;return this; },
      update(value) { this.mode = "update"; this.payload = value; return this; },
      insert(value) { this.mode = "insert"; this.payload = value; return this; },
      async then(resolve, reject) {
        try {
          if (this.mode === "read" && table === "wa_messages") {
            await new Promise(r => setTimeout(r, window.waTest.delays[this.phone] || 0));
            resolve(window.waTest.historyError ? { error: { message: "Riwayat gagal dimuat" } } : { data: [...(messages[this.phone] || [])].reverse(), count: (messages[this.phone] || []).length });
          } else if (this.mode === "read" && ["payment_suggestions", "invoices"].includes(table)) {
            window.waTest.calls.push({type:"payment-lookup",table,phones:this.phones});
            await new Promise(r=>setTimeout(r,window.waTest.paymentLoadDelay || 0));
            const rows=table === "payment_suggestions" ? demoProofs.filter(p=>p.status==="PENDING") : demoInvoices.filter(i=>["UNPAID","PARTIAL_PAID","OVERDUE"].includes(i.status));
            resolve(window.waTest.paymentLoadError ? {error:{message:"Bukti gagal dimuat"}} : {data:rows.filter(r=>!this.phones || this.phones.includes(r.phone)).slice(this.pageStart || 0,(this.pageEnd ?? 199)+1)});
          } else if (this.mode === "read" && table === "customers") {
            window.waTest.calls.push({type:"customer-lookup",phones:this.phones});
            await new Promise(r=>setTimeout(r,window.waTest.customerDelay || 0));
            resolve(window.waTest.customerLookupError?{error:{message:"Daftar Customer tidak tersedia"}}:{data:customers.filter(c=>!this.phones || this.phones.includes(c.phone)).slice(this.pageStart || 0,(this.pageEnd ?? 199)+1)});
          } else if (this.mode === "insert" && table === "orders") {
            window.waTest.calls.push({ type: "planning-save", row: this.payload });
            if (window.waTest.planningSaveError) resolve({ error: { message: "Database tidak tersedia" } });
            else { demoOrders.push(this.payload); resolve({ data: this.payload }); }
          } else if (this.mode === "insert" && table === "wa_messages") {
            const row = { ...this.payload, id: Date.now() }; messages[row.phone].push(row); resolve({ data: { id: row.id } });
          } else if (this.mode === "insert" && table === "customers") {
            resolve({ data: { ...this.payload, id: `demo-${Date.now()}` } });
          } else if (this.mode === "update" && table === "wa_conversations") {
            const conv = conversations.find(c => c.phone === this.phone);
            if (conv) Object.assign(conv, this.payload);
            resolve({ data: conv ? [conv] : [] });
          } else if(table==="wa_followups") resolve({data:[...followups.values()]});
          else if(table==="wa_outbox") resolve({data:[...outbox.values()].filter(r=>r.phone===this.phone).reverse()});
          else if(["orders","daily_team_slots","technician_availability","team_presets"].includes(table)) {
            const rows=table==="orders"?demoOrders:table==="daily_team_slots"?rosters:table==="technician_availability"?absences:presets;
            resolve(window.waTest.scheduleError?{error:{message:"Jadwal gagal dimuat"}}:{data:rows.filter(o=>(!this.date||o.date===this.date)&&(!this.from||o.date>=this.from)&&(!this.to||o.date<=this.to))});
          }
          else resolve({ data: table === "wa_conversations" ? conversations : [] });
        } catch (error) { reject(error); }
      },
    };
    return q;
  },
};
export default function WorkspaceFixture({ onAction, onNotice, planningMode = false, initialView = "whatsapp" } = {}) {
  const [orderRows, setOrderRows] = useState([...demoOrders]);
  const [planRequest,setPlanRequest] = useState(null);
  const [boardOpen,setBoardOpen] = useState(initialView === "schedule");
  const [weekOffset,setWeekOffset] = useState(0);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [planningDraft, setPlanningDraft] = useState(null);
  const [invoiceRows, setInvoiceRows] = useState(demoInvoices);
  const [proofRows, setProofRows] = useState(demoProofs);
  const [open, setOpen] = useState(initialView !== "schedule");
  const [waConversations, setWaConversations] = useState(conversations);
  const [selectedConv, setSelectedConv] = useState(null);
  const [waMessages, setWaMessages] = useState([]);
  const [waSearch, setWaSearch] = useState("");
  const [waInput, setWaInput] = useState("");
  const [customersData, setCustomersData] = useState(new URLSearchParams(location.search).has("empty-customers") ? [] : customers);
  const notice = text => { window.waTest.calls.push({ type: "notice", text }); onNotice?.(text); };
  const action = event => {
    window.waTest.calls.push(event);
    if (event.type === "order" && planningMode) {
      setPlanRequest({ id: crypto.randomUUID(), form: event.draft, source: "whatsapp" });
      return;
    }
    if (onAction) {
      setOpen(false);
      onAction(event, () => setOpen(true));
    }
  };
  return <><button className="demo-launch" onClick={() => setOpen(true)}>Buka WhatsApp</button>
    {planningMode && <><button className="demo-launch" onClick={()=>{setOpen(false);setBoardOpen(true);setPlanningOpen(false);}}>Jadwal Tim</button><button className="demo-launch" onClick={()=>{setOpen(false);setPlanningOpen(true);setBoardOpen(false);}}>Planning Order</button></>}
    {boardOpen && <><div className="team-actions"><button onClick={()=>setWeekOffset(n=>n-1)}>← Minggu sebelumnya</button><button onClick={()=>setWeekOffset(n=>n+1)}>Minggu berikutnya →</button></div><TeamScheduleBoard supabase={db} days={planningWeek(getLocalDate(),weekOffset)} revision={orderRows} onShiftWeek={delta=>setWeekOffset(n=>n+delta)}
      onPlan={(order,form)=>setPlanRequest({id:crypto.randomUUID(),order:order?{...order}:null,form,source:"manual"})} onManageTeams={()=>{setBoardOpen(false);setPlanningOpen(true);}} /></>}
    {planRequest && <SchedulePlanModal key={planRequest.id} request={planRequest} supabase={db} onClose={()=>setPlanRequest(null)}
      onSaved={row=>setOrderRows(prev=>prev.some(o=>o.id===row.id)?prev.map(o=>o.id===row.id?row:o):[row,...prev])}
      onViewSchedule={row=>{setPlanRequest(null);setOpen(false);setBoardOpen(true);setPlanningOpen(false);setWeekOffset(planningWeekOffset(getLocalDate(),row.date));}}
      onOpenPlanning={form=>{if(!planRequest.order)setPlanningDraft({id:crypto.randomUUID(),form});setPlanRequest(null);setOpen(false);setPlanningOpen(true);setBoardOpen(false);}} />}
    {planningOpen && <section aria-label="Planning Order lokal"><AppContext.Provider value={{ currentUser: { name: "Dedy", role: "Owner" }, supabase: db, showNotif: notice, showConfirm: () => {}, auditUserName: () => "Dedy", TODAY: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }), maintClients: [] }}>
      <OrderInboxView ordersData={orderRows} setOrdersData={setOrderRows} customersData={customersData} setCustomersData={setCustomersData} teknisiData={[]} laporanReports={[]}
        incomingDraft={planningDraft} onDraftConsumed={() => setPlanningDraft(null)} sendWA={async () => { window.waTest.calls.push({ type: "dispatch" }); }}
        insertOrder={async (_db, row) => db.from("orders").insert(row)} />
    </AppContext.Provider></section>}
    <WaPanel {...{ open, waConversations, setWaConversations, selectedConv, setSelectedConv, waMessages, setWaMessages, waSearch, setWaSearch, waInput, setWaInput, customersData, setCustomersData }}
    onClose={() => setOpen(false)} waProvider="fonnte" currentUser={{ name: "Dedy", role: "Owner" }} supabase={db}
    ordersData={orderRows} invoicesData={invoiceRows} paymentSuggestions={proofRows}
    technicians={[{name:"Tim Rian",role:"Teknisi",active:true},{name:"Tim Budi",role:"Teknisi",active:true}]}
    duration={(service,units)=>service==="Install"?Number(units)*2.5:Math.max(1,Number(units)*0.5)}
    reports={[{id:"RPT-100",job_id:"JOB-100",status:"VERIFIED"}]}
    sendWorkspaceMessage={mockSend}
    onSendDocument={(kind,item,id,phone)=>mockSend({id,kind,document_id:item.id,phone,message:`Dokumen ${item.id}`,url:`https://demo.test/${item.id}.pdf`})}
    onAppliedPayments={(rows,id)=>{setInvoiceRows(prev=>prev.map(i=>rows.find(r=>r.id===i.id)||i));setProofRows(prev=>prev.filter(p=>p.id!==id));}}
    isMobile={window.innerWidth <= 600} showNotif={notice} addAgentLog={() => {}}
    sendWA={async (phone, text) => { window.waTest.calls.push({ type: "send", phone, text }); await new Promise(r => setTimeout(r, window.waTest.sendDelay)); return window.waTest.sendResult; }}
    onCreateOrder={draft => action({ type: "order", draft })}
    onOpenInvoice={query => action({ type: "invoice", query })}
    onOpenSchedule={() => action({ type: "schedule" })}
  /></>;
}
