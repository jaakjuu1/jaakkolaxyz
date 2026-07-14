import crypto from "crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { eq, and, gt, isNull } from "drizzle-orm";
import { ateneumDb, ateneumRawDb, newId } from "./ateneum-db";
import {
  ateneumUsers,
  ateneumEmailTokens,
  ateneumEmailLog,
  ateneumNotificationPrefs,
  type AteneumUser,
  type AteneumIdea,
  type AteneumWish,
  type AteneumActivity,
} from "@shared/ateneum-schema";

// ============================================
// AWS SES client
// ============================================

const AWS_REGION = process.env.AWS_REGION ?? "eu-north-1";
const FROM_ADDRESS = process.env.ATENEUM_FROM_EMAIL ?? "Ateneum <noreply@jaakkola.xyz>";
const PUBLIC_URL = process.env.ATENEUM_PUBLIC_URL ?? "https://jaakkola.xyz";

let ses: SESClient | null = null;
function getSes(): SESClient | null {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return null;
  }
  if (!ses) ses = new SESClient({ region: AWS_REGION });
  return ses;
}

export function isEmailEnabled(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

// ============================================
// Bounded in-memory rate limiter
// ============================================

const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_MAX = 3;
const RL_MAX_KEYS = 2048;
const rateLimitMap = new Map<string, number[]>();

function pruneExpiredRateLimitKeys(now: number): void {
  rateLimitMap.forEach((timestamps, key) => {
    const recent = timestamps.filter((timestamp) => now - timestamp < RL_WINDOW_MS);
    if (recent.length) rateLimitMap.set(key, recent);
    else rateLimitMap.delete(key);
  });
}

export function checkRateLimit(
  rawKey: string,
  maxAttempts = RL_MAX,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const key = rawKey.slice(0, 512);
  const arr = (rateLimitMap.get(key) ?? []).filter(
    (timestamp) => now - timestamp < RL_WINDOW_MS,
  );
  if (arr.length >= maxAttempts) {
    return {
      ok: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((RL_WINDOW_MS - (now - arr[0])) / 1000),
      ),
    };
  }

  if (!rateLimitMap.has(key) && rateLimitMap.size >= RL_MAX_KEYS) {
    pruneExpiredRateLimitKeys(now);
    while (rateLimitMap.size >= RL_MAX_KEYS) {
      const oldestKey = rateLimitMap.keys().next().value;
      if (typeof oldestKey !== "string") break;
      rateLimitMap.delete(oldestKey);
    }
  }
  rateLimitMap.set(key, [...arr, now]);
  return { ok: true, retryAfterSec: 0 };
}

export function rateLimitEntryCount(): number {
  return rateLimitMap.size;
}

// ============================================
// Token generation / hashing
// ============================================

export function generateToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  const hash = sha256(raw);
  return { raw, hash };
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// ============================================
// Persistence helpers
// ============================================

export async function recordEmailToken(opts: {
  email: string;
  tokenHash: string;
  purpose: "magic_link" | "unsubscribe";
  ttlMs: number;
}): Promise<{ id: string }> {
  const id = newId("tok");
  await ateneumDb.insert(ateneumEmailTokens).values({
    id,
    email: opts.email.toLowerCase().trim(),
    tokenHash: opts.tokenHash,
    purpose: opts.purpose,
    expiresAt: new Date(Date.now() + opts.ttlMs),
  });
  return { id };
}

export async function consumeToken(opts: {
  rawToken: string;
  purpose: "magic_link" | "unsubscribe";
}): Promise<{ email: string } | null> {
  const hash = sha256(opts.rawToken);
  const consumed = await ateneumDb
    .update(ateneumEmailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(ateneumEmailTokens.tokenHash, hash),
        eq(ateneumEmailTokens.purpose, opts.purpose),
        isNull(ateneumEmailTokens.usedAt),
        gt(ateneumEmailTokens.expiresAt, new Date()),
      ),
    )
    .returning({ email: ateneumEmailTokens.email });
  return consumed[0] ?? null;
}

