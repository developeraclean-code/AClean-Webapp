import { waMediaUrl } from "../lib/waPaymentContext.js";
import { matchPaymentInvoices } from "../lib/waPaymentMatch.js";
import { loadPlanningRange, planningTeams, suggestedTeamSlots } from "../lib/teamPlanning.js";
import { useEffect, useRef, useState } from "react";
import { WA_STATES, SEND_STATES, jakartaToday, toJakartaInput, fromJakartaInput, allocatePayment, paymentCandidates, serviceFollowup } from "../lib/waOperations.js";
import { createWaOrderDraft, invoiceBalance, waMoney } from "../lib/waWorkspace.js";

export default function WaOperationsPanel({ phone, conv, customer, needsLocation, orders, invoices, allInvoices,
  suggestions, paymentLoading = false, paymentError = "", onRefreshPayments, reports = [], technicians = [], duration, supabase, currentUser, followup, onFollowupSaved,
  insertDraft, onCreateOrder, onAppliedPayments, onSendDocument, onSendReminder, refreshKey,
}) {
  const [section, setSection] = useState("followup");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});
  const followupDirty = useRef(false);
  const editFollowup = next => { followupDirty.current = true; setForm(next); };
  const [date, setDate] = useState(jakartaToday);
  const [service, setService] = useState("Cleaning");
  const [units, setUnits] = useState(1);
  const [slots, setSlots] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [proofId, setProofId] = useState("");
  const [amount, setAmount] = useState("");
  const [selected, setSelected] = useState([]);
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [paymentPending, setPaymentPending] = useState(null);
  const lock = useRef(false);
  const documentRequests = useRef(new Map());
  const mounted = useRef(true);
  const [localRefresh, setLocalRefresh] = useState(0);
  const proof = suggestions.find(s=>s.id===proofId);
  const candidates = proof ? paymentCandidates(allInvoices,proof) : [];
  const chosen = candidates.filter(i=>selected.includes(i.id));
  const allocation = allocatePayment(chosen,amount);
  const allocated = allocation.reduce((sum,p)=>sum+p.amount,0);
  const follow = serviceFollowup(orders,history,customer?.id,new Date(),customer?.last_rating_request);
  const availableReports = reports.filter(r=>r.status==="VERIFIED" && orders.some(o=>o.id===r.job_id));
  useEffect(()=>{ mounted.current=true; return()=>{ mounted.current=false; }; },[]);
  useEffect(()=>{ if(followupDirty.current)return; setForm({ status:followup?.status || "NEEDS_REPLY", due:toJakartaInput(followup?.due_at), assignee:followup?.assignee || "", note:followup?.note || "", version:followup?.version || 0 }); },[followup?.version]);
  useEffect(()=>{
    let cancelled=false;
    setHistoryReady(false);
    supabase.from("wa_outbox").select("*").eq("phone",phone).order("created_at",{ascending:false}).limit(100)
      .then(({data,error})=>{if(cancelled)return;if(error){setError("Riwayat operasional belum tersedia: "+error.message);return;}setHistory(data||[]);setHistoryReady(true);}).catch(e=>{if(!cancelled)setError("Riwayat gagal dimuat: "+e.message);});
    return()=>{cancelled=true;};
  },[phone,supabase,refreshKey,localRefresh]);
  const run = async fn => {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError("");setNotice("");
    try{await fn();}catch(e){if(mounted.current)setError(e.message || "Operasi gagal. Coba muat ulang.");}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  };
  const searchSlots = () => run(async()=>{
    setSlots([]);
    const day=await loadPlanningRange(supabase,date,date);
    if(!mounted.current)return;
    const result=planningTeams(day.presets,day.rosters,day.orders).flatMap(team=>suggestedTeamSlots({date,team,service,units,...day}).slice(0,2)).slice(0,16);
    setSlots(result);setNotice(result.length?"Opsi sementara; ketersediaan diperiksa lagi saat dipilih dan disimpan.":"Tidak ada slot reguler yang tersedia untuk pilihan ini.");
  });
  const chooseSlot = (slot, asDraft) => run(async()=>{
    const day=await loadPlanningRange(supabase,slot.date,slot.date);
    if(!mounted.current)return;
    const latest=suggestedTeamSlots({date:slot.date,team:slot.team_slot,service,units,...day});
    if(!latest.some(s=>s.team_slot===slot.team_slot && s.time===slot.time))throw new Error("Slot sudah berubah. Cari jadwal kembali.");
    if(asDraft)insertDraft(`Halo ${customer?.name || conv.name}, opsi servis ${service} ${units} unit adalah ${slot.date} pukul ${slot.time}–${slot.time_end} WIB pada ${slot.team_slot}. Apakah berkenan? Jadwal akan dikonfirmasi setelah pemesanan.`);
    else onCreateOrder({...createWaOrderDraft(conv,customer),service,units:Number(units),date:slot.date,time:slot.time,time_end:slot.time_end,team_slot:slot.team_slot});
  });
  const chooseProof = id => {const p=suggestions.find(s=>s.id===id);setProofId(id);setAmount(p?.amount || "");setSelected(p ? matchPaymentInvoices(allInvoices,p.phone,p.amount).invoices.map(i=>i.id) : []);setReviewed(false);setNote("");setPaymentPending(null);};
  const pay = () => run(async()=>{
    if(!proof || !reviewed || !allocation.length || allocated!==Number(amount))throw new Error("Periksa bukti dan alokasi; seluruh nominal harus dialokasikan.");
    if(Number(proof.amount)!==Number(amount) && note.trim().length<10)throw new Error("Jelaskan koreksi nominal (minimal 10 karakter).");
    const payload=paymentPending || {p_id:crypto.randomUUID(),p_suggestion_id:proof.id,p_allocations:allocation,p_amount:Number(amount),p_method:method,p_note:note};
    setPaymentPending(payload);
    const {data,error}=await supabase.rpc("apply_wa_payment",payload);
    if(error)throw new Error(error.message+". Periksa status bukti sebelum mengubah atau mengulang pembayaran.");
    onAppliedPayments?.(data,proof.id);setProofId("");setSelected([]);setPaymentPending(null);setNotice("Pembayaran dan alokasi invoice tersimpan.");
  });
  const documentBlocked = (kind,id) => history.some(h=>h.kind===kind && h.document_id===id && ["SENDING","UNCERTAIN"].includes(h.status));
  const sendDoc = (kind,item) => run(async()=>{
    const key=kind+":"+item.id;
    const id=documentRequests.current.get(key) || crypto.randomUUID();
    documentRequests.current.set(key,id);
    try {
      const row=await onSendDocument(kind,item,id);
      if(["ACCEPTED","FAILED"].includes(row.status))documentRequests.current.delete(key);
      if(mounted.current){setHistory(h=>[row,...h.filter(x=>x.id!==row.id)]);setNotice(SEND_STATES[row.status]+(row.audit_pending?" · audit belum tersimpan":""));}
    } finally { if(mounted.current)setLocalRefresh(v=>v+1); }
  });
  return <section className="wa-operations">
    <div className="wa-ops-tabs" aria-label="Fitur operasional">{[["followup","Tindak lanjut"],["schedule","Slot jadwal"],["payment","Verifikasi bayar"],["documents","Dokumen"],["service","Servis berkala"]].map(([key,label])=><button key={key} aria-pressed={section===key} onClick={()=>{setSection(key);setError("");setNotice("");}}>{label}</button>)}</div>
    {error && <p className="wa-ops-error" role="alert">{error}</p>}{notice && <p className="wa-ops-notice" role="status">{notice}</p>}
    {section==="followup" && <div className="wa-ops-form">
      <h4>Urusan pelanggan</h4>
      <label>Status tindak lanjut<select value={form.status || "NEEDS_REPLY"} onChange={e=>editFollowup({...form,status:e.target.value})}>{Object.entries(WA_STATES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Pengingat (WIB)<input type="datetime-local" value={form.due || ""} onChange={e=>editFollowup({...form,due:e.target.value})}/></label>
      <label>Penanggung jawab<input value={form.assignee || ""} maxLength={100} placeholder={currentUser?.name || "Nama admin"} onChange={e=>editFollowup({...form,assignee:e.target.value})}/></label>
      <label>Catatan internal<textarea value={form.note || ""} maxLength={2000} rows={3} onChange={e=>editFollowup({...form,note:e.target.value})}/></label>
      <button className="wa-primary" disabled={busy} onClick={()=>run(async()=>{const {data,error}=await supabase.rpc("save_wa_followup",{p_phone:phone,p_version:form.version || 0,p_status:form.status,p_due_at:fromJakartaInput(form.due),p_assignee:form.assignee,p_note:form.note});if(error)throw error;followupDirty.current=false;onFollowupSaved(data);setNotice("Tindak lanjut tersimpan untuk seluruh admin.");})}>Simpan tindak lanjut</button>
      <button className="wa-text-button" disabled={busy} onClick={()=>run(async()=>{const {data,error}=await supabase.from("wa_followups").select("*").eq("phone",phone).limit(1);if(error)throw error;const row=data?.[0];followupDirty.current=false;setForm({status:row?.status || "NEEDS_REPLY",due:toJakartaInput(row?.due_at),assignee:row?.assignee || "",note:row?.note || "",version:row?.version || 0});if(row)onFollowupSaved(row);})}>Muat ulang tindak lanjut</button>
      {followup?.updated_by && <p className="wa-muted">Terakhir: {followup.updated_by}</p>}
    </div>}
    {section==="schedule" && <div className="wa-ops-form"><h4>Cari jadwal tersedia</h4>
      <p className="wa-muted">Pilih slot untuk membuka pop-up rencana. Jam mengikuti durasi pekerjaan; anggota Team dapat berbeda setiap hari.</p>
      <label>Tanggal servis<input type="date" value={date} min={jakartaToday()} onChange={e=>{setDate(e.target.value);setSlots([]);}}/></label>
      <label>Layanan<select value={service} onChange={e=>{setService(e.target.value);setSlots([]);}}>{["Cleaning","Repair","Install","Complain"].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Jumlah unit<input type="number" min="1" max="100" value={units} onChange={e=>{setUnits(e.target.value);setSlots([]);}}/></label>
      <button className="wa-primary" disabled={busy || needsLocation || !duration} onClick={searchSlots}>Cari slot tim</button>
      {slots.map(s=><div className="wa-info-card" key={s.team_slot+s.time}><strong>{s.team_slot} · {s.time}–{s.time_end}</strong><p>{s.date} · Anggota mengikuti roster harian</p><div className="wa-button-pair"><button disabled={busy} className="wa-text-button" onClick={()=>chooseSlot(s,true)}>Draf tawaran</button><button disabled={busy} className="wa-text-button" onClick={()=>chooseSlot(s,false)}>Pilih slot</button></div></div>)}
    </div>}
    {section==="payment" && <div className="wa-ops-form"><h4>Cocokkan bukti & invoice</h4>
      <button className="wa-text-button" disabled={paymentLoading || busy || !!paymentPending} onClick={onRefreshPayments}>Muat ulang bukti & invoice</button>
      {paymentLoading ? <p className="wa-muted">Memuat bukti & invoice…</p> : paymentError ? <p className="wa-ops-error" role="alert">Bukti belum dapat dimuat: {paymentError}. Klik muat ulang.</p> : !suggestions.length?<p className="wa-muted">Tidak ada bukti yang menunggu pemeriksaan pada nomor ini.</p>:<>
        <label>Bukti pembayaran<select aria-label="Bukti pembayaran" value={proofId} disabled={busy || !!paymentPending} onChange={e=>chooseProof(e.target.value)}><option value="">Pilih bukti…</option>{suggestions.map(s=><option key={s.id} value={s.id}>{s.bank || s.sender_name || "Transfer"} · {s.amount?waMoney(s.amount):"Nominal belum terbaca"}</option>)}</select></label>
        {proof && <>
          {waMediaUrl(proof.image_url) && <a href={waMediaUrl(proof.image_url)} target="_blank" rel="noopener noreferrer"><img className="wa-proof-preview" src={waMediaUrl(proof.image_url)} alt="Bukti transfer yang akan diverifikasi"/>Buka bukti ↗</a>}
          {proof.raw_message && <p className="wa-muted">{proof.raw_message}</p>}
          <fieldset disabled={busy || !!paymentPending}><label>Nominal diterima<input type="number" min="1" value={amount} onChange={e=>{setAmount(e.target.value);setReviewed(false);}}/></label>
          <label>Metode<select value={method} onChange={e=>setMethod(e.target.value)}>{["transfer","cash","qris","card","other"].map(m=><option key={m}>{m}</option>)}</select></label>
          <p className="wa-muted">Pilihan awal hanya saran kecocokan nominal; periksa lokasi dan bukti. Pilih invoice. Nama lokasi ditampilkan agar satu transfer dapat dialokasikan dengan benar.</p>
          {candidates.map(inv=><label className="wa-check" key={inv.id}><input type="checkbox" checked={selected.includes(inv.id)} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,inv.id]:ids.filter(id=>id!==inv.id));setReviewed(false);}}/><span>{inv.id} · {inv.customer}<small>Sisa {waMoney(invoiceBalance(inv))}</small></span></label>)}
          {!candidates.length && <p className="wa-muted">Tidak ada invoice terbuka dengan nomor yang cocok.</p>}
          <label>Catatan verifikasi / koreksi<textarea value={note} onChange={e=>setNote(e.target.value)} rows={2}/></label></fieldset>
          {allocation.map(p=>{const inv=chosen.find(i=>i.id===p.invoice_id);return <div className="wa-payment-allocation" key={p.invoice_id}>{p.invoice_id}: {waMoney(p.amount)}<small>Sisa setelah bayar: {waMoney(invoiceBalance(inv)-p.amount)}</small></div>;})}
          <p className="wa-muted">Dialokasikan {waMoney(allocated)} dari {waMoney(amount)}.</p>
          <label className="wa-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>Saya sudah memeriksa bukti, lokasi, nominal, dan alokasi.</span></label>
          <button className="wa-primary" disabled={busy || !reviewed || !allocation.length || allocated!==Number(amount)} onClick={pay}>{busy?"Memproses…":paymentPending?"Periksa / ulangi transaksi yang sama":"Konfirmasi pembayaran"}</button>
          {paymentPending && <p className="wa-muted">Permintaan dipertahankan dengan ID yang sama untuk mencegah pencatatan ganda. Muat ulang data jika bukti sudah diproses.</p>}
        </>}
      </>}
    </div>}
    {section==="documents" && <div className="wa-ops-form"><h4>Kirim dokumen resmi</h4><p className="wa-muted">Tombol Kirim PDF mengirim langsung ke {phone}. Dokumen harus sudah disetujui/diverifikasi.</p>
      {invoices.filter(i=>["APPROVED","UNPAID","OVERDUE","PARTIAL_PAID","PAID"].includes(i.status)).map(inv=><div className="wa-info-card" key={inv.id}><strong>Invoice {inv.id}</strong><p>{inv.customer} · {waMoney(inv.total)}</p><button disabled={busy || !historyReady || !onSendDocument || documentBlocked("INVOICE",inv.id)} className="wa-primary" onClick={()=>sendDoc("INVOICE",inv)}>Kirim PDF invoice</button></div>)}
      {availableReports.map(report=><div className="wa-info-card" key={report.id}><strong>Laporan {report.job_id}</strong><button disabled={busy || !historyReady || !onSendDocument || documentBlocked("REPORT",report.id)} className="wa-primary" onClick={()=>sendDoc("REPORT",report)}>Kirim PDF laporan</button></div>)}
      <h4>Riwayat pengiriman</h4><button className="wa-text-button" onClick={()=>setLocalRefresh(v=>v+1)}>Muat ulang status</button>
      {history.slice(0,20).map(h=><div className="wa-order" key={h.id}><strong>{h.document_id || h.kind}</strong><p>{h.message?.slice(0,90)}</p><span className="wa-tag">{SEND_STATES[h.status]}</span><p>{new Date(h.created_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})} · {h.actor}</p>{h.error && <p>{h.error}</p>}{/^https:\/\//i.test(h.attachment_url || h.url || "") && <a href={h.attachment_url || h.url} target="_blank" rel="noopener noreferrer">Buka PDF ↗</a>}</div>)}
      {!history.length && <p className="wa-muted">Belum ada riwayat pengiriman terpantau.</p>}
    </div>}
    {section==="service" && <div className="wa-ops-form"><h4>Follow-up servis berkala</h4>
      <p className="wa-muted">Lokasi: {customer?.name || "Pilih pelanggan/lokasi terlebih dahulu"}</p>
      <p className="wa-muted">Cleaning / maintenance selesai terakhir: {follow.last || "Belum ada riwayat selesai yang dimuat"}</p>
      {follow.due && <p className="wa-muted">Saran berikutnya (90 hari): {follow.due.toLocaleDateString("id-ID",{timeZone:"Asia/Jakarta"})}</p>}
      {follow.active && <p className="wa-ops-notice">Sudah ada order aktif. Periksa jadwal sebelum menawarkan servis lagi.</p>}
      {follow.legacyBlocked && <p className="wa-ops-notice">Kontak otomatis tercatat pada {customer.last_rating_request}. Tunggu jeda 30 hari sebelum mengirim pengingat lagi.</p>}
      {follow.blocked && <p className="wa-ops-notice">Pengingat sudah dikirim/diproses dalam 30 hari terakhir.</p>}
      <button className="wa-primary" disabled={!customer || !follow.eligible || !historyReady || busy} onClick={()=>insertDraft(`Halo ${customer.name}, servis AC terakhir di ${customer.address || customer.name} tercatat pada ${follow.last}. Apakah ingin menjadwalkan perawatan berikutnya? Kami dapat membantu memeriksa slot tim AClean.`,{kind:"SERVICE_REMINDER",customer_id:String(customer.id),customer_name:customer.name})}>Buat draf penawaran servis</button>
      <button className="wa-secondary" disabled={!customer || !follow.eligible || !historyReady || busy || !onSendReminder} onClick={()=>run(async()=>{const row=await onSendReminder(customer,`Halo ${customer.name}, servis AC terakhir di ${customer.address || customer.name} tercatat pada ${follow.last}. Apakah ingin menjadwalkan perawatan berikutnya? Kami dapat membantu memeriksa slot tim AClean.`,crypto.randomUUID());setHistory(h=>[row,...h]);setNotice(SEND_STATES[row.status]);setLocalRefresh(v=>v+1);})}>Kirim pengingat servis</button>
      <button className="wa-text-button" disabled={!customer || needsLocation} onClick={()=>onCreateOrder(createWaOrderDraft(conv,customer,orders.find(o=>["PAID","COMPLETED"].includes(o.status))))}>Buat reorder untuk lokasi ini →</button>
      {follow.contacts.map(h=><p className="wa-muted" key={h.id}>{new Date(h.created_at).toLocaleDateString("id-ID")} · {SEND_STATES[h.status]} · {h.actor}</p>)}
      <p className="wa-context-footnote">Pengiriman pengingat berbagi jeda 30 hari dengan reminder otomatis AClean. Riwayat hanya memakai pekerjaan selesai yang dimuat.</p>
    </div>}
  </section>;
}
