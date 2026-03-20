DO $$ BEGIN
  CREATE TYPE salary_status AS ENUM ('draft', 'approved', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS salary_records (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  period_year           INT           NOT NULL,
  period_month          INT           NOT NULL,
  period_label          VARCHAR(7)    NOT NULL,

  working_days_in_month INT           NOT NULL,
  days_present          INT           NOT NULL DEFAULT 0,
  days_absent           INT           NOT NULL DEFAULT 0,
  days_leave            INT           NOT NULL DEFAULT 0,

  total_hours           NUMERIC(7,2)  NOT NULL DEFAULT 0.00,

  monthly_salary        NUMERIC(12,2) NOT NULL,
  daily_rate            NUMERIC(10,2) NOT NULL,
  hourly_rate           NUMERIC(10,2) NOT NULL,
  gross_pay             NUMERIC(12,2) NOT NULL DEFAULT 0.00,

  status                salary_status NOT NULL DEFAULT 'draft',
  notes                 TEXT,
  generated_by          UUID,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT salary_records_unique_period UNIQUE (employee_id, period_year, period_month),
  CONSTRAINT salary_records_month_range   CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT salary_records_gross_check   CHECK (gross_pay >= 0)
);

CREATE INDEX IF NOT EXISTS salary_records_employee_id_idx ON salary_records (employee_id);
CREATE INDEX IF NOT EXISTS salary_records_period_idx      ON salary_records (period_year, period_month);
CREATE INDEX IF NOT EXISTS salary_records_status_idx      ON salary_records (status);

DROP TRIGGER IF EXISTS salary_records_updated_at ON salary_records;
CREATE TRIGGER salary_records_updated_at
  BEFORE UPDATE ON salary_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();