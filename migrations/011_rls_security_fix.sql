-- Migration 011: Fix RLS policy yang terlalu permisif
-- Audit finding: wa_messages, wa_conversations, payment_suggestions
-- mengizinkan anon read/write — berbahaya karena anon key ada di frontend bundle.
-- Jalankan di Supabase SQL Editor.

-- ══════════════════════════════════════════════════════════════
-- 1. wa_conversations
-- ══════════════════════════════════════════════════════════════
-- Hapus policy lama yang allow semua role
DROP POLICY IF EXISTS "anon_all_wa_conversations" ON wa_conversations;
DROP POLICY IF EXISTS "service_full" ON wa_conversations;
DROP POLICY IF EXISTS "allow_all" ON wa_conversations;

-- Authenticated user (teknisi/admin/owner) boleh baca — untuk WA Monitor di app
CREATE POLICY "auth_read_wa_conversations"
  ON wa_conversations FOR SELECT
  TO authenticated
  USING (true);

-- Hanya service_role (backend) yang boleh insert/update/delete
CREATE POLICY "service_write_wa_conversations"
  ON wa_conversations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 2. wa_messages
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "anon_all_wa_messages" ON wa_messages;
DROP POLICY IF EXISTS "service_full" ON wa_messages;
DROP POLICY IF EXISTS "allow_all" ON wa_messages;

-- Authenticated user boleh baca — untuk WA Monitor di app
CREATE POLICY "auth_read_wa_messages"
  ON wa_messages FOR SELECT
  TO authenticated
  USING (true);

-- Hanya service_role (backend) yang boleh insert/update/delete
CREATE POLICY "service_write_wa_messages"
  ON wa_messages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 3. payment_suggestions
-- ══════════════════════════════════════════════════════════════
-- Data ini sangat sensitif: nomor HP, nominal transfer, nama bank
DROP POLICY IF EXISTS "service_full" ON payment_suggestions;
DROP POLICY IF EXISTS "allow_all" ON payment_suggestions;
DROP POLICY IF EXISTS "anon_all_payment_suggestions" ON payment_suggestions;

-- Authenticated user boleh baca (untuk banner konfirmasi di app)
CREATE POLICY "auth_read_payment_suggestions"
  ON payment_suggestions FOR SELECT
  TO authenticated
  USING (true);

-- Hanya service_role (backend) yang boleh insert/update/delete
CREATE POLICY "service_write_payment_suggestions"
  ON payment_suggestions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 4. agent_logs — hanya service_role yang boleh DELETE
--    (mencegah user menghapus audit trail sendiri)
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "auth_delete_agent_logs" ON agent_logs;
DROP POLICY IF EXISTS "allow_all" ON agent_logs;

-- Baca: semua authenticated user (untuk ARA Log view)
CREATE POLICY "auth_read_agent_logs"
  ON agent_logs FOR SELECT
  TO authenticated
  USING (true);

-- Insert: authenticated (frontend log aktivitas)
CREATE POLICY "auth_insert_agent_logs"
  ON agent_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Delete & Update: hanya service_role (cron cleanup, bukan frontend)
CREATE POLICY "service_delete_agent_logs"
  ON agent_logs FOR DELETE
  TO service_role
  USING (true);

CREATE POLICY "service_update_agent_logs"
  ON agent_logs FOR UPDATE
  TO service_role
  USING (true);
