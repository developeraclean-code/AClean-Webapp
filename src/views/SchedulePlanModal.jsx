import { useEffect, useRef, useState } from 'react';
import { normalizePhone } from '../lib/phone.js';
import { getLocalDate } from '../lib/dateTime.js';
import { estimatedEnd, planningTeams, teamReadiness, teamSlotCrew, suggestedTeamSlots, validatePlan, planConflict, planSnapshot, loadPlanningRange, EDITABLE_PLAN } from '../lib/teamPlanning.js';
import { usePlanningData } from '../lib/usePlanningData.js';
import { SERVICE_AREAS, resolveServiceArea } from '../lib/serviceArea.js';
import './TeamSchedule.css';

export default function SchedulePlanModal({ request, supabase, onClose, onSaved, onViewSchedule, onOpenPlanning }) {
  const original=request.order;
  const [form,setForm]=useState(()=>{
    const dragged=!!original && request.form?.__drag===true;
    const d=dragged?{...original,date:request.form.date,team_slot:request.form.team_slot,time:request.form.time,time_end:request.form.time_end}:original || request.form || {};
    const guessed=resolveServiceArea(d).label;
    return {customer:d.customer || '',customer_id:d.customer_id || null,phone:d.phone || '',address:d.address || '',area:original?(d.area || ''):(guessed==='Area belum jelas'?'':guessed),service:d.service || 'Cleaning',type:d.type || '',units:d.units || 1,date:d.date || '',time:d.time?.slice(0,5) || '09:00',time_end:d.time_end?.slice(0,5) || estimatedEnd(d.time?.slice(0,5) || '09:00',d.service || 'Cleaning',d.units || 1),team_slot:d.team_slot || '',status:d.status==='PENDING' || !original?'PENDING':d.status==='CANCELLED'?'CANCELLED':'CONFIRMED',notes:d.notes || ''};
  });
  const [areaManuallyChosen,setAreaManuallyChosen]=useState(false);
  const [reason,setReason]=useState(''),[reasonEdited,setReasonEdited]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(null),[pending,setPending]=useState(null);
  const lock=useRef(false),dialog=useRef(null),previousFocus=useRef(null);
  const {data,loading,error:loadError,reload}=usePlanningData(supabase,form.date || getLocalDate(),form.date || getLocalDate());
  const readonly=!!original && (!EDITABLE_PLAN.includes(original.status) || !!original.project_id);
  const teams=planningTeams(data.presets,data.rosters,[...data.orders,...(original?[original]:[])]);
  const ready=teamReadiness(form.team_slot,form.date,data.rosters,data.absences);
  const suggestions=suggestedTeamSlots({...data,date:form.date,team:form.team_slot,service:form.service,units:form.units,excludeId:original?.id});
  const conflict=form.status==='CANCELLED'?null:planConflict({...form,id:original?.id},data.orders,data.rosters);
  const dragSummary=request.form?.__drag && original?`${original.date} · ${original.team_slot || 'Belum ada tim'} ${original.time?.slice(0,5)}–${(original.time_end || estimatedEnd(original.time,original.service,original.units)).slice(0,5)} → ${form.date} · ${form.team_slot || 'Belum ada tim'} ${form.time}–${form.time_end}`:'';
  const effectiveReason=reasonEdited?reason:dragSummary?`Geser jadwal ${dragSummary}`:reason;
  const dragCrew=dragSummary?teamSlotCrew(form.team_slot,form.date,data.rosters,data.absences,data.presets):null;
  const update=(key,value)=>setForm(prev=>{const next={...prev,[key]:value};if(['service','units','time'].includes(key))next.time_end=estimatedEnd(next.time,next.service,next.units);if(key==='address' && !areaManuallyChosen && !original){const guessed=resolveServiceArea({address:value}).label;next.area=guessed==='Area belum jelas'?'':guessed;}return next;});
  useEffect(()=>{previousFocus.current=document.activeElement;dialog.current?.focus();return()=>previousFocus.current?.focus?.();},[]);
  const submit=async()=>{
    if(lock.current || readonly)return;
    const invalid=validatePlan(form);
    if(!pending && (invalid || conflict || dragCrew?.blocked || loadError || loading)){setError(invalid || conflict || (dragCrew?.blocked?dragCrew.detail:'') || loadError || 'Tunggu jadwal selesai dimuat.');return;}
    if(!pending && original && effectiveReason.trim().length<5){setError('Isi alasan perubahan minimal 5 karakter.');return;}
    lock.current=true;setBusy(true);setError('');
    try {
      if(!pending && dragSummary){
        const latest=await loadPlanningRange(supabase,form.date,form.date);
        const crew=teamSlotCrew(form.team_slot,form.date,latest.rosters,latest.absences,latest.presets);
        if(crew.blocked)throw new Error(crew.detail);
        const changed=planConflict({...form,id:original.id},latest.orders,latest.rosters);
        if(changed)throw new Error(changed);
      }
      const args=pending || {p_request_id:crypto.randomUUID(),p_order_id:original?.id || `WA-${request.id}`,p_plan:{...form,phone:normalizePhone(form.phone),units:Number(form.units),source:request.source || 'whatsapp'},p_expected:original?planSnapshot(original):null,p_reason:effectiveReason};
      setPending(args);
      const {data:result,error:saveError}=await supabase.rpc('save_schedule_plan',args);
      if(saveError){if(saveError.code && !['57014','PGRST301'].includes(saveError.code))setPending(null);throw saveError;}
      if(!result?.order)throw new Error('Hasil simpan belum pasti. Periksa dengan ID permintaan yang sama.');
      setPending(null);setSaved(result.order);onSaved(result.order);
    }catch(e){setError(e.message || 'Koneksi terputus. Periksa penyimpanan sebelum membuat job baru.');}
    finally{lock.current=false;setBusy(false);}
  };
  const close=()=>{if(!busy && !pending)onClose();};
  const keys=e=>{
    e.stopPropagation();
    if(e.key==='Escape'){e.stopPropagation();close();}
    if(e.key==='Tab'){
      const items=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(el=>el.getClientRects().length);
      const first=items[0],last=items.at(-1);
      if(!first){e.preventDefault();return;}
      if(e.shiftKey && (document.activeElement===first || document.activeElement===dialog.current)){e.preventDefault();last.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  };
  return <div className="plan-overlay" onClick={e=>{if(e.target===e.currentTarget)close();}}>
    <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="plan-title" className="plan-dialog" onKeyDown={keys}>
      <header><div><span className="team-eyebrow">ACLEAN · PLANNING</span><h2 id="plan-title">{original?'Ubah rencana pekerjaan':request.source==='manual'?'Rencanakan pekerjaan':'Rencanakan dari WhatsApp'}</h2><p>Satu job untuk Planning Order dan Jadwal. Tim dapat diisi kemudian.</p></div><button aria-label="Tutup rencana" disabled={busy || !!pending} onClick={close}>×</button></header>
      {saved?<div className="plan-success" role="status"><span>✓</span><h3>Planning tersimpan</h3><p>{saved.customer} · {saved.date}<br/>{saved.time}–{saved.time_end} WIB · {saved.team_slot || 'Belum ada tim'}</p><p>{saved.status==='PENDING'?'Tentatif':saved.status==='CANCELLED'?'Dibatalkan':'Pelanggan terkonfirmasi'}. Tidak ada pesan otomatis yang dikirim.</p><div className="team-actions"><button className="team-primary" onClick={()=>onViewSchedule(saved)}>Lihat di Jadwal</button><button onClick={onClose}>Tutup</button></div></div>:<>
        <div className="plan-content">
          {dragSummary && <p className="team-warning">Usulan: {dragSummary}. Perubahan baru berlaku setelah disimpan.</p>}
          {readonly && <p className="team-alert">Job ini sudah berjalan/ditutup atau merupakan project. Perubahan melalui alur operasional terkait.</p>}
          {error && <p className="team-alert" role="alert">{error}</p>}
          {loadError && <p className="team-alert" role="alert">Jadwal gagal dimuat: {loadError} <button onClick={reload}>Muat ulang</button></p>}
          {pending && !busy && <p className="team-warning">Hasil belum pasti. Form dikunci; periksa penyimpanan menggunakan permintaan yang sama.</p>}
          {dragCrew?.blocked && <p className="team-alert">{dragCrew.detail}. Pilih Team lain atau atur pengganti sebelum menyimpan.</p>}
          <fieldset disabled={busy || !!pending || readonly} className="plan-fields">
            <label>Pelanggan<input value={form.customer} readOnly={!!original} onChange={e=>{update('customer',e.target.value);update('customer_id',null);}}/></label>
            <label>WhatsApp<input value={form.phone} readOnly={!!original} onChange={e=>{update('phone',e.target.value);update('customer_id',null);}}/></label>
            <label className="plan-wide">Alamat lokasi<textarea rows={2} value={form.address} readOnly={!!original} onChange={e=>update('address',e.target.value)}/></label>
            {original ? <div className="plan-wide"><small>Area quick view: {resolveServiceArea(form).label}. Periksa alamat di Maps bila rute tampak tidak searah.</small></div>
              : <label className="plan-wide">Area layanan untuk Jadwal<select aria-label="Area layanan" value={form.area} onChange={e=>{setAreaManuallyChosen(true);update('area',e.target.value);}}><option value="">Pilih bila alamat belum jelas</option>{SERVICE_AREAS.map(area=><option key={area} value={area}>{area}</option>)}</select><small>Perkiraan dari alamat; pilih ulang jika kawasan yang terdeteksi tidak tepat.</small></label>}
            <label>Layanan<select disabled={!!original} value={form.service} onChange={e=>update('service',e.target.value)}>{[...new Set(['Cleaning','Repair','Install','Complain','Maintenance',form.service])].map(s=><option key={s}>{s}</option>)}</select></label>
            <label>Jumlah unit<input type="number" min="1" max="100" value={form.units} onChange={e=>update('units',e.target.value)}/></label>
            <label>Tanggal pengerjaan<input type="date" min={!original?getLocalDate():undefined} value={form.date} onChange={e=>update('date',e.target.value)}/></label>
            <label>Team<select aria-label="Team" value={form.team_slot} onChange={e=>update('team_slot',e.target.value)}><option value="">Belum ada tim</option>{teams.map(t=><option key={t}>{t}</option>)}</select></label>
            <label>Jam mulai<input type="time" value={form.time} onChange={e=>update('time',e.target.value)}/></label>
            <label>Jam selesai<input type="time" value={form.time_end} onChange={e=>update('time_end',e.target.value)}/></label>
            <div className="plan-wide"><small>Estimasi selesai {estimatedEnd(form.time,form.service,form.units)} WIB. Bisa disesuaikan dengan kondisi lapangan.</small><p className={`team-pill ${ready.tone}`}>{ready.label}{ready.members.length?` · ${ready.members.map(m=>`${m.name} (${m.role==='teknisi'?'T':'H'})`).join(' · ')}`:''}</p>{ready.missing.length>0 && <p className="team-alert">Tidak tersedia: {ready.missing.map(m=>m.name).join(', ')}. Konfirmasi pelanggan tetap dipertahankan; ganti anggota melalui Planning Order.</p>}</div>
            {form.team_slot && <div className="plan-wide team-suggestions"><b>Jam disarankan</b><small>{loading?'Memeriksa jadwal…':'Berdasarkan durasi dan jadwal tim pada tanggal pilihan.'}</small><div className="team-actions">{!loading && !loadError && suggestions.map(s=><button type="button" key={s.time} onClick={()=>setForm(f=>({...f,time:s.time,time_end:s.time_end}))}>{s.time}–{s.time_end}</button>)}</div>{!loading && !suggestions.length && <small>Tidak ada slot yang dapat disarankan. Pilih tim atau tanggal lain.</small>}</div>}
            {conflict && <p className="plan-wide team-alert">{conflict}</p>}
            <label className="plan-wide">Konfirmasi pelanggan<select value={form.status} onChange={e=>update('status',e.target.value)}><option value="PENDING">Tentatif · menunggu pelanggan</option><option value="CONFIRMED">Pelanggan terkonfirmasi</option>{original && <option value="CANCELLED">Batalkan pekerjaan</option>}</select></label>
            <label className="plan-wide">Catatan<textarea rows={2} value={form.notes} onChange={e=>update('notes',e.target.value)}/></label>
            {original && <label className="plan-wide">Alasan perubahan<textarea rows={2} value={effectiveReason} onChange={e=>{setReasonEdited(true);setReason(e.target.value);}} placeholder="Contoh: pelanggan meminta pindah hari / teknisi berhalangan"/></label>}
          </fieldset>
          {original?.status==='DISPATCHED' && <p className="team-warning">Perubahan ini mengembalikan job ke konfirmasi pelanggan; dispatch lama dilepas. Kirim ulang informasi setelah tim/jadwal siap.</p>}
        </div>
        <footer><button disabled={busy || !!pending} onClick={close}>Batal</button>{onOpenPlanning && !dragSummary && <button disabled={busy || !!pending} onClick={()=>onOpenPlanning(form)}>Buka Planning Order</button>}<button className="team-primary" disabled={busy || readonly || (!pending && (loading || !!loadError || !!conflict || dragCrew?.blocked))} onClick={submit}>{busy?'Menyimpan…':pending?'Periksa penyimpanan':original?'Simpan perubahan':'Simpan planning'}</button></footer>
      </>}
    </section>
  </div>;
}
