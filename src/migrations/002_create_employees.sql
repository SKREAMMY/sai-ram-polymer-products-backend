-- Migration 002: employees
-- Core employee records. Linked to users (auth) via user_id.
-- shift_id references shift_rules — determines how attendance is calculated.

CREATE TABLE employees (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          UNIQUE,                           -- nullable: employee may not have login
  employee_code   VARCHAR(20)   NOT NULL UNIQUE,
  full_name       VARCHAR(150)  NOT NULL,
  phone           VARCHAR(20),
  position        VARCHAR(100),
  department      VARCHAR(100),
  hourly_rate     NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  shift_id        UUID          REFERENCES shift_rules(id) ON DELETE SET NULL,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  joined_at       DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT employees_hourly_rate_positive CHECK (hourly_rate >= 0)
);

CREATE INDEX employees_department_idx ON employees (department);
CREATE INDEX employees_is_active_idx  ON employees (is_active);
CREATE INDEX employees_shift_id_idx   ON employees (shift_id);

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rollback:
-- DROP TABLE IF EXISTS employees CASCADE;