import { withTransaction, query } from "../config/db";
import {
  AttendanceLog,
  AttendanceCalculation,
  CreateAttendanceLogDTO,
  UpdateAttendanceLogDTO,
  BulkAttendanceDTO,
  ShiftRule,
  Employee,
  SalaryRecord,
  GeneratePayrollDTO,
  AttendanceFilters,
  PaginatedResult,
} from "../types/attendance.types";

// ── Time helpers ───────────────────────────────────────────────────────────

/**
 * Parse "HH:MM" or "HH:MM:SS" into total minutes from midnight.
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Difference between two "HH:MM" strings in decimal hours.
 * e.g. "09:30", "18:15" → 8.75
 */
function hoursBetween(start: string, end: string): number {
  return (timeToMinutes(end) - timeToMinutes(start)) / 60;
}

// ── Core calculation (pure function — easy to unit test) ──────────────────

/**
 * Given a shift rule and raw clock times, compute all pay fields.
 * This is the single source of truth for salary math.
 * The same logic is mirrored in the frontend salary.utils.ts for live previews.
 */
export function calculateAttendance(
  shift: ShiftRule,
  clockIn: string,
  clockOut: string,
  hourlyRate: number
): AttendanceCalculation {
  const hours_worked = Math.max(0, hoursBetween(clockIn, clockOut));

  // Late minutes: how many minutes after shift_start did the employee clock in
  const shiftStartMins = timeToMinutes(shift.shift_start);
  const clockInMins = timeToMinutes(clockIn);
  const late_minutes = Math.max(0, clockInMins - shiftStartMins);

  // Overtime hours: hours worked beyond the overtime threshold
  const overtime_hours = Math.max(0, hours_worked - shift.overtime_threshold);

  // Regular hours (capped at threshold)
  const regular_hours = Math.min(hours_worked, shift.overtime_threshold);

  // Pay components
  const base_pay = regular_hours * hourlyRate;
  const overtime_pay = overtime_hours * hourlyRate * shift.overtime_multiplier;
  const deduction_amount = late_minutes * shift.late_deduction_per_min;

  const gross_pay = Math.max(0, base_pay + overtime_pay - deduction_amount);

  return {
    hours_worked: Math.round(hours_worked * 100) / 100,
    late_minutes: Math.round(late_minutes * 100) / 100,
    overtime_hours: Math.round(overtime_hours * 100) / 100,
    deduction_amount: Math.round(deduction_amount * 100) / 100,
    overtime_pay: Math.round(overtime_pay * 100) / 100,
    gross_pay: Math.round(gross_pay * 100) / 100,
  };
}

// ── Repository helpers (private) ──────────────────────────────────────────

async function fetchEmployeeWithShift(
  employeeId: string
): Promise<Employee & { shift: ShiftRule }> {
  const { rows } = await query(
    `
    SELECT
      e.*,
      row_to_json(s) AS shift
    FROM employees e
    LEFT JOIN shift_rules s ON s.id = e.shift_id
    WHERE e.id = $1 AND e.is_active = TRUE
  `,
    [employeeId]
  );

  if (!rows[0]) throw new Error(`Employee ${employeeId} not found or inactive`);
  if (!rows[0].shift)
    throw new Error(`Employee ${employeeId} has no shift assigned`);
  return rows[0];
}

// ── Public service methods ─────────────────────────────────────────────────

export async function createAttendanceLog(
  dto: CreateAttendanceLogDTO,
  actorId: string
): Promise<AttendanceLog> {
  return withTransaction(async (client) => {
    // Prevent duplicate entry for the same day
    const { rows: existing } = await client.query(
      "SELECT id FROM attendance_logs WHERE employee_id = $1 AND log_date = $2",
      [dto.employee_id, dto.log_date]
    );
    if (existing.length > 0) {
      throw new Error(
        `Attendance already logged for employee ${dto.employee_id} on ${dto.log_date}`
      );
    }

    const employee = await fetchEmployeeWithShift(dto.employee_id);

    // Zero-out fields for absent / leave
    let calc: AttendanceCalculation = {
      hours_worked: 0,
      late_minutes: 0,
      overtime_hours: 0,
      deduction_amount: 0,
      overtime_pay: 0,
      gross_pay: 0,
    };

    if (dto.status !== "absent" && dto.status !== "leave") {
      if (!dto.clock_in || !dto.clock_out) {
        throw new Error(
          "clock_in and clock_out are required for present/late/half_day"
        );
      }
      calc = calculateAttendance(
        employee.shift,
        dto.clock_in,
        dto.clock_out,
        Number(employee.hourly_rate)
      );
    }

    const { rows } = await client.query(
      `
      INSERT INTO attendance_logs (
        employee_id, shift_id, log_date,
        clock_in, clock_out,
        hours_worked, late_minutes, overtime_hours,
        deduction_amount, overtime_pay, gross_pay,
        status, notes, created_by
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14
      )
      RETURNING *
    `,
      [
        dto.employee_id,
        employee.shift_id,
        dto.log_date,
        dto.clock_in ?? null,
        dto.clock_out ?? null,
        calc.hours_worked,
        calc.late_minutes,
        calc.overtime_hours,
        calc.deduction_amount,
        calc.overtime_pay,
        calc.gross_pay,
        dto.status,
        dto.notes ?? null,
        actorId,
      ]
    );

    return rows[0];
  });
}

