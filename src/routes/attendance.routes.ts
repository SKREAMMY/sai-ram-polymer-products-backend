import { Router } from "express";
import * as C from "../controllers/attendance.controller";

const router = Router();

// ── Employees ──────────────────────────────────────────────────────────────
router.get("/employees", C.listEmployees);
router.post("/employees", C.createEmployee);
router.put("/employees/:id", C.updateEmployee);
router.get("/employees/:id/summary", C.getEmployeeSummary);

// ── Shift rules ────────────────────────────────────────────────────────────
router.get("/shifts", C.listShifts);
router.post("/shifts", C.createShift);
router.put("/shifts/:id", C.updateShift);

// ── Attendance logs ────────────────────────────────────────────────────────
router.post("/attendance", C.logAttendance);
router.put("/attendance/:id", C.editAttendance);
router.delete("/attendance/:id", C.softDeleteAttendance);
router.post("/attendance/bulk", C.bulkAttendance);
router.get("/attendance/daily", C.getDailyAttendance);
router.get("/attendance/employee/:id", C.getEmployeeAttendance);

// ── Payroll ────────────────────────────────────────────────────────────────
router.post("/payroll/generate", C.generatePayroll);
router.get("/payroll/:period", C.getPayrollByPeriod);

// ── Reports ────────────────────────────────────────────────────────────────
router.get("/reports/attendance/daily", C.getDailySummaryReport);

export default router;
