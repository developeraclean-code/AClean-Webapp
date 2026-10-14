import { describe, expect, it } from 'vitest';
import { loadBonusBillingContext, loadBonusHppInventory } from '../bonusBillingReads.js';
import { saveScopedOrderBonuses } from '../bonusBillingWrites.js';
import { fetchOrderBonusesByPeriod, fetchOrdersWithoutBonus } from '../../data/reads.js';
import { DEFAULT_BONUS_CATEGORIES as cats } from '../../constants/bonus.js';

function client(seed={}, fault=()=>null) {
  const tables={orders:[],invoices:[],team_invoice_parts:[],inventory:[],order_bonuses:[],app_settings:[],...seed};
  const calls=[];
  const db={tables,calls,from(table){
    let rows=[...(tables[table] || [])],payload;
    const run=async(op,from,to)=>{
      calls.push({table,op,from});const error=fault(table,op,from);
      if(error)return {data:null,error:{message:error}};
      if(op==='single'&&payload){
        if(tables[table].some(row=>row.order_id===payload.order_id&&row.status!=='VOID'&&
          (row.bonus_type===payload.bonus_type||(String(row.bonus_type).startsWith('margin')&&String(payload.bonus_type).startsWith('margin')))))return {data:null,error:{message:'duplicate key'}};
        const row={...payload,id:'B-'+tables[table].length};tables[table].push(row);return {data:row,error:null};
      }
      return {data:op==='range'?rows.slice(from,to+1):op==='single'||op==='maybeSingle'?rows[0] || null:rows,error:null};
    };
    const query={select(){return query;},insert(row){payload=row;return query;},
      eq(key,value){rows=rows.filter(row=>row[key]===value);return query;},
      neq(key,value){rows=rows.filter(row=>row[key]!==value);return query;},
      in(key,values){rows=rows.filter(row=>values.includes(row[key]));return query;},
      gte(key,value){rows=rows.filter(row=>row[key]>=value);return query;},
      lte(key,value){rows=rows.filter(row=>row[key]<=value);return query;},
      like(key,pattern){
        // SQL LIKE, termasuk wildcard yang di-escape untuk ID berisi underscore.
        let regex='';for(let i=0;i<pattern.length;i++){
          const ch=pattern[i];if(ch==='\\'){regex+=pattern[++i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
          else regex+=ch==='%'?'.*':ch==='_'?'.':ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        }
        rows=rows.filter(row=>new RegExp('^'+regex+'$').test(String(row[key] || '')));return query;
      },
      order(key,{ascending=true}={}){rows.sort((a,b)=>String(a[key] || '').localeCompare(String(b[key] || ''))*(ascending?1:-1));return query;},
      range(from,to){return run('range',from,to);},single(){return run('single');},maybeSingle(){return run('maybeSingle');},
      then(resolve,reject){return run('read').then(resolve,reject);},
    };return query;
  }};return db;
}
const line=nama=>({nama,jumlah:1,satuan:'unit',category:'LABOR'});
const job=(id='J1',invoice_id='I1',extra={})=>({id,invoice_id,date:'2026-10-01',status:'PAID',service:'Repair',...extra});
const invoice=(id='I1',total=2400000,extra={})=>({id,total,job_id:'J1',status:'PAID',service:'Repair',materials_detail:JSON.stringify([line('Cleaning')]),...extra});
const fixture=()=>({orders:[job()],invoices:[invoice()]});
const args=async db=>{
  const orderRow=db.tables.orders[0],billing=await loadBonusBillingContext(db,[orderRow]);
  return {supabase:db,orderRow,entries:[{bonus_type:'margin_2jt',total_amount:100000,gross_revenue:2400000,material_cost:0}],
    teamMembers:['Rey','Putra'],billingSignature:billing.bases[orderRow.id].signature,createdBy:'Owner'};
};

describe('baca basis bonus lengkap dan gagal-terlihat',()=>{
  it('peer di luar bulan tetap dibaca; invoice bersama tanpa parts tidak dianggap job tunggal',async()=>{
    const db=client({orders:[job('J1','I1',{date:'2026-09-30'}),job('J2')],invoices:[invoice()]});
    const result=await loadBonusBillingContext(db,[db.tables.orders[1]]);
    expect(result.orders).toHaveLength(2);
    expect(result.bases.J2.resolved).toBe(false);expect(result.bases.J2.shared).toBe(true);
  });
  it('invoice sumber dari konsolidasi tetap ditemukan walau hanya satu job ada di bulan ini',async()=>{
    const db=client({orders:[job('J1','A',{date:'2026-09-30'}),job('J2','B')],invoices:[
      invoice('A',1200000,{status:'CANCELLED',service:'A [Digabung ke C]'}),
      invoice('B',1800000,{job_id:'J2',status:'CANCELLED',service:'B [Digabung ke C]'}),
      invoice('C',3000000,{job_id:null,service:'Invoice Gabungan',materials_detail:JSON.stringify([line('Cleaning'),{...line('Cleaning'),jumlah:1}])}),
    ]});
    const result=await loadBonusBillingContext(db,[db.tables.orders[1]]);
    expect(result.bases.J1.total).toBe(1200000);expect(result.bases.J2.total).toBe(1800000);
  });
  it('pekerjaan team split tanpa link invoice sendiri masih diambil lewat grup',async()=>{
    const db=client({orders:[job('J1','I1',{is_team_split:true,job_group_id:'J1'}),job('J2',null,{is_team_split:true,job_group_id:'J1'})],invoices:[invoice()],team_invoice_parts:[]});
    const result=await loadBonusBillingContext(db,[db.tables.orders[0]]);
    expect(result.bases.J1.resolved).toBe(false);expect(result.bases.J2.shared).toBe(true);
  });
  it('tujuan konsolidasi yang hilang ditandai per job, bukan loop retry tanpa akhir',async()=>{
    const db=client({orders:[job()],invoices:[invoice('I1',2400000,{status:'CANCELLED',service:'Repair [Digabung ke MISSING]'})]});
    const result=await loadBonusBillingContext(db,db.tables.orders);
    expect(result.bases.J1).toMatchObject({resolved:false,invoiceId:'I1'});
    expect(db.calls.filter(call=>call.table==='invoices'&&call.op==='range').length).toBeLessThan(4);
  });
  it.each(['invoices','orders','team_invoice_parts'])('error %s tidak ditelan sebagai data kosong',async table=>{
    const seed=fixture();seed.orders[0].is_team_split=true;seed.orders[0].job_group_id='J1';
    const db=client(seed,(name)=>name===table?'Simulasi RLS/network':null);
    await expect(loadBonusBillingContext(db,seed.orders)).rejects.toThrow(/Simulasi/);
  });
  it('HPP lebih dari 500 item dipaginasi dan error halaman lanjutan terlihat',async()=>{
    const inventory=Array.from({length:1001},(_,i)=>({code:String(i).padStart(5,'0'),name:'N'+i,purchase_price:i}));
    expect(await loadBonusHppInventory(client({inventory}))).toHaveLength(1001);
    const db=client({inventory},(table,op,from)=>table==='inventory'&&from===500?'Halaman kedua gagal':null);
    await expect(loadBonusHppInventory(db)).rejects.toThrow(/Halaman kedua/);
  });
  it('periode bonus/order tidak terpotong di batas 1000 baris',async()=>{
    const orders=Array.from({length:1201},(_,i)=>job('J'+i,'I'+i));
    const order_bonuses=orders.map(row=>({id:'B'+row.id,order_date:row.date}));
    const db=client({orders,order_bonuses});
    expect((await fetchOrdersWithoutBonus(db,'2026-10-01','2026-10-31')).data).toHaveLength(1201);
    expect((await fetchOrderBonusesByPeriod(db,'2026-10-01','2026-10-31')).data).toHaveLength(1201);
  });
});

describe('guard simpan per job (database simulasi, tanpa write produksi)',()=>{
  it('simpan, retry dan kategori margin berbeda tidak menghasilkan bonus margin kedua',async()=>{
    const db=client(fixture()),input=await args(db);
    expect(await saveScopedOrderBonuses(input)).toMatchObject({saved:1,skipped:0,failed:0});
    expect(await saveScopedOrderBonuses(input)).toMatchObject({saved:0,skipped:1,failed:0});
    db.tables.order_bonuses[0].bonus_type='margin_1jt';
    expect(await saveScopedOrderBonuses(input)).toMatchObject({saved:0,skipped:1});
    expect(db.tables.order_bonuses).toHaveLength(1);
    expect(db.tables.order_bonuses[0].note).toContain('Basis per job J1: I1');
    expect(db.tables.order_bonuses[0].material_cost).toBe(0);
  });
  it('preview stale sesudah total invoice diedit ditolak sebelum insert',async()=>{
    const db=client(fixture()),input=await args(db);db.tables.invoices[0].total=2000000;
    await expect(saveScopedOrderBonuses(input)).rejects.toThrow(/Dasar invoice berubah/);
    expect(db.tables.order_bonuses).toHaveLength(0);
  });
  it('job terkait baru ditautkan ke invoice setelah preview juga membatalkan basis lama',async()=>{
    const db=client(fixture()),input=await args(db);db.tables.orders.push(job('J2'));
    await expect(saveScopedOrderBonuses(input)).rejects.toThrow(/Dasar invoice berubah/);
    expect(db.tables.order_bonuses).toHaveLength(0);
  });
  it('perubahan setting bonus sebelum simpan tidak memakai nominal lama',async()=>{
    const db=client(fixture()),input=await args(db);
    db.tables.app_settings.push({key:'bonus_categories',value:JSON.stringify(cats.map(cat=>cat.id==='margin_2jt'?{...cat,amount:125000}:cat))});
    await expect(saveScopedOrderBonuses(input)).rejects.toThrow(/Tingkat bonus/);
    expect(db.tables.order_bonuses).toHaveLength(0);
  });
  it('read error saat cek existing/settings tidak dilanjutkan menjadi insert',async()=>{
    for(const table of ['order_bonuses','app_settings']){
      const db=client(fixture(),name=>name===table?'Read gagal':null),input=await args(db);
      await expect(saveScopedOrderBonuses(input)).rejects.toThrow(/Read gagal/);
      expect(db.tables.order_bonuses).toHaveLength(0);
    }
  });
  it('kegagalan insert tidak diklaim berhasil dan retry masih aman',async()=>{
    let fail=true;
    const db=client(fixture(),(table,op)=>table==='order_bonuses'&&op==='single'&&fail?'Write gagal':null),input=await args(db);
    expect(await saveScopedOrderBonuses(input)).toMatchObject({saved:0,failed:1,errors:['Write gagal']});
    fail=false;expect(await saveScopedOrderBonuses(input)).toMatchObject({saved:1,failed:0});
    expect(db.tables.order_bonuses).toHaveLength(1);
  });
  it('dua request bersamaan tetap dijaga unique index job/kategori yang disimulasikan',async()=>{
    const db=client(fixture()),input=await args(db);
    const result=await Promise.all([saveScopedOrderBonuses(input),saveScopedOrderBonuses(input)]);
    expect(result.reduce((sum,row)=>sum+row.saved,0)).toBe(1);expect(db.tables.order_bonuses).toHaveLength(1);
  });
  it('dua admin memilih margin berbeda pada job sama tetap hanya menyimpan satu sesudah migrasi 205',async()=>{
    const db=client(fixture()),input=await args(db);
    const other={...input,entries:[{bonus_type:'margin_1jt',total_amount:50000,gross_revenue:2400000,material_cost:1000000}]};
    const result=await Promise.all([saveScopedOrderBonuses(input),saveScopedOrderBonuses(other)]);
    expect(result.reduce((sum,row)=>sum+row.saved,0)).toBe(1);expect(db.tables.order_bonuses).toHaveLength(1);
  });
  it('job dibatalkan, menjadi multi-hari, atau tanggalnya berubah membatalkan simpan',async()=>{
    for(const patch of [{status:'CANCELLED'},{is_multi_day:true},{date:'2026-10-02'}]){
      const db=client(fixture()),input=await args(db);
      input.orderRow={...input.orderRow};Object.assign(db.tables.orders[0],patch);
      await expect(saveScopedOrderBonuses(input)).rejects.toThrow();expect(db.tables.order_bonuses).toHaveLength(0);
    }
  });
  it('HPP berubah sebelum simpan tidak disimpan dengan biaya auto lama',async()=>{
    const db=client(fixture());db.tables.invoices[0].materials_detail=JSON.stringify([{nama:'Pipa',jumlah:1,category:'PART'}]);
    const input=await args(db);input.entries[0].material_cost_source='auto';
    db.tables.inventory.push({code:'P1',name:'Pipa',purchase_price:100000});
    await expect(saveScopedOrderBonuses(input)).rejects.toThrow(/Harga beli material berubah/);
    expect(db.tables.order_bonuses).toHaveLength(0);
  });
  it('partial save dilaporkan dengan jumlah tepat, tanpa mengubah bonus PAID lama',async()=>{
    const seed=fixture();seed.order_bonuses=[{id:'OLD',order_id:'OTHER',bonus_type:'kapasitor',total_amount:40000,status:'PAID'}];
    const db=client(seed);let insert=0;const original=db.from;
    db.from=table=>{const q=original(table);if(table==='order_bonuses'){const single=q.single;q.single=()=>++insert===2?Promise.resolve({data:null,error:{message:'Gagal kedua'}}):single();}return q;};
    const input=await args(db);input.entries.push({bonus_type:'manual',total_amount:50000,note:'Pekerjaan tambahan terverifikasi'});
    expect(await saveScopedOrderBonuses(input)).toMatchObject({saved:1,failed:1});
    expect(db.tables.order_bonuses[0]).toEqual(seed.order_bonuses[0]);expect(db.tables.order_bonuses[0].status).toBe('PAID');
  });
});
