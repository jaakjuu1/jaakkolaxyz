import argon2 from "argon2";
import crypto from "node:crypto";
import { eq, and, gt } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { ateneumDb, newId } from "./ateneum-db";
import {
  ateneumUsers,
  ateneumSessions,
  ateneumApiTokens,
  type AteneumUser,
} from "@shared/ateneum-schema";

const SESSION_COOKIE = "ateneum_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface AteneumAuthedRequest extends Request {
  ateneumUser?: AteneumUser;
  ateneumAuth?:
    | { kind: "session" }
    | { kind: "api_token"; tokenId: string; scopes: AteneumApiTokenScope[] };
}

export const ATENEUM_API_TOKEN_SCOPES = ["read", "write", "notifications:send"] as const;
export type AteneumApiTokenScope = (typeof ATENEUM_API_TOKEN_SCOPES)[number];

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = `sess_${crypto.randomBytes(32).toString("base64url")}`;
  const storedId = sessionStorageId(id);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await ateneumDb.insert(ateneumSessions).values({
    id: storedId,
    userId,
    expiresAt,
  });
  return { id, expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  await ateneumDb
    .delete(ateneumSessions)
    .where(eq(ateneumSessions.id, sessionStorageId(sessionId)));
}

export async function getUserBySession(sessionId: string | undefined): Promise<AteneumUser | null> {
  if (!sessionId) return null;
  const rows = await ateneumDb
    .select({
      user: ateneumUsers,
      session: ateneumSessions,
    })
    .from(ateneumSessions)
    .innerJoin(ateneumUsers, eq(ateneumSessions.userId, ateneumUsers.id))
    .where(
      and(
        eq(ateneumSessions.id, sessionStorageId(sessionId)),
        gt(ateneumSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0]?.user ?? null;
}

export function setSessionCookie(res: Response, sessionId: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function readSessionCookie(req: Request): string | undefined {
  return (req as any).cookies?.[SESSION_COOKIE];
}

// Visibility and ownership rules are enforced per resource in ateneum-routes.ts.
// User roles never grant implicit access to another person's private content.

// ============================================
// API token (Bearer) auth — for scripts & integrations
// ============================================

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function sessionStorageId(rawSessionId: string): string {
  return `sessh_${sha256Hex(rawSessionId)}`;
}

export interface AteneumApiTokenIssueOptions {
  userId: string;
  name: string;
  expiresInDays: number;
  scopes: AteneumApiTokenScope[];
}

/**
 * Issue a new API token. Returns the raw token (shown once) and the persisted row id.
 * The raw token should be stored in .env by the caller; only the hash is kept in DB.
 */
export async function issueAteneumApiToken(
  opts: AteneumApiTokenIssueOptions,
): Promise<{ id: string; rawToken: string; expiresAt: Date }> {
  const rawToken = `atn_${crypto.randomBytes(32).toString("base64url")}`;
  const tokenHash = sha256Hex(rawToken);
  const id = newId("apt");
  if (!Number.isInteger(opts.expiresInDays) || opts.expiresInDays < 1 || opts.expiresInDays > 90) {
    throw new Error("API token expiry must be between 1 and 90 days");
  }
  const scopes = Array.from(new Set(opts.scopes));
  if (!scopes.includes("read") || scopes.some((scope) => !ATENEUM_API_TOKEN_SCOPES.includes(scope))) {
    throw new Error("API token scopes must include read and contain only supported scopes");
  }
  const expiresAt = new Date(Date.now() + opts.expiresInDays * 24 * 60 * 60 * 1000);
  await ateneumDb.insert(ateneumApiTokens).values({
    id,
    tokenHash,
    userId: opts.userId,
    name: opts.name,
    scopes: JSON.stringify(scopes),
    expiresAt,
  });
  return { id, rawToken, expiresAt };
}

/**
 * Look up a user by raw API token. Returns null if invalid / expired.
 * Side effect: updates last_used_at on hit.
 */
export async function getAuthByApiToken(
  rawToken: string,
): Promise<{
  user: AteneumUser;
  tokenId: string;
  scopes: AteneumApiTokenScope[];
} | null> {
  if (!rawToken) return null;
  const tokenHash = sha256Hex(rawToken);
  const rows = await ateneumDb
    .select({ user: ateneumUsers, token: ateneumApiTokens })
    .from(ateneumApiTokens)
    .innerJoin(ateneumUsers, eq(ateneumApiTokens.userId, ateneumUsers.id))
    .where(eq(ateneumApiTokens.tokenHash, tokenHash))
    .limit(1);
  const hit = rows[0];
  if (!hit) return null;
  if (hit.token.revokedAt || !hit.token.expiresAt) return null;
  const exp = hit.token.expiresAt;
  const expMs = exp instanceof Date ? exp.getTime() : Number(exp);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;
  let scopes: AteneumApiTokenScope[];
  try {
    const parsed = JSON.parse(hit.token.scopes);
    if (
      !Array.isArray(parsed) ||
      !parsed.includes("read") ||
      parsed.some((scope) => !ATENEUM_API_TOKEN_SCOPES.includes(scope))
    ) {
      return null;
    }
    scopes = Array.from(new Set(parsed)) as AteneumApiTokenScope[];
  } catch {
    return null;
  }
  // Best-effort last_used_at update
  try {
    await ateneumDb
      .update(ateneumApiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(ateneumApiTokens.id, hit.token.id));
  } catch {
    /* ignore */
  }
  return { user: hit.user, tokenId: hit.token.id, scopes };
}

function extractBearer(req: Request): string | undefined {
  const h = req.headers["authorization"] || req.headers["Authorization"];
  if (!h) return undefined;
  const s = String(h);
  const m = /^Bearer\s+(\S+)/i.exec(s);
  return m?.[1];
}

/**
 * Middleware: accept either session cookie OR `Authorization: Bearer <token>`.
 * On success, populates req.ateneumUser. On failure, 401.
 */
export async function requireAteneumAuth(
  req: AteneumAuthedRequest,
  res: Response,
  next: NextFunction,
) {
  // Try session cookie first
  const sessionId = readSessionCookie(req);
  const sessionUser = await getUserBySession(sessionId);
  if (sessionUser) {
    req.ateneumUser = sessionUser;
    req.ateneumAuth = { kind: "session" };
    return next();
  }
  // Try Bearer token
  const bearer = extractBearer(req);
  if (bearer) {
    const tokenAuth = await getAuthByApiToken(bearer);
    if (tokenAuth) {
      req.ateneumUser = tokenAuth.user;
      req.ateneumAuth = {
        kind: "api_token",
        tokenId: tokenAuth.tokenId,
        scopes: tokenAuth.scopes,
      };
      return next();
    }
  }
  return res.status(401).json({ message: "Unauthorized" });
}