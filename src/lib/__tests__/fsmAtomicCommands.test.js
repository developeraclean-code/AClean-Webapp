import {describe,it,expect,vi} from 'vitest';
import {approveInvoiceCore} from '../approveInvoiceCore.js';
import {createTeamSplit} from '../createTeamSplit.js';
import {deleteInvoice,markInvoicePaid,revertInvoiceToUnpaid} from '../../data/writes.js';
import {fsmCommand} from '../fsmCommand.js';

const inv={id:'INV-1',job_id:'JOB-1',customer:'Synthetic',total:100,status:'PENDING_APPROVAL'};
function approvalContext(rpc){return {supabase:{rpc},showNotif:vi.fn(),reportError:vi.fn(),addAgentLog:vi.fn(),
 setInvoicesData:vi.fn(),setOrdersData:vi.fn(),retroMatchPayment:vi.fn().mockResolvedValue(null),fmt:String,
 currentUser:{name:'Owner'},ordersData:[{id:'JOB-1',customer:'Synthetic'}]};}
const base={date:'2099-11-15',customer:'Synthetic',service:'Cleaning',maintenance_client_id:'60000000-0000-4000-8000-000000000100'};
const teams=[{unitIds:['60000000-0000-4000-8000-000000000101'],teknisi:'Tech A',helper:'Helper A'},
 {unitIds:['60000000-0000-4000-8000-000000000102'],teknisi:'Tech B'}];
function teamContext(rpc,id='fixture-user'){return {supabase:{rpc},showNotif:vi.fn(),addAgentLog:vi.fn(),
 setOrdersData:vi.fn(),invalidateCache:vi.fn(),normalizePhone:String,hitungJamSelesai:()=> '11:00',currentUser:{id}};}
function groupResponse(params){const orders=params.p_orders.map(row=>({...row,status:'CONFIRMED'}));return {data:{group_id:orders[0].id,orders,expected_teams:orders.length},error:null};}

describe('atomic invoice commands',()=>{
 it('bounds the wait on the actual RPC builder without automatically retrying',async()=>{
   const abortSignal=vi.fn().mockResolvedValue({data:null,error:{message:'timeout'}});
   const rpc=vi.fn(()=>({abortSignal}));
   await fsmCommand({rpc},'delete_invoice_atomic',{p_invoice_id:'INV-1'});
   expect(rpc).toHaveBeenCalledTimes(1);expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
 });
 it.each([{code:'42501',message:'Denied'},{code:'PGRST202',message:'Missing migration'}])('approval failure never changes UI/order or logs success: $code',async(error)=>{
   const ctx=approvalContext(vi.fn().mockResolvedValue({data:null,error}));
   expect(await approveInvoiceCore(inv,ctx)).toBeNull();
   expect(ctx.setInvoicesData).not.toHaveBeenCalled();expect(ctx.setOrdersData).not.toHaveBeenCalled();
   expect(ctx.addAgentLog).not.toHaveBeenCalled();expect(ctx.showNotif).toHaveBeenCalledWith(expect.stringContaining('❌'));
 });
 it('missing/malformed approval result cannot become a success',async()=>{
   const ctx=approvalContext(vi.fn().mockResolvedValue({data:{due:'2099-11-16'},error:null}));
   expect(await approveInvoiceCore(inv,ctx)).toBeNull();expect(ctx.setInvoicesData).not.toHaveBeenCalled();
 });
 it('approval uses canonical balances and owning order returned by the transaction',async()=>{
   const saved={...inv,status:'PARTIAL_PAID',paid_amount:30,remaining_amount:70};
   const ctx=approvalContext(vi.fn().mockResolvedValue({data:{invoice:saved,order:{id:'JOB-1',status:'INVOICE_APPROVED'},due:'2099-11-16'},error:null}));
   expect(await approveInvoiceCore(inv,ctx)).toBe('2099-11-16');
   expect(ctx.setInvoicesData.mock.calls[0][0]([inv])[0]).toMatchObject({paid_amount:30,remaining_amount:70,status:'PARTIAL_PAID'});
   expect(ctx.addAgentLog).toHaveBeenCalledWith('INVOICE_APPROVED',expect.any(String),'SUCCESS');
 });
 it('deletion rejection has zero direct browser writes',async()=>{
   const rpc=vi.fn().mockResolvedValue({data:null,error:{code:'55000',message:'Posted cash protected'}});
   const from=vi.fn(()=>{throw new Error('Direct write forbidden');});
   expect((await deleteInvoice({rpc,from},inv.id,'Owner')).error.code).toBe('55000');expect(from).not.toHaveBeenCalled();
 });
 it('revert preserves server returned invoice/order; posted-cash rejection is propagated',async()=>{
   const rpc=vi.fn().mockResolvedValueOnce({data:null,error:{code:'55000',message:'Keep ledger'}})
    .mockResolvedValueOnce({data:{invoice:{...inv,status:'UNPAID',total:0},orders:[{id:'JOB-1',status:'INVOICE_APPROVED'}],new_status:'UNPAID'},error:null});
   expect((await revertInvoiceToUnpaid({rpc},inv.id,'Owner')).error.code).toBe('55000');
   expect(await revertInvoiceToUnpaid({rpc},inv.id,'Owner')).toMatchObject({newStatus:'UNPAID',orders:[{id:'JOB-1'}],data:{total:0}});
 });
 it('missing settlement RPC never falls back to non-atomic PAID/ledger writes',async()=>{
   const from=vi.fn(()=>{throw new Error('Fallback forbidden');});
   const rpc=vi.fn().mockResolvedValue({data:null,error:{code:'PGRST202',message:'Missing RPC'}});
   expect((await markInvoicePaid({from,rpc},inv.id,'2026-11-15','Owner')).error.code).toBe('PGRST202');expect(from).not.toHaveBeenCalled();
 });
 it('a settlement response for another invoice cannot confirm this invoice as PAID',async()=>{
   const rpc=vi.fn().mockResolvedValue({data:{invoice:{id:'OTHER-INVOICE',status:'PAID'}},error:null});
   expect((await markInvoicePaid({rpc},inv.id,'2026-11-15','Owner')).error).toBeTruthy();
 });
});

