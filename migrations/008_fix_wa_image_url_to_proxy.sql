-- Migration 008: Fix image_url yang pakai r2.dev public domain → proxy /api/foto?key=...
-- Jalankan di Supabase SQL Editor.
-- Konversi URL lama: https://pub-xxx.r2.dev/wa-images/... → /api/foto?key=wa-images/...

UPDATE wa_messages
SET image_url = '/api/foto?key=' || regexp_replace(image_url, '^https?://[^/]+/', '')
WHERE image_url LIKE '%r2.dev/wa-images/%'
  AND image_url NOT LIKE '/api/foto%';

UPDATE payment_suggestions
SET image_url = '/api/foto?key=' || regexp_replace(image_url, '^https?://[^/]+/', '')
WHERE image_url LIKE '%r2.dev/wa-images/%'
  AND image_url NOT LIKE '/api/foto%';