export async function updateAttendanceLog(
  logId: string,
  dto: UpdateAttendanceLogDTO,
  actorId: string
): Promise<AttendanceLog> {
  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      "SELECT * FROM attendance_logs WHERE id = $1",
      [logId]
    );
    if (!existing[0]) throw new Error(`Attendance log ${logId} not found`);

    const current: AttendanceLog = existing[0];
    const newStatus = dto.status ?? current.status;
    const newClockIn = dto.clock_in ?? current.clock_in ?? undefined;
    const newClockOut = dto.clock_out ?? current.clock_out ?? undefined;

    let calc: AttendanceCalculation = {
      hours_worked: 0,
      late_minutes: 0,
      overtime_hours: 0,
      deduction_amount: 0,
      overtime_pay: 0,
      gross_pay: 0,
    };

    if (newStatus !== "absent" && newStatus !== "leave") {
      if (!newClockIn || !newClockOut) {
        throw new Error("clock_in and clock_out required for this status");
      }
      const employee = await fetchEmployeeWithShift(current.employee_id);
      calc = calculateAttendance(
        employee.shift,
        newClockIn,
        newClockOut,
        Number(employee.hourly_rate)
      );
    }

    const { rows } = await client.query(
      `
      UPDATE attendance_logs SET
        clock_in         = $1,
        clock_out        = $2,
        hours_worked     = $3,
        late_minutes     = $4,
        overtime_hours   = $5,
        deduction_amount = $6,
        overtime_pay     = $7,
        gross_pay        = $8,
        status           = $9,
        notes            = $10,
        updated_by       = $11
      WHERE id = $12
      RETURNING *
    `,
      [
        newStatus !== "absent" && newStatus !== "leave" ? newClockIn : null,
        newStatus !== "absent" && newStatus !== "leave" ? newClockOut : null,
        calc.hours_worked,
        calc.late_minutes,
        calc.overtime_hours,
        calc.deduction_amount,
        calc.overtime_pay,
        calc.gross_pay,
        newStatus,
        dto.notes ?? current.notes,
        actorId,
        logId,
      ]
    );

    return rows[0];
  });
}

