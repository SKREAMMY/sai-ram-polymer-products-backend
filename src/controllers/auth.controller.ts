import { Request, Response, NextFunction } from "express";
import * as AuthService from "../services/auth.service";
import { RegisterDTO, LoginDTO } from "../types/auth.types";

const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ success: true, data });
const fail = (res: Response, message: string, status = 400) =>
  res.status(status).json({ success: false, message });

export async function register(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const dto: RegisterDTO = req.body;
    if (!dto.full_name || !dto.email || !dto.password) {
      return fail(res, "full_name, email and password are required");
    }
    if (dto.password.length < 8) {
      return fail(res, "Password must be at least 8 characters");
    }
    const user = await AuthService.register(dto);
    ok(res, user, 201);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const dto: LoginDTO = req.body;
    if (!dto.email || !dto.password) {
      return fail(res, "email and password are required");
    }
    const result = await AuthService.login(dto);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return fail(res, "refresh_token is required");
    }
    const tokens = await AuthService.refresh(refresh_token);
    ok(res, tokens);
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return fail(res, "refresh_token is required");
    }
    await AuthService.logout(refresh_token);
    ok(res, { message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { userId?: string }).userId!;
    const user = await AuthService.getMe(userId);
    ok(res, user);
  } catch (err) {
    next(err);
  }
}
