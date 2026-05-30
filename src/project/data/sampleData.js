// Bentuk state awal kosong — dipakai sebelum loadAll() dari Supabase selesai.
// Data sebenarnya di-fetch di ProjectContext via src/project/data/projectApi.js
// (tabel project_* — lihat migrations/051_project_module.sql).
export const initialData = () => ({
  projects: [],
  dp: [],
  materials: [],
  alokasi: [],
  usage: [],
  tools: [],
  expenses: [],
  purchases: [],
  harian: [],
  documents: [],
});
