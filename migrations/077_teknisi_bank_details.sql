-- Migration 077: Add personal bank/payout details to user_profiles
-- Shown only inside the PIN-protected "Komisi Saya" area (per technician, own data only).

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS bank_name        TEXT DEFAULT NULL,  -- e.g. 'BCA', 'DANA'
  ADD COLUMN IF NOT EXISTS bank_account_no  TEXT DEFAULT NULL,  -- TEXT to preserve leading zeros (DANA / e-wallet)
  ADD COLUMN IF NOT EXISTS bank_holder      TEXT DEFAULT NULL,  -- rekening atas nama
  ADD COLUMN IF NOT EXISTS work_start_date  DATE DEFAULT NULL;  -- tanggal mulai kerja

COMMENT ON COLUMN user_profiles.bank_name       IS 'Bank / e-wallet name for payroll payout (e.g. BCA, DANA)';
COMMENT ON COLUMN user_profiles.bank_account_no IS 'Account / e-wallet number (TEXT to preserve leading zeros)';
COMMENT ON COLUMN user_profiles.bank_holder     IS 'Rekening atas nama (account holder name)';
COMMENT ON COLUMN user_profiles.work_start_date IS 'Technician/helper employment start date';

-- ── Seed payout data (matched by name against existing profiles) ──
-- Skipped: Yolanda (no profile). Ramdan = Hamdan (typo) — di-seed ke profil Hamdan.

UPDATE user_profiles SET bank_name='BCA',  bank_account_no='6044307591',  bank_holder='USAERI / KE YOLA',          work_start_date='2018-03-20' WHERE id='72b4e0a9-1f34-494e-abdd-55d628fe13c1'; -- Usaeri (ERI)
UPDATE user_profiles SET bank_name='BCA',  bank_account_no='5475435467',  bank_holder='AGUNG SUBAGYA',             work_start_date='2023-10-17' WHERE id='802d1485-d855-47fb-bbe3-b2211a5a8f97'; -- Agung
UPDATE user_profiles SET bank_name='BCA',  bank_account_no='6043681953',  bank_holder='ALBANA NIJI',               work_start_date='2021-01-09' WHERE id='6c027ec0-2c2d-4072-99cd-bcef954889fa'; -- Aji
UPDATE user_profiles SET bank_name='BCA',  bank_account_no='8680325929',  bank_holder='MULYADI',                   work_start_date='2021-02-01' WHERE id='0285c3c1-50c1-45b6-9d22-982136ffc3a2'; -- Mulyadi (FEB 2021)
UPDATE user_profiles SET bank_name='DANA', bank_account_no='085220225634',bank_holder='YUSUF DIDI SAPUTRA',         work_start_date='2024-12-24' WHERE id='768bcecf-f01e-462a-8670-a01be711cac3'; -- Yusuf
UPDATE user_profiles SET bank_name='DANA', bank_account_no='082127536842',bank_holder='ENO',                       work_start_date='2022-07-15' WHERE id='deb71140-aa01-42d5-b87b-dc88030ef98d'; -- Putra (RIZKY PUTRA)
UPDATE user_profiles SET bank_name='BCA',  bank_account_no='5475343058',  bank_holder='SAMSUL FAJAR',              work_start_date='2025-09-01' WHERE id='7cb14fdd-2be5-4682-861b-5b8e821ed475'; -- Samsul
UPDATE user_profiles SET bank_name='DANA', bank_account_no='083161242996',bank_holder='Aditya ramdani',            work_start_date='2026-04-23' WHERE id='1f2bdad0-2d44-430a-b842-5908e44d5209'; -- Adit
UPDATE user_profiles SET bank_name='BCA',  bank_account_no='5475464947',  bank_holder='EZRA NURPRADITYA WARDOYO',  work_start_date='2025-04-07' WHERE id='4e183a41-269c-445e-bbe4-af54ef0fb70d'; -- Ezra
UPDATE user_profiles SET                                                                                            work_start_date='2025-09-11' WHERE id='c8c64ce1-b8b7-442e-8e01-57f98d61244d'; -- Boim (no rekening)
UPDATE user_profiles SET bank_name='BCA',  bank_account_no='7005908396',  bank_holder='RAMDANA',                   work_start_date='2026-06-02' WHERE id='3d9cced7-4f65-470c-b0b7-e5643126997f'; -- Hamdan (RAMDAN, typo)
UPDATE user_profiles SET bank_name='BCA',  bank_account_no='8330442701',  bank_holder='MUHAMAD RIZAL',             work_start_date='2025-10-29' WHERE id='246343f9-75d6-4d2a-b141-94f9876af630'; -- Rizal
UPDATE user_profiles SET bank_name='BCA',  bank_account_no='7475042921',  bank_holder='RENALDI SA''BAN',           work_start_date='2025-10-27' WHERE id='20ab6ac1-9cb9-4f54-aceb-63cf2a1b9a1b'; -- Rey
UPDATE user_profiles SET bank_name='DANA', bank_account_no='085731720231',bank_holder='M PIKRI',                   work_start_date='2025-11-02' WHERE id='08b03451-bc46-494d-a294-beda7b5d5ec4'; -- Fikri
UPDATE user_profiles SET bank_name='DANA', bank_account_no='083156943404',bank_holder=NULL,                        work_start_date='2026-04-21' WHERE id='b8a46aa9-7b02-4ce7-88cc-3f008786e24f'; -- Angga
UPDATE user_profiles SET bank_name='DANA', bank_account_no='089644779499',bank_holder=NULL,                        work_start_date='2026-05-07' WHERE id='79655598-e22e-4c8e-9ec2-9f1d593b3e5f'; -- Ari
UPDATE user_profiles SET bank_name='DANA', bank_account_no='088976538047',bank_holder=NULL,                        work_start_date='2026-05-02' WHERE id='594bec68-a036-4d83-9a9a-3c8f810f5f96'; -- Dedi

COMMIT;
