import * as fs from "fs";
import * as path from "path";
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

async function runMigrations() {
  const client = await pool.connect();

  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id          SERIAL PRIMARY KEY,
        filename    VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname);
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // runs in filename order: 001_, 002_, etc.

    for (const file of files) {
      // Skip if already executed
      const { rows } = await client.query(
        "SELECT id FROM _migrations WHERE filename = $1",
        [file]
      );
      if (rows.length > 0) {
        console.log(`  skip  ${file} (already executed)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
        console.log(`  ran   ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  FAIL  ${file}:`, err);
        throw err;
      }
    }

    console.log("\nAll migrations complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error("Migration runner failed:", err);
  process.exit(1);
});
