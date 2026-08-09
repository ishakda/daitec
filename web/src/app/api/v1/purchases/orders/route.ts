import { z } from "zod";
import { withApi, parseBody, getPagination } from "@/lib/api";
import { createPurchaseOrder } from "@/lib/domain/purchases";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("purchases.view");
  const { page, limit, offset } = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || null;
  const supplierId = url.searchParams.get("supplierId") || null;

  const rows = await db.query(
    `select po.id, po.number, po.status, po.order_date, po.expected_date, po.total,
            s.name as supplier_name,
            (select count(*)::int from purchase_order_items where purchase_order_id = po.id) as item_count
     from purchase_orders po
     join suppliers s on s.id = po.supplier_id
     where po.company_id = $1 and po.deleted_at is null
       and ($2::text is null or po.status = $2)
       and ($3::uuid is null or po.supplier_id = $3)
     order by po.created_at desc limit ${limit} offset ${offset}`,
    [companyId, status, supplierId]
  );
  const count = await db.query(
    `select count(*)::int as total from purchase_orders po
     where po.company_id = $1 and po.deleted_at is null
       and ($2::text is null or po.status = $2) and ($3::uuid is null or po.supplier_id = $3)`,
    [companyId, status, supplierId]
  );
  return { data: rows.rows, page, limit, total: count.rows[0].total };
});

const schema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid().nullish(),
  expectedDate: z.string().nullish(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullish(),
    description: z.string().max(300).optional(),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    discountPct: z.number().min(0).max(100).default(0),
    taxRate: z.number().min(0).max(100).default(0),
  })).min(1),
  globalDiscount: z.number().min(0).default(0),
  shipping: z.number().min(0).default(0),
  notes: z.string().max(2000).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("purchases.create");
  const body = await parseBody(req, schema);
  const result = await createPurchaseOrder(db, companyId, session.userId, body);
  await audit({
    action: "create", entityType: "purchase_order", entityId: result.purchaseOrderId,
    entityLabel: result.number, newValues: { total: result.totals.total, items: body.items.length },
  });
  return result;
});
