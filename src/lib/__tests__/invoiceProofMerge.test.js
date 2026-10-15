import { describe, expect, it, vi } from 'vitest';
import { retroMatchPayment } from '../retroMatch.js';
import { createConsolidatedInvoice } from '../consolidatedInvoice.js';
import { confirmInvoiceWaProof } from '../invoiceWaProof.js';
import { samePhone } from '../phone.js';
import * as invoicing from '../invoicing.js';

const phone='6281213125126';
const inv=(id,total=300,extra={})=>({id,phone,customer:'Ibu Mike',total,labor:total,material:0,discount:0,status:'UNPAID',paid_amount:0,remaining_amount:total,...extra});
const proof=(extra={})=>({id:'S1',phone,amount:300,status:'PENDING',validation_status:'PENDING',invoice_id:null,image_url:'proof.jpg',created_at:new Date().toISOString(),...extra});
function client(seed, errorAt = () => null) {
  const tables={invoices:[],payment_suggestions:[],...seed},reads=[];
  const db={tables,reads,rpc:vi.fn(async(name,args)=>{
    if(name==='link_payment_suggestion_for_review')return {data:{suggestion:{...tables.payment_suggestions.find(p=>p.id===args.p_suggestion_id),invoice_id:args.p_invoice_id}},error:null};
    return {data:null,error:{message:'RPC unavailable',code:'PGRST202'}};
  }),from(table){
    let data=[...tables[table]],start=0;
    const execute=async(single=false)=>{
      reads.push({table,start});const error=errorAt(table,start);
      return error?{data:null,error:{message:error}}:{data:single?data[0]:data,error:null};
    };
    const q={select(){return q;},eq(k,v){data=data.filter(r=>r[k]===v);return q;},in(k,vs){data=data.filter(r=>vs.includes(r[k]));return q;},
      is(k,v){data=data.filter(r=>(r[k]??null)===v);return q;},gte(k,v){data=data.filter(r=>r[k]>=v);return q;},
      order(k){data.sort((a,b)=>String(a[k]||'').localeCompare(String(b[k]||'')));return q;},
      range(from,to){start=from;data=data.slice(from,to+1);return execute();},single(){return execute(true);},
      then(resolve,reject){return execute().then(resolve,reject);},
    };return q;
  }};return db;
}
const ctx=db=>({supabase:db,currentUser:{name:'Owner'},showNotif:vi.fn(),addAgentLog:vi.fn(),
  setInvoicesData:vi.fn(),setOrdersData:vi.fn(),setPaymentSuggestions:vi.fn(),getLocalDate:()=> '2026-10-15',samePhone,...invoicing});

describe('retro-match is review only',()=>{
  it('links unique exact proof without invoice writes, confirmation, WA sends or cash',async()=>{
    const db=client({invoices:[inv('I1')],payment_suggestions:[proof()]});const log=vi.fn(),sendWA=vi.fn();
    expect(await retroMatchPayment(inv('I1'),{supabase:db,addAgentLog:log,sendWA})).toMatchObject({matched:true,suggestion:{status:'PENDING'}});
    expect(db.rpc).toHaveBeenCalledWith('link_payment_suggestion_for_review',{p_invoice_id:'I1',p_suggestion_id:'S1'});
    expect(sendWA).not.toHaveBeenCalled();expect(db.tables.invoices[0].payment_proof_url).toBeUndefined();
  });
  it.each(['PAID','CANCELLED','PENDING_APPROVAL'])('fresh status %s prevents stale approval matching',async status=>{
    const db=client({invoices:[inv('I1',300,{status})],payment_suggestions:[proof()]});
    expect((await retroMatchPayment(inv('I1'),{supabase:db})).matched).toBe(false);expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {invoices:[inv('I1'),inv('I2')],payment_suggestions:[proof()]},
    {invoices:[inv('I1'),inv('I2',100),inv('I3',200)],payment_suggestions:[proof()]},
    {invoices:[inv('I1')],payment_suggestions:[proof(),proof({id:'S2'})]},
    {invoices:[inv('I1')],payment_suggestions:[proof({amount:200})]},
    {invoices:[inv('I1')],payment_suggestions:[proof({amount:null})]},
    {invoices:[inv('I1')],payment_suggestions:[proof({phone:'6281213125127'})]},
    {invoices:[inv('I1')],payment_suggestions:[proof({image_url:null})]},
  ])('does not guess newest, fuzzy phone, ambiguous amount or combined payment',async seed=>{
    const db=client(seed);await retroMatchPayment(inv('I1'),{supabase:db});expect(db.rpc).not.toHaveBeenCalled();
  });
  it('matches remaining balance, not invoice total, for partial payment',async()=>{
    const db=client({invoices:[inv('I1',500,{status:'PARTIAL_PAID',paid_amount:200,remaining_amount:300,phone:'081213125126'})],payment_suggestions:[proof()]});
    expect((await retroMatchPayment(inv('I1'),{supabase:db})).matched).toBe(true);
  });
  it('reads beyond 200 rows and errors remain visible',async()=>{
    const items=Array.from({length:201},(_,n)=>proof({id:'S'+String(n).padStart(4,'0'),amount:n===200?300:1}));
    const db=client({invoices:[inv('I1')],payment_suggestions:items});
    expect((await retroMatchPayment(inv('I1'),{supabase:db})).matched).toBe(true);
    const failed=client({invoices:[inv('I1')],payment_suggestions:items},(table,start)=>table==='payment_suggestions'&&start===200?'page failed':null);
    const log=vi.fn();expect(await retroMatchPayment(inv('I1'),{supabase:failed,addAgentLog:log})).toMatchObject({matched:false,error:'page failed'});
    expect(log).toHaveBeenCalledWith('PAYMENT_REVIEW_MATCH_FAILED',expect.stringContaining('page failed'),'WARNING');
  });
  it('RPC/race errors never fall back to a direct update',async()=>{
    const db=client({invoices:[inv('I1')],payment_suggestions:[proof()]});db.rpc.mockResolvedValue({error:{message:'Invoice changed'}});
    expect(await retroMatchPayment(inv('I1'),{supabase:db})).toMatchObject({matched:false,error:'Invoice changed'});
  });
});

