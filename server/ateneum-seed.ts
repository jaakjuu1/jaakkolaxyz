import crypto from "node:crypto";
import { ateneumRawDb } from "./ateneum-db";
import { hashPassword } from "./ateneum-auth";
import { SEED_IDEAS } from "./ateneum-seed-data";

type HumanRole = "partner_a" | "partner_b";
type ExistingUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "partner_a" | "partner_b" | "bot";
};

type PreparedHuman = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: HumanRole;
  passwordHash: string;
};

const HUMAN_CONFIG = [
  { role: "partner_a" as const, prefix: "ATENEUM_PARTNER_A" },
  { role: "partner_b" as const, prefix: "ATENEUM_PARTNER_B" },
];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}; it is required for the initial Ateneum seed`);
  return value;
}

function validateUsername(name: string, value: string): string {
  if (!/^[a-zA-Z0-9._-]{2,64}$/.test(value)) {
    throw new Error(`${name} must be 2-64 characters and use only letters, numbers, dot, underscore or dash`);
  }
  return value;
}

function validateDisplayName(name: string, value: string): string {
  if (value.length > 100) throw new Error(`${name} must be at most 100 characters`);
  return value;
}

function validateEmail(name: string, value: string): string {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    throw new Error(`${name} must be a valid email address`);
  }
  return value.toLowerCase();
}

function generatedId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}

function seedIdeaId(title: string): string {
  const digest = crypto.createHash("sha256").update(title, "utf8").digest("hex").slice(0, 24);
  return `idea_seed_${digest}`;
}

export async function seedAteneum(): Promise<{ seeded: boolean; summary: string }> {
  const existing = ateneumRawDb
    .prepare(
      `SELECT id, username, display_name AS displayName, email, role
       FROM ateneum_users`,
    )
    .all() as ExistingUser[];

  for (const role of ["partner_a", "partner_b", "bot"] as const) {
    if (existing.filter((user) => user.role === role).length > 1) {
      throw new Error(`Ateneum database contains more than one ${role} user`);
    }
  }

  // Build and validate the complete write plan before changing the database.
  const preparedHumans: PreparedHuman[] = [];
  const emailBackfills: Array<{ id: string; email: string }> = [];

  for (const descriptor of HUMAN_CONFIG) {
    const current = existing.find((user) => user.role === descriptor.role);
    const emailName = `${descriptor.prefix}_EMAIL`;

    if (current) {
      if (!current.email) {
        emailBackfills.push({
          id: current.id,
          email: validateEmail(emailName, requiredEnv(emailName)),
        });
      }
      continue;
    }

    const usernameName = `${descriptor.prefix}_USERNAME`;
    const displayNameName = `${descriptor.prefix}_DISPLAY_NAME`;
    const passwordName = `${descriptor.prefix}_PASSWORD`;
    const username = validateUsername(usernameName, requiredEnv(usernameName));
    const displayName = validateDisplayName(displayNameName, requiredEnv(displayNameName));
    const email = validateEmail(emailName, requiredEnv(emailName));
    const password = requiredEnv(passwordName);

    preparedHumans.push({
      id: generatedId("usr"),
      username,
      displayName,
      email,
      role: descriptor.role,
      passwordHash: await hashPassword(password),
    });
  }

  const existingBot = existing.find((user) => user.role === "bot");
  const botEmail = validateEmail(
    "ATENEUM_BOT_EMAIL",
    process.env.ATENEUM_BOT_EMAIL?.trim() || "noreply@example.invalid",
  );
  if (existingBot && !existingBot.email) {
    emailBackfills.push({ id: existingBot.id, email: botEmail });
  }
  const preparedBot = existingBot
    ? null
    : {
        id: generatedId("usr"),
        username: "ateneum-bot",
        displayName: "Ateneum",
        email: botEmail,
        role: "bot" as const,
        passwordHash: await hashPassword(
          process.env.ATENEUM_BOT_PASSWORD || crypto.randomBytes(32).toString("base64url"),
        ),
      };

  const existingTitles = new Set(
    (ateneumRawDb.prepare("SELECT title FROM ateneum_ideas").all() as Array<{ title: string }>).map(
      (row) => row.title,
    ),
  );

  const applySeed = ateneumRawDb.transaction(() => {
    let usersWritten = 0;
    let preferencesWritten = 0;
    let ideasWritten = 0;

    const updateEmail = ateneumRawDb.prepare(
      "UPDATE ateneum_users SET email = ? WHERE id = ? AND email IS NULL",
    );
    for (const backfill of emailBackfills) {
      usersWritten += updateEmail.run(backfill.email, backfill.id).changes;
    }

    const insertUser = ateneumRawDb.prepare(`
      INSERT INTO ateneum_users (id, username, display_name, password_hash, email, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const user of preparedHumans) {
      usersWritten += insertUser.run(
        user.id,
        user.username,
        user.displayName,
        user.passwordHash,
        user.email,
        user.role,
      ).changes;
    }
    if (preparedBot) {
      usersWritten += insertUser.run(
        preparedBot.id,
        preparedBot.username,
        preparedBot.displayName,
        preparedBot.passwordHash,
        preparedBot.email,
        preparedBot.role,
      ).changes;
    }

    const humansByRole = new Map<HumanRole, string>();
    for (const user of existing) {
      if (user.role === "partner_a" || user.role === "partner_b") {
        humansByRole.set(user.role, user.id);
      }
    }
    for (const user of preparedHumans) humansByRole.set(user.role, user.id);

    const insertPreferences = ateneumRawDb.prepare(`
      INSERT OR IGNORE INTO ateneum_preferences
        (user_id, liked_tags, disliked_tags, energy_level, budget_level,
         social_mode, preferred_duration, weekday_evenings, weekend_mornings, notes)
      VALUES (?, '[]', '[]', 'medium', 'moderate', 'together', 120, 1, 1, '')
    `);
    for (const role of ["partner_a", "partner_b"] as const) {
      const userId = humansByRole.get(role);
      if (!userId) throw new Error(`Seed plan did not resolve the ${role} user`);
      preferencesWritten += insertPreferences.run(userId).changes;
    }

    const insertIdea = ateneumRawDb.prepare(`
      INSERT OR IGNORE INTO ateneum_ideas
        (id, title, description, category, tags, energy_cost, budget_cost,
         social_mode, duration_min, created_by, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)
    `);
    for (const idea of SEED_IDEAS) {
      if (existingTitles.has(idea.title)) continue;
      ideasWritten += insertIdea.run(
        seedIdeaId(idea.title),
        idea.title,
        idea.description,
        idea.category,
        JSON.stringify(idea.tags),
        idea.energyCost,
        idea.budgetCost,
        idea.socialMode,
        idea.durationMin,
      ).changes;
    }

    return { usersWritten, preferencesWritten, ideasWritten };
  });

  const result = applySeed();
  const written = result.usersWritten + result.preferencesWritten + result.ideasWritten;
  return {
    seeded: written > 0,
    summary: written
      ? `users=${result.usersWritten} preferences=${result.preferencesWritten} ideas=${result.ideasWritten}`
      : "already seeded",
  };
}
