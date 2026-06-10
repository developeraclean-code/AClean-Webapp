-- Quick Win 8 — Lock storage bucket 'fotos'
-- Bucket Supabase 'fotos' kosong (0 obj) dan tidak dipakai code app (semua foto via R2).
-- Tutup public=false agar advisor warning hilang + tidak bisa di-list/akses anon.

UPDATE storage.buckets SET public = false WHERE id = 'fotos';
