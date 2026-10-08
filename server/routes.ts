import type { Express } from "express";
import { createServer, type Server } from "http";
import { createContactHandler, createDefaultContactDeps, createRateLimiter } from "./contact";

// The public site (home, blog, privacy, learn, reports) is the EmDash app in cms/.
// This app keeps only the API routes below plus Ateneum and the dashboard (registered in index.ts).
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post(
    "/api/contact",
    createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 }),
    createContactHandler(createDefaultContactDeps()),
  );

  return httpServer;
}
