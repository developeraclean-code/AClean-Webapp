import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('../../../api/_tasks/_shared.js',()=>({sb:{},isCronJobEnabled:(map,key)=>!map.cron_jobs||JSON.parse(map.cron_jobs).find(j=>j.backendKey===key)?.active!==false}));
vi.mock('../../../api/_wa-workspace.js',async importOriginal=>({...await importOriginal(),deliverWorkspaceMessage:vi.fn()}));
import {runVoucherTask,voucherMessageId} from '../../../api/_tasks/vouchers.js';
import {dispatchWorkspaceMessage} from '../../../api/_wa-workspace.js';
const voucher={id:'10000000-0000-4000-8000-000000000001',phone:'081234567890',customer_name:'Fiktif',code:'ACL-FIXTURE',type:'discount_pct',value:10,description:'Hadiah fiktif',expires_at:'2099-01-01'};
function fixture({enabled=true,cronActive=true,updateFail=false,dbFail=false}={}) {
 const calls=[];
 const db={rpc:vi.fn(async()=>({data:{issued:1},error:null})),from(table){
  const q={table,write:false};const chain={};
  for(const method of ['select','in','eq','is','not','or','gte','lte','order','limit','update'])chain[method]=(...args)=>{calls.push({table,method,args});if(method==='update')q.write=true;return chain;};
  chain.then=(resolve,reject)=>Promise.resolve(dbFail?{error:{message:'fixture down'}}:table==='app_settings'?{data:['loyalty','winback','expiry_reminder'].map(kind=>({key:`voucher_${kind}_enabled`,value:String(enabled)})).concat([{key:'cron_jobs',value:JSON.stringify([{backendKey:'voucher_loyalty_enabled',active:cronActive}])}])}:q.write?updateFail?{error:{message:'fixture update failure'}}:{data:[{id:voucher.id}]}:{data:[voucher]}).then(resolve,reject);return chain;
 }};return {db,calls};
}
beforeEach(()=>vi.clearAllMocks());
describe('independent voucher tasks and durable message IDs',()=>{
 it('standalone OFF or cron OFF never issues or sends',async()=>{for(const option of [{enabled:false},{cronActive:false}]){const {db}=fixture(option),deliver=vi.fn();expect(await runVoucherTask('loyalty',{db,deliver})).toEqual({skipped:true});expect(db.rpc).not.toHaveBeenCalled();expect(deliver).not.toHaveBeenCalled();}});
 it.each(['loyalty','winback'])('%s runs without rating/portal/service reminder toggles',async kind=>{const {db}=fixture();const dispatch=vi.fn(async()=>({status:'ACCEPTED'}));const r=await runVoucherTask(kind,{db,dispatch});expect(db.rpc).toHaveBeenCalledWith('issue_vouchers_241',{p_kind:kind,p_limit:5});expect(r.sent).toBe(1);expect(dispatch.mock.calls[0][2].kind).toBe('TEXT');});
 it('database outages are errors, never empty success',async()=>{await expect(runVoucherTask('loyalty',{db:fixture({dbFail:true}).db})).rejects.toThrow(/Database/);});
 it('an accepted send followed by tracking failure cannot send twice',async()=>{
  const {db}=fixture({updateFail:true}),outbox=new Map();let providerCalls=0;
  db.rpc=vi.fn(async(name,args)=>{
   if(name==='issue_vouchers_241')return {data:{issued:0}};
   if(name==='claim_wa_send'){const row=outbox.get(args.p_id);if(row)return {data:{claimed:false,row}};const pending={id:args.p_id,status:'SENDING',payload:args.p_payload};outbox.set(args.p_id,pending);return {data:{claimed:true,row:pending}};}
   const row={...outbox.get(args.p_id),status:args.p_status};outbox.set(args.p_id,row);return {data:row};
  });
  const deliver=async()=>{providerCalls++;return {status:'ACCEPTED'};};
  for(let n=0;n<2;n++)await expect(runVoucherTask('expiry',{db,dispatch:dispatchWorkspaceMessage,deliver})).rejects.toThrow(/Database/);
  expect(providerCalls).toBe(1);
 });
 it('uncertain/audit-pending outcomes are retained for review and never marked sent',async()=>{const {db,calls}=fixture();const r=await runVoucherTask('loyalty',{db,dispatch:async()=>({status:'ACCEPTED',audit_pending:true})});expect(r.review_required).toBe(1);expect(calls.find(c=>c.method==='update').args[0]).toEqual({issued_message_sent:false,issued_message_status:'UNCERTAIN'});});
 it('expiry boundaries use WIB; issuance and expiry have separate stable IDs',async()=>{const {db,calls}=fixture();await runVoucherTask('expiry',{db,dispatch:async()=>({status:'ACCEPTED'}),today:'2026-11-13'});expect(calls.find(c=>c.method==='lte').args).toEqual(['expires_at','2026-11-16']);expect(voucherMessageId(voucher.id,'issuance')).not.toBe(voucherMessageId(voucher.id,'expiry'));});
});
