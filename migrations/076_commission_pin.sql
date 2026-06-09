-- Migration 076: Add commission PIN for password-protected commission viewing
-- Allows Owner to set individual PINs per technician for accessing sensitive commission data

BEGIN;

-- Add commission_pin column to user_profiles (nullable - no PIN by default)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS commission_pin TEXT DEFAULT NULL;

-- Add comment to document the column
COMMENT ON COLUMN user_profiles.commission_pin IS 'Optional 4-6 digit PIN set by Owner for password-protecting technician commission access';

COMMIT;
