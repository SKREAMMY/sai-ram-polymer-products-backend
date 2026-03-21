import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { query, withTransaction } from "../config/db";
import {
  RegisterDTO,
  LoginDTO,
  JwtPayload,
  AuthTokens,
  SafeUser,
} from "../types/auth.types";

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || "change_this_secret";
const ACCESS_TOKEN_EXPIRY = process.env.JWT_EXPIRES_IN || "8h";
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
const SALT_ROUNDS = 12;

// ── Token helpers ──────────────────────────────────────────────────────────

function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  } as jwt.SignOptions);
}

function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function stripPassword(user: Record<string, unknown>): SafeUser {
  const { password_hash: _, ...safe } = user;
  return safe as SafeUser;
}

// ── Register ───────────────────────────────────────────────────────────────

export async function register(dto: RegisterDTO): Promise<SafeUser> {
  const { rows: existing } = await query(
    "SELECT id FROM users WHERE email = $1",
    [dto.email.toLowerCase()]
  );
  if (existing.length > 0) {
    throw new Error("An account with this email already exists");
  }

  const password_hash = await bcrypt.hash(dto.password, SALT_ROUNDS);

  const { rows } = await query(
    `
    INSERT INTO users (full_name, email, password_hash, role)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `,
    [dto.full_name, dto.email.toLowerCase(), password_hash, dto.role ?? "admin"]
  );

  return stripPassword(rows[0]);
}

// ── Login ──────────────────────────────────────────────────────────────────

export async function login(
  dto: LoginDTO
): Promise<AuthTokens & { user: SafeUser }> {
  const { rows } = await query(
    "SELECT * FROM users WHERE email = $1 AND is_active = TRUE",
    [dto.email.toLowerCase()]
  );

  if (!rows[0]) {
    throw new Error("Invalid email or password");
  }

  const user = rows[0];
  const isValid = await bcrypt.compare(dto.password, user.password_hash);
  if (!isValid) {
    throw new Error("Invalid email or password");
  }

  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);

  // Calculate refresh token expiry (7 days)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await withTransaction(async (client) => {
    // Store hashed refresh token
    await client.query(
      `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
      [user.id, tokenHash, expiresAt]
    );

    // Update last login
    await client.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      user.id,
    ]);
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 8 * 60 * 60, // 8 hours in seconds
    user: stripPassword(user),
  };
}

// ── Refresh ────────────────────────────────────────────────────────────────

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const tokenHash = hashToken(refreshToken);

  const { rows } = await query(
    `
    SELECT rt.*, u.email, u.role, u.is_active
    FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id
    WHERE rt.token_hash = $1
  `,
    [tokenHash]
  );

  if (!rows[0]) {
    throw new Error("Invalid refresh token");
  }

  const stored = rows[0];

  if (new Date(stored.expires_at) < new Date()) {
    await query("DELETE FROM refresh_tokens WHERE token_hash = $1", [
      tokenHash,
    ]);
    throw new Error("Refresh token expired — please log in again");
  }

  if (!stored.is_active) {
    throw new Error("Account is deactivated");
  }

  // Rotate: delete old token, issue new one
  const newRefreshToken = generateRefreshToken();
  const newTokenHash = hashToken(newRefreshToken);
  const newExpiresAt = new Date();
  newExpiresAt.setDate(newExpiresAt.getDate() + 7);

  await withTransaction(async (client) => {
    await client.query("DELETE FROM refresh_tokens WHERE token_hash = $1", [
      tokenHash,
    ]);
    await client.query(
      `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
      [stored.user_id, newTokenHash, newExpiresAt]
    );
  });

  const accessToken = generateAccessToken({
    userId: stored.user_id,
    email: stored.email,
    role: stored.role,
  });

  return {
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_in: 8 * 60 * 60,
  };
}

// ── Logout ─────────────────────────────────────────────────────────────────

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await query("DELETE FROM refresh_tokens WHERE token_hash = $1", [tokenHash]);
}

// ── Get current user ───────────────────────────────────────────────────────

export async function getMe(userId: string): Promise<SafeUser> {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [userId]);
  if (!rows[0]) throw new Error("User not found");
  return stripPassword(rows[0]);
}