async function logEmail(opts: {
  toEmail: string;
  subject: string;
  kind: string;
  meta?: Record<string, unknown>;
  result: "sent" | "skipped" | "error";
  error?: string;
}): Promise<void> {
  try {
    await ateneumDb.insert(ateneumEmailLog).values({
      id: newId("log"),
      toEmail: opts.toEmail,
      subject: opts.subject,
      kind: opts.kind,
      meta: JSON.stringify({ ...(opts.meta ?? {}), result: opts.result, error: opts.error ?? null }),
    });
  } catch (e) {
    console.error("[ateneum-email] failed to log email:", e);
  }
}

export async function getNotificationPrefs(userId: string): Promise<{
  weeklySuggestion: boolean;
  wishAdded: boolean;
  wishFulfilled: boolean;
  activityPlanned: boolean;
  inactivityReminder: boolean;
}> {
  const rows = await ateneumDb
    .select()
    .from(ateneumNotificationPrefs)
    .where(eq(ateneumNotificationPrefs.userId, userId))
    .limit(1);
  const p = rows[0];
  return {
    weeklySuggestion: p ? Boolean(p.weeklySuggestion) : true,
    wishAdded: p ? Boolean(p.wishAdded) : true,
    wishFulfilled: p ? Boolean(p.wishFulfilled) : true,
    activityPlanned: p ? Boolean(p.activityPlanned) : true,
    inactivityReminder: p ? Boolean(p.inactivityReminder) : true,
  };
}

export async function shouldNotify(
  userId: string,
  kind:
    | "weekly_suggestion"
    | "wish_added"
    | "wish_fulfilled"
    | "activity_planned"
    | "inactivity_reminder"
    | "custom_message",
): Promise<boolean> {
  // custom_message bypasses individual category prefs unless the recipient
  // has globally unsubscribed by disabling every notification preference.
  if (kind === "custom_message") {
    const prefs = await getNotificationPrefs(userId);
    // If the user has globally unsubscribed (all flags off), respect it.
    const anyOn =
      prefs.weeklySuggestion ||
      prefs.wishAdded ||
      prefs.wishFulfilled ||
      prefs.activityPlanned ||
      prefs.inactivityReminder;
    return anyOn;
  }
  const prefs = await getNotificationPrefs(userId);
  switch (kind) {
    case "weekly_suggestion":
      return prefs.weeklySuggestion;
    case "wish_added":
      return prefs.wishAdded;
    case "wish_fulfilled":
      return prefs.wishFulfilled;
    case "activity_planned":
      return prefs.activityPlanned;
    case "inactivity_reminder":
      return prefs.inactivityReminder;
  }
}

// ============================================
// HTML helpers
// ============================================

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}

function layout(opts: { title: string; body: string; unsubscribeUrl?: string }): string {
  const unsub = opts.unsubscribeUrl
    ? `<p style="font-size: 11px; color: #999; margin-top: 32px; text-align: center;">
         <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color: #999;">Lopeta ilmoitukset</a>
       </p>`
    : "";
  return `<!DOCTYPE html>
<html lang="fi"><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #fafaf7; padding: 24px; color: #1a1a1a;">
<div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e8e8e4; border-radius: 8px; padding: 28px;">
  <div style="font-size: 13px; color: #0a6e3a; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px;">Ateneum</div>
  ${opts.body}
  ${unsub}
</div>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<div style="margin: 20px 0;">
    <a href="${escapeHtml(href)}" style="display: inline-block; background: #0a6e3a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px;">${escapeHtml(label)}</a>
  </div>`;
}

