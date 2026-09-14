-- 172 — Lampiran gambar terstruktur untuk dokumen Maintenance dan Project.
-- File tetap berada di R2; database hanya menyimpan URL, caption, nama, dan hash.

BEGIN;

ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.maintenance_documents
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_attachments_array;
ALTER TABLE public.project_documents
  ADD CONSTRAINT project_documents_attachments_array
  CHECK (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 8);

ALTER TABLE public.maintenance_documents
  DROP CONSTRAINT IF EXISTS maintenance_documents_attachments_array;
ALTER TABLE public.maintenance_documents
  ADD CONSTRAINT maintenance_documents_attachments_array
  CHECK (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 8);

COMMIT;
