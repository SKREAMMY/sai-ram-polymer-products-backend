import { withTransaction, query } from "../config/db";
import {
  CreateAttendanceDTO,
  UpdateAttendanceDTO,
  GeneratePayrollDTO,
  DayCalculation,
  AttendanceLog,
  SalaryRecord,
  PaginatedResult,
} from "../types/attendance.types";

const DEFAULT_WORKING_DAYS = 26;
const HOURS_PER_DAY = 8;

// ── Core calculation (pure function) ──────────────────────────────────────
//
//   monthly_salary / working_days_in_month = daily_rate
//   daily_rate / 8                         = hourly_rate
//   hourly_rate * hours_worked             = day_pay

export function calculateDayPay(
  monthlySalary: number,
  workingDaysInMonth: number,
  clockIn: string,
  clockOut: string
): DayCalculation {
  const [inH, inM] = clockIn.split(":").map(Number);
  const [outH, outM] = clockOut.split(":").map(Number);

  const totalInMins = inH * 60 + inM;
  const totalOutMins = outH * 60 + outM;
  const hours_worked = Math.max(0, (totalOutMins - totalInMins) / 60);

  const daily_rate = monthlySalary / workingDaysInMonth;
  const hourly_rate = daily_rate / HOURS_PER_DAY;
  const day_pay = Math.round(hourly_rate * hours_worked * 100) / 100;

  return {
    hours_worked: Math.round(hours_worked * 100) / 100,
    working_days_in_month: workingDaysInMonth,
    monthly_salary: monthlySalary,
    daily_rate: Math.round(daily_rate * 100) / 100,
    hourly_rate: Math.round(hourly_rate * 100) / 100,
    day_pay,
  };
}

// ── Create attendance log ──────────────────────────────────────────────────

export async function createAttendanceLog(
  dto: CreateAttendanceDTO,
  actorId: string
): Promise<AttendanceLog> {
  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      "SELECT id FROM attendance_logs WHERE employee_id = $1 AND log_date = $2",
      [dto.employee_id, dto.log_date]
    );
    if (existing.length > 0) {
      throw new Error(
        `Attendance already logged for this employee on ${dto.log_date}`
      );
    }

    const { rows: empRows } = await client.query(
      "SELECT id, monthly_salary FROM employees WHERE id = $1 AND is_active = TRUE",
      [dto.employee_id]
    );
    if (!empRows[0]) throw new Error("Employee not found or inactive");

    const monthlySalary = Number(empRows[0].monthly_salary);
    const workingDaysInMonth =
      dto.working_days_in_month ?? DEFAULT_WORKING_DAYS;

    let calc: DayCalculation = {
      hours_worked: 0,
      working_days_in_month: workingDaysInMonth,
      monthly_salary: monthlySalary,
      daily_rate: Math.round((monthlySalary / workingDaysInMonth) * 100) / 100,
      hourly_rate:
        Math.round((monthlySalary / workingDaysInMonth / HOURS_PER_DAY) * 100) /
        100,
      day_pay: 0,
    };

    if (dto.status === "present") {
      if (!dto.clock_in || !dto.clock_out) {
        throw new Error(
          "clock_in and clock_out are required for present status"
        );
      }
      calc = calculateDayPay(
        monthlySalary,
        workingDaysInMonth,
        dto.clock_in,
        dto.clock_out
      );
    }

    const { rows } = await client.query(
      `
      INSERT INTO attendance_logs (
        employee_id, log_date,
        clock_in, clock_out, hours_worked,
        working_days_in_month, monthly_salary, daily_rate, hourly_rate, day_pay,
        status, notes, created_by
      ) VALUES (
        $1, $2,
        $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13
      )
      RETURNING *
    `,
      [
        dto.employee_id,
        dto.log_date,
        dto.clock_in ?? null,
        dto.clock_out ?? null,
        calc.hours_worked,
        calc.working_days_in_month,
        calc.monthly_salary,
        calc.daily_rate,
        calc.hourly_rate,
        calc.day_pay,
        dto.status,
        dto.notes ?? null,
        actorId,
      ]
    );

    return rows[0];
  });
}

// ── Update attendance log ──────────────────────────────────────────────────

export async function updateAttendanceLog(
  logId: string,
  dto: UpdateAttendanceDTO,
  actorId: string
): Promise<AttendanceLog> {
  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      "SELECT * FROM attendance_logs WHERE id = $1",
      [logId]
    );
    if (!existing[0]) throw new Error("Attendance log not found");

    const current = existing[0];
    const newStatus = dto.status ?? current.status;
    const newClockIn = dto.clock_in ?? current.clock_in;
    const newClockOut = dto.clock_out ?? current.clock_out;
    const workingDays =
      dto.working_days_in_month ?? current.working_days_in_month;

    const { rows: empRows } = await client.query(
      "SELECT monthly_salary FROM employees WHERE id = $1",
      [current.employee_id]
    );
    const monthlySalary = Number(empRows[0].monthly_salary);

    let calc: DayCalculation = {
      hours_worked: 0,
      working_days_in_month: workingDays,
      monthly_salary: monthlySalary,
      daily_rate: Math.round((monthlySalary / workingDays) * 100) / 100,
      hourly_rate:
        Math.round((monthlySalary / workingDays / HOURS_PER_DAY) * 100) / 100,
      day_pay: 0,
    };

    if (newStatus === "present") {
      if (!newClockIn || !newClockOut) {
        throw new Error(
          "clock_in and clock_out are required for present status"
        );
      }
      calc = calculateDayPay(
        monthlySalary,
        workingDays,
        newClockIn,
        newClockOut
      );
    }

    const { rows } = await client.query(
      `
      UPDATE attendance_logs SET
        clock_in              = $1,
        clock_out             = $2,
        hours_worked          = $3,
        working_days_in_month = $4,
        monthly_salary        = $5,
        daily_rate            = $6,
        hourly_rate           = $7,
        day_pay               = $8,
        status                = $9,
        notes                 = $10,
        updated_by            = $11
      WHERE id = $12
      RETURNING *
    `,
      [
        newStatus === "present" ? newClockIn : null,
        newStatus === "present" ? newClockOut : null,
        calc.hours_worked,
        calc.working_days_in_month,
        calc.monthly_salary,
        calc.daily_rate,
        calc.hourly_rate,
        calc.day_pay,
        newStatus,
        dto.notes ?? current.notes,
        actorId,
        logId,
      ]
    );

    return rows[0];
  });
}

