// ── Enums ──────────────────────────────────────────────────────────────────

export type AttendanceStatus =
  | "present"
  | "late"
  | "absent"
  | "half_day"
  | "leave";
export type SalaryStatus = "draft" | "approved" | "paid";

// ── Database row shapes (snake_case matches PostgreSQL columns) ────────────

export interface ShiftRule {
  id: string;
  name: string;
  shift_start: string; // "09:00:00"
  shift_end: string;
  standard_hours: number;
  overtime_threshold: number;
  overtime_multiplier: number;
  late_deduction_per_min: number;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Employee {
  id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  phone: string | null;
  position: string | null;
  department: string | null;
  hourly_rate: number;
  shift_id: string | null;
  is_active: boolean;
  joined_at: string;
  created_at: Date;
  updated_at: Date;
  // joined from shift_rules when fetched with detail
  shift?: ShiftRule;
}

export interface AttendanceLog {
  id: string;
  employee_id: string;
  shift_id: string | null;
  log_date: string; // "YYYY-MM-DD"
  clock_in: string | null; // "HH:MM:SS"
  clock_out: string | null;
  hours_worked: number;
  late_minutes: number;
  overtime_hours: number;
  deduction_amount: number;
  overtime_pay: number;
  gross_pay: number;
  status: AttendanceStatus;
  notes: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  // joined fields
  employee?: Pick<
    Employee,
    "id" | "full_name" | "employee_code" | "department"
  >;
}

export interface SalaryRecord {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  total_days_present: number;
  total_days_absent: number;
  total_days_leave: number;
  total_days_late: number;
  total_days_half_day: number;
  total_hours: number;
  overtime_hours: number;
  base_pay: number;
  total_overtime_pay: number;
  total_deductions: number;
  gross_pay: number;
  net_pay: number;
  hourly_rate_snapshot: number;
  status: SalaryStatus;
  notes: string | null;
  generated_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // joined
  employee?: Pick<
    Employee,
    "id" | "full_name" | "employee_code" | "department"
  >;
}

// ── Request DTOs (what the API receives) ──────────────────────────────────

export interface CreateAttendanceLogDTO {
  employee_id: string;
  log_date: string; // "YYYY-MM-DD"
  clock_in?: string; // "HH:MM" — required for present/late/half_day
  clock_out?: string;
  status: AttendanceStatus;
  notes?: string;
}

export interface UpdateAttendanceLogDTO {
  clock_in?: string;
  clock_out?: string;
  status?: AttendanceStatus;
  notes?: string;
}

export interface BulkAttendanceDTO {
  log_date: string;
  entries: Array<{
    employee_id: string;
    status: AttendanceStatus;
    clock_in?: string;
    clock_out?: string;
    notes?: string;
  }>;
}

export interface CreateEmployeeDTO {
  employee_code: string;
  full_name: string;
  phone?: string;
  position?: string;
  department?: string;
  hourly_rate: number;
  shift_id?: string;
  joined_at?: string;
}

export interface UpdateEmployeeDTO extends Partial<CreateEmployeeDTO> {
  is_active?: boolean;
}

export interface CreateShiftRuleDTO {
  name: string;
  shift_start: string;
  shift_end: string;
  standard_hours: number;
  overtime_threshold?: number;
  overtime_multiplier?: number;
  late_deduction_per_min?: number;
  is_default?: boolean;
}

export interface GeneratePayrollDTO {
  period_start: string; // "YYYY-MM-DD"
  period_end: string;
  employee_ids?: string[]; // if empty, generates for all active employees
}

// ── Computed result from AttendanceService ─────────────────────────────────

export interface AttendanceCalculation {
  hours_worked: number;
  late_minutes: number;
  overtime_hours: number;
  deduction_amount: number;
  overtime_pay: number;
  gross_pay: number;
}

// ── Query filter shapes ────────────────────────────────────────────────────

export interface AttendanceFilters {
  employee_id?: string;
  date_from?: string;
  date_to?: string;
  status?: AttendanceStatus;
  department?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
