-- Migration 007: Buat tabel wa_conversations & wa_messages jika belum ada,
-- dan pastikan RLS policy mengizinkan akses dari frontend (anon key).
-- Jalankan di Supabase SQL Editor.

-- ── wa_conversations ──
CREATE TABLE IF NOT EXISTS wa_conversations (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone      text UNIQUE NOT NULL,
  name       text,
  last_message text,
  last_reply text,
  unread     int DEFAULT 0,
  intent     text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_wa_conversations" ON wa_conversations;
CREATE POLICY "anon_all_wa_conversations" ON wa_conversations
  FOR ALL USING (true) WITH CHECK (true);

-- ── wa_messages ──
CREATE TABLE IF NOT EXISTS wa_messages (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone      text NOT NULL,
  name       text,
  content    text,
  role       text DEFAULT 'customer',
  image_url  text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_wa_messages" ON wa_messages;
CREATE POLICY "anon_all_wa_messages" ON wa_messages
  FOR ALL USING (true) WITH CHECK (true);

-- Index untuk performa
CREATE INDEX IF NOT EXISTS idx_wa_conv_updated ON wa_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msg_phone    ON wa_messages(phone, created_at ASC);
