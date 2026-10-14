import { describe, expect, it } from 'vitest';
import { allocateBonusRevenue, buildBonusBillingBases, mergedInvoiceTarget, scopedBonusInvoice, validateBonusBillingEntries } from '../bonusBilling.js';
import { buildBonusRekap, bonusRekapToCSV, bonusRekapToPrintHTML } from '../bonusRekap.js';
import { invoiceMaterialCostHPP } from '../hpp.js';
import { DEFAULT_BONUS_CATEGORIES as cats } from '../../constants/bonus.js';
import { marginBonusForProfit } from '../bonusSettings.js';
import { readFileSync } from 'node:fs';

const line = (nama, jumlah = 1, category = 'LABOR') => ({ nama, jumlah, satuan:'unit', category });
const inv = (id='I1', total=2400000, lines=[line('Cleaning')], extra={}) => ({ id,total,status:'PAID',materials_detail:JSON.stringify(lines),...extra });
const job = (id='J1', invoice_id='I1', extra={}) => ({ id,invoice_id,date:'2026-10-01',service:'Repair',status:'PAID',...extra });
const part = (order_id,total,lines,group_id='J1') => ({ report_id:'R-'+order_id,order_id,group_id,total,invoice_payload:{materials_detail:JSON.stringify(lines)} });
const splitFixture = () => ({
  orders:[job('J1','I1',{is_team_split:true,job_group_id:'J1'}),job('J2','I1',{is_team_split:true,job_group_id:'J1'})],
  invoices:[inv('I1',3205000,[line('Cleaning tim 1'),line('Cleaning tim 2')],{job_id:'J1'})],
  parts:[part('J1',1540000,[line('Cleaning tim 1')]),part('J2',1665000,[line('Cleaning tim 2')])],
});

