import { z } from "zod";
import { withApi, parseBody, getPagination } from "@/lib/api";
import { createTransfer } from "@/lib/domain/inventory";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("inventory.view");
  const { page, limit, offset } = getPagination(req);
  const rows = await db.query(
    `select t.id, t.number, t.status, t.notes, t.sent_at, t.received_at, t.created_at,
            wf.name as from_warehouse, wt.name as to_warehouse,
            (select count(*)::int from stock_transfer_items where transfer_id = t.id) as item_count
     from stock_transfers t
     join warehouses wf on wf.id = t.from_warehouse_id
     join warehouses wt on wt.id = t.to_warehouse_id
     where t.company_id = $1
     order by t.created_at desc limit ${limit} offset ${offset}`,
    [companyId]
  );
  return { data: rows.rows, page, limit };
});

const schema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullish(),
    quantity: z.number().positive(),
  })).min(1),
  notes: z.string().max(1000).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("inventory.transfer");
  const body = await parseBody(req, schema);
  const result = await createTransfer(db, companyId, session.userId, body);
  await audit({
    action: "create", entityType: "stock_transfer", entityId: result.transferId,
    entityLabel: result.number, newValues: { items: body.items.length },
  });
  return result;
});
