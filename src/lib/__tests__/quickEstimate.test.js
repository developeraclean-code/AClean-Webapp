import { describe, it, expect } from 'vitest';
import { calculateInstallEstimate, calculatePipeReplacementEstimate, calculateManualEstimate, manualEstimateItemError } from '../quickEstimate.js';
import { referenceInstall } from './fixtures/quickEstimateReference.js';
describe('Quick estimate, verified public pricing 2026-11-28',()=>{
  it('matches original calculator across 2304 installation combinations',()=>{
    let count=0;
    for(const [pk,tier] of [['1','1'],['2','2'],['2.5','3']]) for(const qty of [1,3,10]) for(const workType of ['new','move']) for(let mask=0;mask<32;mask++) for(let freon=0;freon<4;freon++) {
      const g={pk,qty,pipeMeters:4.5,cableMeters:5.5,usePipe:!!(mask&1),useCable:!!(mask&2),vacuum:!!(mask&4),bracket:!!(mask&8),ductTape:!!(mask&16),freonTopup:!!(freon&1),freonFlush:!!(freon&2)};
      const expected=referenceInstall(workType==='new'?'pasang':'bongkar', {'.g-pk':{value:tier},'.g-qty':{value:qty},'.g-pipa':{value:g.pipeMeters},'.g-kabel':{value:g.cableMeters},'.g-pipa-on':{checked:g.usePipe},'.g-kabel-on':{checked:g.useCable},'.g-vacum':{checked:g.vacuum},'.g-breket':{checked:g.bracket},'.g-duct':{checked:g.ductTape},'.g-freon':{checked:g.freonTopup},'.g-kuras':{checked:g.freonFlush}});
      expect(calculateInstallEstimate({groups:[g],workType}).total).toBe(expected); count++;
    }
    expect(count).toBe(2304);
  });
  it('keeps pipe material/manual/freon amounts independent of AC unit count',()=>{
    const selected={pipe1:{enabled:true,qty:4},cable15:{enabled:true,qty:4},ductGlue:{enabled:true,qty:1},freon:['smallTopup','largeFlush']};
    const manualItems=[{label:'Extra',qty:2.5,unit:'m',unitPrice:30000}];
    expect(calculatePipeReplacementEstimate({units:1,selected,manualItems}).total).toBe(2685000);
    expect(calculatePipeReplacementEstimate({units:4,selected,manualItems}).total).toBe(3285000);
  });
  it.each(['',-1,Infinity,NaN])('rejects incomplete/invalid manual price %s',unitPrice=>{
    const item={label:'Kapasitor',qty:1,unit:'pcs',unitPrice};
    expect(manualEstimateItemError(item)).toBeTruthy();
    expect(calculateManualEstimate([item]).rows).toEqual([]);
  });
  it('allows complimentary items and calculates decimal quantities',()=>{
    expect(calculateManualEstimate([{label:'Bonus',qty:1,unit:'pcs',unitPrice:0},{label:'Extra',qty:2.5,unit:'m',unitPrice:30000}]).total).toBe(75000);
  });
  it('has no base charge for sparepart and sums mixed installation groups',()=>{
    expect(calculateManualEstimate([])).toEqual({rows:[],total:0});
    const groups=[{pk:'1',qty:2},{pk:'2.5',qty:3}];
    expect(calculateInstallEstimate({groups,workType:'new'}).total).toBe(2150000);
  });
});