describe('dasar bonus per pekerjaan',()=>{
  it('job biasa memakai invoice sendiri, tanpa mengubah data sumber',()=>{
    const fixture={orders:[job()],invoices:[inv()]};
    const before=JSON.stringify(fixture),bases=buildBonusBillingBases(fixture);
    expect(bases.J1).toMatchObject({resolved:true,total:2400000,shared:false,source:'invoice_job'});
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it('dua pekerjaan customer sama dengan invoice berbeda tetap berdiri sendiri',()=>{
    const bases=buildBonusBillingBases({orders:[job('J1','I1',{customer:'Sama'}),job('J2','I2',{customer:'Sama'})],invoices:[inv('I1',1200000),inv('I2',1800000)]});
    expect(bases.J1.total).toBe(1200000);expect(bases.J2.total).toBe(1800000);
  });
  it('dua tim memakai billing part masing-masing, bukan total grup dua kali',()=>{
    const bases=buildBonusBillingBases(splitFixture());
    expect(bases.J1.total).toBe(1540000);expect(bases.J2.total).toBe(1665000);
    expect(JSON.parse(bases.J1.materials_detail)).toEqual([line('Cleaning tim 1')]);
    expect(JSON.parse(bases.J2.materials_detail)).toEqual([line('Cleaning tim 2')]);
    expect(bases.J1.total+bases.J2.total).toBe(3205000);
  });
  it('edit/diskon invoice akhir dialokasikan proporsional, bukan memakai total part lama',()=>{
    const fixture=splitFixture();fixture.invoices[0].total=2805000;
    const bases=buildBonusBillingBases(fixture);
    expect(bases.J1.total+bases.J2.total).toBe(2805000);
    expect(bases.J1.adjusted).toBe(true);expect(bases.J1.warnings.join()).toMatch(/proporsional/);
    expect(marginBonusForProfit(bases.J1.total).amount).toBe(50000);
    expect(marginBonusForProfit(bases.J2.total).amount).toBe(50000);
  });
  it('invoice gabungan manual memakai invoice sumber yang dibatalkan',()=>{
    const bases=buildBonusBillingBases({orders:[job('J1','I1'),job('J2','I2')],invoices:[
      inv('I1',1200000,[line('Freon')],{job_id:'J1',status:'CANCELLED',service:'Repair [Digabung ke I3]'}),
      inv('I2',1800000,[line('Cleaning')],{job_id:'J2',status:'CANCELLED',service:'Cleaning [Digabung ke I3]'}),
      inv('I3',3000000,[line('Freon'),line('Cleaning')],{job_id:null,service:'Invoice Gabungan (2 pekerjaan)'}),
    ]});
    expect(bases.J1).toMatchObject({resolved:true,invoiceId:'I3',total:1200000});
    expect(bases.J2).toMatchObject({resolved:true,invoiceId:'I3',total:1800000});
    expect(JSON.parse(bases.J2.materials_detail)).toEqual([line('Cleaning')]);
  });
  it('order yang telah ditautkan ulang ke gabungan tetap ditemukan melalui job_id sumber',()=>{
    const bases=buildBonusBillingBases({orders:[job('J1','I3'),job('J2','I3')],invoices:[
      inv('I1',1200000,[line('Freon')],{job_id:'J1',status:'CANCELLED',service:'Repair [Digabung ke I3]'}),
      inv('I2',1800000,[line('Cleaning')],{job_id:'J2',status:'CANCELLED',service:'Cleaning [Digabung ke I3]'}),
      inv('I3',3000000,[line('Freon'),line('Cleaning')],{job_id:null}),
    ]});
    expect(bases.J1.total).toBe(1200000);expect(bases.J2.total).toBe(1800000);
  });
  it('basis part yang hilang/ganda/grup berbeda tidak ditebak',()=>{
    for(const mutate of [fixture=>fixture.parts.pop(),fixture=>fixture.parts.push({...fixture.parts[0]}),fixture=>fixture.parts[0].group_id='OTHER']){
      const fixture=splitFixture();mutate(fixture);const bases=buildBonusBillingBases(fixture);
      expect(bases.J1.resolved).toBe(false);expect(bases.J2.resolved).toBe(false);
      expect(scopedBonusInvoice(bases.J1)).toMatchObject({total:0,materials_detail:'[]'});
    }
  });
  it('satu kapasitor tidak dapat dimiliki dua billing part',()=>{
    const fixture=splitFixture();fixture.invoices[0].materials_detail=JSON.stringify([line('Kapasitor',1)]);
    fixture.parts.forEach(row=>{row.invoice_payload.materials_detail=JSON.stringify([line('Kapasitor',1)]);});
    expect(buildBonusBillingBases(fixture).J1).toMatchObject({resolved:false});
    expect(buildBonusBillingBases(fixture).J1.reason).toMatch(/Item\/jumlah/);
  });
  it('dua kapasitor nyata pada dua job diperbolehkan bila jumlah invoice cocok',()=>{
    const fixture=splitFixture();fixture.invoices[0].materials_detail=JSON.stringify([line('Kapasitor',2)]);
    fixture.parts.forEach(row=>{row.invoice_payload.materials_detail=JSON.stringify([line('Kapasitor',1)]);});
    const bases=buildBonusBillingBases(fixture);
    expect(bases.J1.resolved).toBe(true);expect(bases.J2.resolved).toBe(true);
    for(const basis of Object.values(bases))expect(()=>validateBonusBillingEntries([{bonus_type:'kapasitor',total_amount:40000}],basis,cats)).not.toThrow();
  });
  it('HPP dihitung dari material job masing-masing, bukan item grup',()=>{
    const fixture=splitFixture();const pipe=line('Pipa AC Hoda 1PK',2,'PART');
    fixture.invoices[0].materials_detail=JSON.stringify([pipe,line('Cleaning tim 2')]);
    fixture.parts[0].invoice_payload.materials_detail=JSON.stringify([pipe]);
    const bases=buildBonusBillingBases(fixture), inventory=[{name:'Pipa AC Hoda 1PK',purchase_price:75000}];
    expect(invoiceMaterialCostHPP({materialsDetail:bases.J1.materials_detail,inventory}).total).toBe(150000);
    expect(invoiceMaterialCostHPP({materialsDetail:bases.J2.materials_detail,inventory}).total).toBe(0);
  });
  it('peer lintas bulan tetap memakai bagian sendiri',()=>{
    const fixture=splitFixture();fixture.orders[0].date='2026-09-30';fixture.orders[1].date='2026-10-01';
    const bases=buildBonusBillingBases(fixture);
    const rekap=buildBonusRekap({month:'2026-10',orders:[fixture.orders[1]],bonuses:[],invMap:{I1:fixture.invoices[0]},billingBases:bases,bonusCategories:cats});
    expect(rekap.excluded[0].nilai).toBe(1665000);
  });
  it('invoice legacy bersama masuk tinjauan; tidak mengulang total pada dua job',()=>{
    const fixture={orders:[job('J1'),job('J2')],invoices:[inv('I1',800000,[line('Kapasitor')])]};
    const bases=buildBonusBillingBases(fixture);
    expect(bases.J1.resolved).toBe(false);expect(bases.J2.resolved).toBe(false);
    const rekap=buildBonusRekap({month:'2026-10',orders:fixture.orders,invMap:{I1:fixture.invoices[0]},billingBases:bases,bonusCategories:cats});
    expect(rekap.excluded.map(row=>row.kategori)).toEqual(['BILLING_REVIEW','BILLING_REVIEW']);
  });
  it('bonus lama/PAID tetap utuh; rekap legacy menghitung invoice sekali',()=>{
    const orders=[job('J1'),job('J2')],invoice=inv('I1',800000,[line('Kapasitor')]);
    const bonuses=orders.map(order=>({id:'B'+order.id,order_id:order.id,order_date:order.date,bonus_type:'kapasitor',total_amount:40000,team_members:['Putra'],member_count:1,amount_per_person:40000,status:'PAID'}));
    const before=JSON.stringify(bonuses);
    const rekap=buildBonusRekap({month:'2026-10',orders,bonuses,invMap:{I1:invoice},bonusCategories:cats});
    expect(rekap.summary).toMatchObject({totalNilaiTrx:800000,totalBonus:80000,totalDibayar:80000,unallocatedInvoiceCount:1,billingReviewCount:2});
    expect(rekap.included.every(row=>row.nilai==null)).toBe(true);
    expect(JSON.stringify(bonuses)).toBe(before);
    expect(bonusRekapToCSV(rekap)).toContain('dihitung sekali');
    expect(bonusRekapToPrintHTML(rekap)).toContain('Belum dipisah');
  });
  it('invoice hilang, dibatalkan atau rusak tidak disulap menjadi nilai nol',()=>{
    expect(buildBonusBillingBases({orders:[job()]}).J1).toMatchObject({resolved:false,invoiceId:'I1'});
    for(const invoice of [{...inv(),status:'CANCELLED'},{...inv(),materials_detail:'{broken'},{...inv(),materials_detail:'[null]'},{...inv(),total:null},{...inv(),material:500000,materials_detail:null}]){
      expect(buildBonusBillingBases({orders:[job()],invoices:[invoice]}).J1.resolved).toBe(false);
    }
  });
  it('migrasi 205 memasang guard lintas margin tanpa menulis transaksi historis',()=>{
    const sql=readFileSync(new URL('../../../migrations/205_bonus_margin_one_per_job.sql',import.meta.url),'utf8');
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_order_bonuses_margin_job_active/);
    expect(sql).toMatch(/bonus_type LIKE 'margin%'/);expect(sql).toMatch(/HAVING count\(\*\) > 1/);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\s/i);
  });
  it('tautan gabungan siklus ditolak',()=>{
    const bases=buildBonusBillingBases({orders:[job()],invoices:[inv('I1',1,[],{service:'A [Digabung ke I2]'}),inv('I2',1,[],{service:'B [Digabung ke I1]'})]});
    expect(bases.J1.reason).toMatch(/siklus/);
    expect(mergedInvoiceTarget({service:'A [Digabung ke I2]'})).toBe('I2');
  });
  it('validasi simpan menolak omset gabungan, kategori milik job lain dan tier salah',()=>{
    const basis=buildBonusBillingBases(splitFixture()).J1;
    const valid={bonus_type:'margin_2jt',total_amount:100000,gross_revenue:1540000,material_cost:0};
    expect(()=>validateBonusBillingEntries([valid],basis,cats)).not.toThrow();
    expect(()=>validateBonusBillingEntries([{...valid,gross_revenue:3205000}],basis,cats)).toThrow(/Omset bonus/);
    expect(()=>validateBonusBillingEntries([{bonus_type:'kapasitor',total_amount:40000}],basis,cats)).toThrow(/tidak ada/);
    expect(()=>validateBonusBillingEntries([{...valid,bonus_type:'margin_3jt'}],basis,cats)).toThrow(/Tingkat bonus/);
  });
  it('manual pada data ambigu wajib alasan; bonus invoice tidak bisa melewati guard',()=>{
    const basis={resolved:false,reason:'Ambigu',materials_detail:'[]'};
    expect(()=>validateBonusBillingEntries([{bonus_type:'manual',total_amount:50000,note:'Owner verifikasi pekerjaan tambahan'}],basis,cats)).not.toThrow();
    expect(()=>validateBonusBillingEntries([{bonus_type:'manual',total_amount:50000}],basis,cats)).toThrow(/alasan/);
    expect(()=>validateBonusBillingEntries([{bonus_type:'kapasitor',total_amount:40000}],basis,cats)).toThrow(/Ambigu/);
  });
  it.each([[1,[1,1,1]],[0,[0,0]],[2805000,[1540000,1665000]],[123456.78,[3,7,19]]])('alokasi %s mempertahankan total hingga sen', (total,weights)=>{
    expect(Math.round(allocateBonusRevenue(total,weights).reduce((s,n)=>s+n,0)*100)).toBe(Math.round(total*100));
  });
  it('simulasi 200 pekerjaan: total/item tidak dipakai berulang dan bonus tiap tim tetap ada',()=>{
    const orders=[],invoices=[],parts=[];
    for(let i=0;i<100;i++){
      const a='J'+i+'A',b='J'+i+'B',id='I'+i;
      orders.push(job(a,id,{is_team_split:true,job_group_id:a}),job(b,id,{is_team_split:true,job_group_id:a}));
      invoices.push(inv(id,2700000,[line('Cleaning '+a),line('Cleaning '+b)],{job_id:a}));
      parts.push(part(a,1200000,[line('Cleaning '+a)],a),part(b,1800000,[line('Cleaning '+b)],a));
    }
    const bases=buildBonusBillingBases({orders,invoices,parts});
    expect(Object.keys(bases)).toHaveLength(200);
    expect(Object.values(bases).every(basis=>basis.resolved)).toBe(true);
    expect(Object.values(bases).reduce((s,basis)=>s+basis.total,0)).toBe(270000000);
    const bonuses=orders.map(order=>{
      const basis=bases[order.id],tier=marginBonusForProfit(basis.total);
      return {id:'B'+order.id,order_id:order.id,order_date:order.date,bonus_type:tier.id,total_amount:tier.amount,amount_per_person:tier.amount,member_count:1,team_members:['SIM'],status:'ELIGIBLE'};
    });
    const rekap=buildBonusRekap({month:'2026-10',orders,bonuses,invMap:Object.fromEntries(invoices.map(row=>[row.id,row])),billingBases:bases,bonusCategories:cats});
    expect(rekap.summary).toMatchObject({totalNilaiTrx:270000000,totalBonus:15000000,totalJobBonus:200});
  });
});
