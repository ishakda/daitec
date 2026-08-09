import { z } from "zod";
import { withApi, parseBody, getPagination } from "@/lib/api";
import { computeTotals } from "@/lib/money";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("sales.view");
  const { page, limit, offset } = getPagination(req);
  const rows = await db.query(
    `select q.id, q.number, q.status, q.valid_until, q.total, q.created_at, c.name as customer_name
     from quotations q left join customers c on c.id = q.customer_id
     where q.company_id = $1 and q.deleted_at is null
     order by q.created_at desc limit ${limit} offset ${offset}`,
    [companyId]
  );
  return { data: rows.rows, page, limit };
});

const schema = z.object({
  customerId: z.string().uuid().nullish(),
  validUntil: z.string().nullish(),
  items: z.array(z.object({
    productId: z.string().uuid().nullish(),
    description: z.string().max(300).optional(),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    discountPct: z.number().min(0).max(100).default(0),
    taxRate: z.number().min(0).max(100).default(0),
  })).min(1),
  globalDiscount: z.number().min(0).default(0),
  notes: z.string().max(2000).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("sales.create");
  const body = await parseBody(req, schema);
  const totals = computeTotals({
    lines: body.items, globalDiscount: body.globalDiscount,
  });
  const num = await db.query(`select next_document_number($1,'quotation') as n`, [companyId]);
  const q = await db.query(
    `insert into quotations (company_id, number, customer_id, valid_until, subtotal,
        discount_amount, tax_amount, total, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, number`,
    [companyId, num.rows[0].n, body.customerId ?? null, body.validUntil ?? null,
     totals.subtotal, totals.discountAmount, totals.taxAmount, totals.total,
     body.notes ?? null, session.userId]
  );
  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i];
    let desc = item.description;
    if (!desc && item.productId) {
      const p = await db.query(`select name from products where id = $1 and company_id = $2`, [item.productId, companyId]);
      desc = p.rows[0]?.name;
    }
    await db.query(
      `insert into quotation_items (company_id, quotation_id, product_id, description,
          quantity, unit_price, discount_pct, tax_rate, line_total, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [companyId, q.rows[0].id, item.productId ?? null, desc ?? "Article", item.quantity,
       item.unitPrice, item.discountPct, item.taxRate, totals.lines[i].lineTotal, i]
    );
  }
  await audit({ action: "create", entityType: "quotation", entityId: q.rows[0].id, entityLabel: q.rows[0].number, newValues: { total: totals.total } });
  return { id: q.rows[0].id, number: q.rows[0].number, totals };
});