async function buildUnsubscribeUrl(user: AteneumUser): Promise<string> {
  const { raw, hash } = generateToken();
  await recordEmailToken({
    email: user.email,
    tokenHash: hash,
    purpose: "unsubscribe",
    ttlMs: 30 * 24 * 60 * 60 * 1000,
  });
  return `${PUBLIC_URL}/api/ateneum/auth/unsubscribe?token=${raw}`;
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  kind: string;
  meta?: Record<string, unknown>;
}): Promise<{ sent: boolean; error?: string }> {
  const client = getSes();
  if (!client) {
    console.warn(`[ateneum-email] AWS credentials missing, skipping ${opts.kind}`);
    await logEmail({ ...opts, toEmail: opts.to, result: "skipped", error: "AWS credentials missing" });
    return { sent: false, error: "AWS credentials missing" };
  }
  // SES SendEmail vaatii sekä Text- että Html-bodyn — generoidaan tekstiversio HTML:stä
  const textBody = opts.html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  try {
    const r = await client.send(new SendEmailCommand({
      Source: FROM_ADDRESS,
      Destination: { ToAddresses: [opts.to] },
      Message: {
        Subject: { Data: opts.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: opts.html, Charset: "UTF-8" },
          Text: { Data: textBody, Charset: "UTF-8" },
        },
      },
      ReplyToAddresses: [FROM_ADDRESS],
    }));
    await logEmail({
      ...opts,
      toEmail: opts.to,
      result: "sent",
      meta: { ...(opts.meta ?? {}), sesMessageId: r.MessageId ?? null },
    });
    return { sent: true };
  } catch (e: any) {
    console.error(`[ateneum-email] ${opts.kind} send threw:`, e?.name, e?.message);
    await logEmail({
      ...opts,
      toEmail: opts.to,
      result: "error",
      error: e?.message ?? String(e),
    });
    return { sent: false, error: e?.message ?? String(e) };
  }
}

// ============================================
// Public senders
// ============================================

export async function sendMagicLink(opts: {
  email: string;
  displayName?: string;
  rawToken: string;
}): Promise<{ sent: boolean; error?: string }> {
  const link = `${PUBLIC_URL}/ateneum/#magic=${encodeURIComponent(opts.rawToken)}`;
  const body = `
    <p>Hei${opts.displayName ? ` ${escapeHtml(opts.displayName)}` : ""},</p>
    <p>Avaa Ateneum klikkaamalla alla olevaa nappia. Linkki on voimassa 15 minuuttia.</p>
    ${button(link, "Avaa Ateneum")}
    <p style="font-size: 13px; color: #777;">Jos nappi ei toimi, kopioi tämä linkki selaimeen:<br>
      <span style="word-break: break-all; color: #0a6e3a;">${escapeHtml(link)}</span></p>
  `;
  return sendEmail({
    to: opts.email,
    subject: "Kirjaudu Ateneumiin",
    html: layout({ title: "Kirjaudu Ateneumiin", body }),
    kind: "magic_link",
    meta: { email: opts.email },
  });
}

