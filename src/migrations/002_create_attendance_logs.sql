DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'leave');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS attendance_logs (
  id                    UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID              NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  log_date              DATE              NOT NULL,

  clock_in              TIME,
  clock_out             TIME,
  hours_worked          NUMERIC(5,2)      NOT NULL DEFAULT 0.00,

  working_days_in_month INT               NOT NULL DEFAULT 26,
  monthly_salary        NUMERIC(12,2)     NOT NULL DEFAULT 0.00,
  daily_rate            NUMERIC(10,2)     NOT NULL DEFAULT 0.00,
  hourly_rate           NUMERIC(10,2)     NOT NULL DEFAULT 0.00,
  day_pay               NUMERIC(10,2)     NOT NULL DEFAULT 0.00,

  status                attendance_status NOT NULL DEFAULT 'present',
  notes                 TEXT,
  created_by            UUID,
  updated_by            UUID,
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  CONSTRAINT attendance_logs_unique_day   UNIQUE (employee_id, log_date),
  CONSTRAINT attendance_logs_clock_order  CHECK (
    clock_in IS NULL OR clock_out IS NULL OR clock_out > clock_in
  ),
  CONSTRAINT attendance_logs_hours_check  CHECK (hours_worked >= 0),
  CONSTRAINT attendance_logs_pay_check    CHECK (day_pay >= 0),
  CONSTRAINT attendance_logs_working_days CHECK (working_days_in_month > 0)
);

CREATE INDEX IF NOT EXISTS attendance_logs_employee_id_idx  ON attendance_logs (employee_id);
CREATE INDEX IF NOT EXISTS attendance_logs_log_date_idx     ON attendance_logs (log_date);
CREATE INDEX IF NOT EXISTS attendance_logs_employee_date_idx ON attendance_logs (employee_id, log_date DESC);
CREATE INDEX IF NOT EXISTS attendance_logs_status_idx       ON attendance_logs (status);

DROP TRIGGER IF EXISTS attendance_logs_updated_at ON attendance_logs;
CREATE TRIGGER attendance_logs_updated_at
  BEFORE UPDATE ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();