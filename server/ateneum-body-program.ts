/**
 * Build a short weekly body-practice proposal as mutual activities + email payload.
 */
import { ateneumRawDb, newId } from "./ateneum-db";
import {
  BODY_PRACTICE_LIBRARY,
  libraryByKind,
  pickRotated,
  type BodyLibraryItem,
  type BodyPracticeKind,
} from "./ateneum-body-library";
import { isoWeekKey } from "./ateneum-email";

export type ProposedBodySlot = {
  activityId: string;
  libraryId: string;
  kind: BodyPracticeKind;
  title: string;
  instructions: string;
  durationMin: number;
  scheduledFor: Date;
};

export type BodyProgramProposeResult = {
  weekKey: string;
  slots: ProposedBodySlot[];
  reused: boolean;
};

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function atLocal(day: Date, hour: number, minute: number): Date {
  const x = new Date(day);
  x.setHours(hour, minute, 0, 0);
  return x;
}

/** Next Monday 00:00 local (or this Monday if today is Monday and before evening). */
export function weekAnchor(from: Date = new Date()): Date {
  const day = startOfLocalDay(from);
  const dow = day.getDay(); // 0 Sun .. 6 Sat
  const offsetToMonday = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  // If we're past Thursday evening, prefer next week for a fresh block
  if (dow === 0 || (dow >= 5 && from.getHours() >= 12)) {
    const next = new Date(day);
    next.setDate(day.getDate() + (dow === 0 ? 1 : 8 - dow));
    return next;
  }
  if (offsetToMonday === 0) return day;
  const next = new Date(day);
  next.setDate(day.getDate() + offsetToMonday);
  return next;
}

type SlotPlan = {
  item: BodyLibraryItem;
  dayOffset: number;
  hour: number;
  minute: number;
};

/**
 * Default week shape (P0, no survey):
 *  - Mon 17:30 training
 *  - Tue 20:00 recovery
 *  - Thu 17:30 training
 *  - Sat 10:00 recovery
 * connection omitted unless includeConnection
 */
export function planBodyWeek(opts: {
  weekKey: string;
  includeConnection?: boolean;
  trainingCount?: number;
  recoveryCount?: number;
}): SlotPlan[] {
  const trainingCount = opts.trainingCount ?? 2;
  const recoveryCount = opts.recoveryCount ?? 2;
  const trainings = pickRotated(
    libraryByKind("training").filter((t) => t.id !== "train-short-hiit"),
    opts.weekKey,
    "training",
    trainingCount,
  );
  const recoveries = pickRotated(
    libraryByKind("recovery"),
    opts.weekKey,
    "recovery",
    recoveryCount,
  );

  const plans: SlotPlan[] = [];
  const trainingSlots = [
    { dayOffset: 0, hour: 17, minute: 30 },
    { dayOffset: 3, hour: 17, minute: 30 },
    { dayOffset: 5, hour: 11, minute: 0 },
  ];
  const recoverySlots = [
    { dayOffset: 1, hour: 20, minute: 0 },
    { dayOffset: 5, hour: 10, minute: 0 },
    { dayOffset: 2, hour: 20, minute: 30 },
  ];

  trainings.forEach((item, i) => {
    const slot = trainingSlots[i] ?? trainingSlots[trainingSlots.length - 1]!;
    plans.push({ item, ...slot });
  });
  recoveries.forEach((item, i) => {
    const slot = recoverySlots[i] ?? recoverySlots[recoverySlots.length - 1]!;
    plans.push({ item, ...slot });
  });

  if (opts.includeConnection) {
    const conn = pickRotated(libraryByKind("connection"), opts.weekKey, "connection", 1)[0];
    if (conn) {
      plans.push({ item: conn, dayOffset: 4, hour: 21, minute: 0 });
    }
  }

  plans.sort((a, b) => a.dayOffset - b.dayOffset || a.hour - b.hour);
  return plans;
}

function detailsJson(item: BodyLibraryItem, weekKey: string): string {
  return JSON.stringify({
    source: "body_practice_library",
    libraryId: item.id,
    kind: item.kind,
    instructions: item.instructions,
    weekKey,
    place: item.place,
    energy: item.energy,
    tags: item.tags,
  });
}

/**
 * Create mutual activities for the week. Idempotent per weekKey via email_claims-like marker table
 * using activities notes/details scan — simpler: store claim in ateneum_email_claims kind body_practice_program.
 */
