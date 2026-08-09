import { z } from "zod";
import { withApi, parseBody, getPagination } from "@/lib/api";
import { receiveGoods } from "@/lib/domain/purchases";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("purchases.view");
  const { page, limit, offset } = getPagination(req);
  const rows = await db.query(
    `select gr.id, gr.number, gr.receipt_date, gr.status, s.name as supplier_name,
            w.name as warehouse_name, po.number as po_number,
            (select coalesce(sum(quantity * unit_cost),0) from goods_receipt_items where goods_receipt_id = gr.id) as total_value
     from goods_receipts gr
     join suppliers s on s.id = gr.supplier_id
     join warehouses w on w.id = gr.warehouse_id
     left join purchase_orders po on po.id = gr.purchase_order_id
     where gr.company_id = $1 and gr.deleted_at is null
     order by gr.created_at desc limit ${limit} offset ${offset}`,
    [companyId]
  );
  return { data: rows.rows, page, limit };
});

const schema = z.object({
  purchaseOrderId: z.string().uuid().nullish(),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  items: z.array(z.object({
    purchaseOrderItemId: z.string().uuid().nullish(),
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullish(),
    quantity: z.number().positive(),
    unitCost: z.number().min(0),
  })).min(1),
  createSupplierInvoice: z.boolean().default(true),
  dueDate: z.string().nullish(),
  supplierRef: z.string().max(100).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("purchases.receive");
  const body = await parseBody(req, schema);
  const result = await receiveGoods(db, companyId, session.userId, body);
  await audit({
    action: "receive", entityType: "goods_receipt", entityId: result.receiptId,
    entityLabel: result.number, newValues: { totalValue: result.totalValue, invoice: result.supplierInvoice?.number },
  });
  return result;
});
