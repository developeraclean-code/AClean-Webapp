import { describe, it, expect } from 'vitest';
import { SERVICE_AREAS, resolveServiceArea, areaMapsUrl } from '../serviceArea.js';

describe('perkiraan area layanan',()=>{
  it('memiliki sembilan area operasional yang dipilih admin',()=>{
    expect(SERVICE_AREAS).toEqual(['Gading Serpong','BSD','Alam Sutera','Bintaro','Graha Raya','Tangerang','Jakarta Barat','Karawaci','Suvarna Sutera']);
  });
  it.each([
    ['De Park BSD City, Tangerang Selatan','BSD'],
    ['Gading Serpong, Tangerang','Gading Serpong'],
    ['Suvarna Sutera, Tangerang','Suvarna Sutera'],
    ['Graha Raya Bintaro','Graha Raya'],
    ['Lippo Karawaci, Tangerang','Karawaci'],
    ['Alam Sutera, Kota Tangerang','Alam Sutera'],
    ['Bintaro Sektor 9','Bintaro'],
    ['Jakarta Barat','Jakarta Barat'],
    ['Kota Tangerang','Tangerang'],
  ])('%s → %s', (address,expected)=>{
    expect(resolveServiceArea({address})).toMatchObject({label:expected,source:'alamat'});
  });
  it('keeps unknown and broad Tangerang Selatan unassigned',()=>{
    expect(resolveServiceArea({address:'Jl. Melati No.12, Tangerang Selatan'}).label).toBe('Area belum jelas');
    expect(resolveServiceArea({address:'Jl. Melati 12'}).label).toBe('Area belum jelas');
  });
  it('honors a saved specific area and marks contradictory address for review',()=>{
    expect(resolveServiceArea({area:'BSD',address:'Alam Sutera'})).toMatchObject({label:'BSD',conflict:true});
    expect(resolveServiceArea({area:'Tangerang',address:'De Park BSD City'})).toMatchObject({label:'BSD',conflict:false});
  });
  it('only offers Maps lookup when an address exists',()=>{
    expect(areaMapsUrl('De Park BSD City')).toContain('De%20Park%20BSD%20City');
    expect(areaMapsUrl('')).toBeNull();
  });
});
