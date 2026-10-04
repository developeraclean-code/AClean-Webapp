import { useState } from 'react';
import { usePlanningData } from '../lib/usePlanningData.js';
import { planningTeams, teamReadiness, minutes, estimatedEnd, ACTIVE_PLAN, EDITABLE_PLAN, planConflict } from '../lib/teamPlanning.js';
import { statusLabel } from '../constants/status.js';
import './TeamSchedule.css';
const label = status => status==='PENDING'?'Tentatif':status==='CONFIRMED'?'Terkonfirmasi':statusLabel[status] || status;
export default function TeamScheduleBoard({ supabase, days, revision, search='', person='Semua', accepts=()=>true, onPlan, onManageTeams, renderActions }) {
  const {data,loading,error,reload}=usePlanningData(supabase,days[0].date,days[6].date,revision);
  const [team,setTeam]=useState('Semua'),[status,setStatus]=useState('active'),[detailDate,setDetailDate]=useState('');
  const allTeams=planningTeams(data.presets,data.rosters,data.orders);
  const displayedTeams=team==='Semua'?['',...allTeams]:[team==='unassigned'?'':team];
  const q=search.trim().toLowerCase();
  const jobs=data.orders.filter(o=>{
    if(status==='active' && o.status==='CANCELLED')return false;
    if(status==='pending' && o.status!=='PENDING')return false;
    const ready=teamReadiness(o.team_slot,o.date,data.rosters,data.absences,o);
    if(status==='attention' && (!ACTIVE_PLAN.includes(o.status) || ready.tone==='ready'))return false;
    if(person!=='Semua' && ![o.teknisi,o.helper,o.teknisi2,o.helper2,o.teknisi3,o.helper3,...ready.members.map(m=>m.name)].includes(person))return false;
    return (!q || [o.customer,o.phone,o.address,o.id,o.service,o.team_slot,...ready.members.map(m=>m.name)].some(v=>String(v||'').toLowerCase().includes(q))) && accepts(o);
  }).sort((a,b)=>(a.time || '').localeCompare(b.time || ''));
  const selectedDay=days.some(d=>d.date===detailDate)?detailDate:days[0].date;
  const dayJobs=jobs.filter(o=>o.date===selectedDay);
  const attention=data.orders.filter(o=>ACTIVE_PLAN.includes(o.status) && teamReadiness(o.team_slot,o.date,data.rosters,data.absences,o).tone!=='ready').length;
  const card=(job,compact=false)=>{
    const ready=teamReadiness(job.team_slot,job.date,data.rosters,data.absences,job);
    const conflict=ACTIVE_PLAN.includes(job.status) && planConflict(job,data.orders,data.rosters);
    return <article className={`team-job ${job.status==='PENDING'?'tentative':''} ${job.status==='CANCELLED'?'cancelled':''} ${conflict?'clash':''}`} key={job.id} data-job-id={job.id}>
      <button className="team-job-main" aria-label={`${job.customer}, ${job.date}, ${job.time}–${job.time_end || estimatedEnd(job.time,job.service,job.units)}, ${job.team_slot || 'Belum ada tim'}`} onClick={()=>onPlan(job)}>
        <span className="team-job-time">{job.time?.slice(0,5) || 'Jam belum ada'}–{job.time_end?.slice(0,5) || estimatedEnd(job.time,job.service,job.units)}</span>
        <strong>{job.customer}</strong><small>{job.service} · {job.units || 1} unit</small>
        <span className="team-state">{label(job.status)}</span>
        {!compact && <small className={ready.tone==='danger'?'team-danger':''}>{ready.label}{ready.missing.length?` · ${ready.missing.map(m=>m.name).join(', ')}`:''}</small>}
        {conflict && <small className="team-danger">Benturan jadwal</small>}
      </button>
      {!compact && renderActions?.(job)}
    </article>;
  };
  return <section className="team-board" aria-label="Jadwal mingguan per Team">
    <div className="team-board-heading"><div><span className="team-eyebrow">PERENCANAAN MINGGUAN</span><h2>Tim tetap. Anggota fleksibel.</h2><p>{data.orders.filter(o=>o.status!=='CANCELLED').length} pekerjaan · {attention} perlu tim / pengganti</p></div><div className="team-actions"><button onClick={reload} disabled={loading}>{loading?'Memuat…':'↻ Muat ulang'}</button><button onClick={onManageTeams}>Atur anggota harian</button></div></div>
    <div className="team-board-filters"><label>Team<select value={team} onChange={e=>setTeam(e.target.value)}><option>Semua</option><option value="unassigned">Belum ada tim</option>{allTeams.map(t=><option key={t}>{t}</option>)}</select></label><label>Tampilkan<select value={status} onChange={e=>setStatus(e.target.value)}><option value="active">Aktif & selesai</option><option value="pending">Tentatif</option><option value="attention">Perlu tim / pengganti</option><option value="all">Semua, termasuk batal</option></select></label><span className="team-legend">▧ Tentatif · ● Terkonfirmasi · <b>Merah: perlu diperiksa</b></span></div>
    {error && <p className="team-alert" role="alert">{error}. Data lama belum diperbarui; muat ulang sebelum menjadwalkan.</p>}
    {!loading && !error && !allTeams.length && <p className="team-warning">Belum ada preset Team. Tambahkan preset atau simpan rencana sebagai “Belum ada tim”.</p>}
    <div className="team-week-scroll" aria-label="Kalender tujuh hari" tabIndex={0}>
      <div className="team-week-grid">
        <div className="team-axis">TEAM / HARI</div>{days.map(d=><button className={`team-day ${d.date===selectedDay?'selected':''}`} key={d.date} onClick={()=>setDetailDate(d.date)}><b>{d.label.split(' ')[0]}</b><span>{d.date.slice(8)}/{d.date.slice(5,7)}</span><small>{jobs.filter(o=>o.date===d.date && o.status!=='CANCELLED').length} job · lihat jam ↓</small></button>)}
        {displayedTeams.map(slot=><div className="team-week-row" key={slot || 'unassigned'}>
          <div className="team-row-label"><b>{slot || 'Belum ada tim'}</b><small>{slot?'Anggota per hari →':'Rencana tetap tercatat'}</small></div>
          {days.map(d=>{
            const own=jobs.filter(o=>o.date===d.date && (o.team_slot || '')===slot);
            const ready=teamReadiness(slot,d.date,data.rosters,data.absences,own[0]);
            const start=slot.startsWith('Malam ')?18:9,end=slot.startsWith('Malam ')?24:18;
            return <div className="team-day-cell" key={d.date} data-team={slot || 'unassigned'} data-date={d.date}>
              {slot && <div className={`team-crew ${ready.tone}`} title={ready.members.map(m=>`${m.name} (${m.role})`).join(', ')}>{ready.members.length?ready.members.map((m,i)=><span key={i}>{m.role==='teknisi'?'T':'H'} · {m.name}{ready.missing.some(x=>x.name===m.name)?' · absen':''}</span>):<span>Anggota belum diisi</span>}</div>}
              <div className="team-mini-hours" aria-label={`Jam ${start} sampai ${end}`}><div>{Array.from({length:end-start+1},(_,i)=><span key={i}>{String(start+i).padStart(2,'0')}</span>)}</div><div className="team-mini-track">{own.filter(o=>o.status!=='CANCELLED').map(o=>{const a=minutes(o.time),b=minutes(o.time_end || estimatedEnd(o.time,o.service,o.units));return Number.isFinite(a+b)?<i key={o.id} title={`${o.customer}: ${o.time}–${o.time_end}`} style={{left:`${Math.max(0,(a-start*60)/((end-start)*60)*100)}%`,width:`${Math.max(1,Math.min(b-a,end*60-a)/((end-start)*60)*100)}%`}}/>:null;})}</div></div>
              {own.map(o=>card(o))}
              {!own.length && <span className="team-empty">—</span>}
              <button className="team-add" disabled={loading || !!error} onClick={()=>onPlan(null,{date:d.date,team_slot:slot,time:slot.startsWith('Malam ')?'18:00':'09:00'})}>+ Rencanakan</button>
            </div>;
          })}
        </div>)}
      </div>
    </div>
    <div className="team-day-detail"><div className="team-board-heading"><div><span className="team-eyebrow">JAM PENGERJAAN · WIB</span><h3>{selectedDay}</h3><p>Klik hari di kalender untuk melihat pembagian jam.</p></div><span>{dayJobs.length} pekerjaan</span></div>
      <div className="team-time-scroll" tabIndex={0} aria-label="Timeline harian"><div className="team-time-grid"><div className="team-time-head"><b>Team</b><div>{Array.from({length:15},(_,i)=><span key={i}>{String(i+9).padStart(2,'0')}:00</span>)}</div></div>
        {displayedTeams.map(slot=><div className="team-time-row" key={slot || 'unassigned'}><b>{slot || 'Belum ada tim'}</b><div className="team-time-lanes">{dayJobs.filter(o=>(o.team_slot||'')===slot).map(o=>{const a=minutes(o.time),b=minutes(o.time_end || estimatedEnd(o.time,o.service,o.units));return <div className="team-time-lane" key={o.id}><button disabled={!Number.isFinite(a+b)} onClick={()=>onPlan(o)} title={`${o.customer} ${o.time}–${o.time_end}`} style={{left:`${Math.max(0,(a-540)/900*100)}%`,width:`${Math.max(4,Math.min(b-a,1440-a)/900*100)}%`}}>{o.time?.slice(0,5)}–{o.time_end?.slice(0,5)} · {o.customer}</button></div>;})}</div></div>)}
      </div></div>
    </div>
    <p className="team-footnote">Tentatif mencatat rencana pelanggan. Team yang belum memiliki anggota tetap terlihat; penugasan dan perubahan anggota dilakukan per tanggal di Planning Order.</p>
  </section>;
}
