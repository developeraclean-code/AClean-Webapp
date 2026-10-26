import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("../../../api/sentry-init.js",()=>({initSentry(){}}));
import {getApiToken} from "../../../api/_handlers/auth-token.js";
import {validateInternalToken,verifyAppToken,signAppToken} from "../../../api/_auth.js";
import {readSessionJson} from "../../../api/_session-check.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
beforeEach(()=>{for(const [key,value]of Object.entries({SUPABASE_URL:"https://db.invalid",SUPABASE_ANON_KEY:"anon",SUPABASE_SERVICE_KEY:"service",INTERNAL_API_SECRET:"test-signing-secret"}))vi.stubEnv(key,value);});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
const req=()=>({method:"POST",headers:{authorization:"Bearer verified-by-server-only"}});
it("accepts a separately verified Supabase token when the proxy uses Basic Authorization",async()=>{
  const network=vi.fn(async url=>url.includes("/auth/v1/user")?json({id:"u1",email:"user@example.test"}):json([{id:"u1",role:"Owner",name:"User",active:true}]));
  vi.stubGlobal("fetch",network);
  const res=response();
  await getApiToken({method:"POST",headers:{authorization:"Basic browser-credential","x-supabase-access-token":"verified-by-server-only"}},res);
  expect(res.code).toBe(200);
  expect(verifyAppToken(res.body.token)).toMatchObject({userId:"u1",role:"Owner"});
  expect(network.mock.calls[0][1].headers.Authorization).toBe("Bearer verified-by-server-only");
});
it("rejects Basic Authorization without a Supabase token",async()=>{
  const network=vi.fn();vi.stubGlobal("fetch",network);
  const res=response();await getApiToken({method:"POST",headers:{authorization:"Basic browser-credential"}},res);
  expect(res.code).toBe(401);expect(network).not.toHaveBeenCalled();
});
it.each([429,500,503,504,522])("Auth HTTP %s is unavailable, never Invalid session or Helper fallback",async status=>{
  const network=vi.fn(async()=>json({message:"private upstream detail"},status));vi.stubGlobal("fetch",network);const res=response();
  await getApiToken(req(),res);expect(res.code).toBe(503);expect(res.body.code).toBe("AUTH_SERVICE_UNAVAILABLE");
  expect(res.headers["Retry-After"]).toBe("15");expect(res.body.token).toBeUndefined();expect(JSON.stringify(res.body)).not.toContain("private upstream detail");expect(network).toHaveBeenCalledTimes(1);
});
it.each(["Owner","Admin","Finance","Teknisi","Helper"])("issues exactly the verified active %s role",async role=>{
  const network=vi.fn(async url=>url.includes("/auth/v1/user")?json({id:"u1",email:"user@example.test"}):json([{id:"u1",role,name:"User",active:true}]));vi.stubGlobal("fetch",network);const res=response();
  await getApiToken(req(),res);expect(res.code).toBe(200);expect(verifyAppToken(res.body.token)).toMatchObject({userId:"u1",role});
  expect(network.mock.calls[1][0]).toContain("select=id,role,name,active");expect(res.headers["Cache-Control"]).toBe("no-store");
});
it.each([401,403])("preserves definite Auth rejection %s without signing a token",async status=>{
  vi.stubGlobal("fetch",vi.fn(async()=>json({},status)));const res=response();await getApiToken(req(),res);expect(res.code).toBe(status);expect(res.body.token).toBeUndefined();
});
it("does not downgrade an Owner to Helper if its profile database is unavailable",async()=>{
  vi.stubGlobal("fetch",vi.fn(async url=>url.includes("/auth/v1/user")?json({id:"u1"}):json({},503)));const res=response();await getApiToken(req(),res);
  expect(res.code).toBe(503);expect(res.body.token).toBeUndefined();
});
it.each([{rows:[]},{rows:[{id:"u1",role:"Owner",active:false}]},{rows:[{id:"u1",role:"Invented",active:true}]},{rows:[{id:"other-user",role:"Owner",active:true}]}])("rejects absent, inactive, invalid or mismatched profiles",async ({rows})=>{
  vi.stubGlobal("fetch",vi.fn(async url=>url.includes("/auth/v1/user")?json({id:"u1"}):json(rows)));const res=response();await getApiToken(req(),res);expect(res.code).toBe(403);expect(res.body.token).toBeUndefined();
});
it("malformed Auth success is a service failure, not verified login",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>json({})));const res=response();await getApiToken(req(),res);expect(res.code).toBe(503);
});
it("bounds both connection and response-body stalls",async()=>{
  vi.useFakeTimers();const network=vi.fn(async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}));
  const outcome=Promise.allSettled([readSessionJson("https://db.invalid/auth/v1/user",{},{fetchImpl:network,timeoutMs:50})]);
  await vi.advanceTimersByTimeAsync(51);expect((await outcome)[0].reason).toMatchObject({status:503,code:"AUTH_SERVICE_UNAVAILABLE"});expect(network.mock.calls[0][1].signal.aborted).toBe(true);
});
it("Bearer middleware preserves service unavailability rather than triggering session refresh",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>json({},503)));const res=response();expect(await validateInternalToken(req(),res)).toBe(false);expect(res.code).toBe(503);
});
it("signed App Tokens remain locally verified during a Supabase outage",async()=>{
  const network=vi.fn();vi.stubGlobal("fetch",network);const request={headers:{"x-internal-token":signAppToken({userId:"u1",role:"Helper",name:"User"})}};
  expect(await validateInternalToken(request,response())).toBe(true);expect(request.appClaims.role).toBe("Helper");expect(network).not.toHaveBeenCalled();
});
it("missing or tampered credentials never receive access",async()=>{
  for(const headers of [{},{"x-internal-token":"fake.fake.fake"}]){const res=response();expect(await validateInternalToken({headers},res)).toBe(false);expect(res.code).toBe(401);}
});
it("fails closed when self-hosted auth env is missing even without NODE_ENV=production",async()=>{
  vi.stubEnv("INTERNAL_API_SECRET","");
  vi.stubEnv("SUPABASE_URL","");
  vi.stubEnv("VITE_SUPABASE_URL","");
  vi.stubEnv("NODE_ENV","development");
  const res=response();
  expect(await validateInternalToken({headers:{}},res)).toBe(false);
  expect(res.code).toBe(500);
  expect(res.body).toEqual({error:"Server misconfiguration"});
});
