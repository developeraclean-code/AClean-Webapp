import { useRef, useState } from 'react';
import { usePlanningData } from '../lib/usePlanningData.js';
import { planningTeams, teamReadiness, teamSlotCrew, minutes, estimatedEnd, ACTIVE_PLAN, EDITABLE_PLAN, planConflict, gridMoveProposal } from '../lib/teamPlanning.js';
import { shiftDateStr } from '../lib/dateTime.js';
import { statusLabel } from '../constants/status.js';
import { areaMapsUrl, resolveServiceArea } from '../lib/serviceArea.js';
import './TeamSchedule.css';
const DAY_START=9*60, DAY_END=19*60;
const isNight = order => (order.team_slot || '').startsWith('Malam ') || minutes(order.time)>=18*60;
const endLabel = order => (order.time_end || estimatedEnd(order.time,order.service,order.units)).slice(0,5);
const barStyle = order => {
  const start=Math.max(DAY_START,minutes(order.time)), end=Math.min(DAY_END,minutes(order.time_end || estimatedEnd(order.time,order.service,order.units)));
  return Number.isFinite(start+end) && end>start ? {left:`${(start-DAY_START)/(DAY_END-DAY_START)*100}%`,width:`${(end-start)/(DAY_END-DAY_START)*100}%`} : null;
};
const label = status => status==='PENDING'?'Tentatif':status==='CONFIRMED'?'Terkonfirmasi':statusLabel[status] || status;
export default function TeamScheduleBoard({ supabase, days, revision, search='', person='Semua', accepts=()=>true, onPlan, onManageTeams, onShiftWeek, renderActions }) {
  const {data,loading,error,reload}=usePlanningData(supabase,days[0].date,days[6].date,revision);
  const [team,setTeam]=useState('Semua'),[status,setStatus]=useState('active'),[detailDate,setDetailDate]=useState('');
  const drag=useRef(null),dayDetail=useRef(null),[dragPreview,setDragPreview]=useState(null),[dragError,setDragError]=useState('');
  const daytimeOrders=data.orders.filter(o=>!isNight(o));
  const allTeams=planningTeams(data.presets,data.rosters,daytimeOrders).filter(slot=>!slot.startsWith('Malam '));
  const displayedTeams=team==='Semua'?['',...allTeams]:[team==='unassigned'?'':team];
  const q=search.trim().toLowerCase();
  const jobs=daytimeOrders.filter(o=>{
    if(status==='active' && o.status==='CANCELLED')return false;
    if(status==='pending' && o.status!=='PENDING')return false;
    const ready=teamReadiness(o.team_slot,o.date,data.rosters,data.absences,o);
    if(status==='attention' && (!ACTIVE_PLAN.includes(o.status) || ready.tone==='ready'))return false;
    if(person!=='Semua' && ![o.teknisi,o.helper,o.teknisi2,o.helper2,o.teknisi3,o.helper3,...ready.members.map(m=>m.name)].includes(person))return false;
    return (!q || [o.customer,o.phone,o.address,o.area,resolveServiceArea(o).label,o.id,o.service,o.team_slot,...ready.members.map(m=>m.name)].some(v=>String(v||'').toLowerCase().includes(q))) && accepts(o);
  }).sort((a,b)=>(a.time || '').localeCompare(b.time || ''));
  const selectedDay=days.some(d=>d.date===detailDate)?detailDate:days[0].date;
  const dayJobs=jobs.filter(o=>o.date===selectedDay);
  const moveDay=delta=>{
    const target=shiftDateStr(selectedDay,delta);
    setDetailDate(target);
    if(target<days[0].date || target>days[6].date)onShiftWeek?.(delta);
  };
  const selectDay=date=>{setDetailDate(date);dayDetail.current?.scrollIntoView({block:'start'});};
  const dragStart=(event,order)=>{
    const lane=event.currentTarget.closest('.team-time-lanes');
    if(!lane)return;
    drag.current={order,grabMinutes:(event.clientX-event.currentTarget.getBoundingClientRect().left)/lane.getBoundingClientRect().width*(DAY_END-DAY_START)};
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain',order.id);
    setDragPreview(null);setDragError('');
  };
  const moveAt=(event,slot)=>{
    if(!drag.current)return null;
    const rect=event.currentTarget.getBoundingClientRect();
    const rawStart=DAY_START+(event.clientX-rect.left)/rect.width*(DAY_END-DAY_START)-drag.current.grabMinutes;
    const result=gridMoveProposal(drag.current.order,slot,rawStart);
    if(result.error)return {...result,slot};
    const crew=teamSlotCrew(slot,drag.current.order.date,data.rosters,data.absences,data.presets);
    if(crew.blocked)return {error:`${crew.detail}. Pilih Team lain atau atur pengganti.`,slot};
    const conflict=planConflict({...drag.current.order,...result.plan},data.orders,data.rosters);
    return conflict?{error:conflict,slot}:{...result,slot};
  };
  const dragOver=(event,slot)=>{
    if(!drag.current)return;
    event.preventDefault();event.dataTransfer.dropEffect='move';
    const next=moveAt(event,slot);
    setDragPreview(prev=>JSON.stringify(prev)===JSON.stringify(next)?prev:next);
  };
  const drop=(event,slot)=>{
    if(!drag.current)return;
    event.preventDefault();
    const next=moveAt(event,slot),order=drag.current.order;
    drag.current=null;setDragPreview(null);
    if(next?.error){setDragError(next.error);return;}
    if(next?.plan){setDragError('');onPlan(order,{...next.plan,__drag:true});}
  };
  const attention=daytimeOrders.filter(o=>ACTIVE_PLAN.includes(o.status) && teamReadiness(o.team_slot,o.date,data.rosters,data.absences,o).tone!=='ready').length;
  const card=(job,compact=false)=>{
    const ready=teamReadiness(job.team_slot,job.date,data.rosters,data.absences,job);
    const conflict=ACTIVE_PLAN.includes(job.status) && planConflict(job,data.orders,data.rosters);
    const area=resolveServiceArea(job);
    return <article className={`team-job ${job.status==='PENDING'?'tentative':''} ${job.status==='CANCELLED'?'cancelled':''} ${conflict?'clash':''}`} key={job.id} data-job-id={job.id}>
      <button className="team-job-main" aria-label={`${job.customer}, ${job.date}, ${job.time}–${job.time_end || estimatedEnd(job.time,job.service,job.units)}, area ${area.label}, ${job.team_slot || 'Belum ada tim'}`} onClick={()=>onPlan(job)}>
        <span className="team-job-time">{job.time?.slice(0,5) || 'Jam belum ada'}–{endLabel(job)}</span>
        <strong>{job.customer}</strong><small className="team-job-area">📍 {area.label}{area.conflict?' · cek alamat':''}</small><small>{job.service} · {job.units || 1} unit</small>
        <span className="team-state">{label(job.status)}</span>
        {!compact && <small className={ready.tone==='danger'?'team-danger':''}>{ready.label}{ready.missing.length?` · ${ready.missing.map(m=>m.name).join(', ')}`:''}</small>}
        {conflict && <small className="team-danger">Benturan jadwal</small>}
      </button>
      {areaMapsUrl(job.address) && <a className="team-job-map" href={areaMapsUrl(job.address)} target="_blank" rel="noopener noreferrer" aria-label={`Periksa alamat ${job.customer} di Maps`}>Cek Maps ↗</a>}
      {!compact && renderActions?.(job)}
    </article>;
  };
  return <section className="team-board" aria-label="Jadwal mingguan per Team">
    <div className="team-board-heading"><div><span className="team-eyebrow">JADWAL TEAM</span><h2>Jam kerja & rencana mingguan</h2></div><div className="team-actions"><button onClick={reload} disabled={loading}>{loading?'Memuat…':'↻ Muat ulang'}</button><button onClick={onManageTeams}>Atur anggota harian</button></div></div>
    <div className="team-board-filters"><label>Team<select aria-label="Filter Team jadwal" value={team} onChange={e=>setTeam(e.target.value)}><option>Semua</option><option value="unassigned">Belum ada tim</option>{allTeams.map(t=><option key={t}>{t}</option>)}</select></label><label>Tampilkan<select value={status} onChange={e=>setStatus(e.target.value)}><option value="active">Aktif & selesai</option><option value="pending">Tentatif</option><option value="attention">Perlu tim / pengganti</option><option value="all">Semua, termasuk batal</option></select></label><span className="team-legend">▧ Tentatif · ● Terkonfirmasi · <b>Merah: perlu diperiksa</b></span></div>
    {error && <p className="team-alert" role="alert">{error}. Data lama belum diperbarui; muat ulang sebelum menjadwalkan.</p>}
    {!loading && !error && !allTeams.length && <p className="team-warning">Belum ada preset Team. Tambahkan preset atau simpan rencana sebagai “Belum ada tim”.</p>}
    <div className="team-day-detail" ref={dayDetail}><div className="team-board-heading"><div><span className="team-eyebrow">JAM PENGERJAAN · WIB</span><div className="team-day-navigation" role="group" aria-label="Navigasi hari jadwal"><button aria-label="Hari sebelumnya" title="Hari sebelumnya" disabled={!onShiftWeek && selectedDay===days[0].date} onClick={()=>moveDay(-1)}>◀</button><h3 aria-live="polite">{selectedDay}</h3><button aria-label="Hari berikutnya" title="Hari berikutnya" disabled={!onShiftWeek && selectedDay===days[6].date} onClick={()=>moveDay(1)}>▶</button></div><p>Seret blok ke jam/Team lain (langkah 30 menit), lalu konfirmasi di Planning. Slot reguler selesai maksimal 18:00; grid tetap tampil sampai 19:00.</p>{dragError && <p className="team-alert" role="alert">{dragError}</p>}</div><span>{dayJobs.length} pekerjaan</span></div>
      <div className="team-time-scroll" tabIndex={0} aria-label="Timeline harian"><div className="team-time-grid"><div className="team-time-head"><b>Team</b><div>{Array.from({length:11},(_,i)=><span key={i} style={{left:`${i*10}%`}}>{String(i+9).padStart(2,'0')}:00</span>)}</div></div>
        {displayedTeams.map(slot=><div className="team-time-row" key={slot || 'unassigned'} data-team={slot || 'unassigned'}><b>{slot || 'Belum ada tim'}</b><div className="team-time-lanes" onDragOver={event=>dragOver(event,slot)} onDrop={event=>drop(event,slot)}>{dayJobs.filter(o=>(o.team_slot||'')===slot).map(o=>{
          const style=barStyle(o),area=resolveServiceArea(o),end=endLabel(o);
          const duration=minutes(end)-minutes(o.time);
          const movable=!loading && !error && EDITABLE_PLAN.includes(o.status) && !o.project_id && minutes(o.time)>=DAY_START && minutes(o.time_end || estimatedEnd(o.time,o.service,o.units))<=18*60;
          return style?<div className="team-time-lane" key={o.id}>
            <button className={`team-time-slot${duration<60?' compact':''}`} draggable={movable} onDragStart={event=>dragStart(event,o)} onDragEnd={()=>{drag.current=null;setDragPreview(null);}} onClick={()=>onPlan(o)} data-area={area.label} aria-label={`${o.time?.slice(0,5)}–${end} · ${o.customer} · Area ${area.label}`} title={`${o.time?.slice(0,5)}–${end} · ${o.customer} · ${area.label}${area.conflict?' (cek alamat)':''} · ${o.address || 'alamat belum tersedia'}${movable?' · Seret untuk usulkan pindah jam/Team':''}`} style={style}>
              <span className="team-time-slot-time" aria-hidden="true">{duration<60?o.time?.slice(0,5):`${o.time?.slice(0,5)}–${end}`}</span>
              <strong className="team-time-slot-name">{o.customer || 'Customer belum diisi'}</strong>
              <span className="team-time-slot-area">📍 {area.label}{area.conflict?' · cek alamat':''}</span>
            </button>
          </div>:null;
        })}{dragPreview?.slot===slot && (dragPreview.plan?<div className="team-drag-preview" style={barStyle(dragPreview.plan)}>{dragPreview.plan.time}–{dragPreview.plan.time_end}</div>:<span className="team-drag-invalid">{dragPreview.error}</span>)}</div></div>)}
      </div></div>
    </div>
    <div className="team-week-heading"><span className="team-eyebrow">PERENCANAAN MINGGUAN</span><h2>Tim tetap. Anggota fleksibel.</h2><p>{daytimeOrders.filter(o=>o.status!=='CANCELLED').length} pekerjaan · {attention} perlu tim / pengganti</p></div>
    <div className="team-week-scroll" aria-label="Kalender tujuh hari" tabIndex={0}>
      <div className="team-week-grid">
        <div className="team-axis">TEAM / HARI</div>{days.map(d=><button className={`team-day ${d.date===selectedDay?'selected':''}`} key={d.date} onClick={()=>selectDay(d.date)}><b>{d.label.split(' ')[0]}</b><span>{d.date.slice(8)}/{d.date.slice(5,7)}</span><small>{jobs.filter(o=>o.date===d.date && o.status!=='CANCELLED').length} job · lihat jam ↑</small></button>)}
        {displayedTeams.map(slot=><div className="team-week-row" key={slot || 'unassigned'}>
          <div className="team-row-label"><b>{slot || 'Belum ada tim'}</b><small>{slot?'Anggota per hari →':'Rencana tetap tercatat'}</small></div>
          {days.map(d=>{
            const own=jobs.filter(o=>o.date===d.date && (o.team_slot || '')===slot);
            const ready=teamReadiness(slot,d.date,data.rosters,data.absences,own[0]);
            return <div className="team-day-cell" key={d.date} data-team={slot || 'unassigned'} data-date={d.date}>
              {slot && <div className={`team-crew ${ready.tone}`} title={ready.members.map(m=>`${m.name} (${m.role})`).join(', ')}>{ready.members.length?ready.members.map((m,i)=><span key={i}>{m.role==='teknisi'?'T':'H'} · {m.name}{ready.missing.some(x=>x.name===m.name)?' · absen':''}</span>):<span>Anggota belum diisi</span>}</div>}
              <div className="team-mini-hours" aria-label="Jam 9 sampai 19"><div>{Array.from({length:11},(_,i)=><span key={i}>{String(9+i).padStart(2,'0')}</span>)}</div><div className="team-mini-track">{own.filter(o=>o.status!=='CANCELLED').map(o=>{const style=barStyle(o);return style?<i key={o.id} title={`${o.customer}: ${o.time?.slice(0,5)}–${endLabel(o)} · ${resolveServiceArea(o).label}`} style={style}/>:null;})}</div></div>
              {own.map(o=>card(o))}
              {!own.length && <span className="team-empty">—</span>}
              <button className="team-add" disabled={loading || !!error} onClick={()=>onPlan(null,{date:d.date,team_slot:slot,time:'09:00'})}>+ Rencanakan</button>
            </div>;
          })}
        </div>)}
      </div>
    </div>
    <p className="team-footnote">Area diperkirakan dari area tersimpan atau alamat. Buka Maps untuk memeriksa lokasi dan rute; waktu tempuh belum dihitung otomatis. Tentatif mencatat rencana pelanggan. Penugasan anggota dilakukan per tanggal di Planning Order.</p>
  </section>;
}
