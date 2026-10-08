import express, { type Express } from "express";
import fs from "fs";
import path from "path";

// Serves the plain HTML pages copied into dist/public by script/build.ts (Ateneum and the
// dashboard). There is no SPA fallback: the public site is the EmDash app in cms/, so any
// path that is not a static file or one of the API routes gets Express's own 404.
export function serveStatic(app: Express, distPath = path.resolve(__dirname, "public")) {
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the static pages first`,
    );
  }

  // index: false so that dist/public/index.html (left over from an older build) is never served at "/".
  app.use(express.static(distPath, { index: false }));

  // Ateneum and the dashboard are directories with their own index.html (/ateneum/, /dashboard/).
  for (const dir of ["ateneum", "dashboard"]) {
    app.use(`/${dir}`, express.static(path.join(distPath, dir)));
  }
}
