// Reference calcGroup extracted from https://aclean.id/estimasi, public RPC rates read 2026-11-28.
const P = {
  "bongkar_pasang_indoor": 200000,
  "bongkar_pasang_outdoor": 200000,
  "bongkar_unit_besar": 200000,
  "bongkar_unit_kecil": 150000,
  "breket_outdoor": 150000,
  "duct_tape": 20000,
  "freon_r32": 500000,
  "kabel_15": 35000,
  "kabel_25": 45000,
  "kuras_vacum": 650000,
  "pasang_besar": 450000,
  "pasang_kecil": 400000,
  "pipa_1pk": 150000,
  "pipa_2_5pk": 240000,
  "pipa_2pk": 170000,
  "vacum_kecil": 50000
};
  var TIER = {
    '1':{label:'0,5 – 1 PK', pipa:'pipa_1pk',   kabel:'kabel_15', pasang:'pasang_kecil', bongkar:'bongkar_unit_kecil', fmult:1},
    '2':{label:'1,5 – 2 PK', pipa:'pipa_2pk',   kabel:'kabel_25', pasang:'pasang_besar', bongkar:'bongkar_unit_besar', fmult:1},
    '3':{label:'2,5 PK',     pipa:'pipa_2_5pk', kabel:'kabel_25', pasang:'pasang_besar', bongkar:'bongkar_unit_besar', fmult:2}
  };


export function referenceInstall(job, values) {
const fmt = n => String(n);
  function calcGroup(g){
    var t = TIER[g.querySelector('.g-pk').value] || TIER['1'];
    var qty   = Math.max(1, parseInt(g.querySelector('.g-qty').value,10)||1);
    var lPipa = g.querySelector('.g-pipa-on').checked  ? Math.max(0, parseFloat(g.querySelector('.g-pipa').value)||0)  : 0;
    var lKabel= g.querySelector('.g-kabel-on').checked ? Math.max(0, parseFloat(g.querySelector('.g-kabel').value)||0) : 0;
    var fTambah = P.freon_r32 * t.fmult;                       // 500rb · 2,5PK 1jt
    var fKuras  = P.kuras_vacum + P.freon_r32 * (t.fmult - 1); // 650rb · 2,5PK 1,15jt

    g.querySelector('.g-p-vacum').textContent  = fmt(P.vacum_kecil);
    g.querySelector('.g-p-breket').textContent = fmt(P.breket_outdoor);
    g.querySelector('.g-p-duct').textContent   = fmt(P.duct_tape);
    g.querySelector('.g-p-freon').textContent  = fmt(fTambah);
    g.querySelector('.g-p-kuras').textContent  = fmt(fKuras);

    var items = [];
    if(job==='pasang'){
      items.push({lbl:'Jasa Pasang AC Baru', sub:qty+' unit @ '+fmt(P[t.pasang]), amt:P[t.pasang]*qty});
    } else {
      items.push({lbl:'Jasa Bongkar Unit AC', sub:qty+' unit @ '+fmt(P[t.bongkar]), amt:P[t.bongkar]*qty});
      var bp = P.bongkar_pasang_indoor + P.bongkar_pasang_outdoor;
      items.push({lbl:'Jasa Pasang Kembali', sub:'Indoor + Outdoor × '+qty+' unit', amt:bp*qty});
    }
    if(lPipa>0)  items.push({lbl:'Pipa AC', sub:lPipa+' m × '+qty+' unit @ '+fmt(P[t.pipa])+'/m', amt:P[t.pipa]*lPipa*qty});
    if(lKabel>0) items.push({lbl:'Kabel Listrik', sub:lKabel+' m × '+qty+' unit @ '+fmt(P[t.kabel])+'/m', amt:P[t.kabel]*lKabel*qty});
    if(g.querySelector('.g-vacum').checked)  items.push({lbl:'Jasa Vacum', sub:qty+' unit @ '+fmt(P.vacum_kecil), amt:P.vacum_kecil*qty});
    if(g.querySelector('.g-breket').checked) items.push({lbl:'Breket Outdoor + Dinabolt', sub:qty+' set @ '+fmt(P.breket_outdoor), amt:P.breket_outdoor*qty});
    if(g.querySelector('.g-duct').checked)   items.push({lbl:'Duct Tape', sub:qty+' pcs @ '+fmt(P.duct_tape), amt:P.duct_tape*qty});
    if(g.querySelector('.g-freon').checked)  items.push({lbl:'Penambahan Freon', sub:qty+' unit @ '+fmt(fTambah), amt:fTambah*qty});
    if(g.querySelector('.g-kuras').checked)  items.push({lbl:'Kuras Vacum Freon', sub:qty+' unit @ '+fmt(fKuras), amt:fKuras*qty});

    var sub = items.reduce(function(s,i){return s+i.amt;},0);
    return {items:items, sub:sub, label:t.label, qty:qty};
  }


return calcGroup({querySelector: key => values[key] || {}}).sub;
}
