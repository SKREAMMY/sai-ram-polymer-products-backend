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

    const result = await client.query(`
      INSERT INTO employees
        (employee_code, full_name, phone, position, department, monthly_salary)
      VALUES
        ('EMP001', 'Alice Rahman',  '+60123456789', 'Senior Developer', 'Engineering', 8000.00),
        ('EMP002', 'Bob Tan',       '+60198765432', 'UI Designer',       'Design',      6500.00),
        ('EMP003', 'Carol Singh',   '+60112223334', 'Project Manager',   'Management',  9500.00),
        ('EMP004', 'David Lim',     '+60145556667', 'Junior Developer',  'Engineering', 4500.00),
        ('EMP005', 'Eva Krishnan',  '+60167778889', 'QA Engineer',       'Engineering', 5500.00)
      ON CONFLICT (employee_code) DO NOTHING
      RETURNING employee_code, full_name, monthly_salary
    `);

    console.log("Employees seeded:");
    result.rows.forEach((r) => {
      const daily = (r.monthly_salary / 26).toFixed(2);
      const hourly = (r.monthly_salary / 26 / 8).toFixed(2);
      console.log(
        `  ${r.employee_code}  ${r.full_name}  | monthly: ${r.monthly_salary}  daily: ${daily}  hourly: ${hourly}`
      );
    });

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

seed().catch(() => process.exit(1));
