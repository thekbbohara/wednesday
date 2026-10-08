import { z } from "zod";
const item = z.object({
  id: z.string().max(100),
  kind: z.enum(["note", "card", "group"]),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().min(80).max(5000),
  h: z.number().min(60).max(5000),
  title: z.string().max(2000),
  body: z.string().max(30000),
  color: z.enum(["blue", "mint", "amber", "pink", "plain"]),
  tags: z.array(z.string().max(100)).max(100),
  status: z.enum(["idea", "planned", "doing", "done"]),
  tasks: z.array(z.string().regex(/^T\d+$/)).max(100),
});
export const boardSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    items: z.array(item).max(2000),
    connectors: z
      .array(
        z.object({ id: z.string().max(100), from: z.string(), to: z.string() }),
      )
      .max(4000),
  })
  .refine(
    (b) =>
      new Set(b.items.map((i) => i.id)).size === b.items.length &&
      b.connectors.every(
        (c) =>
          b.items.some((i) => i.id === c.from) &&
          b.items.some((i) => i.id === c.to),
      ),
    "Invalid item references",
  );
export type Board = z.infer<typeof boardSchema>;
export type PlanItem = Board["items"][number];
