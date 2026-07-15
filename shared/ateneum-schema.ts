import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================
// Ateneum schema — private couple activity suggestion app
// ============================================

export const ateneumUsers = sqliteTable("ateneum_users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["partner_a", "partner_b", "bot"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumSessions = sqliteTable("ateneum_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => ateneumUsers.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumPreferences = sqliteTable("ateneum_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => ateneumUsers.id, { onDelete: "cascade" }),
  likedTags: text("liked_tags").notNull().default("[]"),
  dislikedTags: text("disliked_tags").notNull().default("[]"),
  energyLevel: text("energy_level", { enum: ["low", "medium", "high"] })
    .notNull()
    .default("medium"),
  budgetLevel: text("budget_level", { enum: ["free", "cheap", "moderate", "splurge"] })
    .notNull()
    .default("moderate"),
  socialMode: text("social_mode", { enum: ["solo", "together", "with-friends"] })
    .notNull()
    .default("together"),
  preferredDuration: integer("preferred_duration").notNull().default(120),
  weekdayEvenings: integer("weekday_evenings", { mode: "boolean" })
    .notNull()
    .default(true),
  weekendMornings: integer("weekend_mornings", { mode: "boolean" })
    .notNull()
    .default(true),
  notes: text("notes").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumIdeas = sqliteTable("ateneum_ideas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  tags: text("tags").notNull().default("[]"),
  energyCost: text("energy_cost", { enum: ["low", "medium", "high"] })
    .notNull()
    .default("medium"),
  budgetCost: text("budget_cost", { enum: ["free", "cheap", "moderate", "splurge"] })
    .notNull()
    .default("cheap"),
  socialMode: text("social_mode", { enum: ["solo", "together", "with-friends"] })
    .notNull()
    .default("together"),
  durationMin: integer("duration_min").notNull().default(90),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").references(() => ateneumUsers.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumActivities = sqliteTable("ateneum_activities", {
  id: text("id").primaryKey(),
  ideaId: text("idea_id").references(() => ateneumIdeas.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  scheduledFor: integer("scheduled_for", { mode: "timestamp" }).notNull(),
  durationMin: integer("duration_min").notNull().default(60),
  status: text("status", { enum: ["planned", "done", "skipped"] })
    .notNull()
    .default("planned"),
  rating: integer("rating"),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by")
    .notNull()
    .references(() => ateneumUsers.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  details: text("details"),
  planningMode: text("planning_mode", { enum: ["legacy", "mutual"] })
    .notNull()
    .default("legacy"),
  version: integer("version").notNull().default(1),
  proposedBy: text("proposed_by").references(() => ateneumUsers.id, {
    onDelete: "set null",
  }),
  updatedBy: text("updated_by").references(() => ateneumUsers.id, {
    onDelete: "set null",
  }),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumActivityAcceptances = sqliteTable(
  "ateneum_activity_acceptances",
  {
    activityId: text("activity_id")
      .notNull()
      .references(() => ateneumActivities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => ateneumUsers.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    activityUserUnique: uniqueIndex("idx_ateneum_activity_acceptances_activity_user").on(
      table.activityId,
      table.userId,
    ),
  }),
);

export const ateneumPlans = sqliteTable("ateneum_plans", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => ateneumUsers.id, { onDelete: "cascade" }),
  planType: text("plan_type", { enum: ["trip", "event", "project", "other"] }).notNull(),
  latestVersion: integer("latest_version").notNull().default(1),
  acceptedVersion: integer("accepted_version"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumPlanRevisions = sqliteTable(
  "ateneum_plan_revisions",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => ateneumPlans.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    summary: text("summary").notNull().default(""),
    content: text("content").notNull().default('{"sections":[]}'),
    status: text("status", {
      enum: ["draft", "proposed", "accepted", "superseded"],
    }).notNull(),
    draftedBy: text("drafted_by", { enum: ["into", "human"] }).notNull(),
    createdBy: text("created_by").references(() => ateneumUsers.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    planVersionUnique: uniqueIndex("idx_ateneum_plan_revisions_plan_version").on(
      table.planId,
      table.version,
    ),
  }),
);

export const ateneumPlanAcceptances = sqliteTable(
  "ateneum_plan_acceptances",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => ateneumPlans.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => ateneumUsers.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    planVersionUserUnique: uniqueIndex("idx_ateneum_plan_acceptances_plan_version_user").on(
      table.planId,
      table.version,
      table.userId,
    ),
  }),
);

export const ateneumPlanRequests = sqliteTable(
  "ateneum_plan_requests",
  {
    id: text("id").primaryKey(),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => ateneumUsers.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: ["idea", "activity", "plan"] }).notNull().default("idea"),
    ideaId: text("idea_id")
      .references(() => ateneumIdeas.id, { onDelete: "cascade" }),
    activityId: text("activity_id").references(() => ateneumActivities.id, {
      onDelete: "cascade",
    }),
    planId: text("plan_id").references(() => ateneumPlans.id, { onDelete: "cascade" }),
    baseVersion: integer("base_version"),
    planType: text("plan_type", { enum: ["trip", "event", "project", "other"] }).notNull(),
    brief: text("brief").notNull().default("{}"),
    status: text("status", {
      enum: ["pending", "processing", "completed", "failed"],
    }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimKey: text("claim_key").unique(),
    availableAt: integer("available_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    resultPlanId: text("result_plan_id").references(() => ateneumPlans.id, {
      onDelete: "set null",
    }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sourceCheck: check(
      "chk_ateneum_plan_requests_source",
      sql`(${table.sourceType} = 'idea' AND ${table.ideaId} IS NOT NULL AND ${table.activityId} IS NULL AND ${table.planId} IS NULL AND ${table.baseVersion} IS NULL)
        OR (${table.sourceType} = 'activity' AND ${table.activityId} IS NOT NULL AND ${table.ideaId} IS NULL AND ${table.planId} IS NULL AND ${table.baseVersion} IS NULL)
        OR (${table.sourceType} = 'plan' AND ${table.planId} IS NOT NULL AND ${table.baseVersion} >= 1 AND ${table.ideaId} IS NULL AND ${table.activityId} IS NULL)`,
    ),
    requesterIdeaUnique: uniqueIndex("idx_ateneum_plan_requests_requester_idea")
      .on(
      table.requesterUserId,
      table.ideaId,
      )
      .where(sql`${table.sourceType} = 'idea'`),
    requesterActivityUnique: uniqueIndex("idx_ateneum_plan_requests_requester_activity")
      .on(table.requesterUserId, table.activityId)
      .where(sql`${table.sourceType} = 'activity'`),
    requesterPlanVersionUnique: uniqueIndex("idx_ateneum_plan_requests_requester_plan_version")
      .on(table.requesterUserId, table.planId, table.baseVersion)
      .where(sql`${table.sourceType} = 'plan'`),
  }),
);

export const ateneumWishes = sqliteTable("ateneum_wishes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => ateneumUsers.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  mood: text("mood", { enum: ["longing", "playful", "tender", "restless", "grateful"] })
    .notNull()
    .default("tender"),
  fulfilled: integer("fulfilled", { mode: "boolean" }).notNull().default(false),
  visibility: text("visibility", { enum: ["shared", "private"] })
    .notNull()
    .default("shared"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumWeeklySuggestions = sqliteTable("ateneum_weekly_suggestions", {
  weekKey: text("week_key").primaryKey(),
  ideaId: text("idea_id")
    .notNull()
    .references(() => ateneumIdeas.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumConnectionCycles = sqliteTable("ateneum_connection_cycles", {
  cycleKey: text("cycle_key").primaryKey(),
  suggestionIds: text("suggestion_ids").notNull().default("[]"),
  committedIdeaId: text("committed_idea_id").references(() => ateneumIdeas.id, {
    onDelete: "set null",
  }),
  activityId: text("activity_id").references(() => ateneumActivities.id, {
    onDelete: "set null",
  }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumConnectionCheckIns = sqliteTable(
  "ateneum_connection_checkins",
  {
    id: text("id").primaryKey(),
    cycleKey: text("cycle_key")
      .notNull()
      .references(() => ateneumConnectionCycles.cycleKey, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => ateneumUsers.id, { onDelete: "cascade" }),
    energy: text("energy", { enum: ["low", "medium", "high"] }).notNull(),
    need: text("need", {
      enum: ["rest", "closeness", "talk", "play", "adventure", "practical_support", "space"],
    }).notNull(),
    capacityMin: integer("capacity_min").notNull(),
    togetherness: text("togetherness", { enum: ["together", "space", "flexible"] })
      .notNull(),
    note: text("note").notNull().default(""),
    noteVisibility: text("note_visibility", { enum: ["private", "shared"] })
      .notNull()
      .default("private"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    cycleUserUnique: uniqueIndex("idx_ateneum_connection_checkins_cycle_user").on(
      table.cycleKey,
      table.userId,
    ),
  }),
);

export const ateneumConnectionCommitments = sqliteTable(
  "ateneum_connection_commitments",
  {
    id: text("id").primaryKey(),
    cycleKey: text("cycle_key")
      .notNull()
      .references(() => ateneumConnectionCycles.cycleKey, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => ateneumUsers.id, { onDelete: "cascade" }),
    choice: text("choice", { enum: ["choose", "later"] }).notNull(),
    ideaId: text("idea_id").references(() => ateneumIdeas.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    cycleUserUnique: uniqueIndex("idx_ateneum_connection_commitments_cycle_user").on(
      table.cycleKey,
      table.userId,
    ),
  }),
);

export const ateneumConnectionReflections = sqliteTable(
  "ateneum_connection_reflections",
  {
    id: text("id").primaryKey(),
    cycleKey: text("cycle_key")
      .notNull()
      .references(() => ateneumConnectionCycles.cycleKey, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => ateneumUsers.id, { onDelete: "cascade" }),
    impact: text("impact", { enum: ["closer", "same", "farther"] }).notNull(),
    note: text("note").notNull().default(""),
    allowLearning: integer("allow_learning", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    cycleUserUnique: uniqueIndex("idx_ateneum_connection_reflections_cycle_user").on(
      table.cycleKey,
      table.userId,
    ),
  }),
);

// ============================================
// Magic-link and notification tables
// ============================================

export const ateneumEmailTokens = sqliteTable("ateneum_email_tokens", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  purpose: text("purpose", { enum: ["magic_link", "unsubscribe"] }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumNotificationPrefs = sqliteTable("ateneum_notification_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => ateneumUsers.id, { onDelete: "cascade" }),
  weeklySuggestion: integer("weekly_suggestion", { mode: "boolean" })
    .notNull()
    .default(true),
  wishAdded: integer("wish_added", { mode: "boolean" }).notNull().default(true),
  wishFulfilled: integer("wish_fulfilled", { mode: "boolean" })
    .notNull()
    .default(true),
  activityPlanned: integer("activity_planned", { mode: "boolean" })
    .notNull()
    .default(true),
  inactivityReminder: integer("inactivity_reminder", { mode: "boolean" })
    .notNull()
    .default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const ateneumEmailLog = sqliteTable("ateneum_email_log", {
  id: text("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  kind: text("kind").notNull(),
  sentAt: integer("sent_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  meta: text("meta"),
});

// ============================================
// API tokens — long-lived Bearer auth for scripts
// ============================================

export const ateneumApiTokens = sqliteTable("ateneum_api_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => ateneumUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scopes: text("scopes").notNull().default('["read"]'),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ============================================
// Zod insert schemas
// ============================================

export const insertAteneumUserSchema = createInsertSchema(ateneumUsers).omit({
  id: true,
  createdAt: true,
});

export const insertAteneumPreferencesSchema = createInsertSchema(
  ateneumPreferences,
).omit({
  updatedAt: true,
});

export const insertAteneumIdeaSchema = createInsertSchema(ateneumIdeas).omit({
  id: true,
  createdAt: true,
  isActive: true,
});

export const insertAteneumActivitySchema = createInsertSchema(ateneumActivities).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  planningMode: true,
  version: true,
  proposedBy: true,
  updatedBy: true,
  updatedAt: true,
});

export const insertAteneumWishSchema = createInsertSchema(ateneumWishes).omit({
  id: true,
  createdAt: true,
  fulfilled: true,
});

// ============================================
// Type exports
// ============================================

export type AteneumUser = typeof ateneumUsers.$inferSelect;
export type InsertAteneumUser = z.infer<typeof insertAteneumUserSchema>;
export type AteneumSession = typeof ateneumSessions.$inferSelect;
export type AteneumPreferences = typeof ateneumPreferences.$inferSelect;
export type InsertAteneumPreferences = z.infer<typeof insertAteneumPreferencesSchema>;
export type AteneumIdea = typeof ateneumIdeas.$inferSelect;
export type InsertAteneumIdea = z.infer<typeof insertAteneumIdeaSchema>;
export type AteneumActivity = typeof ateneumActivities.$inferSelect;
export type InsertAteneumActivity = z.infer<typeof insertAteneumActivitySchema>;
export type AteneumActivityAcceptance = typeof ateneumActivityAcceptances.$inferSelect;
export type AteneumPlan = typeof ateneumPlans.$inferSelect;
export type AteneumPlanRevision = typeof ateneumPlanRevisions.$inferSelect;
export type AteneumPlanAcceptance = typeof ateneumPlanAcceptances.$inferSelect;
export type AteneumWish = typeof ateneumWishes.$inferSelect;
export type InsertAteneumWish = z.infer<typeof insertAteneumWishSchema>;
export type AteneumWeeklySuggestion = typeof ateneumWeeklySuggestions.$inferSelect;
export type AteneumConnectionCycle = typeof ateneumConnectionCycles.$inferSelect;
export type AteneumConnectionCheckIn = typeof ateneumConnectionCheckIns.$inferSelect;
export type AteneumConnectionCommitment = typeof ateneumConnectionCommitments.$inferSelect;
export type AteneumConnectionReflection = typeof ateneumConnectionReflections.$inferSelect;
export type AteneumEmailToken = typeof ateneumEmailTokens.$inferSelect;
export type AteneumNotificationPrefs = typeof ateneumNotificationPrefs.$inferSelect;
export type AteneumEmailLog = typeof ateneumEmailLog.$inferSelect;
export type AteneumApiToken = typeof ateneumApiTokens.$inferSelect;
