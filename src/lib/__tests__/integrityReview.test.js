import { describe, expect, it } from 'vitest';
import { normalizeInfraSnapshot } from '../infraHealth.js';
import { integrityReviewTargets } from '../integrityReview.js';

describe('quota freshness and integrity navigation', () => {
  const now=Date.parse('2026-10-18T10:00:00Z');
  const snapshot={measured_at:new Date(now).toISOString(),level:'ok',supabase_database:{percent:34},r2_storage:{percent:12}};
  it('does not show legacy missing/error R2 snapshots as healthy',()=>{
    expect(normalizeInfraSnapshot({...snapshot,r2_storage:{percent:null,error:'failed'}},now).level).toBe('unknown');
    expect(normalizeInfraSnapshot({...snapshot,measured_at:'invalid'},now)).toMatchObject({level:'unknown',stale:true});
    expect(normalizeInfraSnapshot(snapshot,now+37*3600000).level).toBe('unknown');
    expect(normalizeInfraSnapshot(snapshot,now-10*60000).level).toBe('unknown');
    expect(normalizeInfraSnapshot(snapshot,now).level).toBe('ok');
    expect(normalizeInfraSnapshot({...snapshot,r2_storage:{percent:NaN}},now).level).toBe('unknown');
  });
  it('known critical usage remains visible even if another measurement is incomplete',()=>{
    expect(normalizeInfraSnapshot({...snapshot,supabase_database:{percent:90},r2_storage:{}},now).level).toBe('critical');
  });
  it('maps rows to scoped review targets, never a mutation action',()=>{
    const links=integrityReviewTargets({invoice_id:'INV-1',order_id:'JOB-1',client_id:'CLIENT-1'});
    expect(links.map(l=>l.menu)).toEqual(['invoice','maintenance','orders']);
    expect(links[1].focus).toMatchObject({clientId:'CLIENT-1',orderId:'JOB-1',tab:'link'});
    expect(integrityReviewTargets({client_id:'CLIENT-1',unit_code:'AC-1'})[0].focus).toMatchObject({tab:'unit',unitCode:'AC-1'});
    const cross=integrityReviewTargets({client_id:'CLIENT-1',related_client_id:'CLIENT-2',unit_code:'AC-2'});
    expect(cross.map(t=>t.focus.clientId)).toEqual(['CLIENT-1','CLIENT-2']);
  });
});
