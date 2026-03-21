import { Router } from "express";
import * as C from "../controllers/attendance.controller";

const router = Router();

// ── Employees ──────────────────────────────────────────────────────────────
router.get("/employees", C.listEmployees);
router.post("/employees", C.createEmployee);
router.get("/employees/:id", C.getEmployee);
router.put("/employees/:id", C.updateEmployee);
router.get("/employees/:id/summary", C.getEmployeeSummary);
router.get("/employees/:id/attendance", C.getEmployeeAttendance);

// ── Attendance logs ────────────────────────────────────────────────────────
router.post("/attendance", C.logAttendance);
router.put("/attendance/:id", C.editAttendance);
router.delete("/attendance/:id", C.deleteAttendance);
router.get("/attendance/daily", C.getDailyAttendance);

// ── Payroll ────────────────────────────────────────────────────────────────
router.post("/payroll/generate", C.generatePayroll);
router.get("/payroll/:period", C.getPayrollByMonth);
router.get(
  "/payroll/:period/employee/:employeeId",
  C.getEmployeePayrollByMonth
);

// ── Reports ────────────────────────────────────────────────────────────────
router.get("/reports/daily", C.getDailySummary);

export default router;
