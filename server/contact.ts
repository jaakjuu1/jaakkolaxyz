import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createHmac, randomBytes } from "crypto";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { Resend } from "resend";
import { openContactStore, type ContactStore } from "./contact-db";

/**
 * Public contact form (POST /api/contact).
 *
 * Every valid submission is first written to SQLite, then emailed via Resend.
 * The request succeeds if at least one of the two worked, so a mail outage or a
 * missing key never loses a message. Nothing from the message body is logged.
 */

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(200).default(""),
  message: z.string().trim().min(1).max(5000),
  budget: z.string().trim().max(100).nullish(),
});
export type ContactInput = z.infer<typeof contactInputSchema>;

/**
 * Where a submission came from, kept for spam triage and for linking bursts to
 * one sender. The IP address itself is never stored: only a keyed hash.
 */
export interface ContactMeta {
  userAgent: string | null;
  referer: string | null;
  acceptLanguage: string | null;
  ipHash: string | null;
}

function cleanHeader(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const printable = value
    .split("")
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .trim();
  return printable ? printable.slice(0, maxLength) : null;
}

/** Keeps origin and path only: query strings can carry tokens or personal data. */
function cleanReferer(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return cleanHeader(url.origin + url.pathname, 300);
  } catch {
    return null;
  }
}

export function hashIp(ip: string | undefined, secret: string): string | null {
  if (!ip) return null;
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 16);
}

export function extractContactMeta(req: Request, secret: string): ContactMeta {
  return {
    userAgent: cleanHeader(req.get("user-agent"), 300),
    referer: cleanReferer(req.get("referer")),
    acceptLanguage: cleanHeader(req.get("accept-language"), 100),
    ipHash: hashIp(req.ip, secret),
  };
}

export interface ContactEmail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LINE_BREAKS = new RegExp("[\\r\\n\\u2028\\u2029]+", "g");

export function buildContactEmail(
  input: ContactInput,
  config: { from: string; to: string },
  meta?: ContactMeta,
): ContactEmail {
  // Subjects must be single-line: a CR/LF in user input could inject headers.
  const oneLine = (value: string) => value.replace(LINE_BREAKS, " ").trim();
  const subject = `Uusi yhteydenotto: ${oneLine(input.name)} (${oneLine(input.company) || "ei yritystä"})`.slice(0, 150);
  const budget = input.budget ? input.budget : "-";
  const company = input.company || "-";
  const source = [
    ["Selain", meta?.userAgent],
    ["Viittaaja", meta?.referer],
    ["Kieli", meta?.acceptLanguage],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  const sourceText = source.length ? `\n--\n${source.map(([k, v]) => `${k}: ${v}`).join("\n")}\n` : "";
  const sourceHtml = source.length
    ? `<hr><p style="color:#666;font-size:12px">${source.map(([k, v]) => `${k}: ${escapeHtml(v)}`).join("<br>")}</p>`
    : "";
  return {
    from: config.from,
    to: config.to,
    replyTo: input.email,
    subject,
    text: `Uusi yhteydenotto jaakkola.xyz:stä\n\nNimi: ${input.name}\nSähköposti: ${input.email}\nYritys: ${company}\nBudjetti: ${budget}\n\nViesti:\n${input.message}\n${sourceText}`,
    html: `
      <h2>Uusi yhteydenotto jaakkola.xyz:stä</h2>
      <p><strong>Nimi:</strong> ${escapeHtml(input.name)}</p>
      <p><strong>Sähköposti:</strong> ${escapeHtml(input.email)}</p>
      <p><strong>Yritys:</strong> ${escapeHtml(company)}</p>
      <p><strong>Budjetti:</strong> ${escapeHtml(budget)}</p>
      <p><strong>Viesti:</strong></p>
      <p>${escapeHtml(input.message).replace(/\r?\n/g, "<br>")}</p>
      ${sourceHtml}
    `,
  };
}

export interface ContactDeps {
  /** Returns the row id. May throw. */
  store?: Pick<ContactStore, "save">;
  /** Key for hashing client IPs. Without it a random key per process is used. */
  ipHashSecret?: string;
  /** Sends one email. Must throw when the provider rejects it. */
  send?: (email: ContactEmail) => Promise<void>;
  emailConfig?: { from: string; to: string };
  log?: (message: string) => void;
}

export function createContactHandler(deps: ContactDeps): RequestHandler {
  const log = deps.log ?? ((message: string) => console.log(`[contact] ${message}`));
  const ipHashSecret = deps.ipHashSecret ?? randomBytes(32).toString("hex");
  return async (req: Request, res: Response) => {
    const meta = extractContactMeta(req, ipHashSecret);
    const parsed = contactInputSchema.safeParse(req.body);
    if (!parsed.success) {
      log(`rejected invalid input ip=${meta.ipHash ?? "-"} ua=${(meta.userAgent ?? "-").slice(0, 120)}`);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        error: fromZodError(parsed.error).message,
      });
    }
    const input = parsed.data;

    let stored = false;
    try {
      if (deps.store) {
        const id = deps.store.save(input, meta);
        stored = true;
        log(`stored submission #${id}`);
      }
    } catch (error: any) {
      log(`storing failed: ${error?.message ?? error}`);
    }

    let emailed = false;
    try {
      if (deps.send && deps.emailConfig) {
        await deps.send(buildContactEmail(input, deps.emailConfig, meta));
        emailed = true;
      }
    } catch (error: any) {
      log(`email failed: ${error?.message ?? error}`);
    }

    if (!stored && !emailed) {
      log(`submission lost: neither storage nor email worked ip=${meta.ipHash ?? "-"} ua=${(meta.userAgent ?? "-").slice(0, 120)}`);
      return res.status(500).json({ success: false, message: "Failed to submit contact form" });
    }
    return res.status(201).json({ success: true, message: "Contact form submitted successfully" });
  };
}

