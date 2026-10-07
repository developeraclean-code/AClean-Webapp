import { test, expect } from "@playwright/test";
import { build } from "esbuild";
let js, css;
test.beforeAll(async()=>{
  const result=await build({entryPoints:["preview/ara/main.jsx"],bundle:true,write:false,outdir:"/tmp/ara-review-test",jsx:"automatic",define:{"process.env.NODE_ENV":'"test"'}});
  js=result.outputFiles.find(f=>f.path.endsWith(".js")).text;
  css=result.outputFiles.find(f=>f.path.endsWith(".css")).text;
});
test("proposals and customer drafts remain reviewable without external requests",async({page})=>{
  const errors=[];const external=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{if(!request.url().startsWith("https://ara-review.test/"))external.push(request.url());});
  await page.route("https://ara-review.test/**",route=>{
    const path=new URL(route.request().url()).pathname;
    return route.fulfill({contentType:path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":"text/html",body:path.endsWith(".js")?js:path.endsWith(".css")?css:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'});
  });
  await page.goto("https://ara-review.test/");
  await expect(page.getByText("Belum terverifikasi",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Simulasi usulan pelunasan"}).click();
  await expect(page.getByText(/Belum ada transaksi atau pesan yang dijalankan/)).toBeVisible();
  await page.getByRole("button",{name:"Tinjau di Invoice"}).click();
  await expect(page.getByRole("status")).toContainText("Invoice · INV-DEMO");
  await page.getByText(/Draf ARA \(1\)/).click();
  await page.getByRole("button",{name:"Tinjau & masukkan ke pesan"}).click();
  await expect(page.getByRole("textbox",{name:"Kolom pesan",exact:true})).toHaveValue(/Admin perlu memverifikasi/);
  await expect(page.getByRole("textbox",{name:"Kolom pesan",exact:true})).toHaveValue(/\n\n- Auto Reply by ARA -$/);
  await expect(page.getByText(/Draf ARA \(0\)/)).toBeVisible();
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
