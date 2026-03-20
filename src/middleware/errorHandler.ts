import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(`[Error] ${err.message}`, err.stack);

  // Postgres unique violation
  if ((err as NodeJS.ErrnoException & { code?: string }).code === "23505") {
    return res.status(409).json({
      success: false,
      message: "A record with this value already exists.",
      detail: err.message,
    });
  }

  // Postgres FK violation
  if ((err as NodeJS.ErrnoException & { code?: string }).code === "23503") {
    return res.status(400).json({
      success: false,
      message: "Referenced record does not exist.",
    });
  }

  // Postgres check constraint
  if ((err as NodeJS.ErrnoException & { code?: string }).code === "23514") {
    return res.status(400).json({
      success: false,
      message: "Data constraint violation.",
      detail: err.message,
    });
  }

  // Known business logic errors
  if (err.message.includes("not found") || err.message.includes("inactive")) {
    return res.status(404).json({ success: false, message: err.message });
  }
  if (
    err.message.includes("already logged") ||
    err.message.includes("required")
  ) {
    return res.status(400).json({ success: false, message: err.message });
  }

  // Fallback
  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
