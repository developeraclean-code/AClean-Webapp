import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('../../../api/_auth.js',()=>({checkRateLimit:vi.fn(()=>true)}));
import {validateVoucher,applyInvoiceVoucher,claimVoucher,cancelVoucher,adminVouchers,customerVouchers} from '../../../api/_handlers/voucher.js';
const id='10000000-0000-4000-8000-000000000001';
const body={code:'ACL-FIXTURE',invoice_id:'A',edit:{lines:[{nama:'Cleaning',jumlah:1,harga_satuan:100000,keterangan:'jasa'}]},request_id:'20000000-0000-4000-8000-000000000001',expected_updated_at:'2026-11-12T00:00:00Z',quote_hash:'a'.repeat(64)};
const req=(patch={})=>({method:'POST',body,appClaims:{userId:id,role:'Owner'},...patch});
const res=()=>({setHeader:vi.fn(),status(n){this.code=n;return this;},json(data){this.data=data;return this;}});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
let fetcher;
beforeEach(()=>{vi.stubEnv('SUPABASE_URL','https://fixture.invalid');vi.stubEnv('SUPABASE_SERVICE_KEY','fixture');fetcher=vi.fn(async(url,opts)=>{
 if(url.includes('/user_profiles?'))return json([{id,name:'Owner Fiktif',role:'Owner',active:true}]);
 if(url.includes('/invoices?'))return json([{id:'A',customer:'Fiktif',phone:'6281234567890'}]);
 if(url.includes('voucher_quote_241'))return json({voucher:{id:'v',code:'ACL-FIXTURE',type:'discount_pct',value:10},discount:10000,total:90000});
 if(url.includes('save_invoice_voucher_241'))return json({invoice:{id:'A',total:90000,voucher_code:'ACL-FIXTURE'}});
 return json({ok:true});
});vi.stubGlobal('fetch',fetcher);});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('voucher API guards and atomic entrypoint',()=>{
 it('preview never claims, server recomputes summary',async()=>{const r=res();await validateVoucher(req(),r);expect(r.code).toBe(200);expect(fetcher.mock.calls.map(c=>c[0]).some(x=>x.includes('save_invoice'))).toBe(false);const p=JSON.parse(fetcher.mock.calls.at(-1)[1].body);expect(p.p_edit.labor).toBe(100000);expect(p.p_edit.material).toBe(0);});
 it('only one RPC writes invoice and claim',async()=>{const r=res();await applyInvoiceVoucher(req(),r);expect(r.code).toBe(200);const writes=fetcher.mock.calls.filter(c=>c[1].method!=='GET');expect(writes).toHaveLength(1);expect(writes[0][0]).toContain('/rpc/save_invoice_voucher_241');expect(JSON.parse(writes[0][1].body).p_request).toBe(body.request_id);});
 it.each(['Teknisi','Helper','Finance'])('rejects %s before service access',async role=>{const r=res();await cancelVoucher(req({appClaims:{userId:id,role}}),r);expect(r.code).toBe(403);expect(fetcher).not.toHaveBeenCalled();});
 it('rechecks deactivated Owner profile',async()=>{fetcher.mockResolvedValueOnce(json([{id,name:'Fiktif',role:'Owner',active:false}]));const r=res();await validateVoucher(req(),r);expect(r.code).toBe(403);expect(fetcher).toHaveBeenCalledTimes(1);});
 it('dependency failure stays 503, never changes to auth denial or empty list',async()=>{fetcher.mockRejectedValue(new Error('fixture down'));const r=res();await adminVouchers(req({method:'GET',query:{}}),r);expect(r.code).toBe(503);expect(r.data.vouchers).toBeUndefined();});
 it('legacy standalone claim is rejected without mutation',async()=>{const r=res();await claimVoucher(req(),r);expect(r.code).toBe(409);expect(fetcher.mock.calls.every(c=>c[1].method==='GET')).toBe(true);});
 it('expired portal denied and cancelled vouchers excluded in database query',async()=>{fetcher.mockImplementation(async url=>url.includes('customer_tokens')?json([{phone:'081234567890',expires_at:null}]):json([]));const r=res();await customerVouchers(req({method:'GET',query:{token:'a'.repeat(48)}}),r);expect(r.code).toBe(200);const u=new URL(fetcher.mock.calls.at(-1)[0]);expect(u.searchParams.get('is_valid')).toBe('eq.true');expect(u.searchParams.get('and')).toContain('expires_at.is.null');});
 it('portal dependency failure is visible',async()=>{fetcher.mockRejectedValue(new Error('down'));const r=res();await customerVouchers(req({method:'GET',query:{token:'a'.repeat(48)}}),r);expect(r.code).toBe(503);});
});
