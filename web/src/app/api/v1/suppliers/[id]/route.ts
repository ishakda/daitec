import { z } from "zod";
import { withApi, parseBody, pathId, notFound, ApiError } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("suppliers.view");
  const id = pathId(req);
  const showDebt = await can("suppliers.view_debt");

  const s = await db.query(
    `select * from suppliers where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]
  );
  if (!s.rowCount) throw notFound("Supplier");
  const supplier = s.rows[0];
  if (!showDebt) { delete supplier.balance; delete supplier.credit_limit; }

  const [stats, orders, invoices, payments] = await Promise.all([
    db.query(
      `select count(*)::int as orders, coalesce(sum(total),0) as total_purchases
       from purchase_orders where supplier_id = $1 and company_id = $2 and deleted_at is null`,
      [id, companyId]
    ),
    db.query(
      `select id, number, status, order_date, total from purchase_orders
       where supplier_id = $1 and company_id = $2 and deleted_at is null
       order by created_at desc limit 15`,
      [id, companyId]
    ),
    db.query(
      `select id, number, supplier_ref, invoice_date, due_date, total, paid_amount, payment_status
       from supplier_invoices where supplier_id = $1 and company_id = $2 and deleted_at is null
       order by created_at desc limit 15`,
      [id, companyId]
    ),
    db.query(
      `select p.id, p.number, p.direction, p.amount, p.payment_date, m.name as method
       from payments p join payment_methods m on m.id = p.payment_method_id
       where p.supplier_id = $1 and p.company_id = $2 and p.deleted_at is null
       order by p.created_at desc limit 15`,
      [id, companyId]
    ),
  ]);

  return {
    ...supplier,
    stats: stats.rows[0],
    recentOrders: orders.rows,
    recentInvoices: invoices.rows,
    recentPayments: payments.rows,
  };
});

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  companyName: z.string().max(200).nullish(),
  contactName: z.string().max(160).nullish(),
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
});

const COLS: Record<string, string> = {
  name: "name", companyName: "company_name", contactName: "contact_name", phone: "phone",
  email: "email", address: "address", city: "city", wilaya: "wilaya", nif: "nif",
  nis: "nis", rc: "rc", ai: "ai", creditLimit: "credit_limit",
  paymentTermsDays: "payment_terms_days", notes: "notes", isActive: "is_active",
};

export const PATCH = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("suppliers.edit");
  const id = pathId(req);
  const body = await parseBody(req, patchSchema);
  const existing = await db.query(
    `select * from suppliers where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]
  );
  if (!existing.rowCount) throw notFound("Supplier");
  const keys = Object.keys(COLS).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
  if (keys.length) {
    await db.query(
      `update suppliers set ${keys.map((k, i) => `${COLS[k]} = $${i + 1}`).join(", ")}
       where id = $${keys.length + 1} and company_id = $${keys.length + 2}`,
      [...keys.map((k) => (body as Record<string, unknown>)[k]), id, companyId]
    );
  }
  await audit({ action: "update", entityType: "supplier", entityId: id, entityLabel: existing.rows[0].name, newValues: body });
  return { ok: true };
});

export const DELETE = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("suppliers.delete");
  const id = pathId(req);
  const existing = await db.query(
    `select name, balance from suppliers where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]
  );
  if (!existing.rowCount) throw notFound("Supplier");
  if (Number(existing.rows[0].balance) !== 0) {
    throw new ApiError(409, "HAS_BALANCE", "This supplier still has an outstanding balance.");
  }
  await db.query(`update suppliers set deleted_at = now() where id = $1 and company_id = $2`, [id, companyId]);
  await audit({ action: "delete", entityType: "supplier", entityId: id, entityLabel: existing.rows[0].name });
  return { ok: true };
});
