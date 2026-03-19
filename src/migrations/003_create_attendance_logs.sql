-- Migration 003: attendance_logs
-- One row per employee per day. All salary fields are computed and stored
-- at write time so reports are pure reads with no recalculation needed.
-- shift_id is stored on the log (not just on the employee) so historical
-- records remain accurate if an employee is reassigned to a different shift later.

CREATE TYPE IF NOT EXISTS attendance_status AS ENUM (
  'present',
  'late',
  'absent',
  'half_day',
  'leave'
);

CREATE TABLE attendance_logs (
  id                UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID              NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id          UUID              REFERENCES shift_rules(id) ON DELETE SET NULL,
  log_date          DATE              NOT NULL,

  -- Raw clock times (null for absent / leave)
  clock_in          TIME,
  clock_out         TIME,

  -- Computed at write time by AttendanceService
  hours_worked      NUMERIC(5,2)      NOT NULL DEFAULT 0.00,
  late_minutes      NUMERIC(6,2)      NOT NULL DEFAULT 0.00,
  overtime_hours    NUMERIC(5,2)      NOT NULL DEFAULT 0.00,

  -- Pay breakdown computed at write time
  deduction_amount  NUMERIC(10,2)     NOT NULL DEFAULT 0.00,
  overtime_pay      NUMERIC(10,2)     NOT NULL DEFAULT 0.00,
  gross_pay         NUMERIC(10,2)     NOT NULL DEFAULT 0.00,

  status            attendance_status NOT NULL DEFAULT 'present',
  notes             TEXT,

  -- Audit trail
  created_by        UUID              NOT NULL,
  updated_by        UUID,
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  -- One log row per employee per day
  CONSTRAINT attendance_logs_unique_day UNIQUE (employee_id, log_date),

  -- Clock-out must be after clock-in when both are provided
  CONSTRAINT attendance_logs_clock_order CHECK (
    clock_in IS NULL OR clock_out IS NULL OR clock_out > clock_in
  ),

  -- present/late/half_day must have clock times; absent/leave must not
  CONSTRAINT attendance_logs_clock_required CHECK (
    (status IN ('present', 'late', 'half_day') AND clock_in IS NOT NULL AND clock_out IS NOT NULL)
    OR
    (status IN ('absent', 'leave') AND clock_in IS NULL AND clock_out IS NULL)
  ),

  CONSTRAINT attendance_logs_hours_positive     CHECK (hours_worked >= 0),
  CONSTRAINT attendance_logs_late_min_positive  CHECK (late_minutes >= 0),
  CONSTRAINT attendance_logs_ot_positive        CHECK (overtime_hours >= 0),
  CONSTRAINT attendance_logs_gross_positive     CHECK (gross_pay >= 0)
);

CREATE INDEX attendance_logs_employee_id_idx  ON attendance_logs (employee_id);
CREATE INDEX attendance_logs_log_date_idx     ON attendance_logs (log_date);
CREATE INDEX attendance_logs_status_idx       ON attendance_logs (status);
-- Composite: most common query pattern — employee history by date range
CREATE INDEX attendance_logs_employee_date_idx ON attendance_logs (employee_id, log_date DESC);

CREATE TRIGGER attendance_logs_updated_at
  BEFORE UPDATE ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rollback:
-- DROP TABLE IF EXISTS attendance_logs CASCADE;
-- DROP TYPE  IF EXISTS attendance_status;