import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(`[Error] ${err.message}`);

  const code = (err as NodeJS.ErrnoException & { code?: string }).code;

  if (code === "23505") {
    return res
      .status(409)
      .json({
        success: false,
        message: "A record with this value already exists.",
      });
  }
  if (code === "23503") {
    return res
      .status(400)
      .json({ success: false, message: "Referenced record does not exist." });
  }
  if (code === "23514") {
    return res
      .status(400)
      .json({ success: false, message: "Data constraint violation." });
  }

  const msg = err.message;

  if (msg.includes("not found"))
    return res.status(404).json({ success: false, message: msg });
  if (msg.includes("already exists"))
    return res.status(409).json({ success: false, message: msg });
  if (msg.includes("already logged"))
    return res.status(409).json({ success: false, message: msg });
  if (msg.includes("Invalid email or password"))
    return res.status(401).json({ success: false, message: msg });
  if (msg.includes("expired"))
    return res.status(401).json({ success: false, message: msg });
  if (msg.includes("required") || msg.includes("inactive")) {
    return res.status(400).json({ success: false, message: msg });
  }

  return res
    .status(500)
    .json({ success: false, message: "Internal server error" });
}
