import { z } from "zod";
import { withApi, parseBody } from "@/lib/api";
import { adjustStock } from "@/lib/domain/inventory";

const schema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
  kind: z.enum(["adjustment_in", "adjustment_out", "damage", "loss", "initial", "count"]),
  quantity: z.number().min(0),
  unitCost: z.number().min(0).nullish(),
  notes: z.string().max(1000).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("inventory.adjust");
  const body = await parseBody(req, schema);
  const result = await adjustStock(db, companyId, session.userId, body);
  const p = await db.query(`select name from products where id = $1`, [body.productId]);
  await audit({
    action: "adjust_stock", entityType: "product", entityId: body.productId,
    entityLabel: p.rows[0]?.name, newValues: { kind: body.kind, quantity: body.quantity, delta: result.delta, notes: body.notes },
  });
  return result;
});
