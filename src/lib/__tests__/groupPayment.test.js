import { describe, expect, it, vi } from 'vitest';
import { createGroupPaymentRequest, groupInvoiceBalance, groupPaymentProof, groupPaymentError, handleGroupPayment } from '../groupPayment.js';
const invoices=[{id:'A',total:1655000,paid_amount:0,status:'UNPAID',phone:'628000000001'},
  {id:'B',total:2645000,paid_amount:0,status:'UNPAID',phone:'628000000001'}];
const make=(patch={})=>createGroupPaymentRequest({invoices,invoiceIds:['B','A'],totalReceived:4300000,
  customerPhone:'628000000001',method:'transfer',reviewAcknowledged:true,requestId:'fixed',paidAt:'2026-10-21T09:00:00Z',...patch});
const saved=()=>({payment:{id:1,amount:4300000,allocation_detail:{A:1655000,B:2645000}},
  invoices:invoices.map(i=>({...i,status:'PAID',paid_amount:i.total,remaining_amount:0})),orders:[]});
const client=result=>({rpc:vi.fn(()=>({abortSignal:vi.fn(async()=>result)})),from:vi.fn(()=>{throw new Error('Legacy writes forbidden');})});
describe('atomic group payments',()=>{
  it('only prefills a unique proof for the actual remaining total, never by phone alone',()=>{
    const proof={id:'proof',phone:'628000000001',amount:4300000,image_url:'test.jpg',status:'PENDING',validation_status:'PENDING'};
    expect(groupPaymentProof([proof],proof.phone,invoices)).toBe(proof);
    expect(groupPaymentProof([proof,{...proof,id:'other'}],proof.phone,invoices)).toBeNull();
    expect(groupPaymentProof([{...proof,amount:1}],proof.phone,invoices)).toBeNull();
    expect(groupPaymentProof([{...proof,status:'CONFIRMED'}],proof.phone,invoices)).toBeNull();
  });
  it('builds deterministic IDs, numeric snapshots and correct remaining balance',()=>{
    const req=make();expect(req.p_invoice_ids).toEqual(['A','B']);expect(req.p_expected.A).toMatchObject({paid_amount:0,remaining_amount:null});
    expect(groupInvoiceBalance({total:200,paid_amount:50,remaining_amount:200})).toBe(150);
  });
  it.each([0,-1,NaN,Infinity,1.5,4300001])('rejects unsafe amount %s',totalReceived=>expect(()=>make({totalReceived})).toThrow(/Nominal/));
  it.each([{invoiceIds:[]},{invoiceIds:['A','A']},{invoiceIds:['missing']},{reviewAcknowledged:false}])('rejects invalid review %j',patch=>expect(()=>make(patch)).toThrow());
  it('uses one RPC, validates the response and never calls legacy writes',async()=>{
    const sb=client({data:saved(),error:null});const req=make();expect((await handleGroupPayment(sb,req)).payment.id).toBe(1);
    expect(sb.rpc).toHaveBeenCalledExactlyOnceWith('record_group_payment_atomic',req);expect(sb.from).not.toHaveBeenCalled();
  });
  it.each(['PGRST202','57014','P0001','42501'])('returns visible error %s without fallback or retry',async code=>{
    const sb=client({data:null,error:{code,message:'Test denial'}});await expect(handleGroupPayment(sb,make())).rejects.toThrow();
    expect(sb.rpc).toHaveBeenCalledTimes(1);expect(sb.from).not.toHaveBeenCalled();
  });
  it.each([null,{...saved(),orders:null},{...saved(),invoices:[]},{...saved(),payment:{id:1,amount:4300000,allocation_detail:{A:1}}}])('never reports success from incomplete result %j',async data=>{
    await expect(handleGroupPayment(client({data,error:null}),make())).rejects.toThrow(/belum dapat dipastikan/);
  });
  it('retains the caller request unchanged through timeout and a manual retry',async()=>{
    const req=make(),sb=client({data:saved(),error:null});sb.rpc.mockImplementationOnce(()=>({abortSignal:async()=>{throw new Error('network');}}));
    const before=JSON.stringify(req);await expect(handleGroupPayment(sb,req)).rejects.toThrow(/ID tetap/);
    await handleGroupPayment(sb,req);expect(JSON.stringify(req)).toBe(before);expect(sb.rpc.mock.calls[0][1]).toBe(sb.rpc.mock.calls[1][1]);
  });
  it('requires the proof to be linked to the actual group on success',async()=>{
    await expect(handleGroupPayment(client({data:saved(),error:null}),make({suggestionId:'proof'}))).rejects.toThrow();
  });
  it('does not mislabel timeout as missing migration',()=>{
    expect(groupPaymentError({code:'57014'})).not.toMatch(/Migrasi/);
    expect(groupPaymentError({code:'PGRST202'})).toMatch(/220/);
    expect(groupPaymentError({code:'23502',message:'null value in column "invoice_id" of relation "payments" violates not-null constraint'})).toMatch(/221/);
  });
});
