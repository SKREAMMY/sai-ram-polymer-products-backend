import { Request, Response, NextFunction } from "express";
import * as AttendanceService from "../services/attendance.service";
import { query } from "../config/db";
import {
  CreateAttendanceLogDTO,
  UpdateAttendanceLogDTO,
  BulkAttendanceDTO,
  GeneratePayrollDTO,
} from "../types/attendance.types";

// Extract a single string param safely
const param = (req: Request, key: string): string =>
  Array.isArray(req.params[key])
    ? (req.params[key] as string[])[0]
    : (req.params[key] as string);

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });
const fail = (res: Response, message: string, status = 400) =>
  res.status(status).json({ success: false, message });

// ── Attendance logs ──────────────────────────────────────────────────────

export async function logAttendance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const dto: CreateAttendanceLogDTO = req.body;
    const actorId: string =
      (req as Request & { userId?: string }).userId ?? "system";
    const log = await AttendanceService.createAttendanceLog(dto, actorId);
    ok(res, log, 201);
  } catch (err) {
    next(err);
  }
}

export async function editAttendance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const dto: UpdateAttendanceLogDTO = req.body;
    const actorId: string =
      (req as Request & { userId?: string }).userId ?? "system";
    const log = await AttendanceService.updateAttendanceLog(
      param(req, "id"),
      dto,
      actorId
    );
    ok(res, log);
  } catch (err) {
    next(err);
  }
}

export async function softDeleteAttendance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    await query(
      `UPDATE attendance_logs SET deleted_at = NOW(), updated_by = $2 WHERE id = $1`,
      [
        param(req, "id"),
        (req as Request & { userId?: string }).userId ?? "system",
      ]
    );
    ok(res, { id: param(req, "id"), deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function bulkAttendance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const dto: BulkAttendanceDTO = req.body;
    const actorId: string =
      (req as Request & { userId?: string }).userId ?? "system";
    const result = await AttendanceService.bulkCreateAttendance(dto, actorId);
    ok(res, result, result.failed.length === 0 ? 201 : 207);
  } catch (err) {
    next(err);
  }
}

export async function getDailyAttendance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const date =
      (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const logs = await AttendanceService.getDailyAttendance(date);
    ok(res, logs);
  } catch (err) {
    next(err);
  }
}

export async function getEmployeeAttendance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const id = param(req, "id");
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 30);

    const result = await AttendanceService.getEmployeeAttendance(
      id,
      {
        date_from: req.query.from as string | undefined,
        date_to: req.query.to as string | undefined,
        status: req.query.status as never,
      },
      { page, limit }
    );
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

// ── Employees ──────────────────────────────────────────────────────────────

