-- 110_trim_team_names.sql
-- Cegah nama tim "kotor" (spasi depan/belakang) masuk lagi — akar masalah
-- "Ferdi" vs "Ferdi " yang bikin 1 orang dihitung 2 (ghost-pending).
-- Data lama sudah dinormalisasi manual; trigger ini menjaga ke depan dari
-- SEMUA jalur tulis (WA bot, form order, quick-assign, dll) dalam 1 tempat.
--
-- Hanya btrim (potong spasi). TIDAK mengubah null/empty semantics, tidak
-- menyentuh case (case di-handle manual/aplikasi). Ringan, BEFORE row trigger.

CREATE OR REPLACE FUNCTION trim_team_names() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    NEW.teknisi  := btrim(NEW.teknisi);
    NEW.helper   := btrim(NEW.helper);
    NEW.teknisi2 := btrim(NEW.teknisi2);
    NEW.helper2  := btrim(NEW.helper2);
    NEW.teknisi3 := btrim(NEW.teknisi3);
    NEW.helper3  := btrim(NEW.helper3);
  ELSIF TG_TABLE_NAME = 'service_reports' THEN
    NEW.teknisi := btrim(NEW.teknisi);
    NEW.helper  := btrim(NEW.helper);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trim_team_names ON orders;
CREATE TRIGGER trg_trim_team_names
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION trim_team_names();

DROP TRIGGER IF EXISTS trg_trim_team_names ON service_reports;
CREATE TRIGGER trg_trim_team_names
  BEFORE INSERT OR UPDATE ON service_reports
  FOR EACH ROW EXECUTE FUNCTION trim_team_names();
