-- Migration 003: Add sort column to doctors for poster-ordered presentation
ALTER TABLE doctors ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_doctors_sort ON doctors(sort, active, published);
