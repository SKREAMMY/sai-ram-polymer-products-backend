import { Request, Response, NextFunction } from "express";
import * as AttendanceService from "../services/attendance.service";
import { query } from "../config/db";
import {
  CreateAttendanceDTO,
  UpdateAttendanceDTO,
  CreateEmployeeDTO,
  UpdateEmployeeDTO,
  GeneratePayrollDTO,
} from "../types/attendance.types";

const param = (req: Request, key: string): string =>
  Array.isArray(req.params[key])
    ? (req.params[key] as string[])[0]
    : (req.params[key] as string);

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });
const fail = (res: Response, message: string, status = 400) =>
  res.status(status).json({ success: false, message });

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
    const conditions = ["is_active = TRUE"];

    if (req.query.department) {
      params.push(req.query.department);
      conditions.push(`department = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conditions.push(
        `(full_name ILIKE $${params.length} OR employee_code ILIKE $${params.length})`
      );
    }

    const where = conditions.join(" AND ");
    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM employees WHERE ${where}`,
      params
    );
    const total = Number(countRows[0].count);

    params.push(limit, offset);
    const { rows } = await query(
      `
      SELECT
        *,
        ROUND((monthly_salary / 26), 2)      AS daily_rate,
        ROUND((monthly_salary / 26 / 8), 2)  AS hourly_rate
      FROM employees
      WHERE ${where}
      ORDER BY department, full_name
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

export async function getEmployee(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { rows } = await query(
      `
      SELECT
        *,
        ROUND((monthly_salary / 26), 2)     AS daily_rate,
        ROUND((monthly_salary / 26 / 8), 2) AS hourly_rate
      FROM employees
      WHERE id = $1
    `,
      [param(req, "id")]
    );
    if (!rows[0]) return fail(res, "Employee not found", 404);
    ok(res, rows[0]);
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
    const d: CreateEmployeeDTO = req.body;
    if (!d.monthly_salary || d.monthly_salary <= 0) {
      return fail(res, "monthly_salary is required and must be greater than 0");
    }

    // Auto-generate employee code: find highest existing EMP number and increment
    const { rows: codeRows } = await query(`
      SELECT employee_code FROM employees
      WHERE employee_code ~ '^EMP[0-9]+$'
      ORDER BY CAST(SUBSTRING(employee_code FROM 4) AS INT) DESC
      LIMIT 1
    `);
    const lastCode = codeRows[0]?.employee_code ?? "EMP000";
    const lastNum = parseInt(lastCode.replace("EMP", ""), 10);
    const newCode = `EMP\${String(lastNum + 1).padStart(3, '0')}`;

    const { rows } = await query(
      `
      INSERT INTO employees
        (employee_code, full_name, phone, position, department, monthly_salary, joined_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        *,
        ROUND((monthly_salary / 26), 2)     AS daily_rate,
        ROUND((monthly_salary / 26 / 8), 2) AS hourly_rate
    `,
      [
        newCode,
        d.full_name,
        d.phone ?? null,
        d.position ?? null,
        d.department ?? null,
        d.monthly_salary,
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
    const d: UpdateEmployeeDTO = req.body ?? {};
    const { rows } = await query(
      `
      UPDATE employees SET
        full_name      = COALESCE($1, full_name),
        phone          = COALESCE($2, phone),
        position       = COALESCE($3, position),
        department     = COALESCE($4, department),
        monthly_salary = COALESCE($5, monthly_salary),
        is_active      = COALESCE($6, is_active)
      WHERE id = $7
      RETURNING
        *,
        ROUND((monthly_salary / 26), 2)     AS daily_rate,
        ROUND((monthly_salary / 26 / 8), 2) AS hourly_rate
    `,
      [
        d.full_name ?? null,
        d.phone ?? null,
        d.position ?? null,
        d.department ?? null,
        d.monthly_salary ?? null,
        d.is_active ?? null,
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
        COUNT(*) FILTER (WHERE status = 'present') AS days_present,
        COUNT(*) FILTER (WHERE status = 'absent')  AS days_absent,
        COUNT(*) FILTER (WHERE status = 'leave')   AS days_leave,
        COALESCE(SUM(hours_worked), 0)             AS total_hours,
        COALESCE(SUM(day_pay), 0)                  AS gross_pay
      FROM attendance_logs
      WHERE employee_id = $1
        AND TO_CHAR(log_date, 'YYYY-MM') = $2
    `,
      [id, month]
    );

    ok(res, { employee_id: id, month, ...rows[0] });
  } catch (err) {
    next(err);
  }
}

