import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "attendance_db",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
});

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ── 1. Default shift rule ──────────────────────────────────────────────
    const shiftResult = await client.query(`
      INSERT INTO shift_rules (
        name, shift_start, shift_end, standard_hours,
        overtime_threshold, overtime_multiplier,
        late_deduction_per_min, is_default
      )
      VALUES
        ('Standard (9–6)', '09:00', '18:00', 8.00, 8.00, 1.50, 0.50, TRUE),
        ('Early shift (7–4)', '07:00', '16:00', 8.00, 8.00, 1.50, 0.50, FALSE)
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `);
    console.log(
      "Shift rules seeded:",
      shiftResult.rows.map((r) => r.name)
    );

    // Get the default shift id
    const { rows: defaultShift } = await client.query(
      `SELECT id FROM shift_rules WHERE is_default = TRUE LIMIT 1`
    );
    const defaultShiftId = defaultShift[0]?.id;

    // ── 2. Sample employees ────────────────────────────────────────────────
    const empResult = await client.query(
      `
      INSERT INTO employees (
        employee_code, full_name, phone,
        position, department, hourly_rate, shift_id
      )
      VALUES
        ('EMP001', 'Alice Rahman',   '+60123456789', 'Senior Developer',  'Engineering', 45.00, $1),
        ('EMP002', 'Bob Tan',        '+60198765432', 'UI Designer',        'Design',      38.00, $1),
        ('EMP003', 'Carol Singh',    '+60112223334', 'Project Manager',    'Management',  55.00, $1),
        ('EMP004', 'David Lim',      '+60145556667', 'Junior Developer',   'Engineering', 28.00, $1),
        ('EMP005', 'Eva Krishnan',   '+60167778889', 'QA Engineer',        'Engineering', 32.00, $1)
      ON CONFLICT (employee_code) DO NOTHING
      RETURNING employee_code, full_name
    `,
      [defaultShiftId]
    );
    console.log(
      "Employees seeded:",
      empResult.rows.map((r) => `${r.employee_code} ${r.full_name}`)
    );

    await client.query("COMMIT");
    console.log("\nSeed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