// ── Get daily attendance (all employees for one date) ─────────────────────

export async function getDailyAttendance(
  date: string
): Promise<AttendanceLog[]> {
  const { rows } = await query(
    `
    SELECT
      al.*,
      json_build_object(
        'id',            e.id,
        'full_name',     e.full_name,
        'employee_code', e.employee_code,
        'department',    e.department
      ) AS employee
    FROM attendance_logs al
    JOIN employees e ON e.id = al.employee_id
    WHERE al.log_date = $1
    ORDER BY e.department, e.full_name
  `,
    [date]
  );
  return rows;
}

// ── Get attendance for one employee (date range) ───────────────────────────

export async function getEmployeeAttendance(
  employeeId: string,
  from: string,
  to: string,
  page: number,
  limit: number
): Promise<PaginatedResult<AttendanceLog>> {
  const offset = (page - 1) * limit;

  const { rows: countRows } = await query(
    `SELECT COUNT(*) FROM attendance_logs
     WHERE employee_id = $1 AND log_date BETWEEN $2 AND $3`,
    [employeeId, from, to]
  );
  const total = Number(countRows[0].count);

  const { rows } = await query(
    `
    SELECT * FROM attendance_logs
    WHERE employee_id = $1 AND log_date BETWEEN $2 AND $3
    ORDER BY log_date DESC
    LIMIT $4 OFFSET $5
  `,
    [employeeId, from, to, limit, offset]
  );

  return {
    data: rows,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  };
}

// ── Generate monthly payroll ───────────────────────────────────────────────

export async function generatePayroll(
  dto: GeneratePayrollDTO,
  actorId: string
): Promise<SalaryRecord[]> {
  return withTransaction(async (client) => {
    const periodLabel = `${dto.period_year}-${String(dto.period_month).padStart(
      2,
      "0"
    )}`;
    const periodStart = `${periodLabel}-01`;
    const periodEnd = new Date(dto.period_year, dto.period_month, 0)
      .toISOString()
      .slice(0, 10);

    let empQuery =
      "SELECT id, full_name, monthly_salary FROM employees WHERE is_active = TRUE";
    const empParams: unknown[] = [];
    if (dto.employee_ids && dto.employee_ids.length > 0) {
      empParams.push(dto.employee_ids);
      empQuery += " AND id = ANY($1)";
    }

    const { rows: employees } = await client.query(empQuery, empParams);
    if (employees.length === 0) throw new Error("No active employees found");

    const results: SalaryRecord[] = [];

    for (const emp of employees) {
      const monthlySalary = Number(emp.monthly_salary);
      const daily_rate =
        Math.round((monthlySalary / dto.working_days_in_month) * 100) / 100;
      const hourly_rate = Math.round((daily_rate / 8) * 100) / 100;

      const { rows: agg } = await client.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE status = 'present') AS days_present,
          COUNT(*) FILTER (WHERE status = 'absent')  AS days_absent,
          COUNT(*) FILTER (WHERE status = 'leave')   AS days_leave,
          COALESCE(SUM(hours_worked), 0)             AS total_hours,
          COALESCE(SUM(day_pay), 0)                  AS gross_pay
        FROM attendance_logs
        WHERE employee_id = $1
          AND log_date BETWEEN $2 AND $3
      `,
        [emp.id, periodStart, periodEnd]
      );

      const a = agg[0];

      const { rows } = await client.query(
        `
        INSERT INTO salary_records (
          employee_id,
          period_year, period_month, period_label,
          working_days_in_month,
          days_present, days_absent, days_leave,
          total_hours,
          monthly_salary, daily_rate, hourly_rate,
          gross_pay,
          status, generated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', $14
        )
        ON CONFLICT (employee_id, period_year, period_month) DO UPDATE SET
          working_days_in_month = EXCLUDED.working_days_in_month,
          days_present          = EXCLUDED.days_present,
          days_absent           = EXCLUDED.days_absent,
          days_leave            = EXCLUDED.days_leave,
          total_hours           = EXCLUDED.total_hours,
          monthly_salary        = EXCLUDED.monthly_salary,
          daily_rate            = EXCLUDED.daily_rate,
          hourly_rate           = EXCLUDED.hourly_rate,
          gross_pay             = EXCLUDED.gross_pay,
          status                = 'draft',
          generated_by          = EXCLUDED.generated_by,
          updated_at            = NOW()
        RETURNING *
      `,
        [
          emp.id,
          dto.period_year,
          dto.period_month,
          periodLabel,
          dto.working_days_in_month,
          a.days_present,
          a.days_absent,
          a.days_leave,
          a.total_hours,
          monthlySalary,
          daily_rate,
          hourly_rate,
          a.gross_pay,
          actorId,
        ]
      );

      results.push(rows[0]);
    }

    return results;
  });
}
