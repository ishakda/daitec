import { z } from "zod";
import { withApi, parseBody, getPagination, forbidden } from "@/lib/api";
import { createSale } from "@/lib/domain/sales";

export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("sales.view");
  const { page, limit, offset } = getPagination(req);
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const type = url.searchParams.get("type");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const customerId = url.searchParams.get("customerId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const showProfit = await can("sales.view_profit");

  const params: unknown[] = [companyId];
  let where = `s.company_id = $1 and s.deleted_at is null`;
  if (q) { params.push(`%${q}%`); where += ` and (s.number ilike $${params.length} or c.name ilike $${params.length})`; }
  if (type) { params.push(type); where += ` and s.sale_type = $${params.length}`; }
  if (paymentStatus) { params.push(paymentStatus); where += ` and s.payment_status = $${params.length}`; }
  if (customerId) { params.push(customerId); where += ` and s.customer_id = $${params.length}`; }
  if (from) { params.push(from); where += ` and s.sale_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` and s.sale_date <= $${params.length}`; }

  const count = await db.query(
    `select count(*)::int as total from sales s left join customers c on c.id = s.customer_id where ${where}`,
    params
  );
  const rows = await db.query(
    `select s.id, s.number, s.sale_type, s.sale_date, s.due_date, s.status, s.payment_status,
            s.total, s.paid_amount, ${showProfit ? "s.total_cost, (s.total - s.tax_amount - s.total_cost) as gross_profit," : ""}
            c.name as customer_name, u.full_name as created_by_name
     from sales s
     left join customers c on c.id = s.customer_id
     left join users u on u.id = s.created_by
     where ${where}
     order by s.created_at desc
     limit ${limit} offset ${offset}`,
    params
  );
  return { data: rows.rows, page, limit, total: count.rows[0].total };
});

const itemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
  description: z.string().max(300).optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  discountPct: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100).default(0),
});

const createSchema = z.object({
  saleType: z.enum(["invoice", "pos", "proforma"]).default("invoice"),
  customerId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid(),
  branchId: z.string().uuid().nullish(),
  registerSessionId: z.string().uuid().nullish(),
  salesOrderId: z.string().uuid().nullish(),
  items: z.array(itemSchema).min(1),
  globalDiscount: z.number().min(0).default(0),
  shipping: z.number().min(0).default(0),
  dueDate: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
  payments: z.array(z.object({
    paymentMethodId: z.string().uuid(),
    amount: z.number().positive(),
    reference: z.string().max(100).nullish(),
  })).default([]),
});

export const POST = withApi(async ({ req, db, companyId, session, can, require, audit }) => {
  await require("sales.create");
  const body = await parseBody(req, createSchema);

  const hasDiscount = body.globalDiscount > 0 || body.items.some((i) => i.discountPct > 0);
  if (hasDiscount && !(await can("sales.discount"))) throw forbidden("sales.discount");

  const result = await createSale(db, companyId, session.userId, body);
  await audit({
    action: "create", entityType: "sale", entityId: result.saleId, entityLabel: result.number,
    newValues: { type: body.saleType, total: result.totals.total, paid: result.paid, items: body.items.length },
  });
  return result;
});
