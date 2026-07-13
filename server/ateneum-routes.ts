import type { Express, NextFunction, Request, Response } from "express";
import { eq, and, gte, desc, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { ateneumDb, newId } from "./ateneum-db";
import {
  ateneumUsers,
  ateneumPreferences,
  ateneumIdeas,
  ateneumActivities,
  ateneumWishes,
  ateneumWeeklySuggestions,
  ateneumNotificationPrefs,
  ateneumApiTokens,
  insertAteneumPreferencesSchema,
  insertAteneumActivitySchema,
  insertAteneumWishSchema,
} from "@shared/ateneum-schema";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getUserBySession,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  requireAteneumAuth,
  issueAteneumApiToken,
  ATENEUM_API_TOKEN_SCOPES,
  type AteneumAuthedRequest,
  type AteneumApiTokenScope,
} from "./ateneum-auth";
import {
  generateToken,
  sha256,
  checkRateLimit,
  recordEmailToken,
  consumeToken,
  sendMagicLink,
  sendWeeklySuggestion,
  sendWishAdded,
  sendActivityPlanned,
  sendInactivityReminder,
  sendCustomMessage,
  getNotificationPrefs,
  isoWeekKey,
  claimWeeklyEmail,
  finishWeeklyEmailClaim,
} from "./ateneum-email";
export function requireHumanWrite(
  req: AteneumAuthedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.ateneumUser?.role === "bot") {
    return res.status(403).json({ message: "Bot access is read-only" });
  }
  if (
    req.ateneumAuth?.kind === "api_token" &&
    !req.ateneumAuth.scopes.includes("write")
  ) {
    return res.status(403).json({ message: "API token lacks write scope" });
  }
  return next();
}

function requireHumanSession(
  req: AteneumAuthedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.ateneumUser?.role === "bot" || req.ateneumAuth?.kind !== "session") {
    return res.status(403).json({ message: "A human browser session is required" });
  }
  return next();
}

function requireNotificationPermission(
  req: AteneumAuthedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.ateneumUser?.role === "bot") {
    return res.status(403).json({ message: "Bot access is read-only" });
  }
  if (
    req.ateneumAuth?.kind === "api_token" &&
    !req.ateneumAuth.scopes.includes("notifications:send")
  ) {
    return res.status(403).json({ message: "API token lacks notifications:send scope" });
  }
  return next();
}

const ideaCategorySchema = z.enum([
  "indoor",
  "outdoor",
  "culinary",
  "culture",
  "wellness",
  "creative",
  "social",
]);
const ideaEnergySchema = z.enum(["low", "medium", "high"]);
const ideaBudgetSchema = z.enum(["free", "cheap", "moderate", "splurge"]);
const ideaSocialModeSchema = z.enum(["solo", "together", "with-friends"]);
const ideaTagsSchema = z.array(z.string().trim().min(1).max(64)).max(30);
const ideaCreateBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5_000).default(""),
    category: ideaCategorySchema.default("indoor"),
    tags: ideaTagsSchema.default([]),
    energyCost: ideaEnergySchema.default("medium"),
    budgetCost: ideaBudgetSchema.default("cheap"),
    socialMode: ideaSocialModeSchema.default("together"),
    durationMin: z.number().int().min(1).max(1_440).default(90),
  })
  .strict();
const ideaUpdateBodySchema = ideaCreateBodySchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const CUSTOM_NOTIFICATION_WINDOW_MS = 10 * 60 * 1000;
const CUSTOM_NOTIFICATION_MAX_ATTEMPTS = 5;
const customNotificationAttempts = new Map<string, number[]>();

function consumeCustomNotificationAttempt(userId: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const recent = (customNotificationAttempts.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < CUSTOM_NOTIFICATION_WINDOW_MS,
  );
  if (recent.length >= CUSTOM_NOTIFICATION_MAX_ATTEMPTS) {
    return {
      ok: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((CUSTOM_NOTIFICATION_WINDOW_MS - (now - recent[0])) / 1000),
      ),
    };
  }
  customNotificationAttempts.set(userId, [...recent, now]);
  return { ok: true, retryAfterSec: 0 };
}

// JSON-safe helpers
function parseTags(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function serializeIdea(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: parseTags(row.tags),
    energyCost: row.energyCost,
    budgetCost: row.budgetCost,
    socialMode: row.socialMode,
    durationMin: row.durationMin,
    isActive: row.isActive,
    createdBy: row.createdBy,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
  };
}

function serializeActivity(row: any) {
  return {
    id: row.id,
    ideaId: row.ideaId,
    title: row.title,
    scheduledFor:
      row.scheduledFor instanceof Date
        ? row.scheduledFor.toISOString()
        : row.scheduledFor,
    durationMin: row.durationMin,
    status: row.status,
    rating: row.rating,
    notes: row.notes,
    details: parseDetails(row.details),
    createdBy: row.createdBy,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    completedAt:
      row.completedAt instanceof Date
        ? row.completedAt.toISOString()
        : row.completedAt,
  };
}

