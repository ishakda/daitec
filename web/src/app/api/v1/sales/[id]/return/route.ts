import { z } from "zod";
import { withApi, parseBody, pathId } from "@/lib/api";
import { createReturn } from "@/lib/domain/sales";

const schema = z.object({
  items: z.array(z.object({
    saleItemId: z.string().uuid(),
    quantity: z.number().positive(),
  })).min(1),
  refund: z.object({
    paymentMethodId: z.string().uuid(),
    amount: z.number().positive(),
  }).nullish(),
  registerSessionId: z.string().uuid().nullish(),
  notes: z.string().max(2000).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("sales.refund");
  const saleId = pathId(req, 1);
  const body = await parseBody(req, schema);
  const result = await createReturn(db, companyId, session.userId, { saleId, ...body });
  await audit({
    action: "refund", entityType: "sale", entityId: saleId, entityLabel: result.number,
    newValues: { returnId: result.returnId, total: result.total, refunded: result.refunded },
  });
  return result;
});
