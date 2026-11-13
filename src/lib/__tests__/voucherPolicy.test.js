import {describe,it,expect} from 'vitest';
import {normalizeVoucherEdit,calculateVoucherBenefit,voucherTodayWib,voucherPhone} from '../voucherPolicy.js';
import {computePph23} from '../invoicing.js';
const invoice={id:'FIXTURE',customer:'Fiktif'};
const lines=[{nama:'Cleaning AC',jumlah:2,harga_satuan:100000,keterangan:'jasa'},{nama:'Cleaning AC besar',jumlah:1,harga_satuan:150000,keterangan:'jasa'},{nama:'Transport',jumlah:1,harga_satuan:50000,keterangan:'jasa'},{nama:'Kapasitor',jumlah:1,harga_satuan:200000,keterangan:'barang'}];
const edit=patch=>normalizeVoucherEdit(invoice,{lines,manual_discount:0,...patch});
describe('voucher policy',()=>{
 it('percentage excludes materials and fixed fees',()=>expect(calculateVoucherBenefit({type:'discount_pct',value:10},edit())).toMatchObject({benefit:35000,discount:35000,total:565000}));
 it('free units use cheapest complete Cleaning units',()=>expect(calculateVoucherBenefit({type:'free_unit',value:3},edit()).benefit).toBe(350000));
 it('free service excludes material and fixed fees',()=>expect(calculateVoucherBenefit({type:'free_service'},edit()).total).toBe(250000));
 it('best discount never stacks or lowers a manual discount',()=>{
   expect(()=>calculateVoucherBenefit({type:'discount_pct',value:10},edit({manual_discount:50000}))).toThrow(/tidak menambah/);
   expect(calculateVoucherBenefit({type:'discount_pct',value:10},edit({manual_discount:10000}))).toMatchObject({discount:35000,voucher_discount:25000,total:565000});
 });
 it('caps benefit after line discount and trade-in; total cannot be negative',()=>{
  const e=edit({lines:[...lines,{nama:'Potongan',jumlah:1,harga_satuan:-200000,keterangan:'diskon'}],trade_in:true,trade_in_amount:350000});
  expect(()=>calculateVoucherBenefit({type:'free_service'},e)).toThrow(/tidak menambah/);
  expect(calculateVoucherBenefit({type:'free_service'},e,{alreadyRedeemed:true})).toMatchObject({benefit:0,total:50000});
 });
 it.each([0.02,0.025])('retains existing PPh gross-up for %s',pph23_rate=>expect(edit({pph23:true,pph23_rate}).pph23_amount).toBe(computePph23(400000,pph23_rate).amount));
 it.each([NaN,Infinity,-1,0.5])('rejects invalid manual amount %s',manual_discount=>expect(()=>edit({manual_discount})).toThrow());
 it.each([{jumlah:0},{harga_satuan:Infinity},{subtotal:NaN},{subtotal:1},{nama:null}])('rejects tampered line %j',patch=>expect(()=>edit({lines:[{...lines[0],...patch}]})).toThrow());
 it('uses WIB date at UTC day boundary and canonical phones',()=>{expect(voucherTodayWib(new Date('2026-11-12T18:00:00Z'))).toBe('2026-11-13');expect(voucherPhone('0812 3456 7890')).toBe('6281234567890');expect(voucherPhone('+81 9012345678')).toBe('819012345678');});
});
