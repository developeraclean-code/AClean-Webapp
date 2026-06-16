-- 083_project_usage_satuan.sql
-- APPLIED (via MCP, 2026-06-12)
--
-- Integritas pemakaian material Project: pisahkan satuan dari qty.
-- Dulu qty disimpan string gabungan ("18 meter") → ringkasan portal Number(qty)=NaN.
-- Sekarang qty = angka saja, satuan kolom terpisah. Pencatatan pemakaian juga
-- memotong project_alokasi (lihat ProjectUsageView). Data lama 0 baris → tanpa backfill.

alter table project_usage add column if not exists satuan text;
