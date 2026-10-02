import type { NextFunction, Request, RequestHandler, Response } from "express";
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

export function buildContactEmail(input: ContactInput, config: { from: string; to: string }): ContactEmail {
  // Subjects must be single-line: a CR/LF in user input could inject headers.
  const oneLine = (value: string) => value.replace(LINE_BREAKS, " ").trim();
  const subject = `Uusi yhteydenotto: ${oneLine(input.name)} (${oneLine(input.company) || "ei yritystä"})`.slice(0, 150);
  const budget = input.budget ? input.budget : "-";
  const company = input.company || "-";
  return {
    from: config.from,
    to: config.to,
    replyTo: input.email,
    subject,
    text: `Uusi yhteydenotto jaakkola.xyz:stä\n\nNimi: ${input.name}\nSähköposti: ${input.email}\nYritys: ${company}\nBudjetti: ${budget}\n\nViesti:\n${input.message}\n`,
    html: `
      <h2>Uusi yhteydenotto jaakkola.xyz:stä</h2>
      <p><strong>Nimi:</strong> ${escapeHtml(input.name)}</p>
      <p><strong>Sähköposti:</strong> ${escapeHtml(input.email)}</p>
      <p><strong>Yritys:</strong> ${escapeHtml(company)}</p>
      <p><strong>Budjetti:</strong> ${escapeHtml(budget)}</p>
      <p><strong>Viesti:</strong></p>
      <p>${escapeHtml(input.message).replace(/\r?\n/g, "<br>")}</p>
    `,
  };
}

export interface ContactDeps {
  /** Returns the row id. May throw. */
  store?: Pick<ContactStore, "save">;
  /** Sends one email. Must throw when the provider rejects it. */
  send?: (email: ContactEmail) => Promise<void>;
  emailConfig?: { from: string; to: string };
  log?: (message: string) => void;
}

export function createContactHandler(deps: ContactDeps): RequestHandler {
  const log = deps.log ?? ((message: string) => console.log(`[contact] ${message}`));
  return async (req: Request, res: Response) => {
    const parsed = contactInputSchema.safeParse(req.body);
    if (!parsed.success) {
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
        const id = deps.store.save(input);
        stored = true;
        log(`stored submission #${id}`);
      }
    } catch (error: any) {
      log(`storing failed: ${error?.message ?? error}`);
    }

    let emailed = false;
    try {
      if (deps.send && deps.emailConfig) {
        await deps.send(buildContactEmail(input, deps.emailConfig));
        emailed = true;
      }
    } catch (error: any) {
      log(`email failed: ${error?.message ?? error}`);
    }

    if (!stored && !emailed) {
      log("submission lost: neither storage nor email worked");
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
    save(input) {
      store ??= openContactStore();
      return store.save(input);
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
