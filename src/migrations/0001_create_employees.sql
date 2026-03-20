CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS employees (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code    VARCHAR(20)   NOT NULL UNIQUE,
  full_name        VARCHAR(150)  NOT NULL,
  phone            VARCHAR(20),
  position         VARCHAR(100),
  department       VARCHAR(100),
  monthly_salary   NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  joined_at        DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT employees_salary_positive CHECK (monthly_salary >= 0)
);

CREATE INDEX IF NOT EXISTS employees_is_active_idx  ON employees (is_active);
CREATE INDEX IF NOT EXISTS employees_department_idx ON employees (department);

DROP TRIGGER IF EXISTS employees_updated_at ON employees;
CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();