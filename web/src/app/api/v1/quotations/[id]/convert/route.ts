import { z } from "zod";
import { withApi, parseBody, pathId, notFound, ApiError } from "@/lib/api";
import { createSale } from "@/lib/domain/sales";

const schema = z.object({
  warehouseId: z.string().uuid(),
  dueDate: z.string().nullish(),
});

/** Convert an accepted quotation directly into an invoice (stage skipping). */
export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("sales.create");
  const id = pathId(req, 1);
  const body = await parseBody(req, schema);

  const q = await db.query(
    `select * from quotations where id = $1 and company_id = $2 and deleted_at is null for update`,
    [id, companyId]
  );
  if (!q.rowCount) throw notFound("Quotation");
  if (q.rows[0].status === "converted")
    throw new ApiError(409, "ALREADY_CONVERTED", "This quotation was already converted.");

  const items = await db.query(
    `select * from quotation_items where quotation_id = $1 and product_id is not null order by position`,
    [id]
  );
  if (!items.rowCount) throw new ApiError(409, "NO_PRODUCT_LINES", "This quotation has no product lines to convert.");

  const result = await createSale(db, companyId, session.userId, {
    saleType: "invoice",
    customerId: q.rows[0].customer_id,
    warehouseId: body.warehouseId,
    dueDate: body.dueDate ?? null,
    globalDiscount: Number(q.rows[0].discount_amount),
    items: items.rows.map((r) => ({
      productId: r.product_id,
      description: r.description,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
      discountPct: Number(r.discount_pct),
      taxRate: Number(r.tax_rate),
    })),
  });
  await db.query(`update quotations set status = 'converted' where id = $1`, [id]);
  await audit({ action: "convert", entityType: "quotation", entityId: id, entityLabel: q.rows[0].number, newValues: { saleId: result.saleId, saleNumber: result.number } });
  return result;
});
