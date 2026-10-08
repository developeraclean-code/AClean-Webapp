import { shiftDateStr } from './dateTime.js';
import { normalizePhone } from './phone.js';
export const PERSON_FIELDS = ['teknisi','teknisi2','teknisi3','helper','helper2','helper3'];
export const EDITABLE_PLAN = ['PENDING','CONFIRMED','DISPATCHED'];
export const ACTIVE_PLAN = [...EDITABLE_PLAN,'ON_SITE','IN_PROGRESS'];
export const minutes = value => { const m=/^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value || ''); return m && +m[1]<24 && +m[2]<60 ? +m[1]*60 + +m[2] : NaN; };
export const clockTime = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function planningHours(service, units) {
  const u=Number(units)||1;
  if(service==='Install')return Math.min(u*2.5,8);
  if(service==='Repair')return Math.ceil(u*1.5);
  if(service==='Complain')return Math.max(.5,u*.5);
  return u<=3?u:u<=4?3:u<=6?4:u<=8?5:u<=10?6:8;
}
export const estimatedEnd = (time,service,units) => { const end=minutes(time)+planningHours(service,units)*60; return Number.isFinite(end) && end<1440 ? clockTime(end) : ""; };
export function planningWeek(today,offset=0) {
  const dow=new Date(`${today}T12:00:00Z`).getUTCDay();
  const first=shiftDateStr(today,(dow===0?-6:1-dow)+offset*7);
  return Array.from({length:7},(_,i)=>({date:shiftDateStr(first,i),label:['Sen','Sel','Rab','Kam','Jum','Sab','Min'][i]}));
}
export function planningWeekOffset(today,date) {
  return Math.floor((Date.parse(date+'T12:00:00Z')-Date.parse(planningWeek(today)[0].date+'T12:00:00Z'))/(7*86400000));
}
export function planningTeams(presets=[],rosters=[],orders=[]) {
  // Presets define growth. Retain historical slots with a roster/job; no phantom Team 09/10.
  return [...new Set([...presets.map(p=>p.slot),...rosters.map(r=>r.slot),...orders.map(o=>o.team_slot)].filter(Boolean))]
    .sort((a,b)=>{const rank=t=>t.startsWith('Team ')?0:t.startsWith('Maintenance ')?1:t.startsWith('Malam ')?2:3;return rank(a)-rank(b) || a.localeCompare(b,'en',{numeric:true});});
}
export function rosterMembers(row) {
  return Array.from({length:8},(_,i)=>({name:row?.[`member${i+1}`],role:row?.[`member${i+1}_role`] || (i===0?'teknisi':'helper')})).filter(m=>m.name);
}
export const isAbsent = a => a.is_available===false || ['IJIN','SAKIT','ALPA','OFF'].includes(a.status);
export function teamReadiness(team,date,rosters,absences,order) {
  const roster=rosters.find(r=>r.slot===team && r.date===date);
  const members=roster ? rosterMembers(roster) : PERSON_FIELDS.filter(f=>order?.[f]).map(f=>({name:order[f],role:f.startsWith('teknisi')?'teknisi':'helper'}));
  const missing=members.filter(m=>absences.some(a=>a.date===date && a.teknisi===m.name && isAbsent(a)));
  return {members,missing,label:missing.length?'Perlu pengganti':!team?'Belum ada tim':!members.length?'Anggota belum diisi':'Tim terisi',tone:missing.length?'danger':!members.length?'warning':'ready'};
}
export function teamSlotCrew(team,date,rosters=[],absences=[],presets=[]) {
  const roster=rosters.find(r=>r.slot===team && r.date===date);
  const members=roster ? rosterMembers(roster) : [];
  const technicians=members.filter(m=>m.role==='teknisi').map(m=>m.name);
  const preset=presets.find(p=>p.slot===team)?.teknisi?.trim();
  const names=roster ? technicians : preset ? [preset] : [];
  const missing=members.filter(m=>absences.some(a=>a.date===date && a.teknisi===m.name && isAbsent(a)));
  if(!roster && preset && absences.some(a=>a.date===date && a.teknisi===preset && isAbsent(a)))missing.push({name:preset,role:'teknisi'});
  return {
    names,
    source:roster ? 'roster' : preset ? 'preset' : 'empty',
    blocked:missing.length>0,
    detail:missing.length ? `${missing.map(m=>m.name).join(', ')} tidak tersedia · perlu pengganti` :
      roster ? technicians.length ? `Teknisi roster: ${technicians.join(', ')}` : 'Roster belum memiliki teknisi · tentatif' :
      preset ? `Teknisi preset: ${preset} · roster harian belum diisi` : 'Teknisi belum diisi · tentatif',
  };
}
export function planConflict(plan,orders,rosters) {
  if(!plan.team_slot)return null;
  const people=rosterMembers(rosters.find(r=>r.slot===plan.team_slot && r.date===plan.date)).map(m=>m.name);
  const jobs=orders.filter(o=>o.id!==plan.id && o.date===plan.date && ACTIVE_PLAN.includes(o.status));
  const own=jobs.filter(o=>o.team_slot===plan.team_slot);
  if(own.length>=6)return 'Tim sudah memiliki 6 pekerjaan pada tanggal ini.';
  return jobs.find(o=>{
    const other=[...PERSON_FIELDS.map(f=>o[f]),...rosterMembers(rosters.find(r=>r.slot===o.team_slot && r.date===o.date)).map(m=>m.name)];
    if(o.team_slot!==plan.team_slot && !people.some(p=>other.includes(p)))return false;
    const start=minutes(o.time),end=minutes(o.time_end || estimatedEnd(o.time,o.service,o.units));
    return !Number.isFinite(start+end) || end<=start || (minutes(plan.time)<end && minutes(plan.time_end)>start);
  }) ? 'Slot tim atau anggota bertabrakan dengan pekerjaan lain. Pilih jam/tim lain.' : null;
}
export function gridMoveProposal(order,team,rawStart) {
  if(!EDITABLE_PLAN.includes(order?.status) || order.project_id)return {error:'Pekerjaan ini tidak dapat dipindah melalui Jadwal.'};
  const oldStart=minutes(order.time),oldEnd=minutes(order.time_end || estimatedEnd(order.time,order.service,order.units));
  if(!Number.isFinite(oldStart+oldEnd) || oldStart<540 || oldEnd>1080 || oldEnd<=oldStart)return {error:'Pekerjaan di luar jam reguler perlu diubah melalui Planning Order.'};
  if(!Number.isFinite(rawStart))return {error:'Posisi jam tidak valid.'};
  const start=Math.round(rawStart/30)*30,end=start+oldEnd-oldStart;
  if(start<540 || end>1080)return {error:'Pekerjaan reguler harus berada pada 09:00–18:00 WIB.'};
  if((team || '')===(order.team_slot || '') && start===oldStart)return {error:'Posisi pekerjaan belum berubah.'};
  return {plan:{date:order.date,team_slot:team || '',time:clockTime(start),time_end:clockTime(end)}};
}
export function suggestedTeamSlots({date,team,service,units,orders,rosters,excludeId,now=new Date()}) {
  const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
  if(!team || !date || date<today || !Number.isInteger(Number(units)) || +units<1)return [];
  const current=minutes(now.toLocaleTimeString('en-GB',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit'}));
  const length=planningHours(service,units)*60, slots=[];
  const night=team.startsWith('Malam '),limit=night?1439:1080;
  for(let start=night?1080:540;start+length<=limit;start+=30){
    if(date===today && start<=current)continue;
    const plan={id:excludeId,date,team_slot:team,time:clockTime(start),time_end:clockTime(start+length)};
    if(!planConflict(plan,orders,rosters))slots.push(plan);
    if(slots.length===4)break;
  }
  return slots;
}
export function validatePlan(form) {
  if(!form.customer?.trim())return 'Nama pelanggan wajib diisi.';
  if(!/^\d{8,15}$/.test(normalizePhone(form.phone)))return 'Nomor pelanggan tidak valid.';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date || '') || !Number.isFinite(Date.parse(form.date+'T12:00:00Z')) || new Date(form.date+'T12:00:00Z').toISOString().slice(0,10)!==form.date)return 'Pilih tanggal pengerjaan yang valid.';
  if(!Number.isInteger(+form.units) || +form.units<1 || +form.units>100)return 'Jumlah unit harus 1–100.';
  if(!form.service?.trim())return 'Pilih layanan.';
  const start=minutes(form.time),end=minutes(form.time_end);
  if(!Number.isFinite(start+end) || start<540 || end<=start || end>1439)return 'Jam mulai–selesai harus valid, mulai minimal 09:00 dan selesai pada hari yang sama.';
  if(start<1080 && end>1080)return 'Pekerjaan reguler harus selesai maksimal 18:00.';
  if(start>=1080 && form.team_slot && !form.team_slot.startsWith('Malam '))return 'Pilih slot Malam untuk pekerjaan mulai 18:00 ke atas.';
  if(start<1080 && form.team_slot?.startsWith('Malam '))return 'Slot Malam dimulai pukul 18:00.';
  return null;
}
export function planSnapshot(order) {
  return Object.fromEntries(['date','time','time_end','team_slot','status','notes',...PERSON_FIELDS].map(k=>[k,order[k]??null]));
}
export async function loadPlanningRange(db,from,to) {
  const responses=await Promise.all([
    db.from('orders').select('*').gte('date',from).lte('date',to).limit(1000),
    db.from('daily_team_slots').select('*').gte('date',from).lte('date',to).limit(1000),
    db.from('technician_availability').select('date,teknisi,status,is_available').gte('date',from).lte('date',to).limit(1000),
    db.from('team_presets').select('slot,teknisi,sort_order').order('sort_order').limit(1000),
  ]);
  for(const r of responses)if(r.error || r.data?.length>=1000)throw new Error(r.error?.message || 'Data jadwal melebihi batas. Persempit rentang tanggal.');
  return Object.fromEntries(['orders','rosters','absences','presets'].map((k,i)=>[k,responses[i].data || []]));
}
