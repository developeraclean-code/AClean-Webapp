-- 081_project_tools_project_id.sql
-- APPLIED (via MCP, 2026-06-12)
--
-- Alat kerja Project bisa dikelompokkan per project (tiap project beda kebutuhan alat).
-- project_id NULL = alat umum / gudang (tidak terikat project tertentu).

alter table project_tools add column if not exists project_id text;