export async function listEmployees(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const params: unknown[] = [];
    const conditions: string[] = ["e.is_active = TRUE"];

    if (req.query.department) {
      params.push(req.query.department);
      conditions.push(`e.department = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conditions.push(
        `(e.full_name ILIKE $${params.length} OR e.employee_code ILIKE $${params.length})`
      );
    }

    const where = conditions.join(" AND ");

    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM employees e WHERE ${where}`,
      params
    );
    const total = Number(countRows[0].count);

    params.push(limit, offset);
    const { rows } = await query(
      `
      SELECT e.*, row_to_json(s) AS shift
      FROM employees e
      LEFT JOIN shift_rules s ON s.id = e.shift_id
      WHERE ${where}
      ORDER BY e.department, e.full_name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
      params
    );

    ok(res, {
      data: rows,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
}

export async function createEmployee(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const d = req.body;
    const { rows } = await query(
      `
      INSERT INTO employees
        (employee_code, full_name, phone, position, department, hourly_rate, shift_id, joined_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `,
      [
        d.employee_code,
        d.full_name,
        d.phone,
        d.position,
        d.department,
        d.hourly_rate,
        d.shift_id,
        d.joined_at ?? new Date().toISOString().slice(0, 10),
      ]
    );
    ok(res, rows[0], 201);
  } catch (err) {
    next(err);
  }
}

export async function updateEmployee(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const d = req.body;
    const { rows } = await query(
      `
      UPDATE employees SET
        full_name   = COALESCE($1, full_name),
        phone       = COALESCE($2, phone),
        position    = COALESCE($3, position),
        department  = COALESCE($4, department),
        hourly_rate = COALESCE($5, hourly_rate),
        shift_id    = COALESCE($6, shift_id),
        is_active   = COALESCE($7, is_active)
      WHERE id = $8
      RETURNING *
    `,
      [
        d.full_name,
        d.phone,
        d.position,
        d.department,
        d.hourly_rate,
        d.shift_id,
        d.is_active,
        param(req, "id"),
      ]
    );
    if (!rows[0]) return fail(res, "Employee not found", 404);
    ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function getEmployeeSummary(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const id = param(req, "id");
    const month =
      (req.query.month as string) || new Date().toISOString().slice(0, 7);

    const { rows } = await query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'present')  AS present,
        COUNT(*) FILTER (WHERE status = 'late')     AS late,
        COUNT(*) FILTER (WHERE status = 'absent')   AS absent,
        COUNT(*) FILTER (WHERE status = 'leave')    AS on_leave,
        COUNT(*) FILTER (WHERE status = 'half_day') AS half_day,
        COALESCE(SUM(hours_worked),   0) AS total_hours,
        COALESCE(SUM(overtime_hours), 0) AS overtime_hours,
        COALESCE(SUM(gross_pay),      0) AS gross_pay
      FROM attendance_logs
      WHERE employee_id = $1
        AND TO_CHAR(log_date, 'YYYY-MM') = $2
    `,
      [id, month]
    );

    ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

// ── Shift rules ────────────────────────────────────────────────────────────

export async function listShifts(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { rows } = await query(
      "SELECT * FROM shift_rules ORDER BY is_default DESC, name"
    );
    ok(res, rows);
  } catch (err) {
    next(err);
  }
}

export async function createShift(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const d = req.body;
    const { rows } = await query(
      `
      INSERT INTO shift_rules
        (name, shift_start, shift_end, standard_hours, overtime_threshold,
         overtime_multiplier, late_deduction_per_min, is_default)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `,
      [
        d.name,
        d.shift_start,
        d.shift_end,
        d.standard_hours,
        d.overtime_threshold ?? 8,
        d.overtime_multiplier ?? 1.5,
        d.late_deduction_per_min ?? 0,
        d.is_default ?? false,
      ]
    );
    ok(res, rows[0], 201);
  } catch (err) {
    next(err);
  }
}

export async function updateShift(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const d = req.body;
    const { rows } = await query(
      `
      UPDATE shift_rules SET
        name                   = COALESCE($1, name),
        shift_start            = COALESCE($2, shift_start),
        shift_end              = COALESCE($3, shift_end),
        standard_hours         = COALESCE($4, standard_hours),
        overtime_threshold     = COALESCE($5, overtime_threshold),
        overtime_multiplier    = COALESCE($6, overtime_multiplier),
        late_deduction_per_min = COALESCE($7, late_deduction_per_min)
      WHERE id = $8
      RETURNING *
    `,
      [
        d.name,
        d.shift_start,
        d.shift_end,
        d.standard_hours,
        d.overtime_threshold,
        d.overtime_multiplier,
        d.late_deduction_per_min,
        param(req, "id"),
      ]
    );
    if (!rows[0]) return fail(res, "Shift not found", 404);
    ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

// ── Payroll ────────────────────────────────────────────────────────────────

export async function generatePayroll(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const dto: GeneratePayrollDTO = req.body;
    const actorId: string =
      (req as Request & { userId?: string }).userId ?? "system";
    const records = await AttendanceService.generatePayroll(dto, actorId);
    ok(res, records, 201);
  } catch (err) {
    next(err);
  }
}

export async function getPayrollByPeriod(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const period = param(req, "period");
    const [year, month] = period.split("-");

    const { rows } = await query(
      `
      SELECT
        sr.*,
        json_build_object(
          'id',            e.id,
          'full_name',     e.full_name,
          'employee_code', e.employee_code,
          'department',    e.department
        ) AS employee
      FROM salary_records sr
      JOIN employees e ON e.id = sr.employee_id
      WHERE TO_CHAR(sr.period_start, 'YYYY-MM') = $1
      ORDER BY e.department, e.full_name
    `,
      [`${year}-${month}`]
    );

    ok(res, rows);
  } catch (err) {
    next(err);
  }
}

// ── Reports ────────────────────────────────────────────────────────────────

export async function getDailySummaryReport(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const date =
      (req.query.date as string) || new Date().toISOString().slice(0, 10);

    const { rows } = await query(
      `
      SELECT
        COUNT(*)                                       AS total_employees,
        COUNT(*) FILTER (WHERE al.status = 'present')  AS present,
        COUNT(*) FILTER (WHERE al.status = 'late')     AS late,
        COUNT(*) FILTER (WHERE al.status = 'absent')   AS absent,
        COUNT(*) FILTER (WHERE al.status = 'leave')    AS on_leave,
        COUNT(*) FILTER (WHERE al.status = 'half_day') AS half_day,
        COALESCE(SUM(al.gross_pay), 0)                 AS total_gross_pay
      FROM employees e
      LEFT JOIN attendance_logs al
        ON al.employee_id = e.id AND al.log_date = $1
      WHERE e.is_active = TRUE
    `,
      [date]
    );

    ok(res, { date, ...rows[0] });
  } catch (err) {
    next(err);
  }
}
