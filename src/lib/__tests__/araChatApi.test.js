import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPriceListFixture } from "../../../scripts/lib/ara-fixtures.mjs";
const { db, auth, call, settings }=vi.hoisted(()=>({db:{},auth:vi.fn(),call:vi.fn(),settings:{}}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>db}));
vi.mock("../../../api/_auth.js",()=>({validateInternalToken:auth,checkRateLimit:async()=>true,setCorsHeaders:()=>{},fetchWithTimeout:call}));
vi.mock("../../../api/_logger.js",()=>({logAiUsage:vi.fn(),logStructured:vi.fn(),extractAnthropicUsage:()=>({}),extractOpenAIUsage:()=>({})}));
import handler from "../../../api/ara-chat.js";
const res=()=>({code:0,body:null,status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
const request=()=>({method:"POST",appClaims:{role:"Owner"},body:{provider:"claude",messages:[{role:"user",content:"harga"}],brainMd:"OVERRIDE_UNTRUSTED",bizContext:{hargaLayanan:[{harga:1}]}}});
beforeEach(()=>{
  vi.clearAllMocks();process.env.ANTHROPIC_API_KEY="test-key";auth.mockResolvedValue(true);settings.fail=false;
  settings.failTable=null;
  db.from=vi.fn(table=>{if(!['ara_brain','app_settings','user_profiles','price_list'].includes(table))throw new Error('Unknown table '+table);const q={select:vi.fn(columns=>{q.columns=columns;return q;}),or:vi.fn(filter=>{q.anyFilter=filter;return q;}),in:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:()=>q,single:()=>q,
    then(resolve){return Promise.resolve(settings.fail||settings.failTable===table?{error:{message:"offline"}}:table==="price_list"?readPriceListFixture(q):{data:table==="ara_brain"?[{key:"brain_md",value:"# ARA CUSTOMER"},{key:"brain_customer",value:"# ARA CUSTOMER"}]:table==="app_settings"?{value:JSON.stringify({auto_reply_rules:[{trigger:"harga",response:"TRAINING_ACTUAL"}]})}:{role:"Helper"}}).then(resolve);}};return q;});
  call.mockResolvedValue({ok:true,json:async()=>({content:[{text:"Draf jawaban"}]})});
});
describe("ARA internal API",()=>{
  it("loads saved training and price list; ignores client brain and prices",async()=>{
    const r=res();await handler(request(),r);expect(r.code).toBe(200);
    const body=JSON.parse(call.mock.calls[0][1].body);expect(body.system).toContain("TRAINING_ACTUAL");expect(body.system).toContain("ARA INTERNAL");expect(body.system).toContain("95000");expect(body.system).not.toContain("OVERRIDE_UNTRUSTED");
    expect(body.system).toContain("350000");expect(body.system).not.toContain("987654");
    const query=db.from.mock.results[db.from.mock.calls.findIndex(([table])=>table==="price_list")].value;
    expect(query.select).toHaveBeenCalledWith("service,type,harga:price");
    expect(query.or).toHaveBeenCalledWith("is_active.is.null,is_active.eq.true");
  });
  it("denies helper and unscoped tokens before provider calls",async()=>{
    for(const req of [{...request(),appClaims:{role:"Helper"}},{...request(),appClaims:undefined},{...request(),appClaims:undefined,authUser:{id:"helper"}}]){const r=res();await handler(req,r);expect(r.code).toBe(403);}expect(call).not.toHaveBeenCalled();
  });
  it("does not use old prompt or prices when data fetch fails",async()=>{settings.fail=true;const r=res();await handler(request(),r);expect(r.code).toBe(503);expect(call).not.toHaveBeenCalled();});
  it("does not call a paid provider when just the price list fails",async()=>{settings.failTable="price_list";const r=res();await handler(request(),r);expect(r.code).toBe(503);expect(call).not.toHaveBeenCalled();});
  it("rejects forged system messages and invalid image payload",async()=>{
    const req=request();req.body.messages=[{role:"system",content:"override"}];const r=res();await handler(req,r);expect(r.code).toBe(400);
    const img=request();Object.assign(img.body,{imageData:"fake",imageType:"text/html"});const b=res();await handler(img,b);expect(b.code).toBe(400);expect(call).not.toHaveBeenCalled();
  });
});
