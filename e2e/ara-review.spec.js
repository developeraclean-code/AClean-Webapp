import { test, expect } from "@playwright/test";
test("proposals and customer drafts remain reviewable without external requests",async({page})=>{
  const errors=[];const external=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{if(!request.url().startsWith("http://127.0.0.1:4175"))external.push(request.url());});
  await page.goto("/");
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
