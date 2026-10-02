/**
 * Google Calendar write path for mutual activities.
 * Server-side OAuth refresh token only — no per-user login UI in P0.
 *
 * Env:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   ATENEUM_GOOGLE_CALENDAR_ID
 * Optional:
 *   ATENEUM_PUBLIC_URL (link in description)
 *   ATENEUM_CALENDAR_TIME_ZONE (default Europe/Helsinki)
 *   ATENEUM_CALENDAR_BACKEND=memory|google|off
 *     (default: google when creds present, otherwise off)
 */
import { ateneumRawDb } from "./ateneum-db";

export type CalendarActivityInput = {
  id: string;
  title: string;
  scheduledFor: Date | string | number;
  durationMin: number;
  notes?: string | null;
  details?: string | null;
  googleEventId?: string | null;
  version?: number | null;
};

export type CalendarWriteResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  eventId?: string;
  htmlLink?: string;
  error?: string;
  backend?: "google" | "memory" | "off";
};

type MemoryEvent = {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  extendedProperties?: { private?: Record<string, string> };
  htmlLink?: string;
};

const memoryStore: Map<string, MemoryEvent> = ((globalThis as any)
  .__ateneumCalendarMemory ??= new Map());

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function isCalendarConfigured(): boolean {
  return Boolean(
    env("GOOGLE_CLIENT_ID") &&
      env("GOOGLE_CLIENT_SECRET") &&
      env("GOOGLE_REFRESH_TOKEN") &&
      env("ATENEUM_GOOGLE_CALENDAR_ID"),
  );
}

export function getCalendarBackend(): "google" | "memory" | "off" {
  const forced = env("ATENEUM_CALENDAR_BACKEND").toLowerCase();
  if (forced === "memory") return "memory";
  if (forced === "off") return "off";
  if (forced === "google") return isCalendarConfigured() ? "google" : "off";
  return isCalendarConfigured() ? "google" : "off";
}

export function isCalendarEnabled(): boolean {
  return getCalendarBackend() !== "off";
}

export function __resetCalendarMemoryForTests(): void {
  memoryStore.clear();
  cachedAccessToken = null;
}

export function __getCalendarMemoryForTests(): Map<string, MemoryEvent> {
  return memoryStore;
}

function publicUrl(): string {
  return env("ATENEUM_PUBLIC_URL") || "https://jaakkola.xyz";
}

function timeZone(): string {
  return env("ATENEUM_CALENDAR_TIME_ZONE") || "Europe/Helsinki";
}

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  return new Date(value);
}

function detailsText(details: string | null | undefined): string {
  if (!details) return "";
  try {
    const parsed = JSON.parse(details);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      if (typeof (parsed as any).instructions === "string") {
        return (parsed as any).instructions;
      }
      if (typeof (parsed as any).ohje === "string") {
        return (parsed as any).ohje;
      }
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    return details;
  }
  return "";
}

function buildEventBody(activity: CalendarActivityInput) {
  const start = toDate(activity.scheduledFor);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid scheduledFor");
  }
  const end = new Date(
    start.getTime() + Math.max(1, Number(activity.durationMin) || 60) * 60_000,
  );
  const link = `${publicUrl()}/ateneum/activity.html?id=${encodeURIComponent(activity.id)}`;
  const parts = [
    detailsText(activity.details ?? null),
    activity.notes?.trim() ? `Muistiinpanot: ${activity.notes.trim()}` : "",
    `Ateneum: ${link}`,
  ].filter(Boolean);
  const description = parts.join("\n\n");
  const tz = timeZone();
  return {
    summary: activity.title,
    description,
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    extendedProperties: {
      private: {
        ateneumActivityId: activity.id,
        ateneumVersion: String(activity.version ?? ""),
      },
    },
    source: { title: "Ateneum", url: link },
  };
}

async function refreshAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > now + 30_000) {
    return cachedAccessToken.token;
  }
  const body = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    client_secret: env("GOOGLE_CLIENT_SECRET"),
    refresh_token: env("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Google token refresh failed: ${json.error || res.status} ${json.error_description || ""}`.trim(),
    );
  }
  cachedAccessToken = {
    token: json.access_token,
    expiresAtMs: now + Math.max(60, Number(json.expires_in ?? 3600)) * 1000,
  };
  return json.access_token;
}

function calendarId(): string {
  return env("ATENEUM_GOOGLE_CALENDAR_ID");
}

async function googleFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await refreshAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message =
      json?.error?.message || json?.error_description || text || `HTTP ${res.status}`;
    throw new Error(`Google Calendar API ${res.status}: ${message}`);
  }
  return json;
}