export function proposeBodyPracticeWeek(opts: {
  proposerUserId: string;
  weekKey?: string;
  includeConnection?: boolean;
  force?: boolean;
}): BodyProgramProposeResult {
  const weekKey = opts.weekKey ?? isoWeekKey();
  const claimKind = "body_practice_program";

  if (!opts.force) {
    const existing = ateneumRawDb
      .prepare(
        `SELECT 1 FROM ateneum_email_claims
         WHERE kind = ? AND week_key = ? AND status IN ('claimed','sent')
         LIMIT 1`,
      )
      .get(claimKind, weekKey);
    if (existing) {
      const rows = ateneumRawDb
        .prepare(
          `SELECT id, title, scheduled_for AS scheduledFor, duration_min AS durationMin, details
           FROM ateneum_activities
           WHERE details LIKE ?
           ORDER BY scheduled_for ASC`,
        )
        .all(`%"weekKey":"${weekKey}"%`) as Array<{
        id: string;
        title: string;
        scheduledFor: number;
        durationMin: number;
        details: string | null;
      }>;
      const slots: ProposedBodySlot[] = rows.map((row) => {
        let parsed: any = {};
        try {
          parsed = row.details ? JSON.parse(row.details) : {};
        } catch {
          parsed = {};
        }
        return {
          activityId: row.id,
          libraryId: parsed.libraryId ?? "",
          kind: (parsed.kind as BodyPracticeKind) ?? "training",
          title: row.title,
          instructions: parsed.instructions ?? "",
          durationMin: row.durationMin,
          scheduledFor: new Date(row.scheduledFor * 1000),
        };
      });
      return { weekKey, slots, reused: true };
    }
  }

  const anchor = weekAnchor();
  const plans = planBodyWeek({
    weekKey,
    includeConnection: opts.includeConnection,
  });

  const slots: ProposedBodySlot[] = [];
  const insert = ateneumRawDb.transaction(() => {
    // Mark week claimed so concurrent proposes don't double-create
    const claim = ateneumRawDb
      .prepare(
        `INSERT OR IGNORE INTO ateneum_email_claims
          (id, to_email, kind, week_key, status)
         VALUES (?, ?, ?, ?, 'claimed')`,
      )
      .run(newId("emc"), `program:${weekKey}`, claimKind, weekKey);
    if (claim.changes !== 1 && !opts.force) {
      return;
    }

    for (const plan of plans) {
      const id = newId("act");
      const when = atLocal(
        new Date(anchor.getTime() + plan.dayOffset * 86_400_000),
        plan.hour,
        plan.minute,
      );
      const details = detailsJson(plan.item, weekKey);
      ateneumRawDb
        .prepare(
          `INSERT INTO ateneum_activities
            (id, idea_id, title, scheduled_for, duration_min, status, rating, notes, details,
             created_by, planning_mode, version, proposed_by, updated_by, updated_at)
           VALUES (?, NULL, ?, ?, ?, 'planned', NULL, ?, ?, ?, 'mutual', 1, ?, ?, unixepoch())`,
        )
        .run(
          id,
          plan.item.title,
          Math.floor(when.getTime() / 1000),
          plan.item.durationMin,
          `Keho & palautus · ${plan.item.kind}`,
          details,
          opts.proposerUserId,
          opts.proposerUserId,
          opts.proposerUserId,
        );
      ateneumRawDb
        .prepare(
          `INSERT INTO ateneum_activity_acceptances
            (activity_id, user_id, version, accepted_at)
           VALUES (?, ?, 1, unixepoch())`,
        )
        .run(id, opts.proposerUserId);

      slots.push({
        activityId: id,
        libraryId: plan.item.id,
        kind: plan.item.kind,
        title: plan.item.title,
        instructions: plan.item.instructions,
        durationMin: plan.item.durationMin,
        scheduledFor: when,
      });
    }

    ateneumRawDb
      .prepare(
        `UPDATE ateneum_email_claims
         SET status = 'sent', completed_at = unixepoch()
         WHERE kind = ? AND week_key = ? AND to_email = ?`,
      )
      .run(claimKind, weekKey, `program:${weekKey}`);
  });
  insert();

  if (slots.length === 0) {
    const rows = ateneumRawDb
      .prepare(
        `SELECT id, title, scheduled_for AS scheduledFor, duration_min AS durationMin, details
         FROM ateneum_activities
         WHERE details LIKE ?
         ORDER BY scheduled_for ASC`,
      )
      .all(`%"weekKey":"${weekKey}"%`) as Array<{
      id: string;
      title: string;
      scheduledFor: number;
      durationMin: number;
      details: string | null;
    }>;
    return {
      weekKey,
      reused: true,
      slots: rows.map((row) => {
        let parsed: any = {};
        try {
          parsed = row.details ? JSON.parse(row.details) : {};
        } catch {
          parsed = {};
        }
        return {
          activityId: row.id,
          libraryId: parsed.libraryId ?? "",
          kind: (parsed.kind as BodyPracticeKind) ?? "training",
          title: row.title,
          instructions: parsed.instructions ?? "",
          durationMin: row.durationMin,
          scheduledFor: new Date(row.scheduledFor * 1000),
        };
      }),
    };
  }

  return { weekKey, slots, reused: false };
}

export function listBodyLibrary() {
  return BODY_PRACTICE_LIBRARY.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    instructions: item.instructions,
    durationMin: item.durationMin,
    energy: item.energy,
    place: item.place,
    tags: item.tags,
  }));
}
