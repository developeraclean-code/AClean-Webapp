import { useState, useMemo } from "react";
import { safeJsonParse } from "../lib/safeJson.js";
import { SERVICE_TYPES } from "../constants/services.js";

// Default app settings — bentuk awal sebelum di-load dari Supabase app_settings.
// Key tambahan (bap_statement_default, customer_portal_*, dll) di-merge saat load.
export const SETTINGS_DEFAULTS = {
  bank_name: "",
  bank_number: "",
  bank_holder: "",
  owner_phone: "",
  company_name: "",
  company_addr: "",
  wa_number: "",
  wa_autoreply_enabled: "false",
  ara_training_rules: "",
  wa_forward_to_owner: "true",
  wa_chatbot_enabled: "false",
  wa_payment_detect: "true",
  wa_cleanup_enabled: "true",
  wa_monitor_enabled: "false",
  bap_enabled: "false",
  foto_compression_quality: "0.70",
  // White-label branding
  app_name: "AClean",
  ai_name: "ARA",
  logo_url: "",
  // Configurable business logic
  service_types_json: "",
  area_utama: "",
  area_konfirmasi: "",
};

// useSettings (Fase 2): memiliki state appSettings + nilai turunan effectiveServiceTypes.
// Sengaja TIDAK memuat efek load dari Supabase — load app_settings masih terjalin di
// efek besar di App.jsx (bersama payments/llm/wa provider), jadi load tetap di sana &
// memanggil setAppSettings. Hook ini cuma memindahkan deklarasi state + memo turunan.
export function useSettings() {
  const [appSettings, setAppSettings] = useState(SETTINGS_DEFAULTS);

  // Service types — bisa override via app_settings.service_types_json (JSON array)
  const effectiveServiceTypes = useMemo(() => {
    const p = safeJsonParse(appSettings.service_types_json, null);
    return Array.isArray(p) && p.length > 0 ? p : SERVICE_TYPES;
  }, [appSettings.service_types_json]);

  return { appSettings, setAppSettings, effectiveServiceTypes };
}
