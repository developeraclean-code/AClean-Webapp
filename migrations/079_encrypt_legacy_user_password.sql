-- 079_encrypt_legacy_user_password.sql
-- APPLIED (via MCP, 2026-06-11)
--
-- Konteks: kolom legacy `user_profiles.password` menyimpan password PLAINTEXT.
-- Login aplikasi memakai Supabase Auth (auth.users), BUKAN kolom ini — jadi kolom
-- tidak dipakai untuk autentikasi. Tapi login menjalankan select("*") pada
-- user_profiles sehingga password plaintext ikut terkirim ke browser → risiko bocor.
--
-- Keputusan Owner: nilai tetap disimpan (tidak dihapus) tapi DIENKRIPSI agar tidak
-- bocor sebagai plaintext. Pakai pgcrypto PGP simetris + kunci di Supabase Vault.
--
-- Catatan: ganti password kini WAJIB lewat /api/manage-user action "reset-password"
-- (admin.updateUserById) yang mengubah password Supabase Auth sebenarnya. Modal
-- "Ganti Password" di App.jsx sudah diperbaiki (commit 42df2ce) agar tidak lagi
-- menulis plaintext ke kolom ini.

-- 1. Kunci enkripsi di Vault (random 32 byte hex), idempotent
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'user_profiles_password_key') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'user_profiles_password_key',
      'Kunci enkripsi kolom legacy user_profiles.password (PGP sym)'
    );
  end if;
end $$;

-- 2. Enkripsi semua nilai plaintext yang tersisa (guard: skip yang sudah ter-armor PGP)
update user_profiles
set password = armor(pgp_sym_encrypt(
      password,
      (select decrypted_secret from vault.decrypted_secrets where name = 'user_profiles_password_key')
    ))
where password is not null and password <> ''
  and password not like '-----BEGIN PGP MESSAGE-----%';

-- Untuk decrypt manual (Owner, via SQL editor) bila suatu saat diperlukan:
--   select email,
--     pgp_sym_decrypt(dearmor(password),
--       (select decrypted_secret from vault.decrypted_secrets where name = 'user_profiles_password_key'))
--   from user_profiles where password like '-----BEGIN PGP MESSAGE-----%';
