import { createServer } from "node:http";
import { context } from "esbuild";
const port=Number(process.env.ARA_PREVIEW_PORT || 4175);
const bundle=await context({entryPoints:["preview/ara/main.jsx"],bundle:true,write:false,outdir:"/tmp/aclean-ara-preview",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'}});
let output=await bundle.rebuild();
const server=createServer(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Content-Security-Policy","default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  try{
    const path=new URL(req.url,"http://127.0.0.1").pathname;
    if(path==="/"){
      output=await bundle.rebuild();res.setHeader("Content-Type","text/html; charset=utf-8");
      res.end('<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARA — Preview Lokal</title><link rel="stylesheet" href="/main.css"><body style="margin:0;background:#0b1220"><div id="root"></div><script src="/main.js"></script></body></html>');
    }else{
      const file=output.outputFiles.find(f=>["/main.js","/main.css"].includes(path)&&f.path.endsWith(path));
      if(!file){res.writeHead(404);res.end();return;}
      res.setHeader("Content-Type",path.endsWith(".js")?"application/javascript":"text/css");res.end(file.contents);
    }
  }catch(error){console.error(error.message);res.writeHead(500);res.end("Preview gagal");}
});
server.listen(port,"127.0.0.1",()=>console.log(`Preview ARA: http://127.0.0.1:${port} — data simulasi`));
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,async()=>{server.close();await bundle.dispose();process.exit(0);});