function parseDetails(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serializeWish(row: any, owner?: { displayName: string; role: string }) {
  return {
    id: row.id,
    userId: row.userId,
    body: row.body,
    mood: row.mood,
    visibility: row.visibility,
    fulfilled: row.fulfilled,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    owner: owner ?? null,
  };
}

function serializePreferences(row: any) {
  return {
    userId: row.userId,
    likedTags: parseTags(row.likedTags),
    dislikedTags: parseTags(row.dislikedTags),
    energyLevel: row.energyLevel,
    budgetLevel: row.budgetLevel,
    socialMode: row.socialMode,
    preferredDuration: row.preferredDuration,
    weekdayEvenings: row.weekdayEvenings,
    weekendMornings: row.weekendMornings,
    notes: row.notes,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
  };
}

async function findUserByEmail(email: string) {
  const normalized = email.toLowerCase().trim();
  const rows = await ateneumDb
    .select()
    .from(ateneumUsers)
    .where(eq(ateneumUsers.email, normalized))
    .limit(1);
  return rows[0] ?? null;
}

async function findUserByUsernameOrEmail(identifier: string) {
  const lower = identifier.toLowerCase().trim();
  const rows = await ateneumDb
    .select()
    .from(ateneumUsers)
    .where(
      sql`lower(${ateneumUsers.username}) = ${lower} OR lower(${ateneumUsers.email}) = ${lower}`,
    )
    .limit(1);
  return rows[0] ?? null;
}

export function selectHumanPartner<
  T extends { id: string; role: string },
>(users: T[], actor: { id: string; role: string }): T | null {
  const partnerRole =
    actor.role === "partner_a"
      ? "partner_b"
      : actor.role === "partner_b"
        ? "partner_a"
        : null;
  if (!partnerRole) return null;
  return users.find((user) => user.role === partnerRole && user.id !== actor.id) ?? null;
}

const PASSWORD_LOGIN_WINDOW_MS = 10 * 60 * 1000;
const PASSWORD_LOGIN_MAX_FAILURES = 5;
const PASSWORD_LOGIN_MAX_KEYS = 1000;
const passwordLoginFailures = new Map<string, number[]>();

function passwordLoginKey(req: Request, identifier: string): string {
  const remote = req.ip || req.socket.remoteAddress || "unknown";
  return `identity:${remote}:${identifier.toLowerCase().trim()}`;
}

function passwordLoginIpKey(req: Request): string {
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function passwordLoginLimit(
  key: string,
  maxFailures = PASSWORD_LOGIN_MAX_FAILURES,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const recent = (passwordLoginFailures.get(key) ?? []).filter(
    (timestamp) => now - timestamp < PASSWORD_LOGIN_WINDOW_MS,
  );
  if (recent.length) passwordLoginFailures.set(key, recent);
  else passwordLoginFailures.delete(key);

  if (recent.length < maxFailures) {
    return { ok: true, retryAfterSec: 0 };
  }
  return {
    ok: false,
    retryAfterSec: Math.ceil(
      (PASSWORD_LOGIN_WINDOW_MS - (now - recent[0])) / 1000,
    ),
  };
}

function recordPasswordLoginFailure(key: string): void {
  if (
    !passwordLoginFailures.has(key) &&
    passwordLoginFailures.size >= PASSWORD_LOGIN_MAX_KEYS
  ) {
    const oldestKey = passwordLoginFailures.keys().next().value;
    if (oldestKey) passwordLoginFailures.delete(oldestKey);
  }
  const recent = passwordLoginFailures.get(key) ?? [];
  recent.push(Date.now());
  passwordLoginFailures.set(key, recent);
}

export function registerAteneumRoutes(app: Express): void {
  // ============================================
  // AUTH (legacy username+password kept as backup)
  // ============================================

  app.post("/api/ateneum/auth/login", async (req: Request, res: Response) => {
    try {
      const body = z
        .object({ username: z.string().min(1), password: z.string().min(1) })
        .safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ message: "Username and password required" });
      }

      const loginKeys = [
        passwordLoginKey(req, body.data.username),
        passwordLoginIpKey(req),
      ];
      const limits = [
        passwordLoginLimit(loginKeys[0], PASSWORD_LOGIN_MAX_FAILURES),
        passwordLoginLimit(loginKeys[1], 25),
      ];
      const limit = limits.find((entry) => !entry.ok);
      if (limit) {
        res.setHeader("Retry-After", String(limit.retryAfterSec));
        return res.status(429).json({
          message: "Too many login attempts. Try again later.",
          retryAfterSec: limit.retryAfterSec,
        });
      }

      const user = await findUserByUsernameOrEmail(body.data.username);
      if (!user) {
        await hashPassword(body.data.password);
        loginKeys.forEach(recordPasswordLoginFailure);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const ok = await verifyPassword(user.passwordHash, body.data.password);
      if (!ok) {
        loginKeys.forEach(recordPasswordLoginFailure);
        return res.status(401).json({ message: "Invalid credentials" });
      }

      passwordLoginFailures.delete(loginKeys[0]);
      const session = await createSession(user.id);
      setSessionCookie(res, session.id, session.expiresAt);
      return res.json({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
        },
      });
    } catch (err: any) {
      console.error("[ateneum] login error:", err);
      return res
        .status(500)
        .json({ message: err.message || "Login failed" });
    }
  });

  app.post("/api/ateneum/auth/logout", async (req: Request, res: Response) => {
    const sid = readSessionCookie(req);
    if (sid) {
      await destroySession(sid);
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  app.get("/api/ateneum/auth/me", async (req: AteneumAuthedRequest, res: Response) => {
    const sid = readSessionCookie(req);
    const user = await getUserBySession(sid);
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    return res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
      },
    });
  });

  // ============================================
  // MAGIC LINK
  // ============================================

  app.post(
    "/api/ateneum/auth/magic-link/request",
    async (req: Request, res: Response) => {
      try {
        const body = z
          .object({ email: z.string().email() })
          .safeParse(req.body);
        if (!body.success) {
          return res
            .status(400)
            .json({ message: "Anna kelvollinen sähköposti" });
        }
        const email = body.data.email.toLowerCase().trim();
        const remote = req.ip || req.socket.remoteAddress || "unknown";
        for (const [key, maxAttempts] of [
          ["magic-request:global", 100],
          [`magic-request:ip:${remote}`, 10],
          [`magic-request:email:${email}`, 3],
        ] as const) {
          const limit = checkRateLimit(key, maxAttempts);
          if (!limit.ok) {
            res.setHeader("Retry-After", String(limit.retryAfterSec));
            return res.status(429).json({
              message: `Liian monta pyyntöä. Yritä uudelleen ${Math.ceil(limit.retryAfterSec / 60)} minuutin kuluttua.`,
              retryAfterSec: limit.retryAfterSec,
            });
          }
        }

        const user = await findUserByEmail(email);

        // Always respond 200 to avoid email enumeration
        if (!user) {
          console.log("[ateneum] magic-link request: no matching user");
          return res.json({ ok: true });
        }

        const { raw, hash } = generateToken();
        await recordEmailToken({
          email,
          tokenHash: hash,
          purpose: "magic_link",
          ttlMs: 15 * 60 * 1000,
        });
        const r = await sendMagicLink({
          email,
          displayName: user.displayName,
          rawToken: raw,
        });

        if (!r.sent) {
          // Still return ok but log
          console.warn(`[ateneum] magic-link send failed: ${r.error}`);
        }

        return res.json({ ok: true });
      } catch (err: any) {
        console.error("[ateneum] magic-link error:", err);
        return res
          .status(500)
          .json({ message: err.message || "Magic-link failed" });
      }
    },
  );

  app.get("/api/ateneum/auth/magic-link/verify", (_req: Request, res: Response) => {
    return res.status(405).json({ message: "Use POST to verify a magic link" });
  });

  app.post(
    "/api/ateneum/auth/magic-link/verify",
    async (req: Request, res: Response) => {
      try {
        const body = z.object({ token: z.string().min(32).max(512) }).safeParse(req.body);
        if (!body.success) {
          return res.status(400).json({ message: "Missing or invalid token" });
        }

        const remote = req.ip || req.socket.remoteAddress || "unknown";
        for (const [key, maxAttempts] of [
          ["magic-verify:global", 200],
          [`magic-verify:ip:${remote}`, 20],
        ] as const) {
          const limit = checkRateLimit(key, maxAttempts);
          if (!limit.ok) {
            res.setHeader("Retry-After", String(limit.retryAfterSec));
            return res.status(429).json({ message: "Too many verification attempts" });
          }
        }

        const consumed = await consumeToken({
          rawToken: body.data.token,
          purpose: "magic_link",
        });
        if (!consumed) {
          return res
            .status(400)
            .json({ message: "Linkki on vanhentunut tai käytetty. Pyydä uusi." });
        }

        const user = await findUserByEmail(consumed.email);
        if (!user) {
          return res.status(400).json({ message: "Käyttäjää ei löytynyt." });
        }

        const session = await createSession(user.id);
        setSessionCookie(res, session.id, session.expiresAt);
        return res.json({
          ok: true,
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            role: user.role,
          },
        });
      } catch (err: any) {
        console.error("[ateneum] magic-link verify error:", err);
        return res.status(500).json({ message: "Verification failed" });
      }
    },
  );

  // Unsubscribe via email link
  app.post(
    "/api/ateneum/auth/unsubscribe",
    async (req: Request, res: Response) => {
      try {
        const token = String(
          req.query.token ?? req.body?.token ?? "",
        );
        if (!token) return res.status(400).send("Missing token");

        const consumed = await consumeToken({
          rawToken: token,
          purpose: "unsubscribe",
        });
        if (!consumed) {
          return res
            .status(400)
            .send("Linkki on vanhentunut tai käytetty.");
        }
        const user = await findUserByEmail(consumed.email);
        if (!user) return res.status(404).send("Käyttäjää ei löytynyt.");

        // Turn off all notifications
        const existing = await ateneumDb
          .select()
          .from(ateneumNotificationPrefs)
          .where(eq(ateneumNotificationPrefs.userId, user.id))
          .limit(1);
        if (existing[0]) {
          await ateneumDb
            .update(ateneumNotificationPrefs)
            .set({
              weeklySuggestion: false,
              wishAdded: false,
              wishFulfilled: false,
              activityPlanned: false,
              inactivityReminder: false,
              updatedAt: new Date(),
            })
            .where(eq(ateneumNotificationPrefs.userId, user.id));
        } else {
          await ateneumDb.insert(ateneumNotificationPrefs).values({
            userId: user.id,
            weeklySuggestion: false,
            wishAdded: false,
            wishFulfilled: false,
            activityPlanned: false,
            inactivityReminder: false,
          });
        }

        if (req.query.format === "json" || req.headers.accept?.includes("application/json")) {
          return res.json({ ok: true });
        }
        return res.send(
          `<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>Lopetettu</title></head><body style="font-family:sans-serif; max-width:480px; margin:4rem auto; text-align:center; color:#1a1a1a;"><h2>Ilmoitukset lopetettu</h2><p>Et saa enää sähköposti-ilmoituksia Ateneumista.</p><p><a href="/ateneum/">Palaa Ateneumiin</a></p></body></html>`,
        );
      } catch (err: any) {
        console.error("[ateneum] unsubscribe error:", err);
        return res.status(500).send("Unsubscribe failed");
      }
    },
  );

  // GET only confirms intent. Email scanners and prefetchers must not consume
  // the token or change notification preferences.
  app.get(
    "/api/ateneum/auth/unsubscribe",
    (req: Request, res: Response) => {
      const parsed = z.string().min(32).max(512).safeParse(req.query.token);
      if (!parsed.success) {
        return res.status(400).send("Missing or invalid token");
      }
      const token = escapeHtmlAttribute(parsed.data);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      return res.type("html").send(
        `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Vahvista ilmoitusten lopetus</title></head><body style="font-family:sans-serif; max-width:480px; margin:4rem auto; text-align:center; color:#1a1a1a;"><h2>Lopeta sähköposti-ilmoitukset?</h2><p>Vahvista, ettet halua enää sähköposti-ilmoituksia Ateneumista.</p><form method="post" action="/api/ateneum/auth/unsubscribe"><input type="hidden" name="token" value="${token}"><button type="submit" style="padding:.75rem 1rem; cursor:pointer;">Lopeta ilmoitukset</button></form><p><a href="/ateneum/">Peruuta ja palaa Ateneumiin</a></p></body></html>`,
      );
    },
  );

  // ============================================
  // NOTIFICATION PREFS
  // ============================================

  app.get(
    "/api/ateneum/notification-prefs",
    requireAteneumAuth,
    async (req: AteneumAuthedRequest, res: Response) => {
      const user = req.ateneumUser!;
      const prefs = await getNotificationPrefs(user.id);
      return res.json({ prefs });
    },
  );

  app.patch(
    "/api/ateneum/notification-prefs",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const user = req.ateneumUser!;
      const body = z
        .object({
          weeklySuggestion: z.boolean().optional(),
          wishAdded: z.boolean().optional(),
          wishFulfilled: z.boolean().optional(),
          activityPlanned: z.boolean().optional(),
          inactivityReminder: z.boolean().optional(),
        })
        .safeParse(req.body ?? {});
      if (!body.success) {
        return res.status(400).json({ message: "Invalid prefs" });
      }
      const existing = await ateneumDb
        .select()
        .from(ateneumNotificationPrefs)
        .where(eq(ateneumNotificationPrefs.userId, user.id))
        .limit(1);
      const update: any = { ...body.data, updatedAt: new Date() };
      // Drizzle stores booleans as 0/1; convert
      for (const k of [
        "weeklySuggestion",
        "wishAdded",
        "wishFulfilled",
        "activityPlanned",
        "inactivityReminder",
      ]) {
        if (typeof update[k] === "boolean") update[k] = update[k] ? 1 : 0;
      }
      if (existing[0]) {
        await ateneumDb
          .update(ateneumNotificationPrefs)
          .set(update)
          .where(eq(ateneumNotificationPrefs.userId, user.id));
      } else {
        await ateneumDb.insert(ateneumNotificationPrefs).values({
          userId: user.id,
          weeklySuggestion: update.weeklySuggestion ?? 1,
          wishAdded: update.wishAdded ?? 1,
          wishFulfilled: update.wishFulfilled ?? 1,
          activityPlanned: update.activityPlanned ?? 1,
          inactivityReminder: update.inactivityReminder ?? 1,
          updatedAt: new Date(),
        });
      }
      const prefs = await getNotificationPrefs(user.id);
      return res.json({ prefs });
    },
  );

  // ============================================
  // PROTECTED ROUTES
  // ============================================

  // Preferences
  app.get(
    "/api/ateneum/preferences",
    requireAteneumAuth,
    async (req: AteneumAuthedRequest, res: Response) => {
      const user = req.ateneumUser!;
      const rows = await ateneumDb
        .select()
        .from(ateneumPreferences)
        .where(eq(ateneumPreferences.userId, user.id))
        .limit(1);
      if (!rows[0]) {
        return res.json({
          preferences: serializePreferences({
            userId: user.id,
            likedTags: "[]",
            dislikedTags: "[]",
            energyLevel: "medium",
            budgetLevel: "moderate",
            socialMode: "together",
            preferredDuration: 120,
            weekdayEvenings: true,
            weekendMornings: true,
            notes: "",
            updatedAt: null,
          }),
        });
      }
      return res.json({ preferences: serializePreferences(rows[0]) });
    },
  );

  app.put(
    "/api/ateneum/preferences",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const user = req.ateneumUser!;
      try {
        const raw = req.body ?? {};
        const likedTags = Array.isArray(raw.likedTags)
          ? JSON.stringify(raw.likedTags.map(String))
          : raw.likedTags ?? "[]";
        const dislikedTags = Array.isArray(raw.dislikedTags)
          ? JSON.stringify(raw.dislikedTags.map(String))
          : raw.dislikedTags ?? "[]";

        const parsed = insertAteneumPreferencesSchema.safeParse({
          userId: user.id,
          likedTags,
          dislikedTags,
          energyLevel: raw.energyLevel,
          budgetLevel: raw.budgetLevel,
          socialMode: raw.socialMode,
          preferredDuration: Number(raw.preferredDuration ?? 120),
          weekdayEvenings: Boolean(raw.weekdayEvenings),
          weekendMornings: Boolean(raw.weekendMornings),
          notes: String(raw.notes ?? ""),
        });
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: fromZodError(parsed.error).message });
        }

        const existing = await ateneumDb
          .select()
          .from(ateneumPreferences)
          .where(eq(ateneumPreferences.userId, user.id))
          .limit(1);

        let row;
        if (existing[0]) {
          const updated = await ateneumDb
            .update(ateneumPreferences)
            .set({ ...parsed.data, updatedAt: new Date() })
            .where(eq(ateneumPreferences.userId, user.id))
            .returning();
          row = updated[0];
        } else {
          const inserted = await ateneumDb
            .insert(ateneumPreferences)
            .values({ ...parsed.data, updatedAt: new Date() })
            .returning();
          row = inserted[0];
        }
        return res.json({ preferences: serializePreferences(row) });
      } catch (err: any) {
        console.error("[ateneum] preferences update:", err);
        return res
          .status(500)
          .json({ message: err.message || "Failed to update preferences" });
      }
    },
  );

  // Ideas
  app.get(
    "/api/ateneum/ideas",
    requireAteneumAuth,
    async (req: AteneumAuthedRequest, res: Response) => {
      const includeInactive = req.query.includeInactive === "1";
      const all = await ateneumDb
        .select()
        .from(ateneumIdeas)
        .orderBy(desc(ateneumIdeas.createdAt));
      const filtered = includeInactive ? all : all.filter((i) => i.isActive);
      return res.json({ ideas: filtered.map(serializeIdea) });
    },
  );

  app.post(
    "/api/ateneum/ideas",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const user = req.ateneumUser!;
      try {
        const parsed = ideaCreateBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: fromZodError(parsed.error).message });
        }
        const id = newId("idea");
        const inserted = await ateneumDb
          .insert(ateneumIdeas)
          .values({
            id,
            ...parsed.data,
            tags: JSON.stringify(parsed.data.tags),
            createdBy: user.id,
          })
          .returning();
        return res.json({ idea: serializeIdea(inserted[0]) });
      } catch (err: any) {
        console.error("[ateneum] idea create:", err);
        return res
          .status(500)
          .json({ message: err.message || "Failed to create idea" });
      }
    },
  );

  app.patch(
    "/api/ateneum/ideas/:id",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      try {
        const id = req.params.id;
        const parsed = ideaUpdateBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: fromZodError(parsed.error).message });
        }
        const update: any = { ...parsed.data };
        if (parsed.data.tags !== undefined) {
          update.tags = JSON.stringify(parsed.data.tags);
        }
        const updated = await ateneumDb
          .update(ateneumIdeas)
          .set(update)
          .where(eq(ateneumIdeas.id, id))
          .returning();
        if (!updated[0]) {
          return res.status(404).json({ message: "Idea not found" });
        }
        return res.json({ idea: serializeIdea(updated[0]) });
      } catch (err: any) {
        console.error("[ateneum] idea update:", err);
        return res
          .status(500)
          .json({ message: err.message || "Failed to update idea" });
      }
    },
  );

  app.delete(
    "/api/ateneum/ideas/:id",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const id = req.params.id;
      const updated = await ateneumDb
        .update(ateneumIdeas)
        .set({ isActive: false })
        .where(eq(ateneumIdeas.id, id))
        .returning();
      if (!updated[0]) {
        return res.status(404).json({ message: "Idea not found" });
      }
      return res.json({ ok: true });
    },
  );

  // Activities
  app.get(
    "/api/ateneum/activities",
    requireAteneumAuth,
    async (req: AteneumAuthedRequest, res: Response) => {
      const status = (req.query.status as string | undefined) ?? undefined;
      let q: any = ateneumDb
        .select()
        .from(ateneumActivities)
        .orderBy(desc(ateneumActivities.scheduledFor));
      if (status && ["planned", "done", "skipped"].includes(status)) {
        q = ateneumDb
          .select()
          .from(ateneumActivities)
          .where(eq(ateneumActivities.status, status as any))
          .orderBy(desc(ateneumActivities.scheduledFor));
      }
      const rows = await q;
      return res.json({ activities: rows.map(serializeActivity) });
    },
  );

  app.post(
    "/api/ateneum/activities",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const user = req.ateneumUser!;
      try {
        const raw = req.body ?? {};
        const parsed = insertAteneumActivitySchema.safeParse({
          ideaId: raw.ideaId ?? null,
          title: String(raw.title ?? "").trim(),
          scheduledFor: new Date(raw.scheduledFor),
          durationMin: Number(raw.durationMin ?? 60),
          status: raw.status ?? "planned",
          rating:
            raw.rating !== undefined && raw.rating !== null
              ? Number(raw.rating)
              : undefined,
          notes: String(raw.notes ?? ""),
          createdBy: user.id,
        });
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: fromZodError(parsed.error).message });
        }
        const id = newId("act");
        const values: any = { id, ...parsed.data };
        if (values.status === "done") {
          values.completedAt = new Date();
        }
        const inserted = await ateneumDb
          .insert(ateneumActivities)
          .values(values)
          .returning();

        // Email: notify the *other* user
        try {
          const others = await ateneumDb
            .select()
            .from(ateneumUsers);
          const other = selectHumanPartner(others, user);
          if (other) {
            sendActivityPlanned({
              toUser: other,
              fromUser: user,
              activity: inserted[0],
            }).catch((e) =>
              console.error("[ateneum] activity email failed:", e),
            );
          }
        } catch (e) {
          console.error("[ateneum] activity email setup failed:", e);
        }

        return res.json({ activity: serializeActivity(inserted[0]) });
      } catch (err: any) {
        console.error("[ateneum] activity create:", err);
        return res
          .status(500)
          .json({ message: err.message || "Failed to create activity" });
      }
    },
  );

  app.get(
    "/api/ateneum/activities/:id",
    requireAteneumAuth,
    async (req: AteneumAuthedRequest, res: Response) => {
      try {
        const id = req.params.id;
        const rows = await ateneumDb
          .select()
          .from(ateneumActivities)
          .where(eq(ateneumActivities.id, id))
          .limit(1);
        if (!rows[0]) {
          return res.status(404).json({ message: "Activity not found" });
        }
        return res.json({ activity: serializeActivity(rows[0]) });
      } catch (err: any) {
        console.error("[ateneum] activity get:", err);
        return res
          .status(500)
          .json({ message: err.message || "Failed to get activity" });
      }
    },
  );

  app.patch(
    "/api/ateneum/activities/:id",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      try {
        const id = req.params.id;
        const parsed = z
          .object({
            title: z.string().trim().min(1).max(300).optional(),
            scheduledFor: z.coerce.date().optional(),
            durationMin: z.number().int().min(1).max(1440).optional(),
            status: z.enum(["planned", "done", "skipped"]).optional(),
            rating: z.number().int().min(1).max(5).nullable().optional(),
            notes: z.string().max(5000).optional(),
            ideaId: z.string().min(1).max(200).nullable().optional(),
          })
          .strict()
          .refine((value) => Object.keys(value).length > 0)
          .safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid activity update" });
        }
        const update: any = { ...parsed.data };
        if (parsed.data.status !== undefined) {
          if (parsed.data.status === "done") update.completedAt = new Date();
          if (parsed.data.status === "planned" || parsed.data.status === "skipped") {
            update.completedAt = null;
          }
        }
        const updated = await ateneumDb
          .update(ateneumActivities)
          .set(update)
          .where(eq(ateneumActivities.id, id))
          .returning();
        if (!updated[0]) {
          return res.status(404).json({ message: "Activity not found" });
        }
        return res.json({ activity: serializeActivity(updated[0]) });
      } catch (err: any) {
        console.error("[ateneum] activity update:", err);
        return res
          .status(500)
          .json({ message: err.message || "Failed to update activity" });
      }
    },
  );

  app.delete(
    "/api/ateneum/activities/:id",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const id = req.params.id;
      const deleted = await ateneumDb
        .delete(ateneumActivities)
        .where(eq(ateneumActivities.id, id))
        .returning();
      if (!deleted[0]) {
        return res.status(404).json({ message: "Activity not found" });
      }
      return res.json({ ok: true });
    },
  );

  // Wishes
  app.get(
    "/api/ateneum/wishes",
    requireAteneumAuth,
    async (req: AteneumAuthedRequest, res: Response) => {
      const me = req.ateneumUser!;
      const showAll = req.query.all === "1";
      const onlyUnfulfilled = req.query.unfulfilled === "1";
      const allUsers = await ateneumDb.select().from(ateneumUsers);
      const userMap = new Map(
        allUsers.map((u) => [u.id, { displayName: u.displayName, role: u.role }]),
      );
      let rows = await ateneumDb
        .select()
        .from(ateneumWishes)
        .orderBy(desc(ateneumWishes.createdAt));
      rows = rows.filter(
        (w) => w.visibility === "shared" || w.userId === me.id,
      );
      if (onlyUnfulfilled) {
        rows = rows.filter((w) => !w.fulfilled);
      }
      if (!showAll) {
        rows = rows.slice(0, 50);
      }
      return res.json({
        wishes: rows.map((w) => serializeWish(w, userMap.get(w.userId) ?? undefined)),
      });
    },
  );

  app.post(
    "/api/ateneum/wishes",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const user = req.ateneumUser!;
      try {
        const raw = req.body ?? {};
        const parsed = insertAteneumWishSchema.safeParse({
          userId: user.id,
          body: String(raw.body ?? "").trim(),
          mood: raw.mood ?? "tender",
          visibility: raw.visibility ?? "shared",
        });
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: fromZodError(parsed.error).message });
        }
        const id = newId("wish");
        const inserted = await ateneumDb
          .insert(ateneumWishes)
          .values({ id, ...parsed.data })
          .returning();

        // Email: notify the other user, but only for shared wishes
        try {
          if (parsed.data.visibility === "shared") {
            const others = await ateneumDb.select().from(ateneumUsers);
            const other = selectHumanPartner(others, user);
            if (other) {
              sendWishAdded({
                toUser: other,
                fromUser: user,
                wish: inserted[0],
              }).catch((e) =>
                console.error("[ateneum] wish-added email failed:", e),
              );
            }
          }
        } catch (e) {
          console.error("[ateneum] wish email setup failed:", e);
        }

        return res.json({
          wish: serializeWish(inserted[0], {
            displayName: user.displayName,
            role: user.role,
          }),
        });
      } catch (err: any) {
        console.error("[ateneum] wish create:", err);
        return res
          .status(500)
          .json({ message: err.message || "Failed to create wish" });
      }
    },
  );

  app.patch(
    "/api/ateneum/wishes/:id",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const me = req.ateneumUser!;
      try {
        const id = req.params.id;
        const parsed = z
          .object({
            body: z.string().trim().min(1).max(5000).optional(),
            mood: z
              .enum(["longing", "playful", "tender", "restless", "grateful"])
              .optional(),
            visibility: z.enum(["shared", "private"]).optional(),
            fulfilled: z.boolean().optional(),
          })
          .strict()
          .refine((value) => Object.keys(value).length > 0)
          .safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid wish update" });
        }
        const update = parsed.data;

        const existing = await ateneumDb
          .select()
          .from(ateneumWishes)
          .where(eq(ateneumWishes.id, id))
          .limit(1);
        const wish = existing[0];
        if (!wish) return res.status(404).json({ message: "Wish not found" });

        const isOwner = wish.userId === me.id;
        if (!isOwner) {
          return res.status(403).json({ message: "Cannot edit this wish" });
        }

        const updated = await ateneumDb
          .update(ateneumWishes)
          .set(update)
          .where(eq(ateneumWishes.id, id))
          .returning();

        return res.json({ wish: serializeWish(updated[0]) });
      } catch (err: any) {
        console.error("[ateneum] wish update:", err);
        return res
          .status(500)
          .json({ message: err.message || "Failed to update wish" });
      }
    },
  );

  // Wish fulfill shortcut used by HTML demo
  app.post(
    "/api/ateneum/wishes/:id/fulfill",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const me = req.ateneumUser!;
      const id = req.params.id;
      const existing = await ateneumDb
        .select()
        .from(ateneumWishes)
        .where(eq(ateneumWishes.id, id))
        .limit(1);
      const wish = existing[0];
      if (!wish) return res.status(404).json({ message: "Wish not found" });
      const isOwner = wish.userId === me.id;
      if (!isOwner) {
        return res.status(403).json({ message: "Cannot edit this wish" });
      }
      const updated = await ateneumDb
        .update(ateneumWishes)
        .set({ fulfilled: true })
        .where(eq(ateneumWishes.id, id))
        .returning();
      return res.json({ wish: serializeWish(updated[0]) });
    },
  );

  app.delete(
    "/api/ateneum/wishes/:id",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const me = req.ateneumUser!;
      const id = req.params.id;
      const existing = await ateneumDb
        .select()
        .from(ateneumWishes)
        .where(eq(ateneumWishes.id, id))
        .limit(1);
      const wish = existing[0];
      if (!wish) return res.status(404).json({ message: "Wish not found" });
      if (wish.userId !== me.id) {
        return res.status(403).json({ message: "Cannot delete this wish" });
      }
      await ateneumDb.delete(ateneumWishes).where(eq(ateneumWishes.id, id));
      return res.json({ ok: true });
    },
  );

  // ============================================
  // WEEKLY SUGGESTION (reused by cron + endpoint)
  // ============================================

  function stableIdeaOrder(weekKey: string, ideaId: string): number {
    let hash = 2166136261;
    for (const char of `${weekKey}:${ideaId}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  async function rankSharedSuggestions(weekKey: string) {
    const [allPrefs, allUsers, allIdeas] = await Promise.all([
      ateneumDb.select().from(ateneumPreferences),
      ateneumDb.select().from(ateneumUsers),
      ateneumDb.select().from(ateneumIdeas),
    ]);
    const coupleUserIds = new Set(
      allUsers
        .filter((user) => user.role === "partner_a" || user.role === "partner_b")
        .map((user) => user.id),
    );
    const couplePrefs = allPrefs.filter((prefs) => coupleUserIds.has(prefs.userId));
    const active = allIdeas.filter((idea) => idea.isActive);

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = await ateneumDb
      .select()
      .from(ateneumActivities)
      .where(
        and(
          gte(ateneumActivities.scheduledFor, cutoff),
          inArray(ateneumActivities.status, ["planned", "done"] as any),
        ),
      );
    const recentIdeaIds = new Set(recent.map((activity) => activity.ideaId).filter(Boolean));

    function scoreIdea(idea: any): number {
      if (recentIdeaIds.has(idea.id)) return -1;
      const tags = parseTags(idea.tags);
      let score = 0;
      for (const prefs of couplePrefs) {
        const liked = parseTags(prefs.likedTags);
        const disliked = parseTags(prefs.dislikedTags);
        for (const tag of tags) {
          if (liked.includes(tag)) score += 3;
          if (disliked.includes(tag)) score -= 5;
        }
        if (idea.energyCost === prefs.energyLevel) score += 2;
        if (idea.budgetCost === prefs.budgetLevel) score += 1;
        if (idea.socialMode === prefs.socialMode) score += 4;
      }
      return score;
    }

    return active
      .map((idea) => ({ idea, score: scoreIdea(idea) }))
      .filter((entry) => entry.score >= 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          stableIdeaOrder(weekKey, a.idea.id) - stableIdeaOrder(weekKey, b.idea.id),
      )
      .map((entry) => entry.idea);
  }

  async function getWeeklySuggestion() {
    const weekKey = isoWeekKey();
    const [existing, allIdeas] = await Promise.all([
      ateneumDb
        .select()
        .from(ateneumWeeklySuggestions)
        .where(eq(ateneumWeeklySuggestions.weekKey, weekKey))
        .limit(1),
      ateneumDb.select().from(ateneumIdeas),
    ]);

    const persisted = Boolean(existing[0]);
    let suggestion =
      allIdeas.find((idea) => idea.id === existing[0]?.ideaId) ?? null;
    const ranked = await rankSharedSuggestions(weekKey);
    if (!suggestion && ranked[0]) suggestion = ranked[0];

    const alternates = ranked
      .filter((idea) => idea.id !== suggestion?.id)
      .slice(0, 10);
    return { weekKey, suggestion, alternates, persisted };
  }

  async function persistWeeklySuggestion() {
    const current = await getWeeklySuggestion();
    if (!current.suggestion || current.persisted) return current;
    await ateneumDb
      .insert(ateneumWeeklySuggestions)
      .values({ weekKey: current.weekKey, ideaId: current.suggestion.id })
      .onConflictDoNothing({ target: ateneumWeeklySuggestions.weekKey });
    return getWeeklySuggestion();
  }

  async function rotateWeeklySuggestion() {
    const weekKey = isoWeekKey();
    const ranked = await rankSharedSuggestions(weekKey);
    if (!ranked.length) {
      return { weekKey, suggestion: null, alternates: [] };
    }

    const existing = await ateneumDb
      .select()
      .from(ateneumWeeklySuggestions)
      .where(eq(ateneumWeeklySuggestions.weekKey, weekKey))
      .limit(1);
    const currentIndex = ranked.findIndex((idea) => idea.id === existing[0]?.ideaId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % ranked.length : 0;
    const suggestion = ranked[nextIndex];

    await ateneumDb
      .insert(ateneumWeeklySuggestions)
      .values({ weekKey, ideaId: suggestion.id })
      .onConflictDoUpdate({
        target: ateneumWeeklySuggestions.weekKey,
        set: { ideaId: suggestion.id },
      });

    const alternates = ranked
      .filter((idea) => idea.id !== suggestion.id)
      .slice(0, 10);
    return { weekKey, suggestion, alternates };
  }

  app.get(
    "/api/ateneum/suggestions/weekly",
    requireAteneumAuth,
    async (_req: AteneumAuthedRequest, res: Response) => {
      const { weekKey, suggestion, alternates, persisted } = await getWeeklySuggestion();
      return res.json({
        weekKey,
        persisted,
        suggestion: suggestion ? serializeIdea(suggestion) : null,
        alternates: alternates.map(serializeIdea),
      });
    },
  );

  app.post(
    "/api/ateneum/suggestions/weekly/select",
    requireAteneumAuth,
    requireHumanWrite,
    async (_req: AteneumAuthedRequest, res: Response) => {
      const { weekKey, suggestion, alternates, persisted } =
        await persistWeeklySuggestion();
      return res.json({
        weekKey,
        persisted,
        suggestion: suggestion ? serializeIdea(suggestion) : null,
        alternates: alternates.map(serializeIdea),
      });
    },
  );

  app.post(
    "/api/ateneum/suggestions/weekly/rotate",
    requireAteneumAuth,
    requireHumanWrite,
    async (_req: AteneumAuthedRequest, res: Response) => {
      const { weekKey, suggestion, alternates } = await rotateWeeklySuggestion();
      return res.json({
        weekKey,
        suggestion: suggestion ? serializeIdea(suggestion) : null,
        alternates: alternates.map(serializeIdea),
      });
    },
  );

  // Test/ops endpoint: manually trigger weekly digest for current user
  app.post(
    "/api/ateneum/suggestions/weekly/send",
    requireAteneumAuth,
    requireHumanWrite,
    async (req: AteneumAuthedRequest, res: Response) => {
      const me = req.ateneumUser!;
      const week = isoWeekKey();
      const claimed = claimWeeklyEmail({
        toEmail: me.email,
        kind: "weekly_suggestion",
        weekKey: week,
      });
      if (!claimed) {
        return res.json({ ok: true, skipped: true, reason: "already-sent-this-week" });
      }
      try {
        const { suggestion, alternates } = await persistWeeklySuggestion();
        const r = await sendWeeklySuggestion({
          user: me,
          suggestion,
          alternates,
          weekKey: week,
        });
        finishWeeklyEmailClaim({
          toEmail: me.email,
          kind: "weekly_suggestion",
          weekKey: week,
          status: r.sent ? "sent" : "failed",
          error: r.sent ? undefined : r.error ?? (r.skipped ? "notification-disabled" : "send-failed"),
        });
        return res.json({ ok: r.sent, ...r });
      } catch (error: any) {
        finishWeeklyEmailClaim({
          toEmail: me.email,
          kind: "weekly_suggestion",
          weekKey: week,
          status: "failed",
          error: error?.message ?? "weekly-send-failed",
        });
        console.error("[ateneum] weekly email error:", error?.name, error?.message);
        return res.status(500).json({ ok: false, message: "Weekly email failed" });
      }
    },
  );

  // Stats
  app.get(
    "/api/ateneum/stats",
    requireAteneumAuth,
    async (req: AteneumAuthedRequest, res: Response) => {
      const me = req.ateneumUser!;
      const activities = await ateneumDb.select().from(ateneumActivities);
      const wishes = (await ateneumDb.select().from(ateneumWishes)).filter(
        (wish) => wish.visibility === "shared" || wish.userId === me.id,
      );
      const ideas = await ateneumDb.select().from(ateneumIdeas);
      const plannedCount = activities.filter((a) => a.status === "planned").length;
      const doneCount = activities.filter((a) => a.status === "done").length;
      const ratedActivities = activities.filter(
        (a) => a.status === "done" && typeof a.rating === "number",
      );
      const avgRating =
        ratedActivities.length > 0
          ? ratedActivities.reduce((s, a) => s + (a.rating ?? 0), 0) /
            ratedActivities.length
          : null;
      const unfulfilledWishes = wishes.filter((w) => !w.fulfilled).length;
      const recent30d = activities.filter(
        (a) =>
          a.completedAt &&
          a.completedAt instanceof Date &&
          Date.now() - a.completedAt.getTime() < 30 * 24 * 60 * 60 * 1000,
      ).length;
      return res.json({
        stats: {
          ideaCount: ideas.filter((i) => i.isActive).length,
          plannedCount,
          doneCount,
          skippedCount: activities.filter((a) => a.status === "skipped").length,
          avgRating: avgRating ? Math.round(avgRating * 10) / 10 : null,
          unfulfilledWishes,
          recent30d,
          myRole: me.role,
        },
      });
    },
  );

  // ============================================
  // API TOKEN MANAGEMENT (human browser session + password confirmation)
  // ============================================
  // The plaintext token is returned exactly once; only its SHA-256 hash is stored.
  app.post(
    "/api/ateneum/auth/api-token",
    requireAteneumAuth,
    requireHumanSession,
    async (req: AteneumAuthedRequest, res: Response) => {
      try {
        const me = req.ateneumUser!;
        const body = z
          .object({
            name: z.string().trim().min(1).max(120),
            password: z.string().min(1).max(512),
            expiresInDays: z.number().int().min(1).max(90),
            scopes: z
              .array(z.enum(ATENEUM_API_TOKEN_SCOPES))
              .min(1)
              .max(ATENEUM_API_TOKEN_SCOPES.length)
              .refine((items) => items.includes("read"), "read scope is required")
              .refine((items) => new Set(items).size === items.length, "duplicate scopes are not allowed"),
          })
          .safeParse(req.body ?? {});
        if (!body.success) {
          return res.status(400).json({
            message: "name, current password, 1-90 day expiry and scopes including read are required",
          });
        }
        if (!(await verifyPassword(me.passwordHash, body.data.password))) {
          return res.status(403).json({ message: "Password confirmation failed" });
        }
        const scopes = body.data.scopes as AteneumApiTokenScope[];
        const issued = await issueAteneumApiToken({
          userId: me.id,
          name: body.data.name,
          expiresInDays: body.data.expiresInDays,
          scopes,
        });
        return res.json({
          token: issued.rawToken,
          id: issued.id,
          name: body.data.name,
          scopes,
          expires_at: issued.expiresAt.toISOString(),
        });
      } catch (err: any) {
        console.error("[ateneum] api-token issue error:", err?.name, err?.message);
        return res.status(500).json({ message: "Failed to issue token" });
      }
    },
  );

  app.get(
    "/api/ateneum/auth/api-tokens",
    requireAteneumAuth,
    requireHumanSession,
    async (req: AteneumAuthedRequest, res: Response) => {
      const rows = await ateneumDb
        .select({
          id: ateneumApiTokens.id,
          name: ateneumApiTokens.name,
          scopes: ateneumApiTokens.scopes,
          expiresAt: ateneumApiTokens.expiresAt,
          revokedAt: ateneumApiTokens.revokedAt,
          lastUsedAt: ateneumApiTokens.lastUsedAt,
          createdAt: ateneumApiTokens.createdAt,
        })
        .from(ateneumApiTokens)
        .where(eq(ateneumApiTokens.userId, req.ateneumUser!.id))
        .orderBy(desc(ateneumApiTokens.createdAt));
      return res.json({
        tokens: rows.map((row) => ({
          id: row.id,
          name: row.name,
          scopes: JSON.parse(row.scopes),
          expires_at: row.expiresAt.toISOString(),
          revoked_at: row.revokedAt?.toISOString() ?? null,
          last_used_at: row.lastUsedAt?.toISOString() ?? null,
          created_at: row.createdAt.toISOString(),
        })),
      });
    },
  );

  app.delete(
    "/api/ateneum/auth/api-tokens/:id",
    requireAteneumAuth,
    requireHumanSession,
    async (req: AteneumAuthedRequest, res: Response) => {
      const body = z.object({ password: z.string().min(1).max(512) }).safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "Current password is required" });
      const me = req.ateneumUser!;
      if (!(await verifyPassword(me.passwordHash, body.data.password))) {
        return res.status(403).json({ message: "Password confirmation failed" });
      }
      const revoked = await ateneumDb
        .update(ateneumApiTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(ateneumApiTokens.id, req.params.id),
            eq(ateneumApiTokens.userId, me.id),
            isNull(ateneumApiTokens.revokedAt),
          ),
        )
        .returning({ id: ateneumApiTokens.id });
      if (!revoked[0]) return res.status(404).json({ message: "Active API token not found" });
      return res.json({ ok: true, id: revoked[0].id });
    },
  );

  // ============================================
  // GENERIC NOTIFICATION (human partner + optional scoped token)
  // ============================================
  //
  // POST /api/ateneum/notifications
  //   body: {
  //     to: "<email> | <userId> | <username>",  // resolved in that order
  //     kind: "custom_message",                  // only kind supported now
  //     payload: { subject: string, body: string | htmlBody: string }
  //   }
  //   auth: requireAteneumAuth (human session or notifications:send token)
  //   resp: { ok, sent, messageId?, error? }
  app.post(
    "/api/ateneum/notifications",
    requireAteneumAuth,
    requireNotificationPermission,
    async (req: AteneumAuthedRequest, res: Response) => {
      try {
        const me = req.ateneumUser!;
        const body = z
          .object({
            to: z.string().min(1),
            kind: z.literal("custom_message"),
            payload: z.object({
              subject: z.string().min(1).max(200),
              body: z.string().optional(),
              htmlBody: z.string().optional(),
            }),
          })
          .safeParse(req.body ?? {});
        if (!body.success) {
          return res.status(400).json({
            message:
              "Expected { to, kind: 'custom_message', payload: { subject, body|htmlBody } }",
          });
        }
        const rate = consumeCustomNotificationAttempt(me.id);
        if (!rate.ok) {
          res.setHeader("Retry-After", String(rate.retryAfterSec));
          return res.status(429).json({ message: "Too many notification attempts" });
        }

        const raw = body.data.to.trim();
        const normalizedEmail = raw.toLowerCase();
        let recipientRow = raw.includes("@")
          ? (
              await ateneumDb
                .select()
                .from(ateneumUsers)
                .where(eq(ateneumUsers.email, normalizedEmail))
                .limit(1)
            )[0] ?? null
          : (
              await ateneumDb
                .select()
                .from(ateneumUsers)
                .where(eq(ateneumUsers.id, raw))
                .limit(1)
            )[0] ?? null;
        if (!recipientRow && !raw.includes("@")) {
          recipientRow =
            (
              await ateneumDb
                .select()
                .from(ateneumUsers)
                .where(eq(ateneumUsers.username, raw))
                .limit(1)
            )[0] ?? null;
        }
        if (!recipientRow?.email) {
          return res.status(404).json({ message: "Ateneum recipient not found" });
        }
        const toEmail = recipientRow.email.toLowerCase();

        // Honor unsubscribe: if every pref is off for the resolved user, refuse.
        if (!toEmail.includes("@")) {
          // sanity — shouldn't happen, but skip rather than mis-send
          return res.status(400).json({ message: "Invalid recipient" });
        }

        const prefs = await getNotificationPrefs(recipientRow.id);
        const anyOn =
          prefs.weeklySuggestion ||
          prefs.wishAdded ||
          prefs.wishFulfilled ||
          prefs.activityPlanned ||
          prefs.inactivityReminder;
        if (!anyOn) {
          return res.status(409).json({
            ok: false,
            sent: false,
            error: "Recipient has globally unsubscribed",
          });
        }

        const { subject, body: textOrHtml, htmlBody } = body.data.payload;
        let html = htmlBody;
        if (!html) {
          // Wrap plain text in a minimal layout. Inline escapeHtml
          // so we don't need to export it from ateneum-email.ts.
          const esc = (s: string): string =>
            String(s ?? "").replace(/[&<>"']/g, (c) =>
              ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
            );
          html = `<!DOCTYPE html><html lang="fi"><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; padding: 24px; color: #1a1a1a;">${esc(textOrHtml ?? "").replace(/\n/g, "<br>")}</body></html>`;
        }
        const r = await sendCustomMessage(toEmail, subject, html, {
          fromUserId: me.id,
        });
        return res.json(r);
      } catch (err: any) {
        console.error("[ateneum] notifications error:", err?.name, err?.message);
        return res.status(500).json({ message: "Failed to send notification" });
      }
    },
  );
}