export async function bulkCreateAttendance(
  dto: BulkAttendanceDTO,
  actorId: string
): Promise<{
  success: number;
  failed: Array<{ employee_id: string; error: string }>;
}> {
  let success = 0;
  const failed: Array<{ employee_id: string; error: string }> = [];

  for (const entry of dto.entries) {
    try {
      await createAttendanceLog({ ...entry, log_date: dto.log_date }, actorId);
      success++;
    } catch (err: unknown) {
      failed.push({
        employee_id: entry.employee_id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { success, failed };
}

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

export async function getEmployeeAttendance(
  employeeId: string,
  filters: AttendanceFilters,
  pagination: { page: number; limit: number }
): Promise<PaginatedResult<AttendanceLog>> {
  const { page, limit } = pagination;
  const offset = (page - 1) * limit;

  const params: unknown[] = [employeeId];
  const conditions: string[] = ["al.employee_id = $1"];

  if (filters.date_from) {
    params.push(filters.date_from);
    conditions.push(`al.log_date >= $${params.length}`);
  }
  if (filters.date_to) {
    params.push(filters.date_to);
    conditions.push(`al.log_date <= $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`al.status = $${params.length}`);
  }

  const where = conditions.join(" AND ");

  const { rows: countRows } = await query(
    `SELECT COUNT(*) FROM attendance_logs al WHERE ${where}`,
    params
  );
  const total = Number(countRows[0].count);

  params.push(limit, offset);
  const { rows } = await query(
    `
    SELECT al.*
    FROM attendance_logs al
    WHERE ${where}
    ORDER BY al.log_date DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `,
    params
  );

  return {
    data: rows,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  };
}

// ── Payroll generation ─────────────────────────────────────────────────────

export async function generatePayroll(
  dto: GeneratePayrollDTO,
  actorId: string
): Promise<SalaryRecord[]> {
  return withTransaction(async (client) => {
    // Get target employees — all active employees or a specified subset
    let employeeQuery = `
      SELECT id, hourly_rate, full_name FROM employees WHERE is_active = TRUE
    `;
    const employeeParams: unknown[] = [];

    if (dto.employee_ids && dto.employee_ids.length > 0) {
      employeeParams.push(dto.employee_ids);
      employeeQuery += ` AND id = ANY($1)`;
    }

    const { rows: employees } = await client.query(
      employeeQuery,
      employeeParams
    );
    if (employees.length === 0) throw new Error("No active employees found");

    const results: SalaryRecord[] = [];

    for (const emp of employees) {
      // Aggregate attendance_logs for this employee and period
      const { rows: agg } = await client.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE status = 'present')  AS days_present,
          COUNT(*) FILTER (WHERE status = 'late')     AS days_late,
          COUNT(*) FILTER (WHERE status = 'absent')   AS days_absent,
          COUNT(*) FILTER (WHERE status = 'leave')    AS days_leave,
          COUNT(*) FILTER (WHERE status = 'half_day') AS days_half_day,
          COALESCE(SUM(hours_worked),     0)  AS total_hours,
          COALESCE(SUM(overtime_hours),   0)  AS overtime_hours,
          COALESCE(SUM(gross_pay),        0)  AS gross_pay,
          COALESCE(SUM(overtime_pay),     0)  AS total_overtime_pay,
          COALESCE(SUM(deduction_amount), 0)  AS total_deductions
        FROM attendance_logs
        WHERE employee_id = $1
          AND log_date BETWEEN $2 AND $3
      `,
        [emp.id, dto.period_start, dto.period_end]
      );

      const a = agg[0];
      const base_pay = Number(a.total_hours) * Number(emp.hourly_rate);
      const gross_pay = Number(a.gross_pay);
      const net_pay = Math.max(0, gross_pay);

      // Upsert: regenerating for the same period replaces the old draft
      const { rows } = await client.query(
        `
        INSERT INTO salary_records (
          employee_id, period_start, period_end,
          total_days_present, total_days_absent, total_days_leave,
          total_days_late, total_days_half_day,
          total_hours, overtime_hours,
          base_pay, total_overtime_pay, total_deductions,
          gross_pay, net_pay,
          hourly_rate_snapshot, status, generated_by
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6, $7, $8,
          $9, $10,
          $11, $12, $13,
          $14, $15,
          $16, 'draft', $17
        )
        ON CONFLICT (employee_id, period_start, period_end)
        DO UPDATE SET
          total_days_present  = EXCLUDED.total_days_present,
          total_days_absent   = EXCLUDED.total_days_absent,
          total_days_leave    = EXCLUDED.total_days_leave,
          total_days_late     = EXCLUDED.total_days_late,
          total_days_half_day = EXCLUDED.total_days_half_day,
          total_hours         = EXCLUDED.total_hours,
          overtime_hours      = EXCLUDED.overtime_hours,
          base_pay            = EXCLUDED.base_pay,
          total_overtime_pay  = EXCLUDED.total_overtime_pay,
          total_deductions    = EXCLUDED.total_deductions,
          gross_pay           = EXCLUDED.gross_pay,
          net_pay             = EXCLUDED.net_pay,
          hourly_rate_snapshot = EXCLUDED.hourly_rate_snapshot,
          status              = 'draft',
          generated_by        = EXCLUDED.generated_by,
          updated_at          = NOW()
        RETURNING *
      `,
        [
          emp.id,
          dto.period_start,
          dto.period_end,
          a.days_present,
          a.days_absent,
          a.days_leave,
          a.days_late,
          a.days_half_day,
          a.total_hours,
          a.overtime_hours,
          base_pay,
          a.total_overtime_pay,
          a.total_deductions,
          gross_pay,
          net_pay,
          emp.hourly_rate,
          actorId,
        ]
      );

      results.push(rows[0]);
    }

    return results;
  });
}
