-- Migration 075: Add configurable bonus categories to app_settings
-- Allows Owner to customize bonus types, amounts, and detection keywords without code changes

BEGIN;

-- Add bonus_categories JSON field to app_settings if not exists
-- Default structure includes all existing bonus types with detection rules
INSERT INTO app_settings (key, value)
VALUES (
  'bonus_categories',
  '[
    {
      "id": "margin_1jt",
      "label": "Margin >1jt",
      "amount": 50000,
      "detection_keywords": []
    },
    {
      "id": "margin_2jt",
      "label": "Margin >2jt",
      "amount": 100000,
      "detection_keywords": []
    },
    {
      "id": "margin_3jt",
      "label": "Margin >3jt",
      "amount": 200000,
      "detection_keywords": []
    },
    {
      "id": "freon",
      "label": "Isi Freon",
      "amount": 25000,
      "detection_keywords": ["freon", "kuras vacum"]
    },
    {
      "id": "kapasitor",
      "label": "Kapasitor",
      "amount": 35000,
      "detection_keywords": ["kapasitor ac"]
    },
    {
      "id": "thermis",
      "label": "Sparepart Thermis",
      "amount": 35000,
      "detection_keywords": ["thermis"]
    },
    {
      "id": "install_2",
      "label": "Pasang >2 Unit/hari",
      "amount": 100000,
      "detection_keywords": []
    },
    {
      "id": "install_3",
      "label": "Pasang >3 Unit/hari",
      "amount": 200000,
      "detection_keywords": []
    },
    {
      "id": "install_4",
      "label": "Pasang >4 Unit/hari",
      "amount": 300000,
      "detection_keywords": []
    },
    {
      "id": "manual",
      "label": "Bonus Manual",
      "amount": 0,
      "detection_keywords": []
    }
  ]'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