export async function sendWeeklySuggestion(opts: {
  user: AteneumUser;
  suggestion: AteneumIdea | null;
  alternates?: AteneumIdea[];
  weekKey: string;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!(await shouldNotify(opts.user.id, "weekly_suggestion"))) {
    return { sent: false, skipped: true };
  }
  const altList = (opts.alternates ?? [])
    .filter((a) => a.id !== opts.suggestion?.id)
    .slice(0, 5)
    .map(
      (a) =>
        `<li style="margin: 4px 0;"><strong>${escapeHtml(a.title)}</strong> — ${escapeHtml(a.description.slice(0, 80))}${a.description.length > 80 ? "…" : ""}</li>`,
    )
    .join("");

  const main = opts.suggestion
    ? `
      <p>Tämän viikon ehdotus teille:</p>
      <div style="background: #e9f4ec; border-radius: 6px; padding: 16px; margin: 16px 0;">
        <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">${escapeHtml(opts.suggestion.title)}</div>
        <div style="color: #444; font-size: 14px;">${escapeHtml(opts.suggestion.description)}</div>
      </div>`
    : `<p>Ei uutta ehdotusta juuri nyt — avaa Ateneum ja tutki ideoita.</p>`;

  const body = `
    <p>Hei ${escapeHtml(opts.user.displayName)},</p>
    ${main}
    ${altList ? `<p style="font-size: 13px; color: #555;">Vaihtoehtoja:</p><ul style="font-size: 13px; color: #444; padding-left: 20px;">${altList}</ul>` : ""}
    ${button(`${PUBLIC_URL}/ateneum/`, "Avaa Ateneum")}
    <p style="font-size: 13px; color: #777;">Ihanaa viikon alkua! 💚</p>
  `;

  const unsub = await buildUnsubscribeUrl(opts.user);
  return sendEmail({
    to: opts.user.email,
    subject: `Ateneum — viikon ehdotus: ${opts.suggestion?.title ?? "uusi viikko"}`,
    html: layout({ title: "Viikon ehdotus", body, unsubscribeUrl: unsub }),
    kind: "weekly_suggestion",
    meta: {
      userId: opts.user.id,
      ideaId: opts.suggestion?.id ?? null,
      weekKey: opts.weekKey,
    },
  });
}

export async function sendWishAdded(opts: {
  toUser: AteneumUser;
  fromUser: AteneumUser;
  wish: AteneumWish;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!(await shouldNotify(opts.toUser.id, "wish_added"))) {
    return { sent: false, skipped: true };
  }
  const moodLabels: Record<string, string> = {
    longing: "kaipaava",
    playful: "leikkisä",
    tender: "hellä",
    restless: "levoton",
    grateful: "kiitollinen",
  };
  const mood = moodLabels[opts.wish.mood] ?? opts.wish.mood;
  const body = `
    <p>Hei ${escapeHtml(opts.toUser.displayName)},</p>
    <p><strong>${escapeHtml(opts.fromUser.displayName)}</strong> lisäsi uuden toiveen (${mood}):</p>
    <blockquote style="border-left: 3px solid #0a6e3a; margin: 16px 0; padding: 8px 16px; color: #444; font-style: italic;">
      ${escapeHtml(opts.wish.body)}
    </blockquote>
    ${button(`${PUBLIC_URL}/ateneum/?view=wishes`, "Katso toiveet")}
  `;
  const unsub = await buildUnsubscribeUrl(opts.toUser);
  return sendEmail({
    to: opts.toUser.email,
    subject: `${opts.fromUser.displayName} lisäsi toiveen`,
    html: layout({ title: "Uusi toive", body, unsubscribeUrl: unsub }),
    kind: "wish_added",
    meta: { wishId: opts.wish.id, fromUserId: opts.fromUser.id },
  });
}

export async function sendWishFulfilled(opts: {
  toUser: AteneumUser;
  wish: AteneumWish;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!(await shouldNotify(opts.toUser.id, "wish_fulfilled"))) {
    return { sent: false, skipped: true };
  }
  const body = `
    <p>Hei ${escapeHtml(opts.toUser.displayName)},</p>
    <p>Toiveesi on merkitty toteutuneeksi! 🎉</p>
    <blockquote style="border-left: 3px solid #0a6e3a; margin: 16px 0; padding: 8px 16px; color: #444; font-style: italic;">
      ${escapeHtml(opts.wish.body)}
    </blockquote>
    ${button(`${PUBLIC_URL}/ateneum/?view=wishes`, "Avaa Ateneum")}
    <p style="font-size: 13px; color: #777;">Toivottavasti se toi iloa. 💚</p>
  `;
  const unsub = await buildUnsubscribeUrl(opts.toUser);
  return sendEmail({
    to: opts.toUser.email,
    subject: "Toiveesi toteutui 💚",
    html: layout({ title: "Toive toteutui", body, unsubscribeUrl: unsub }),
    kind: "wish_fulfilled",
    meta: { wishId: opts.wish.id },
  });
}

