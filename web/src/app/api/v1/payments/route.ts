import { z } from "zod";
import { withApi, parseBody, getPagination } from "@/lib/api";
import { createPayment } from "@/lib/domain/payments";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("payments.view");
  const { page, limit, offset } = getPagination(req);
  const url = new URL(req.url);
  const direction = url.searchParams.get("direction");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const params: unknown[] = [companyId];
  let where = `p.company_id = $1 and p.deleted_at is null`;
  if (direction) { params.push(direction); where += ` and p.direction = $${params.length}`; }
  if (from) { params.push(from); where += ` and p.payment_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` and p.payment_date <= $${params.length}`; }

  const count = await db.query(`select count(*)::int as total from payments p where ${where}`, params);
  const rows = await db.query(
    `select p.id, p.number, p.direction, p.partner_type, p.amount, p.payment_date, p.reference,
            p.status, m.name as method, c.name as customer_name, s.name as supplier_name,
            u.full_name as created_by_name
     from payments p
     join payment_methods m on m.id = p.payment_method_id
     left join customers c on c.id = p.customer_id
     left join suppliers s on s.id = p.supplier_id
     left join users u on u.id = p.created_by
     where ${where}
     order by p.created_at desc limit ${limit} offset ${offset}`,
    params
  );
  return { data: rows.rows, page, limit, total: count.rows[0].total };
});

const schema = z.object({
  direction: z.enum(["in", "out"]),
  partnerType: z.enum(["customer", "supplier"]),
  customerId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  paymentMethodId: z.string().uuid(),
  registerSessionId: z.string().uuid().nullish(),
  amount: z.number().positive(),
  paymentDate: z.string().nullish(),
  reference: z.string().max(100).nullish(),
  notes: z.string().max(2000).nullish(),
  allocations: z.array(z.object({
    targetType: z.enum(["sale", "supplier_invoice"]),
    targetId: z.string().uuid(),
    amount: z.number().positive(),
  })).default([]),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("payments.create");
  const body = await parseBody(req, schema);
  const result = await createPayment(db, companyId, session.userId, body);
  await audit({
    action: "create", entityType: "payment", entityId: result.paymentId, entityLabel: result.number,
    newValues: { direction: body.direction, amount: result.amount, allocated: result.allocated },
  });
  return result;
});
