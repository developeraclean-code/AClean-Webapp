import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import AraView from "../../src/views/AraView.jsx";
import AraReviewPanel from "../../src/views/AraReviewPanel.jsx";
import { parseAraProposals } from "../../src/lib/araPolicy.js";
import "../../src/views/WaPanel.css";

const pending=[{id:"draft-1",status:"PENDING",intent:"payment",reply:"Mohon sertakan nomor invoice, nominal dan bukti pembayaran. Admin perlu memverifikasi sebelum mengonfirmasi status lunas.",reasons:["Perlu pemeriksaan Admin: payment"],created_at:new Date().toISOString()}];
const db={from(){const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,then:fn=>Promise.resolve({data:[...pending]}).then(fn)};return q;},async rpc(name,p){const index=pending.findIndex(x=>x.id===p.p_id);if(index<0)return {error:{message:"Draf sudah ditinjau"}};pending.splice(index,1);return {data:{status:p.p_status}};}};
function Preview(){
  const [messages,setMessages]=useState([{role:"assistant",content:"Preview lokal: data sintetis, tanpa koneksi database atau pengiriman WhatsApp."}]);
  const [input,setInput]=useState("");const [composer,setComposer]=useState("");const [target,setTarget]=useState("");const bottom=useRef(null);
  const propose=()=>setMessages(prev=>[...prev,{role:"assistant",...parseAraProposals('Invoice sudah lunas [ACTION]{"type":"MARK_PAID","id":"INV-DEMO"}[/ACTION]',"Owner")}]);
  return <main style={{maxWidth:1100,margin:"auto",padding:20,color:"#e2e8f0",fontFamily:"system-ui"}}>
    <h1>Preview ARA · simulasi lokal</h1><p>Tidak mengirim WA dan tidak mengubah data produksi.</p>
    <button onClick={propose}>Simulasi usulan pelunasan</button>
    <p role="status">{target ? "Modul tujuan: "+target : "Belum ada tindakan"}</p>
    <AraView araMessages={messages} setAraMessages={setMessages} araInput={input} setAraInput={setInput} araLoading={false}
      setAraImageData={()=>{}} setAraImageType={()=>{}} setAraImagePreview={()=>{}} araBottomRef={bottom}
      llmStatus="not_connected" priceListSyncedAt={null} forceReloadPriceList={()=>{}} connectAraBrain={()=>{}}
      onOpenProposal={p=>setTarget(p.label+" · "+p.reference)} sendToARA={()=>propose()}/>
    <section style={{marginTop:25,padding:16,border:"1px solid #334155",borderRadius:12}}>
      <h2>Review jawaban customer</h2>
      <AraReviewPanel supabase={db} phone="628000000001" onCopy={setComposer}/>
      <label>Kolom pesan — belum dikirim<textarea aria-label="Kolom pesan" value={composer} onChange={e=>setComposer(e.target.value)} style={{display:"block",width:"100%",minHeight:90,marginTop:12}}/></label>
      <p>Tombol kirim sengaja tidak tersedia pada preview simulasi.</p>
    </section>
  </main>;
}
createRoot(document.getElementById("root")).render(<Preview/>);