export async function sendActivityPlanned(opts: {
  toUser: AteneumUser;
  fromUser: AteneumUser;
  activity: AteneumActivity;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!(await shouldNotify(opts.toUser.id, "activity_planned"))) {
    return { sent: false, skipped: true };
  }
  const when = opts.activity.scheduledFor instanceof Date
    ? opts.activity.scheduledFor
    : new Date(opts.activity.scheduledFor as any);
  const whenStr = when.toLocaleString("fi-FI", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const hours = Math.floor(opts.activity.durationMin / 60);
  const minutes = opts.activity.durationMin % 60;
  const dur = hours > 0
    ? `${hours} h${minutes > 0 ? ` ${minutes} min` : ""}`
    : `${minutes} min`;
  const body = `
    <p>Hei ${escapeHtml(opts.toUser.displayName)},</p>
    <p><strong>${escapeHtml(opts.fromUser.displayName)}</strong> ehdotti yhteistä aikaa:</p>
    <div style="background: #e9f4ec; border-radius: 6px; padding: 16px; margin: 16px 0;">
      <div style="font-size: 16px; font-weight: 600;">${escapeHtml(opts.activity.title)}</div>
      <div style="font-size: 14px; color: #555; margin-top: 4px;">${escapeHtml(whenStr)} · ${dur}</div>
    </div>
    <p>Aikaehdotuksesta tulee yhteinen suunnitelma vasta, kun hyväksyt saman version Ateneumissa.</p>
    ${button(`${PUBLIC_URL}/ateneum/activity.html?id=${encodeURIComponent(opts.activity.id)}`, "Katso aikaehdotus")}
  `;
  const unsub = await buildUnsubscribeUrl(opts.toUser);
  return sendEmail({
    to: opts.toUser.email,
    subject: `Aikaehdotus: ${opts.activity.title}`,
    html: layout({ title: "Uusi aikaehdotus", body, unsubscribeUrl: unsub }),
    kind: "activity_planned",
    meta: { activityId: opts.activity.id, fromUserId: opts.fromUser.id },
  });
}

export async function sendInactivityReminder(opts: {
  user: AteneumUser;
  daysSinceLastActivity: number;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  if (!(await shouldNotify(opts.user.id, "inactivity_reminder"))) {
    return { sent: false, skipped: true };
  }
  const body = `
    <p>Hei ${escapeHtml(opts.user.displayName)},</p>
    <p>Ateneum on ollut hiljaa — edellisestä aktiviteetista on ${opts.daysSinceLastActivity} päivää.</p>
    <p>Ehkä kiva viikonloppu-idea piristäisi arkea?</p>
    ${button(`${PUBLIC_URL}/ateneum/?view=home`, "Avaa Ateneum")}
  `;
  const unsub = await buildUnsubscribeUrl(opts.user);
  return sendEmail({
    to: opts.user.email,
    subject: "Ateneum kaipaa teitä 💚",
    html: layout({ title: "Inaktiivisuusmuistutus", body, unsubscribeUrl: unsub }),
    kind: "inactivity_reminder",
    meta: { daysSinceLastActivity: opts.daysSinceLastActivity },
  });
}

/**
 * Send a custom (ad-hoc) message to an Ateneum user's resolved email address.
 *
 * Used by the /api/ateneum/notifications endpoint after role, scope, recipient
 * allowlist and rate-limit checks. The function:
 *   1. Sends via SES using the standard SendEmailCommand (same path as all
 *      other senders, so SES-template + bounce/complaint handling stays
 *      consistent).
 *   2. Logs the send to ateneum_email_log with kind="custom_message" and
 *      meta containing fromUserId so audit trail is clear.
 *   3. Returns the SES MessageId on success.
 *
 * `toEmail` is the literal recipient email (no DB lookup is performed by
 * this function — caller is responsible for resolving the address).
 */
export async function sendCustomMessage(
  toEmail: string,
  subject: string,
  htmlBody: string,
  opts: { fromUserId?: string | null } = {},
): Promise<{ ok: boolean; sent: boolean; messageId?: string; error?: string }> {
  const client = getSes();
  if (!client) {
    const errMsg = "AWS credentials missing";
    console.warn(`[ateneum-email] custom_message skipped (${errMsg})`);
    await logEmail({
      toEmail,
      subject,
      kind: "custom_message",
      result: "skipped",
      error: errMsg,
      meta: { fromUserId: opts.fromUserId ?? null },
    });
    return { ok: false, sent: false, error: errMsg };
  }
  // SES SendEmail requires both Text and Html bodies.
  const textBody = htmlBody
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  try {
    const r = await client.send(
      new SendEmailCommand({
        Source: FROM_ADDRESS,
        Destination: { ToAddresses: [toEmail] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: htmlBody, Charset: "UTF-8" },
            Text: { Data: textBody, Charset: "UTF-8" },
          },
        },
        ReplyToAddresses: [FROM_ADDRESS],
      }),
    );
    await logEmail({
      toEmail,
      subject,
      kind: "custom_message",
      result: "sent",
      meta: {
        fromUserId: opts.fromUserId ?? null,
        sesMessageId: r.MessageId ?? null,
      },
    });
    return { ok: true, sent: true, messageId: r.MessageId ?? undefined };
  } catch (e: any) {
    console.error("[ateneum-email] custom_message threw:", e?.name, e?.message);
    await logEmail({
      toEmail,
      subject,
      kind: "custom_message",
      result: "error",
      error: e?.message ?? String(e),
      meta: { fromUserId: opts.fromUserId ?? null },
    });
    return { ok: false, sent: false, error: e?.message ?? String(e) };
  }
}

