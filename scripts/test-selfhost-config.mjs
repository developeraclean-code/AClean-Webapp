import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRuntimeConfig } from '../server/runtime-config.mjs';

const valid = () => ({
  SUPABASE_URL: 'https://sb.example.test',
  SUPABASE_SERVICE_KEY: 'server-only-placeholder',
  SUPABASE_ANON_KEY: 'public-placeholder',
  INTERNAL_API_SECRET: 'x'.repeat(64),
  FONNTE_WEBHOOK_SECRET: 'y'.repeat(64),
  CRON_SECRET: 'z'.repeat(64),
  OWNER_PHONE: '6200000000000',
  APP_URL: 'https://app.example.test',
  ALLOWED_ORIGIN: 'https://app.example.test',
});

test('self-host menolak konfigurasi auth dan database yang tidak lengkap', () => {
  assert.equal(validateRuntimeConfig(valid()), true);
  for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'INTERNAL_API_SECRET', 'FONNTE_WEBHOOK_SECRET', 'CRON_SECRET', 'OWNER_PHONE', 'APP_URL', 'ALLOWED_ORIGIN']) {
    const env = valid();
    delete env[name];
    assert.throws(() => validateRuntimeConfig(env), new RegExp(name));
  }
});

test('self-host menolak secret lemah, URL non-HTTPS dan origin tak cocok', () => {
  assert.throws(() => validateRuntimeConfig({ ...valid(), INTERNAL_API_SECRET: 'short' }), /minimal 32/);
  assert.throws(() => validateRuntimeConfig({ ...valid(), APP_URL: 'http://app.example.test' }), /HTTPS/);
  assert.throws(() => validateRuntimeConfig({ ...valid(), ALLOWED_ORIGIN: 'https://evil.example.test' }), /sama/);
  assert.throws(() => validateRuntimeConfig({ ...valid(), APP_URL: 'https://app.example.test/path' }), /tanpa path/);
});

test('produksi self-hosted wajib mengaktifkan otorisasi API media', () => {
  const env = { ...valid(), APP_URL: 'https://app.aclean.id', ALLOWED_ORIGIN: 'https://app.aclean.id' };
  for (const value of [undefined, '', 'false', 'tru']) {
    assert.throws(() => validateRuntimeConfig({ ...env, ACLEAN_MEDIA_AUTH_REQUIRED: value }), /ACLEAN_MEDIA_AUTH_REQUIRED/);
  }
  assert.equal(validateRuntimeConfig({ ...env, ACLEAN_MEDIA_AUTH_REQUIRED: 'true' }), true);
});
