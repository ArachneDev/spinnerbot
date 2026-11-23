import { Hono } from "hono";
import type { WebFeature } from "../../types.js";

export const systemFeature: WebFeature = {
  name: "system",
  routes() {
    return new Hono().get("/version", (c) =>
      c.json({ version: process.env["APP_VERSION"] ?? "dev" }),
    );
  },
};
