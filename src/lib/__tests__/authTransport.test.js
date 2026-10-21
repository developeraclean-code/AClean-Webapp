import {afterEach,expect,it,vi} from "vitest";
import {createClient} from "@supabase/supabase-js";
import {createAuthTransport} from "../authTransport.js";
const base="https://database.simulated.test";
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","x-supabase-api-version":"2024-01-01"}});
afterEach(()=>vi.useRealTimers());
it("200 follow-up Auth calls do not hit an unavailable upstream until cooldown expires",async()=>{
  let time=1000,healthy=false;
  const network=vi.fn(async()=>healthy?json({id:"u1"}):json({},503));
  const transport=createAuthTransport({baseUrl:base,fetchImpl:network,now:()=>time});
  expect((await transport(base+"/auth/v1/user")).status).toBe(503);
  const responses=await Promise.all(Array.from({length:200},()=>transport(base+"/auth/v1/user")));
  expect(responses.every(r=>r.status===503)).toBe(true);expect(network).toHaveBeenCalledTimes(1);
  time+=15_000;healthy=true;expect((await transport(base+"/auth/v1/user")).status).toBe(200);expect(network).toHaveBeenCalledTimes(2);
});
it("real SDK distinguishes downtime from invalid credentials without network retries for every manual click",async()=>{
  let time=1000,mode="outage";
  const network=vi.fn(async()=>mode==="outage"?json({code:"unexpected_failure",msg:"offline"},503):json({code:"invalid_credentials",msg:"Invalid login credentials"},400));
  const transport=createAuthTransport({baseUrl:base,fetchImpl:network,now:()=>time});
  const sdk=createClient(base,"SIMULATED_KEY",{global:{fetch:transport},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  try {
    for(let i=0;i<5;i++)expect((await sdk.auth.signInWithPassword({email:"sim@example.test",password:"SIMULATED"})).error.status).toBe(503);
    expect(network).toHaveBeenCalledTimes(1);
    time+=15_000;mode="invalid";
    expect((await sdk.auth.signInWithPassword({email:"sim@example.test",password:"SIMULATED"})).error.code).toBe("invalid_credentials");
    expect(network).toHaveBeenCalledTimes(2);
  }finally{sdk.auth.stopAutoRefresh();}
});
it("real invalid passwords remain checkable and do not open the infrastructure circuit",async()=>{
  const network=vi.fn(async()=>json({code:"invalid_credentials"},400));const transport=createAuthTransport({baseUrl:base,fetchImpl:network});
  for(let i=0;i<3;i++)expect((await transport(base+"/auth/v1/token?grant_type=password",{method:"POST",body:"{}"})).status).toBe(400);
  expect(network).toHaveBeenCalledTimes(3);
});
it("does not intercept, queue or replay business mutations and other origins",async()=>{
  const network=vi.fn(async()=>json({}));const transport=createAuthTransport({baseUrl:base,fetchImpl:network});
  await transport(base+"/rest/v1/invoice_payments",{method:"POST",body:"{}"});
  await transport("https://other.invalid/auth/v1/token",{method:"POST",body:"{}"});
  expect(network).toHaveBeenCalledTimes(2);expect(network.mock.calls[0][1]).toEqual({method:"POST",body:"{}"});
});
it("bounds stalled Auth response bodies, then pauses the next request",async()=>{
  vi.useFakeTimers();const network=vi.fn(async()=>({arrayBuffer:()=>new Promise(()=>{})}));
  const transport=createAuthTransport({baseUrl:base,fetchImpl:network,timeoutMs:50});
  const result=transport(base+"/auth/v1/token",{method:"POST"});await vi.advanceTimersByTimeAsync(51);
  expect((await result).status).toBe(503);expect(network.mock.calls[0][1].signal.aborted).toBe(true);
  expect((await transport(base+"/auth/v1/token",{method:"POST"})).status).toBe(503);expect(network).toHaveBeenCalledTimes(1);
});
it("caller cancellation is preserved, not silently turned into a service outage",async()=>{
  const controller=new AbortController();controller.abort();const network=vi.fn(async(_url,options)=>{throw options.signal.reason;});
  const transport=createAuthTransport({baseUrl:base,fetchImpl:network});
  await expect(transport(base+"/auth/v1/user",{signal:controller.signal})).rejects.toBeDefined();
});
