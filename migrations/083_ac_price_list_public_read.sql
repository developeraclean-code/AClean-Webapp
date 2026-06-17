-- Migration 083: Izinkan anon SELECT ac_price_list
-- Background: migration 067 (qw6_rls_mass_lockdown) mengunci semua policy ke
-- authenticated only, termasuk ac_price_list. Tapi tabel ini perlu bisa dibaca
-- oleh anon key karena dipakai di public landing page jual-ac.html tanpa login.
-- Fix: tambah policy SELECT untuk role anon (read-only, hanya baris is_active=true).

CREATE POLICY ac_price_list_select_anon
  ON ac_price_list
  FOR SELECT
  TO anon
  USING (is_active = true);
