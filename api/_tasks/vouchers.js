import { createHash } from 'node:crypto';
import { dispatchWorkspaceMessage, deliverWorkspaceMessage } from '../_wa-workspace.js';
import { sb, isCronJobEnabled } from './_shared.js';
import { voucherTodayWib, voucherPhone } from '../../src/lib/voucherPolicy.js';

export function voucherMessageId(id, purpose) {
  const h=createHash('sha256').update(`aclean-voucher-241:${id}:${purpose}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
const checked = result => {if(result.error) throw new Error('Database otomasi voucher gagal');return result.data;};
export async function runVoucherTask(kind, {db=sb,dispatch=dispatchWorkspaceMessage,deliver=payload=>deliverWorkspaceMessage(payload,{timeoutMs:6000}),today=voucherTodayWib()}={}) {
  const toggle=`voucher_${kind==='expiry'?'expiry_reminder':kind}_enabled`;
  const settings=checked(await db.from('app_settings').select('key,value').in('key',[toggle,'cron_jobs']));
  const map=Object.fromEntries((settings||[]).map(s=>[s.key,s.value]));
  if(map[toggle]!=='true'||!isCronJobEnabled(map,toggle)) return {skipped:true};
  const issued=kind==='expiry'?{issued:0}:checked(await db.rpc('issue_vouchers_241',{p_kind:kind,p_limit:5}));
  const flag=kind==='expiry'?'reminder_sent':'issued_message_sent';
  const state=kind==='expiry'?'reminder_status':'issued_message_status';
  let query=db.from('customer_vouchers').select('id,phone,customer_name,code,type,value,description,expires_at').eq('is_valid',true).is('claimed_at',null).eq(flag,false).is(state,null);
  if(kind==='expiry') {
    const end=new Date(`${today}T00:00:00+07:00`);end.setUTCDate(end.getUTCDate()+3);
    query=query.gte('expires_at',today).lte('expires_at',voucherTodayWib(end));
  } else query=query.eq('trigger',kind==='loyalty'?'milestone':'winback').not('issuance_key','is',null).or(`expires_at.is.null,expires_at.gte.${today}`);
  const vouchers=checked(await query.order('created_at',{ascending:true}).order('id',{ascending:true}).limit(2))||[];
  // One provider attempt per continuation keeps a cron tick within its budget.
  const v=vouchers[0];if(!v)return {...issued,sent:0,has_more:Boolean(issued.has_more)};
  const label=v.type==='discount_pct'?`Diskon ${v.value}% jasa`:v.type==='free_unit'?`${v.value} unit Cleaning gratis`:'Jasa gratis';
  const message=kind==='expiry'
    ? `Halo ${v.customer_name||'Pelanggan'}! ⏰\n\nVoucher *${label}* (kode: *${v.code}*) berakhir pada *${v.expires_at}*.\nSebutkan kode saat booking sebelum masa berlaku habis.\n— AClean Service`
    : `🎁 Halo ${v.customer_name||'Pelanggan'}!\n\n${v.description||label}\nKode voucher: *${v.code}*\n${v.expires_at?`Berlaku hingga ${v.expires_at}.\n`:''}Berlaku untuk jasa sesuai jenis voucher; material/biaya tetap tidak termasuk. Potongan terbaik dipakai tanpa menumpuk diskon manual. Sebutkan kode saat booking berikutnya.\n— AClean Service`;
  const row=await dispatch(db,voucherMessageId(v.id,kind==='expiry'?'expiry':'issuance'),{phone:voucherPhone(v.phone),kind:'TEXT',customer_id:null,document_id:null,message,url:null,filename:null},'Otomasi voucher',deliver);
  const status=row.audit_pending?'UNCERTAIN':row.status;
  if(!['SENDING','ACCEPTED','FAILED','UNCERTAIN'].includes(status))throw new Error('Status pengiriman voucher belum terkonfirmasi');
  const accepted=status==='ACCEPTED';
  const updated=await db.from('customer_vouchers').update({[flag]:accepted,[state]:status}).eq('id',v.id).select('id');
  checked(updated);if(!updated.data?.length)throw new Error('Status pesan voucher belum tersimpan');
  return {...issued,sent:accepted?1:0,review_required:accepted?0:1,has_more:vouchers.length>1||Boolean(issued.has_more),items_processed:1};
}
export const taskVoucherLoyalty=()=>runVoucherTask('loyalty');
export const taskVoucherWinback=()=>runVoucherTask('winback');
export const taskVoucherExpiryReminder=()=>runVoucherTask('expiry');
