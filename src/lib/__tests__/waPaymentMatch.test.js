import { describe, it, expect } from 'vitest';
import { matchPaymentInvoices } from '../waPaymentMatch.js';
import { waMediaUrl } from '../waPaymentContext.js';
const phone='62816833809';
const invoice=(id,total,extra={})=>({id,total,phone,status:'UNPAID',...extra});
describe('payment matching',()=>{
  it('suggests Husin 500k + 450k as one 950k transfer',()=>{
    expect(matchPaymentInvoices([invoice('old',500000),invoice('new',450000)],phone,950000)).toMatchObject({kind:'multi',invoices:[{id:'old'},{id:'new'}]});
  });
  it('refuses ambiguous single vs combined, foreign numbers, and paid invoices',()=>{
    const rows=[invoice('a',500000),invoice('b',450000),invoice('c',950000)];
    expect(matchPaymentInvoices(rows,phone,950000)).toMatchObject({kind:'ambiguous',invoices:[]});
    expect(matchPaymentInvoices([invoice('x',950000,{phone:'628123456789'}),invoice('y',950000,{status:'PAID'})],phone,950000)).toMatchObject({kind:'manual',invoices:[]});
  });
  it('uses outstanding amount and matches local phone format',()=>{
    expect(matchPaymentInvoices([invoice('a',500000,{phone:'0816833809',status:'PARTIAL_PAID',paid_amount:200000})],phone,300000)).toMatchObject({kind:'single'});
    expect(matchPaymentInvoices([invoice('a',500000)],phone,400000).invoices).toEqual([]);
  });
  it('handles missing amount and bounds large sets',()=>{
    expect(matchPaymentInvoices([invoice('a',1)],phone,null).invoices).toEqual([]);
    expect(matchPaymentInvoices(Array.from({length:19},(_,n)=>invoice('i'+n,1)),phone,19).kind).toBe('manual');
  });
});
describe('WA media URL',()=>{
  it('renders relative R2 and absolute images while rejecting executable/other relative URLs',()=>{
    expect(waMediaUrl('/api/foto?key=wa-inbox%2Fa.jpg')).toContain('a.jpg');
    expect(waMediaUrl('https://api.fonnte.com/a.jpg')).toBe('https://api.fonnte.com/a.jpg');
    for(const bad of ['javascript:alert(1)','//evil.test/a','/api/other?key=x','data:text/html,x']) expect(waMediaUrl(bad)).toBeNull();
  });
});
