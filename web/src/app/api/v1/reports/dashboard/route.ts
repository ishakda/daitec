import { withApi } from "@/lib/api";

/**
 * Dashboard payload: KPIs, 30-day revenue/profit trend, top products,
 * payment-method distribution, alerts. All figures derive from real
 * rows — nothing is estimated.
 */
export const GET = withApi(async ({ db, companyId, can, require }) => {
  await require("dashboard.view");
  const showProfit = await can("sales.view_profit");
  const showCost = await can("inventory.view_cost");

  const [today, month, receivables, payables, stockValue, trend, topProducts, byMethod, alerts] =
    await Promise.all([
      db.query(
        `select count(*)::int as sales_count,
                coalesce(sum(total),0) as revenue,
                coalesce(sum(total - tax_amount - total_cost),0) as profit
         from sales where company_id = $1 and sale_date = current_date
           and sale_type in ('invoice','pos') and status = 'completed' and deleted_at is null`,
        [companyId]
      ),
      db.query(
        `select count(*)::int as sales_count,
                coalesce(sum(total),0) as revenue,
                coalesce(sum(total - tax_amount - total_cost),0) as profit
         from sales where company_id = $1
           and date_trunc('month', sale_date) = date_trunc('month', current_date)
           and sale_type in ('invoice','pos') and status = 'completed' and deleted_at is null`,
        [companyId]
      ),
      db.query(
        `select coalesce(sum(balance),0) as total,
                (select count(*)::int from sales
                 where company_id = $1 and payment_status in ('unpaid','partial')
                   and due_date < current_date and sale_type in ('invoice','pos')
                   and status = 'completed' and deleted_at is null) as overdue_count
         from customers where company_id = $1 and balance > 0 and deleted_at is null`,
        [companyId]
      ),
      db.query(
        `select coalesce(sum(balance),0) as total,
                (select count(*)::int from supplier_invoices
                 where company_id = $1 and payment_status in ('unpaid','partial')
                   and due_date <= current_date + 7 and deleted_at is null) as due_soon_count
         from suppliers where company_id = $1 and balance > 0 and deleted_at is null`,
        [companyId]
      ),
      db.query(
        `select coalesce(sum(quantity * avg_cost),0) as value, coalesce(sum(quantity),0) as units
         from inventory_balances where company_id = $1`,
        [companyId]
      ),
      db.query(
        `select sale_date::text as date,
                coalesce(sum(total),0) as revenue,
                coalesce(sum(total - tax_amount - total_cost),0) as profit
         from sales where company_id = $1 and sale_date >= current_date - 29
           and sale_type in ('invoice','pos') and status = 'completed' and deleted_at is null
         group by sale_date order by sale_date`,
        [companyId]
      ),
      db.query(
        `select si.product_id, si.description as name,
                sum(si.quantity) as quantity, sum(si.line_total) as revenue
         from sale_items si join sales s on s.id = si.sale_id
         where s.company_id = $1 and s.sale_date >= current_date - 29
           and s.sale_type in ('invoice','pos') and s.status = 'completed' and s.deleted_at is null
         group by si.product_id, si.description
         order by revenue desc limit 8`,
        [companyId]
      ),
      db.query(
        `select m.name as method, coalesce(sum(p.amount),0) as amount
         from payments p join payment_methods m on m.id = p.payment_method_id
         where p.company_id = $1 and p.direction = 'in' and p.deleted_at is null
           and p.payment_date >= current_date - 29
         group by m.name order by amount desc`,
        [companyId]
      ),
      db.query(
        `select
          (select count(*)::int from products p
           where p.company_id = $1 and p.deleted_at is null and p.minimum_stock > 0
             and coalesce((select sum(quantity) from inventory_balances ib where ib.product_id = p.id),0) <= p.minimum_stock
          ) as low_stock,
          (select count(*)::int from products p
           where p.company_id = $1 and p.deleted_at is null and p.status = 'active'
             and coalesce((select sum(quantity) from inventory_balances ib where ib.product_id = p.id),0) <= 0
          ) as out_of_stock,
          (select count(*)::int from sales
           where company_id = $1 and payment_status in ('unpaid','partial')
             and due_date < current_date and sale_type in ('invoice','pos')
             and status = 'completed' and deleted_at is null) as overdue_customers,
          (select count(*)::int from supplier_invoices
           where company_id = $1 and payment_status in ('unpaid','partial')
             and due_date <= current_date + 7 and deleted_at is null) as supplier_due`,
        [companyId]
      ),
    ]);

  const strip = (row: Record<string, unknown>) => {
    if (!showProfit) delete row.profit;
    return row;
  };

  return {
    today: strip(today.rows[0]),
    month: strip(month.rows[0]),
    receivables: receivables.rows[0],
    payables: payables.rows[0],
    inventory: showCost ? stockValue.rows[0] : { units: stockValue.rows[0].units },
    trend: trend.rows.map(strip),
    topProducts: topProducts.rows,
    paymentMethods: byMethod.rows,
    alerts: alerts.rows[0],
  };
});
