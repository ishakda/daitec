import { withApi, badRequest } from "@/lib/api";

/** Global search across products, customers, suppliers, sales, purchase orders. */
export const GET = withApi(async ({ req, db, companyId, can }) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) throw badRequest("Query must be at least 2 characters.");
  const like = `%${q}%`;

  const [products, customers, suppliers, sales, orders] = await Promise.all([
    (await can("products.view")) ? db.query(
      `select id, name, sku as detail from products
       where company_id = $1 and deleted_at is null
         and (name ilike $2 or sku ilike $2 or exists (select 1 from barcodes b where b.product_id = products.id and b.barcode = $3))
       limit 6`, [companyId, like, q]) : { rows: [] },
    (await can("customers.view")) ? db.query(
      `select id, name, phone as detail from customers
       where company_id = $1 and deleted_at is null and (name ilike $2 or phone ilike $2) limit 6`,
      [companyId, like]) : { rows: [] },
    (await can("suppliers.view")) ? db.query(
      `select id, name, phone as detail from suppliers
       where company_id = $1 and deleted_at is null and (name ilike $2 or phone ilike $2) limit 6`,
      [companyId, like]) : { rows: [] },
    (await can("sales.view")) ? db.query(
      `select s.id, s.number as name, c.name as detail from sales s
       left join customers c on c.id = s.customer_id
       where s.company_id = $1 and s.deleted_at is null and s.number ilike $2
       order by s.created_at desc limit 6`, [companyId, like]) : { rows: [] },
    (await can("purchases.view")) ? db.query(
      `select po.id, po.number as name, sp.name as detail from purchase_orders po
       join suppliers sp on sp.id = po.supplier_id
       where po.company_id = $1 and po.deleted_at is null and po.number ilike $2
       order by po.created_at desc limit 6`, [companyId, like]) : { rows: [] },
  ]);

  return {
    products: products.rows,
    customers: customers.rows,
    suppliers: suppliers.rows,
    sales: sales.rows,
    purchaseOrders: orders.rows,
  };
});
