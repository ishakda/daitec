import { withApi, pathId, notFound } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("sales.view");
  const id = pathId(req);
  const showCost = await can("sales.view_cost");

  const s = await db.query(
    `select s.*, c.name as customer_name, c.phone as customer_phone, c.nif as customer_nif,
            c.rc as customer_rc, c.ai as customer_ai, c.address as customer_address,
            w.name as warehouse_name, u.full_name as created_by_name
     from sales s
     left join customers c on c.id = s.customer_id
     left join warehouses w on w.id = s.warehouse_id
     left join users u on u.id = s.created_by
     where s.id = $1 and s.company_id = $2 and s.deleted_at is null`,
    [id, companyId]
  );
  if (!s.rowCount) throw notFound("Sale");
  const sale = s.rows[0];
  if (!showCost) { delete sale.total_cost; }

  const [items, payments, returns] = await Promise.all([
    db.query(
      `select id, product_id, variant_id, description, quantity, unit_price, discount_pct,
              tax_rate, ${showCost ? "unit_cost," : ""} line_total, position
       from sale_items where sale_id = $1 order by position`,
      [id]
    ),
    db.query(
      `select p.id, p.number, p.amount, p.direction, p.payment_date, m.name as method, pa.amount as allocated
       from payment_allocations pa
       join payments p on p.id = pa.payment_id and p.deleted_at is null
       join payment_methods m on m.id = p.payment_method_id
       where pa.target_type = 'sale' and pa.target_id = $1
       order by p.created_at`,
      [id]
    ),
    db.query(
      `select id, number, total, created_at from sales
       where parent_sale_id = $1 and sale_type = 'return' and deleted_at is null`,
      [id]
    ),
  ]);
  return { ...sale, items: items.rows, payments: payments.rows, returns: returns.rows };
});
