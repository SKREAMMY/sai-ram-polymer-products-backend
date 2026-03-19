-- Migration 001: shift_rules
-- Defines working hour configurations. Each employee is assigned one shift.
-- All overtime and late-deduction thresholds live here so they can be changed
-- without touching employee records.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE shift_rules (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(100)  NOT NULL,
  shift_start           TIME          NOT NULL,
  shift_end             TIME          NOT NULL,
  standard_hours        NUMERIC(4,2)  NOT NULL,                  -- e.g. 8.00
  overtime_threshold    NUMERIC(4,2)  NOT NULL DEFAULT 8.00,     -- hours/day before OT kicks in
  overtime_multiplier   NUMERIC(4,2)  NOT NULL DEFAULT 1.50,     -- e.g. 1.5x rate
  late_deduction_per_min NUMERIC(8,4) NOT NULL DEFAULT 0.00,     -- currency amount per late minute
  is_default            BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT shift_rules_standard_hours_positive  CHECK (standard_hours > 0),
  CONSTRAINT shift_rules_ot_threshold_positive    CHECK (overtime_threshold > 0),
  CONSTRAINT shift_rules_ot_multiplier_min        CHECK (overtime_multiplier >= 1.0),
  CONSTRAINT shift_rules_deduction_positive       CHECK (late_deduction_per_min >= 0)
);

-- Only one shift can be the default at a time
CREATE UNIQUE INDEX shift_rules_one_default_idx
  ON shift_rules (is_default)
  WHERE is_default = TRUE;

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shift_rules_updated_at
  BEFORE UPDATE ON shift_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rollback:
-- DROP TABLE IF EXISTS shift_rules CASCADE;
-- DROP FUNCTION IF EXISTS set_updated_at CASCADE;