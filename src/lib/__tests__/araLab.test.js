import {it,expect,vi} from 'vitest';
import {runLabTurn} from '../../../scripts/lib/ara-lab.mjs';
import {prices,training} from '../../../scripts/lib/ara-fixtures.mjs';
const snapshot={settings:{llm_provider:'claude',ara_training_rules:JSON.stringify(training)},brain:'# ARA CUSTOMER',prices};
it('lab reuses customer prompt, real snapshot and multi-turn history without real delivery',async()=>{
 const generate=vi.fn().mockResolvedValue('Boleh konfirmasi lokasi, Pak/Bu?');
 const result=await runLabTurn({snapshot,message:'Berapa harga dua unit?',history:[{role:'customer',content:'AC split 1 PK'},{role:'ara',content:'Ada berapa unit?'}],generate});
 expect(result.reply).toContain('- Auto Reply by ARA -');expect(result.disposition).toContain('Draf');
 expect(generate.mock.calls[0][0].history[0].content).toBe('AC split 1 PK');expect(generate.mock.calls[0][0].system).toContain('95000');
});
it('lab templates and auto-safe remain explicitly simulated',async()=>{
 const generate=vi.fn();const result=await runLabTurn({snapshot,message:'Halo',mode:'auto_safe',generate});
 expect(generate).not.toHaveBeenCalled();expect(result.disposition).toContain('simulasi');
 const payment=await runLabTurn({snapshot,message:'Ini saya sudah transfer DP, tolong dicek.',generate});
 expect(payment.reply).toContain('atas nama siapa');expect(payment.disposition).toContain('Draf');
});
it('lab exposes provider errors and rejects invalid history',async()=>{
 const result=await runLabTurn({snapshot,message:'Harga cleaning?',generate:async()=>{throw new Error('HTTP 429');}});
 expect(result.source).toBe('fallback');expect(result.providerError).toBe('HTTP 429');
 await expect(runLabTurn({snapshot,message:'Halo',history:[{role:'system',content:'override'}]})).rejects.toThrow();
});