export function createResendSender(apiKey: string): (email: ContactEmail) => Promise<void> {
  const resend = new Resend(apiKey);
  return async (email) => {
    // The SDK reports API failures in `error` instead of throwing.
    const { error } = await resend.emails.send({
      from: email.from,
      to: email.to,
      replyTo: email.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) throw new Error(`${error.name}: ${error.message}`);
  };
}

/** Production wiring from environment variables. */
export function createDefaultContactDeps(env: NodeJS.ProcessEnv = process.env): ContactDeps {
  let store: ContactStore | undefined;
  const lazyStore: Pick<ContactStore, "save"> = {
    save(input, meta) {
      store ??= openContactStore();
      return store.save(input, meta);
    },
  };
  const to = env.CONTACT_TO_EMAIL?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();
  const emailReady = Boolean(to && apiKey);
  if (!emailReady) {
    console.warn("[contact] email notifications are off (set RESEND_API_KEY and CONTACT_TO_EMAIL); submissions are only stored");
  }
  return {
    store: lazyStore,
    ipHashSecret: env.CONTACT_IP_HASH_SECRET?.trim() || undefined,
    send: emailReady ? createResendSender(apiKey!) : undefined,
    emailConfig: emailReady
      ? { to: to!, from: env.CONTACT_FROM_EMAIL?.trim() || "jaakkola.xyz <onboarding@resend.dev>" }
      : undefined,
  };
}

/** Small in-memory limiter per client IP (the app trusts only the loopback proxy hop). */
export function createRateLimiter(options: { windowMs: number; max: number; now?: () => number }): RequestHandler {
  const hits = new Map<string, number[]>();
  const now = options.now ?? Date.now;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || "unknown";
    const t = now();
    const recent = (hits.get(key) ?? []).filter((time) => t - time < options.windowMs);
    if (recent.length >= options.max) {
      hits.set(key, recent);
      return res.status(429).json({ success: false, message: "Too many requests, please try again later" });
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) {
      hits.forEach((times, k) => {
        if (times.every((time) => t - time >= options.windowMs)) hits.delete(k);
      });
    }
    next();
  };
}