function persistGoogleEventId(activityId: string, eventId: string | null): void {
  ateneumRawDb
    .prepare(`UPDATE ateneum_activities SET google_event_id = ? WHERE id = ?`)
    .run(eventId, activityId);
}

async function memoryUpsert(activity: CalendarActivityInput): Promise<CalendarWriteResult> {
  const body = buildEventBody(activity);
  const existingId = activity.googleEventId?.trim() || "";
  const id = existingId || `mem_${activity.id}`;
  const event: MemoryEvent = {
    id,
    summary: body.summary,
    description: body.description,
    start: body.start.dateTime,
    end: body.end.dateTime,
    extendedProperties: body.extendedProperties,
    htmlLink: `memory://calendar/${id}`,
  };
  memoryStore.set(id, event);
  persistGoogleEventId(activity.id, id);
  return { ok: true, eventId: id, htmlLink: event.htmlLink, backend: "memory" };
}

async function googleUpsert(activity: CalendarActivityInput): Promise<CalendarWriteResult> {
  const body = buildEventBody(activity);
  const cal = encodeURIComponent(calendarId());
  const existingId = activity.googleEventId?.trim() || "";
  let event: any;
  if (existingId) {
    try {
      event = await googleFetch(
        `/calendars/${cal}/events/${encodeURIComponent(existingId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
    } catch (err: any) {
      if (
        String(err?.message || "").includes("404") ||
        String(err?.message || "").includes("Not Found")
      ) {
        event = await googleFetch(`/calendars/${cal}/events`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else {
        throw err;
      }
    }
  } else {
    event = await googleFetch(`/calendars/${cal}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  const eventId = String(event.id);
  persistGoogleEventId(activity.id, eventId);
  return {
    ok: true,
    eventId,
    htmlLink: event.htmlLink,
    backend: "google",
  };
}

export async function upsertActivityCalendarEvent(
  activity: CalendarActivityInput,
): Promise<CalendarWriteResult> {
  const backend = getCalendarBackend();
  if (backend === "off") {
    return { ok: true, skipped: true, reason: "calendar_disabled", backend: "off" };
  }
  try {
    if (backend === "memory") return await memoryUpsert(activity);
    return await googleUpsert(activity);
  } catch (err: any) {
    console.error("[ateneum] calendar upsert failed:", err);
    return {
      ok: false,
      error: err?.message || String(err),
      backend,
    };
  }
}

export async function removeActivityCalendarEvent(
  eventId: string | null | undefined,
): Promise<CalendarWriteResult> {
  const id = (eventId || "").trim();
  if (!id) return { ok: true, skipped: true, reason: "no_event_id" };
  const backend = getCalendarBackend();
  if (backend === "off") {
    return { ok: true, skipped: true, reason: "calendar_disabled", backend: "off" };
  }
  try {
    if (backend === "memory") {
      memoryStore.delete(id);
      return { ok: true, eventId: id, backend: "memory" };
    }
    const cal = encodeURIComponent(calendarId());
    try {
      await googleFetch(`/calendars/${cal}/events/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch (err: any) {
      if (
        !String(err?.message || "").includes("404") &&
        !String(err?.message || "").includes("Not Found")
      ) {
        throw err;
      }
    }
    return { ok: true, eventId: id, backend: "google" };
  } catch (err: any) {
    console.error("[ateneum] calendar delete failed:", err);
    return { ok: false, error: err?.message || String(err), backend };
  }
}

export async function syncActivityCalendarAfterMutualAccept(
  activityId: string,
): Promise<CalendarWriteResult> {
  const row = ateneumRawDb
    .prepare(
      `SELECT id, title, scheduled_for AS scheduledFor, duration_min AS durationMin,
              notes, details, google_event_id AS googleEventId, version
       FROM ateneum_activities WHERE id = ?`,
    )
    .get(activityId) as CalendarActivityInput | undefined;
  if (!row) {
    return { ok: false, error: "activity_not_found" };
  }
  return upsertActivityCalendarEvent(row);
}

export function clearStoredGoogleEventId(activityId: string): string | null {
  const row = ateneumRawDb
    .prepare(
      `SELECT google_event_id AS googleEventId FROM ateneum_activities WHERE id = ?`,
    )
    .get(activityId) as { googleEventId: string | null } | undefined;
  const prev = row?.googleEventId ?? null;
  if (prev) {
    persistGoogleEventId(activityId, null);
  }
  return prev;
}
