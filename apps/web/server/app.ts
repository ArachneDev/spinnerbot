import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { serveBrand } from "./brand.js";
import type { ServerContext, WebFeature } from "./types.js";

export interface AppOptions {
  features: WebFeature[];
  /** The built client. Unset in tests and in development, where Vite serves it. */
  clientRoot?: string;
  /** Where the art is, served as `/brand/<file>`. Unset in tests that don't need it. */
  assetsDir?: string;
}

export function createApp(
  context: ServerContext,
  { features, clientRoot, assetsDir }: AppOptions,
): Hono {
  const app = new Hono();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: "no-referrer",
    }),
  );

  app.onError((error, c) => {
    context.log.error({ err: error, path: c.req.path }, "Request failed");
    return c.json({ error: "Internal error" }, 500);
  });

  /** Is the process up? Doesn't touch the database, so an outage won't restart this container. */
  app.get("/healthz", (c) => c.json({ status: "ok", version: process.env["VERSION"] ?? "dev" }));

  app.get("/readyz", async (c) => {
    try {
      await context.database.sql`select 1 from guilds limit 0`;
      return c.json({ status: "ok" });
    } catch (error) {
      context.log.warn({ err: error }, "Database unavailable");
      return c.json({ status: "unavailable" }, 503);
    }
  });

  const names = new Set<string>();
  for (const feature of features) {
    if (names.has(feature.name)) throw new Error(`Duplicate web feature "${feature.name}"`);
    names.add(feature.name);
    const log = context.log.child({ feature: feature.name });
    app.route(`/api/${feature.name}`, feature.routes({ ...context, log }));
  }
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  if (assetsDir) serveBrand(app, assetsDir);

  if (clientRoot) {
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("*", serveStatic({ root: clientRoot }));
    // Client-side routes all load the single page.
    app.get("*", serveStatic({ root: clientRoot, path: "index.html" }));
  }

  return app;
}
