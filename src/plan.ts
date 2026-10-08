import { z } from "zod";
import { Hono } from "hono";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { boardSchema } from "../web/plan-schema.ts";
export function planApi(dataDir: string) {
  const app = new Hono(),
    dir = join(dataDir, "plan");
  const path = (id: string) => {
    if (!z.string().uuid().safeParse(id).success)
      throw new Error("Invalid board id");
    return join(dir, `${id}.json`);
  };
  app.onError((e, c) => c.json({ error: e.message }, 400));
  app.get("/", (c) => {
    mkdirSync(dir, { recursive: true });
    return c.json({
      boards: readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) =>
          boardSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))),
        ),
    });
  });
  app.put("/:id", async (c) => {
    const file = path(c.req.param("id"));
    const b = boardSchema.parse(await c.req.json());
    if (b.id !== c.req.param("id")) throw new Error("Board id mismatch");
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(b), { mode: 0o600 });
      renameSync(tmp, file);
    } finally {
      if (existsSync(tmp)) unlinkSync(tmp);
    }
    return c.json(b);
  });
  app.delete("/:id", (c) => {
    const file = path(c.req.param("id"));
    if (existsSync(file)) unlinkSync(file);
    return c.json({ ok: true });
  });
  return app;
}
