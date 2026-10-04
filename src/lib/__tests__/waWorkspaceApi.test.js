import { beforeEach, describe, expect, it, vi } from "vitest";
const { client, validate, dispatch, query } = vi.hoisted(()=>({client:{},validate:vi.fn(),dispatch:vi.fn(),query:{}}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>client}));
vi.mock("../../../api/_wa-workspace.js",()=>({validateWorkspacePayload:validate,dispatchWorkspaceMessage:dispatch,deliverWorkspaceMessage:vi.fn()}));
import { waWorkspaceSend } from "../../../api/_handlers/wa-workspace.js";
const id="11111111-1111-4111-8111-111111111111";
const res=()=>({code:0,body:null,status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
beforeEach(()=>{
  vi.clearAllMocks();query.select=vi.fn(()=>query);query.eq=vi.fn(()=>query);query.single=vi.fn();client.from=vi.fn(()=>query);
  validate.mockResolvedValue({phone:"6281234567890",kind:"TEXT",message:"Halo"});dispatch.mockResolvedValue({id,status:"ACCEPTED"});
});
describe("Workspace send authorization",()=>{
  it("rejects unauthenticated/legacy and forged body roles",async()=>{
    for(const req of [{body:{id,currentUserRole:"Owner"}},{body:{id},appClaims:{role:"Teknisi"}}]){
      const r=res();await waWorkspaceSend({method:"POST",...req},r);expect(r.code).toBe(403);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("permits signed admin claims",async()=>{
    const r=res();await waWorkspaceSend({method:"POST",appClaims:{role:"Admin",name:"Admin"},body:{id}},r);
    expect(r.code).toBe(200);expect(r.body.row.status).toBe("ACCEPTED");
  });
  it("looks up verified bearer users and fails closed on profile errors",async()=>{
    query.single.mockResolvedValueOnce({data:{role:"Owner",name:"Dedy"}}).mockResolvedValueOnce({error:{message:"offline"}});
    const a=res(),b=res();await waWorkspaceSend({method:"POST",authUser:{id:"u"},body:{id}},a);await waWorkspaceSend({method:"POST",authUser:{id:"u"},body:{id}},b);
    expect(a.code).toBe(200);expect(b.code).toBe(403);
  });
  it("rejects invalid IDs and surfaces persistence failures without sending",async()=>{
    const a=res();await waWorkspaceSend({method:"POST",appClaims:{role:"Admin"},body:{id:"bad"}},a);expect(a.code).toBe(400);expect(dispatch).not.toHaveBeenCalled();
    validate.mockRejectedValueOnce(new Error("Dokumen belum diverifikasi"));
    const b=res();await waWorkspaceSend({method:"POST",appClaims:{role:"Admin"},body:{id}},b);expect(b.body.error).toContain("diverifikasi");expect(dispatch).not.toHaveBeenCalled();
  });
});