// ── Attendance logs ────────────────────────────────────────────────────────

export async function logAttendance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const dto: CreateAttendanceDTO = req.body;
    const actorId = (req as Request & { userId?: string }).userId ?? "system";
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
    const dto: UpdateAttendanceDTO = req.body;
    const actorId = (req as Request & { userId?: string }).userId ?? "system";
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

export async function deleteAttendance(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { rowCount } = await query(
      "DELETE FROM attendance_logs WHERE id = $1",
      [param(req, "id")]
    );
    if (!rowCount) return fail(res, "Log not found", 404);
    ok(res, { deleted: true });
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
    const today = new Date().toISOString().slice(0, 10);
    const from = (req.query.from as string) || today.slice(0, 7) + "-01";
    const to = (req.query.to as string) || today;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 31);

    const result = await AttendanceService.getEmployeeAttendance(
      id,
      from,
      to,
      page,
      limit
    );
    ok(res, result);
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
    const actorId = (req as Request & { userId?: string }).userId ?? "system";
    const records = await AttendanceService.generatePayroll(dto, actorId);
    ok(res, records, 201);
  } catch (err) {
    next(err);
  }
}

export async function getPayrollByMonth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const [year, month] = param(req, "period").split("-");
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
      WHERE sr.period_year = $1 AND sr.period_month = $2
      ORDER BY e.department, e.full_name
    `,
      [year, month]
    );
    ok(res, rows);
  } catch (err) {
    next(err);
  }
}

// ── Reports ────────────────────────────────────────────────────────────────

export async function getDailySummary(
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
        COUNT(e.id)                                    AS total_employees,
        COUNT(al.id) FILTER (WHERE al.status = 'present') AS present,
        COUNT(al.id) FILTER (WHERE al.status = 'absent')  AS absent,
        COUNT(al.id) FILTER (WHERE al.status = 'leave')   AS on_leave,
        COUNT(e.id) - COUNT(al.id)                     AS not_marked,
        COALESCE(SUM(al.day_pay), 0)                   AS total_pay_for_day
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

export async function getEmployeePayrollByMonth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const [year, month] = param(req, "period").split("-");
    const employeeId = param(req, "employeeId");

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
      WHERE sr.period_year  = $1
        AND sr.period_month = $2
        AND sr.employee_id  = $3
    `,
      [year, month, employeeId]
    );

    if (!rows[0])
      return fail(
        res,
        "No payroll record found for this employee and period",
        404
      );
    ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function approvePayroll(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { rows } = await query(
      `
      UPDATE salary_records SET status = 'approved', updated_at = NOW()
      WHERE id = $1 AND status = 'draft'
      RETURNING *,
        (SELECT json_build_object(
          'id', e.id, 'full_name', e.full_name,
          'employee_code', e.employee_code, 'department', e.department
        ) FROM employees e WHERE e.id = salary_records.employee_id) AS employee
    `,
      [param(req, "id")]
    );
    if (!rows[0]) return fail(res, "Record not found or already approved", 404);
    ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function markPayrollPaid(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { rows } = await query(
      `
      UPDATE salary_records SET status = 'paid', paid_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'approved'
      RETURNING *,
        (SELECT json_build_object(
          'id', e.id, 'full_name', e.full_name,
          'employee_code', e.employee_code, 'department', e.department
        ) FROM employees e WHERE e.id = salary_records.employee_id) AS employee
    `,
      [param(req, "id")]
    );
    if (!rows[0]) return fail(res, "Record not found or not approved yet", 404);
    ok(res, rows[0]);
  } catch (err) {
    next(err);
  }
}
