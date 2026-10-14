import { describe, expect, it } from 'vitest';
import { DEFAULT_BONUS_CATEGORIES } from '../../constants/bonus.js';
import { bonusCandidateInfo } from '../bonus.js';
import { buildBonusRekap } from '../bonusRekap.js';
import {
  buildBonusSettingsPayload, marginBonusForProfit, marginBonusTiers, normalizeBonusCategories,
} from '../bonusSettings.js';

const fresh = () => DEFAULT_BONUS_CATEGORIES.map(category => ({ ...category }));
const custom = () => fresh().map(category => ({ ...category,
  ...(category.id === 'margin_2jt' ? { threshold: 2000000 } : {}),
  ...(category.id === 'margin_3jt' ? { threshold: 3000000 } : {}),
}));

describe('bonus margin dari setting', () => {
  it.each([
    [999999, null], [1000000, null], [1000001, 50000], [1499999, 50000],
    [1500000, 50000], [1500001, 100000], [2499999, 100000],
    [2500000, 100000], [2500001, 200000], [9000000, 200000],
  ])('margin Rp%s memilih satu tingkat bonus tertinggi: %s', (profit, amount) => {
    expect(marginBonusForProfit(profit)?.amount ?? null).toBe(amount);
  });

  it('batas manual 2jt/3jt mengubah hasil hitungan dan tetap memakai ID kategori lama', () => {
    const saved = buildBonusSettingsPayload(custom());
    expect(marginBonusForProfit(1800000, saved)).toMatchObject({ id: 'margin_1jt', amount: 50000 });
    expect(marginBonusForProfit(2000000, saved).amount).toBe(50000);
    expect(marginBonusForProfit(2000001, saved).amount).toBe(100000);
    expect(marginBonusForProfit(2500000, saved)).toMatchObject({ id: 'margin_2jt', threshold: 2000000, amount: 100000 });
    expect(marginBonusForProfit(3000000, saved).amount).toBe(100000);
    expect(marginBonusForProfit(3000001, saved).amount).toBe(200000);
    expect(marginBonusForProfit(3100000, saved)).toMatchObject({ id: 'margin_3jt', threshold: 3000000, amount: 200000 });
  });

  it('nominal bonus manual dipakai langsung, tidak terikat hardcode preview', () => {
    const categories = fresh().map(category => category.id === 'margin_2jt' ? { ...category, amount: 125000 } : category);
    expect(marginBonusForProfit(1600000, categories).amount).toBe(125000);
  });

  it('setting lama tanpa threshold memperoleh batas baru tanpa memutasi data sumber', () => {
    const old = fresh().map(({ threshold, ...category }) => ({ ...category,
      ...(category.id === 'margin_2jt' ? { label: 'Margin >2jt' } : {}),
      ...(category.id === 'margin_3jt' ? { label: 'Margin >3jt' } : {}),
    }));
    const loaded = normalizeBonusCategories(old);
    expect(loaded.slice(0,3).map(category => category.threshold)).toEqual([1000000,1500000,2500000]);
    expect(loaded[1].label).toBe('Margin >1,5jt');
    expect(old[1].threshold).toBeUndefined();
    expect(old[1].label).toBe('Margin >2jt');
  });

  it('batas manual tetap sama setelah simpan JSON dan reload', () => {
    const saved = buildBonusSettingsPayload(custom());
    const loaded = normalizeBonusCategories(JSON.parse(JSON.stringify(saved)));
    expect(loaded.slice(0,3).map(category => category.threshold)).toEqual([1000000,2000000,3000000]);
    expect(loaded[2].label).toBe('Margin >3jt');
    expect(marginBonusForProfit(2600000, loaded).amount).toBe(100000);
  });

  it.each([0,-1,1000000.5,NaN,Infinity,''])('menolak batas margin tidak valid: %s', threshold => {
    const rows = fresh(); rows[0].threshold = threshold;
    expect(() => buildBonusSettingsPayload(rows)).toThrow(/batas margin/);
  });

  it('menolak batas ganda atau urutan tingkat terbalik sebelum setting disimpan', () => {
    const duplicate = fresh(); duplicate[1].threshold = 1000000;
    expect(() => buildBonusSettingsPayload(duplicate)).toThrow(/harus meningkat/);
    const reversed = fresh(); reversed[1].threshold = 3000000;
    expect(() => buildBonusSettingsPayload(reversed)).toThrow(/harus meningkat/);
  });

  it('menolak nominal negatif dan menjaga aturan kategori selain margin', () => {
    const invalid = fresh(); invalid[0].amount = -50000;
    expect(() => buildBonusSettingsPayload(invalid)).toThrow(/Nominal/);
    const saved = buildBonusSettingsPayload(custom());
    expect(saved.find(category => category.id === 'freon')).toMatchObject({ amount: 20000, detection_keywords: ['freon'], exclude_keywords: ['pengisian'] });
    expect(saved.find(category => category.id === 'freon').threshold).toBeUndefined();
  });

  it('kategori margin yang dinonaktifkan tidak menghasilkan bonus', () => {
    const categories = fresh().filter(category => !category.id.startsWith('margin_'));
    expect(marginBonusTiers(categories)).toEqual([]);
    expect(marginBonusForProfit(9000000, categories)).toBeNull();
    expect(marginBonusForProfit(null)).toBeNull();
    expect(marginBonusForProfit(Infinity)).toBeNull();
  });

  it('review kandidat mengikuti batas margin terendah yang disetel', () => {
    const categories = fresh().map(category => ({ ...category,
      ...(category.id === 'margin_1jt' ? { threshold: 2000000 } : {}),
      ...(category.id === 'margin_2jt' ? { threshold: 2500000 } : {}),
      ...(category.id === 'margin_3jt' ? { threshold: 3000000 } : {}),
    }));
    const order = { id:'J1', date:'2026-07-01', service:'Repair' };
    expect(bonusCandidateInfo(order,1500000,[],[],categories).eligible).toBe(false);
    expect(bonusCandidateInfo(order,2000000,[],[],categories).eligible).toBe(false);
    expect(bonusCandidateInfo(order,2000001,[],[],categories).eligible).toBe(true);
    expect(bonusCandidateInfo(order,500000,['freon'],[],categories).eligible).toBe(true);
  });

  it('review margin memakai lebih-dari, tanpa mengubah syarat minimum omset Install', () => {
    const order = { id:'J1', date:'2026-07-01', service:'Repair', units:1 };
    expect(bonusCandidateInfo(order,1000000).eligible).toBe(false);
    expect(bonusCandidateInfo(order,1000001)).toMatchObject({ eligible:true, omsetComparison:'>' });
    const install = { ...order, service:'Install' };
    expect(bonusCandidateInfo(install,1499999).eligible).toBe(false);
    expect(bonusCandidateInfo(install,1500000)).toMatchObject({ eligible:true, omsetComparison:'≥' });
    const categories = fresh().map(category => ({ ...category,
      ...(category.id === 'margin_1jt' ? { threshold:1500000 } : {}),
      ...(category.id === 'margin_2jt' ? { threshold:2000000 } : {}),
    }));
    expect(bonusCandidateInfo(install,1500000,[],[],categories).eligible).toBe(false);
    expect(bonusCandidateInfo(install,1500001,[],[],categories)).toMatchObject({ eligible:true, omsetComparison:'>' });
  });

  it('mengubah setting tidak menghitung ulang nominal atau pembagian bonus tersimpan', () => {
    const bonus = { id:'B1',order_id:'J1',order_date:'2026-07-01',bonus_type:'margin_2jt',team_members:['Rey','Putra'],member_count:2,total_amount:100000,amount_per_person:50000,status:'PAID' };
    const rekap = buildBonusRekap({ month:'2026-07', bonuses:[bonus], bonusCategories:custom().map(category=>({...category,amount:200000})) });
    expect(rekap.summary.totalBonus).toBe(100000);
    expect(rekap.perPerson.find(person=>person.nama==='Putra').total).toBe(50000);
    expect(bonus.status).toBe('PAID');
  });
});