// ============================================
// Idempotency helpers (used by cron + endpoint)
// ============================================

export function isoWeekKey(d: Date = new Date()): string {
  const dayNum = d.getDay() === 0 ? 7 : d.getDay();
  const copy = new Date(d);
  copy.setDate(copy.getDate() + 4 - dayNum);
  const yearStart = new Date(copy.getFullYear(), 0, 1);
  const weekNo = Math.ceil(
    ((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${copy.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function claimWeeklyEmail(opts: {
  toEmail: string;
  kind: string;
  weekKey: string;
}): boolean {
  const result = ateneumRawDb
    .prepare(
      `INSERT OR IGNORE INTO ateneum_email_claims
        (id, to_email, kind, week_key, status)
       VALUES (?, ?, ?, ?, 'claimed')`,
    )
    .run(
      newId("emc"),
      opts.toEmail.toLowerCase().trim(),
      opts.kind,
      opts.weekKey,
    );
  return result.changes === 1;
}

export function finishWeeklyEmailClaim(opts: {
  toEmail: string;
  kind: string;
  weekKey: string;
  status: "sent" | "failed";
  error?: string;
}): void {
  ateneumRawDb
    .prepare(
      `UPDATE ateneum_email_claims
       SET status = ?, completed_at = unixepoch(), error = ?
       WHERE to_email = ? AND kind = ? AND week_key = ? AND status = 'claimed'`,
    )
    .run(
      opts.status,
      opts.error?.slice(0, 1000) ?? null,
      opts.toEmail.toLowerCase().trim(),
      opts.kind,
      opts.weekKey,
    );
}

export async function alreadySentThisWeek(opts: {
  toEmail: string;
  kind: string;
  isoWeekKey?: string;
}): Promise<boolean> {
  const weekKey = opts.isoWeekKey ?? isoWeekKey();
  const row = ateneumRawDb
    .prepare(
      `SELECT 1 FROM ateneum_email_claims
       WHERE to_email = ? AND kind = ? AND week_key = ?
       LIMIT 1`,
    )
    .get(opts.toEmail.toLowerCase().trim(), opts.kind, weekKey);
  return Boolean(row);
}
