import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import path from "path";
import { initAteneumSchema, migrateAteneumSchema } from "./ateneum-db";
import { seedAteneum } from "./ateneum-seed";
import { registerAteneumRoutes } from "./ateneum-routes";

const app = express();
const httpServer = createServer(app);

// Production Caddy connects over loopback. Trust only that hop so req.ip uses
// Caddy's appended client address without trusting arbitrary direct proxies.
app.set("trust proxy", "loopback");

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  const mayLogResponseBody = !path.startsWith("/api/ateneum");
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    if (mayLogResponseBody) capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

async function startServer() {
  await registerRoutes(httpServer, app);

  // Ateneum — private shared-experience app.
  initAteneumSchema();
  migrateAteneumSchema();
  const seedResult = await seedAteneum();
  log(
    `ateneum schema ready (${seedResult.seeded ? "seeded " + seedResult.summary : seedResult.summary})`,
    "ateneum",
  );
  registerAteneumRoutes(app);
  log("ateneum routes registered", "ateneum");

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Learning workspace — generated HTML lives outside the Vite bundle.
  // Mount it before the SPA catch-all so /learn/* resolves from data/learn.
  app.use(
    "/learn",
    express.static(path.resolve(process.cwd(), "data/learn"), {
      fallthrough: false,
    }),
  );
  log("learn workspace static mounted from data/learn", "learn");

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
}

startServer().catch((error: any) => {
  console.error("[server] startup failed:", error?.name, error?.message);
  process.exit(1);
});
