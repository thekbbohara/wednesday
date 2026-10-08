// Isolated browser verification only. Never opens the live data directory or invokes inference.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { serve } from "@hono/node-server";
import { loadConfig } from "../../src/config.ts";
import { Memory } from "../../src/memory/store.ts";
import { createApp } from "../../src/server.ts";
const dataDir = mkdtempSync(join(tmpdir(), "wedcanvas-demo-"));
const cfg = loadConfig({ dataDir });
const mem = new Memory(cfg.dbPath);
mem.taskCreate({
  title: "Explore the planning canvas",
  goal: "A browser-only demo task",
  status: "running",
});
const { app } = createApp({
  mem,
  cfg,
  webRoot: resolve("dist"),
  runner: {
    async run() {
      return {
        text: "Demo captain received the idea.",
        contextTokens: 1,
        contextWindow: 200000,
        costUsd: 0,
        isError: false,
      };
    },
  },
});
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 4793 }, () =>
  console.log(`Demo http://127.0.0.1:4793 data ${dataDir}`),
);
