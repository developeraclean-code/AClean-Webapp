// Data layer modul Project — Supabase (standalone, tabel prefix `project_`).
// Memetakan field camelCase (state UI) ↔ kolom snake_case (DB) per entitas.
// Lihat migrations/051_project_module.sql untuk skema.
import { supabase } from "../../supabaseClient.js";

// key state ↔ nama tabel DB (selalu project_<key>)
const TABLE = {
  projects: "project_projects",
  dp: "project_dp",
  materials: "project_materials",
  alokasi: "project_alokasi",
  usage: "project_usage",
  tools: "project_tools",
  expenses: "project_expenses",
  purchases: "project_purchases",
  harian: "project_harian",
  documents: "project_documents",
};

// Peta field JS → kolom DB per entitas. Field jsonb (tim/pagi/sore/items/checklist)
// & data URL dipetakan apa adanya (passthrough).
const FIELDS = {
  projects: { id: "id", nama: "nama", kategori: "kategori", lokasi: "lokasi", pic: "pic", status: "status", progress: "progress", mulai: "mulai", target: "target", nilai: "nilai", rab: "rab", tim: "tim", _prev: "prev_status", portalToken: "portal_token", tokenActive: "token_active" },
  dp: { id: "id", projectId: "project_id", tanggal: "tanggal", jumlah: "jumlah", ket: "ket" },
  materials: { id: "id", nama: "nama", sub: "sub", satuan: "satuan", gudang: "gudang", min: "min_qty", harga: "harga" },
  alokasi: { id: "id", materialId: "material_id", projectId: "project_id", qty: "qty" },
  usage: { id: "id", projectId: "project_id", tanggal: "tanggal", material: "material", qty: "qty", satuan: "satuan", oleh: "oleh" },
  tools: { id: "id", nama: "nama", jumlah: "jumlah", status: "status", lokasi: "lokasi", projectId: "project_id" },
  expenses: { id: "id", projectId: "project_id", tanggal: "tanggal", kategori: "kategori", ket: "ket", nominal: "nominal", oleh: "oleh" },
  purchases: { id: "id", projectId: "project_id", tanggal: "tanggal", jenis: "jenis", item: "item", qty: "qty", total: "total", nota: "nota" },
  harian: { id: "id", projectId: "project_id", tanggal: "tanggal", oleh: "oleh", pagi: "pagi", sore: "sore", status: "status" },
  documents: { id: "id", projectId: "project_id", jenis: "jenis", tanggal: "tanggal", nomor: "nomor", kepada: "kepada", periode: "periode", uraian: "uraian", items: "items", foto: "foto", ttdTeknisi: "ttd_teknisi", ttdCustomer: "ttd_customer", ttdCustomerImg: "ttd_customer_img", checklist: "checklist" },
};

// Urutan load + insert optimistic. true = ascending (append), false = desc (newest-first / prepend).
export const ASC = {
  projects: true, materials: true, tools: true, dp: true, alokasi: true,
  usage: false, expenses: false, purchases: false, harian: false, documents: false,
};

// projectId "" (umum) → NULL di DB.
const toRow = (key, obj) => {
  const map = FIELDS[key]; const row = {};
  for (const js in map) {
    if (!(js in obj)) continue;
    let v = obj[js];
    if ((map[js] === "project_id") && (v === "" || v === undefined)) v = null;
    row[map[js]] = v;
  }
  return row;
};

const fromRow = (key, row) => {
  const map = FIELDS[key]; const obj = {};
  for (const js in map) obj[js] = row[map[js]];
  return obj;
};

export const genId = (p = "r") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const EMPTY = () => ({ projects: [], dp: [], materials: [], alokasi: [], usage: [], tools: [], expenses: [], purchases: [], harian: [], documents: [] });

// Load semua tabel sekaligus → bentuk sama dgn initialData().
export async function loadAll() {
  const keys = Object.keys(TABLE);
  const results = await Promise.all(
    keys.map((k) => supabase.from(TABLE[k]).select("*").order("created_at", { ascending: ASC[k] }))
  );
  const out = EMPTY();
  results.forEach((res, i) => {
    const k = keys[i];
    if (res.error) throw new Error(`load ${k}: ${res.error.message}`);
    out[k] = (res.data || []).map((r) => fromRow(k, r));
  });
  return out;
}

export const api = {
  async insert(key, rows) {
    const payload = rows.map((r) => toRow(key, r));
    const { error } = await supabase.from(TABLE[key]).insert(payload);
    if (error) throw new Error(`insert ${key}: ${error.message}`);
  },
  async update(key, id, patch) {
    const { error } = await supabase.from(TABLE[key]).update(toRow(key, patch)).eq("id", id);
    if (error) throw new Error(`update ${key}: ${error.message}`);
  },
  async upsert(key, rows, onConflict) {
    const payload = rows.map((r) => toRow(key, r));
    const { error } = await supabase.from(TABLE[key]).upsert(payload, onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`upsert ${key}: ${error.message}`);
  },
};