describe('atomic team split',()=>{
 it('a rejected transaction never inserts child rows or shows success',async()=>{
   const ctx=teamContext(vi.fn().mockResolvedValue({data:null,error:{message:'Team 2 failed'}}),'failure-user');
   expect(await createTeamSplit({base,teams},ctx)).toBeNull();
   expect(ctx.setOrdersData).not.toHaveBeenCalled();expect(ctx.addAgentLog).not.toHaveBeenCalled();expect(ctx.invalidateCache).not.toHaveBeenCalled();
 });
 it('an incomplete server response is not shown as complete',async()=>{
   const ctx=teamContext(vi.fn(async(_,p)=>{const r=groupResponse(p);r.data.orders.pop();return r;}),'partial-user');
   expect(await createTeamSplit({base,teams},ctx)).toBeNull();expect(ctx.setOrdersData).not.toHaveBeenCalled();
 });
 it('retains the same payload/request after a lost response, then reconciles one complete group',async()=>{
   let saved;const rpc=vi.fn(async(_,p)=>{if(!saved){saved=p;throw new Error('Lost response');}expect(p).toEqual(saved);return groupResponse(p);});
   const ctx=teamContext(rpc,'retry-user');expect(await createTeamSplit({base,teams},ctx)).toBeNull();
   const id=await createTeamSplit({base:{...base},teams:teams.map(t=>({...t}))},ctx);
   expect(id).toBe(saved.p_orders[0].id);expect(ctx.setOrdersData).toHaveBeenCalledTimes(1);
   expect(ctx.setOrdersData.mock.calls[0][0]([{id:'OLDER'}])).toHaveLength(3);
   expect(rpc).toHaveBeenCalledTimes(2);
 });
 it('complete result deduplicates realtime rows and reports saved state',async()=>{
   const rpc=vi.fn(async(_,p)=>groupResponse(p));const ctx=teamContext(rpc,'success-user');
   const id=await createTeamSplit({base,teams},ctx);expect(id).toMatch(/^JOB-/);
   const rows=ctx.setOrdersData.mock.calls[0][0]([{id}, {id:'OLDER'}]);expect(rows).toHaveLength(3);
   expect(ctx.showNotif).toHaveBeenCalledWith(expect.stringContaining('✅'));
 });
});