describe('consolidation client fails closed and updates all state from committed RPC',()=>{
  const a=()=>inv('I1',100),b=()=>inv('I2',200);
  it('uses one RPC; no client-side cancellation or suggestion updates',async()=>{
    const seed=[a(),b()],db=client({invoices:seed}),c=ctx(db);
    db.rpc.mockImplementation(async(_name,args)=>({data:{invoice:{...args.p_invoice,status:'UNPAID'},sources:seed.map(i=>({...i,status:'CANCELLED'})),orders:[{id:'J1',invoice_id:args.p_invoice.id}],suggestions:[proof({invoice_id:args.p_invoice.id})]}}));
    const result=await createConsolidatedInvoice(seed,c);expect(result.ok).toBe(true);expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(result.newInvoice.total).toBe(300);expect(result.newInvoice.payment_proof_url).toBeUndefined();
    expect(c.setOrdersData).toHaveBeenCalled();expect(c.setPaymentSuggestions).toHaveBeenCalled();
    const updated=c.setInvoicesData.mock.calls[0][0](seed);expect(updated).toHaveLength(3);expect(updated[1].status).toBe('CANCELLED');
  });
  it.each(['read','missing','stale','json','amount','phone','tax','quote','duplicate','rpc','malformed'])('%s failure leaves local state untouched and displays an error',async scenario=>{
    const seed=[a(),b()],input=structuredClone(seed);
    if(scenario==='missing')seed.pop();if(scenario==='stale')seed[0].total=101;
    if(scenario==='json')seed[0].materials_detail='{';if(scenario==='amount')seed[0].labor=99;
    if(scenario==='phone')seed[0].phone='628111111111';if(scenario==='tax')seed[0].pph23=true;
    if(scenario==='quote')seed[0].quotation_id='Q1';if(scenario==='duplicate')input[1]=input[0];
    const db=client({invoices:seed},()=>scenario==='read'?'Read failed':null),c=ctx(db);
    if(scenario==='malformed')db.rpc.mockResolvedValue({data:{invoice:{id:'NEW'}}});
    expect((await createConsolidatedInvoice(input,c)).ok).toBe(false);expect(c.setInvoicesData).not.toHaveBeenCalled();
    expect(c.showNotif).toHaveBeenCalledWith(expect.stringContaining('❌'));
  });
});

describe('atomic WA proof confirmation boundary',()=>{
  const input=()=>({supabase:{rpc:vi.fn()},invoiceId:'I1',suggestion:proof(),requestId:'REQUEST',reviewAcknowledged:true,actorName:'Owner'});
  const valid=()=>({invoice:inv('I1',300,{status:'PAID',payment_proof_url:'proof.jpg'}),suggestion:proof({status:'CONFIRMED',validation_status:'LINKED',invoice_id:'I1'}),orders:[]});
  it('passes proof identity and stable request ID, validates the full commit result',async()=>{
    const args=input();args.supabase.rpc.mockResolvedValue({data:valid()});
    expect((await confirmInvoiceWaProof(args)).invoice.status).toBe('PAID');
    expect(args.supabase.rpc).toHaveBeenCalledWith('confirm_invoice_wa_proof_atomic',expect.objectContaining({p_request_id:'REQUEST',p_expected_proof_url:'proof.jpg',p_review_ack:true}));
  });
  it.each(['status','proof','suggestion','orders','target'])('does not claim success for incomplete %s result',async field=>{
    const args=input(),result=valid();
    if(field==='status')result.invoice.status='UNPAID';if(field==='proof')result.invoice.payment_proof_url='other.jpg';
    if(field==='suggestion')result.suggestion.validation_status='PENDING';if(field==='orders')delete result.orders;
    if(field==='target')result.suggestion.invoice_id='I2';args.supabase.rpc.mockResolvedValue({data:result});
    await expect(confirmInvoiceWaProof(args)).rejects.toThrow(/belum lengkap/);
  });
  it('missing migration fails explicitly without fallback or false success',async()=>{
    const args=input();args.supabase.rpc.mockResolvedValue({error:{code:'PGRST202'}});
    await expect(confirmInvoiceWaProof(args)).rejects.toThrow(/Migrasi 206/);expect(args.supabase.rpc).toHaveBeenCalledTimes(1);
  });
});
