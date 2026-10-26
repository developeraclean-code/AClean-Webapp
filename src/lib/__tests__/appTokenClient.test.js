import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppTokenClient } from "../appTokenClient.js";
afterEach(()=>vi.useRealTimers());
const session = (jwt="jwt-1",id="u1") => ({data:{session:{access_token:jwt,user:{id}}}});
const json = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json",...headers}});
function fixture(fetchImpl=vi.fn(async()=>json({token:"app-1",expiresIn:900})),options={}) {
  let time = 100_000;
  const auth={getSession:vi.fn(async()=>session()),refreshSession:vi.fn(async()=>session("jwt-2"))};
  const client=createAppTokenClient({auth,fetchImpl,now:()=>time,...options});client.setUser("u1");
  return {client,auth,fetchImpl,advance:ms=>{time+=ms;}};
}
describe("single-flight API token recovery",()=>{
  it("keeps the browser's Basic Authorization header free during token exchange and refresh",async()=>{
    const network=vi.fn().mockImplementationOnce(async()=>json({},401)).mockImplementationOnce(async()=>json({token:"app-fresh",expiresIn:900}));
    const {client}=fixture(network);
    expect(await client.getToken()).toBe("app-fresh");
    expect(network.mock.calls.map(([,options])=>options.headers["X-Supabase-Access-Token"])).toEqual(["jwt-1","jwt-2"]);
    expect(network.mock.calls.every(([,options])=>!Object.hasOwn(options.headers,"Authorization"))).toBe(true);
  });
  it("200 concurrent widgets use one verified exchange and one session lookup",async()=>{
    const {client,auth,fetchImpl}=fixture();
    const results=await Promise.all(Array.from({length:200},()=>client.headers()));
    expect(results.every(h=>h["X-Internal-Token"]==="app-1")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);expect(auth.getSession).toHaveBeenCalledTimes(1);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
  it.each([429,500,503,504])("HTTP %s: no refresh storm, 200 callers share cooldown, and one probe recovers",async status=>{
    let healthy=false;
    const network=vi.fn(async()=>healthy?json({token:"recovered",expiresIn:900}):json({error:"offline"},status));
    const {client,auth,advance}=fixture(network);
    const first=await Promise.allSettled(Array.from({length:200},()=>client.getToken()));
    expect(first.every(r=>r.status==="rejected"&&r.reason.status===503)).toBe(true);
    await Promise.allSettled(Array.from({length:200},()=>client.getToken()));
    expect(network).toHaveBeenCalledTimes(1);expect(auth.refreshSession).not.toHaveBeenCalled();
    advance(15_000);healthy=true;
    const recovered=await Promise.all(Array.from({length:200},()=>client.getToken()));
    expect(new Set(recovered)).toEqual(new Set(["recovered"]));expect(network).toHaveBeenCalledTimes(2);
  });
  it("increases outage cooldown and respects Retry-After",async()=>{
    const {client,advance,fetchImpl}=fixture(vi.fn(async()=>json({},503,{"Retry-After":"30"})));
    await expect(client.getToken()).rejects.toMatchObject({status:503});
    advance(29_000);await expect(client.getToken()).rejects.toMatchObject({retryAfter:1});expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(1000);await expect(client.getToken()).rejects.toMatchObject({status:503});expect(fetchImpl).toHaveBeenCalledTimes(2);
    advance(29_000);await expect(client.getToken()).rejects.toMatchObject({status:503});expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("refreshes a definitively rejected session once across 200 callers",async()=>{
    const network=vi.fn().mockImplementationOnce(async()=>json({},401)).mockImplementationOnce(async()=>json({token:"app-fresh",expiresIn:900}));
    const {client,auth}=fixture(network);
    const results=await Promise.all(Array.from({length:200},()=>client.getToken()));
    expect(results.every(t=>t==="app-fresh")).toBe(true);expect(network).toHaveBeenCalledTimes(2);expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
  it("does not refresh or manufacture a helper token after inactive-profile rejection",async()=>{
    const {client,auth}=fixture(vi.fn(async()=>json({},403)));
    await expect(client.getToken()).rejects.toMatchObject({status:403});expect(auth.refreshSession).not.toHaveBeenCalled();
  });
  it("bounds a hung session SDK and blocks a late exchange after timeout",async()=>{
    vi.useFakeTimers();const f=fixture(undefined,{timeoutMs:50});let resolve;
    f.auth.getSession.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const settled=Promise.allSettled([f.client.getToken()]);await vi.advanceTimersByTimeAsync(51);
    expect((await settled)[0].reason.status).toBe(503);
    resolve(session());await vi.advanceTimersByTimeAsync(1);expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("logout/account switch rejects old work and never caches the previous account token",async()=>{
    let resolve;const f=fixture(vi.fn(()=>new Promise(r=>{resolve=r;})));
    const old=Promise.allSettled([f.client.getToken()]);await Promise.resolve();await Promise.resolve();
    f.client.setUser("u2");resolve(json({token:"old-account",expiresIn:900}));
    expect((await old)[0].reason.code).toBe("SESSION_CHANGED");
    f.auth.getSession.mockResolvedValue(session("jwt-u2","u2"));f.fetchImpl.mockResolvedValue(json({token:"u2-app",expiresIn:900}));
    expect(await f.client.getToken()).toBe("u2-app");f.client.reset();
    await expect(f.client.getToken()).rejects.toMatchObject({status:401});
  });
  it("a valid cached token can survive failed proactive refresh, but never its actual expiry",async()=>{
    const f=fixture();expect(await f.client.getToken()).toBe("app-1");
    f.advance(841_000);f.fetchImpl.mockImplementation(async()=>json({},503));
    expect(await f.client.getToken()).toBe("app-1");
    f.advance(60_000);await expect(f.client.getToken()).rejects.toMatchObject({status:503});
  });
  it.each(["POST","PATCH","DELETE"])("never replays a %s mutation after 401",async method=>{
    const network=vi.fn(async url=>url==="/api/get-api-token"?json({token:"app-1",expiresIn:900}):json({},401));
    const f=fixture(network);const response=await f.client.request("/api/payment",{method,body:"{}"});
    expect(response.status).toBe(401);expect(network.mock.calls.filter(([url])=>url==="/api/payment")).toHaveLength(1);
  });
  it("never calls the business endpoint while authentication is unavailable",async()=>{
    const f=fixture(vi.fn(async()=>json({},503)));
    const responses=await Promise.all(Array.from({length:200},()=>f.client.request("/api/payment",{method:"POST"})));
    expect(responses.every(r=>r.status===503)).toBe(true);expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("a late rejected old token cannot erase a newer issued token",async()=>{
    const f=fixture();await f.client.getToken();f.advance(841_000);
    f.fetchImpl.mockResolvedValue(json({token:"new-token",expiresIn:900}));await f.client.getToken();
    f.client.invalidate("app-1");expect(await f.client.getToken()).toBe("new-token");expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("does not fabricate or endlessly refresh a missing Supabase session",async()=>{
    const f=fixture();f.auth.getSession.mockResolvedValue({data:{session:null}});
    await expect(f.client.getToken()).rejects.toMatchObject({status:401});expect(f.auth.refreshSession).not.toHaveBeenCalled();expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
