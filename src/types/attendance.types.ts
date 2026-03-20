export type AttendanceStatus = "present" | "absent" | "leave";
export type SalaryStatus = "draft" | "approved" | "paid";

export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  phone: string | null;
  position: string | null;
  department: string | null;
  monthly_salary: number;
  is_active: boolean;
  joined_at: string;
  created_at: Date;
  updated_at: Date;
  // derived — not stored, computed on read
  daily_rate?: number;
  hourly_rate?: number;
}

export interface AttendanceLog {
  id: string;
  employee_id: string;
  log_date: string;
  clock_in: string | null;
  clock_out: string | null;
  hours_worked: number;
  working_days_in_month: number;
  monthly_salary: number;
  daily_rate: number;
  hourly_rate: number;
  day_pay: number;
  status: AttendanceStatus;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  employee?: Pick<
    Employee,
    "id" | "full_name" | "employee_code" | "department"
  >;
}

export interface SalaryRecord {
  id: string;
  employee_id: string;
  period_year: number;
  period_month: number;
  period_label: string;
  working_days_in_month: number;
  days_present: number;
  days_absent: number;
  days_leave: number;
  total_hours: number;
  monthly_salary: number;
  daily_rate: number;
  hourly_rate: number;
  gross_pay: number;
  status: SalaryStatus;
  notes: string | null;
  generated_by: string | null;
  created_at: Date;
  updated_at: Date;
  employee?: Pick<
    Employee,
    "id" | "full_name" | "employee_code" | "department"
  >;
}

// ── DTOs ───────────────────────────────────────────────────────────────────

export interface CreateEmployeeDTO {
  employee_code: string;
  full_name: string;
  phone?: string;
  position?: string;
  department?: string;
  monthly_salary: number;
  joined_at?: string;
}

export interface UpdateEmployeeDTO {
  full_name?: string;
  phone?: string;
  position?: string;
  department?: string;
  monthly_salary?: number;
  is_active?: boolean;
}

export interface CreateAttendanceDTO {
  employee_id: string;
  log_date: string; // "YYYY-MM-DD"
  clock_in?: string; // "HH:MM"
  clock_out?: string; // "HH:MM"
  status: AttendanceStatus;
  working_days_in_month?: number; // defaults to 26
  notes?: string;
}

export interface UpdateAttendanceDTO {
  clock_in?: string;
  clock_out?: string;
  status?: AttendanceStatus;
  working_days_in_month?: number;
  notes?: string;
}

export interface GeneratePayrollDTO {
  period_year: number;
  period_month: number;
  working_days_in_month: number; // admin sets this per month (e.g. 26)
  employee_ids?: string[]; // empty = all active employees
}

// ── Calculation result ─────────────────────────────────────────────────────

export interface DayCalculation {
  hours_worked: number;
  working_days_in_month: number;
  monthly_salary: number;
  daily_rate: number;
  hourly_rate: number;
  day_pay: number;
}

// ── Query helpers ──────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
