import { z } from "zod";
import { withApi, parseBody, pathId, notFound } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("customers.view");
  const id = pathId(req);
  const showDebt = await can("customers.view_debt");

  const c = await db.query(
    `select * from customers where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]
  );
  if (!c.rowCount) throw notFound("Customer");
  const customer = c.rows[0];
  if (!showDebt) { delete customer.balance; delete customer.credit_limit; }

  const [stats, recentSales, payments, topProducts] = await Promise.all([
    db.query(
      `select count(*)::int as orders, coalesce(sum(total),0) as total_purchases,
              coalesce(avg(total),0) as avg_order, max(sale_date) as last_purchase
       from sales where customer_id = $1 and company_id = $2
         and sale_type in ('invoice','pos') and status = 'completed' and deleted_at is null`,
      [id, companyId]
    ),
    db.query(
      `select id, number, sale_type, sale_date, total, paid_amount, payment_status, due_date
       from sales where customer_id = $1 and company_id = $2 and deleted_at is null
       order by created_at desc limit 15`,
      [id, companyId]
    ),
    db.query(
      `select p.id, p.number, p.direction, p.amount, p.payment_date, m.name as method
       from payments p join payment_methods m on m.id = p.payment_method_id
       where p.customer_id = $1 and p.company_id = $2 and p.deleted_at is null
       order by p.created_at desc limit 15`,
      [id, companyId]
    ),
    db.query(
      `select si.product_id, si.description, sum(si.quantity) as qty, sum(si.line_total) as amount
       from sale_items si join sales s on s.id = si.sale_id
       where s.customer_id = $1 and s.company_id = $2 and s.sale_type in ('invoice','pos')
         and s.status = 'completed' and s.deleted_at is null
       group by si.product_id, si.description
       order by qty desc limit 8`,
      [id, companyId]
    ),
  ]);

  return {
    ...customer,
    stats: stats.rows[0],
    recentSales: recentSales.rows,
    recentPayments: payments.rows,
    topProducts: topProducts.rows,
  };
});

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  companyName: z.string().max(200).nullish(),
  phone: z.string().max(30).nullish(),
  email: z.string().email().nullish().or(z.literal("").transform(() => null)),
  address: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  wilaya: z.string().max(80).nullish(),
  nif: z.string().max(30).nullish(),
  nis: z.string().max(30).nullish(),
  rc: z.string().max(30).nullish(),
  ai: z.string().max(30).nullish(),
  creditLimit: z.number().min(0).nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  notes: z.string().max(2000).nullish(),
  isActive: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
});

const COLS: Record<string, string> = {
  name: "name", companyName: "company_name", phone: "phone", email: "email",
  address: "address", city: "city", wilaya: "wilaya", nif: "nif", nis: "nis",
  rc: "rc", ai: "ai", creditLimit: "credit_limit",
  paymentTermsDays: "payment_terms_days", notes: "notes", isActive: "is_active",
  latitude: "latitude", longitude: "longitude",
};

export const PATCH = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("customers.edit");
  const id = pathId(req);
  const body = await parseBody(req, patchSchema);
  const existing = await db.query(
    `select * from customers where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]
  );
  if (!existing.rowCount) throw notFound("Customer");

  const keys = Object.keys(COLS).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
  if (keys.length) {
    await db.query(
      `update customers set ${keys.map((k, i) => `${COLS[k]} = $${i + 1}`).join(", ")}
       where id = $${keys.length + 1} and company_id = $${keys.length + 2}`,
      [...keys.map((k) => (body as Record<string, unknown>)[k]), id, companyId]
    );
  }
  await audit({ action: "update", entityType: "customer", entityId: id, entityLabel: existing.rows[0].name, newValues: body });
  return { ok: true };
});

export const DELETE = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("customers.delete");
  const id = pathId(req);
  const existing = await db.query(
    `select name, balance from customers where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]
  );
  if (!existing.rowCount) throw notFound("Customer");
  if (Number(existing.rows[0].balance) !== 0) {
    const { ApiError } = await import("@/lib/api");
    throw new ApiError(409, "HAS_BALANCE", "This customer still has an outstanding balance.");
  }
  await db.query(`update customers set deleted_at = now() where id = $1 and company_id = $2`, [id, companyId]);
  await audit({ action: "delete", entityType: "customer", entityId: id, entityLabel: existing.rows[0].name });
  return { ok: true };
});
