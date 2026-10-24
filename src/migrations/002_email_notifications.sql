-- Migration 002: Add email channel support to notifications and email consent to appointments
ALTER TABLE appointments ADD COLUMN email_consent INTEGER NOT NULL DEFAULT 1;

ALTER TABLE notifications ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms';
ALTER TABLE notifications ADD COLUMN to_email TEXT;
ALTER TABLE notifications ADD COLUMN subject TEXT;

CREATE INDEX IF NOT EXISTS idx_notif_channel ON notifications(channel, status);
