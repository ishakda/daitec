import { withApi } from "@/lib/api";

/** Everything the dispatch map needs in one call (except live courier positions). */
export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("map.view");
  const url = new URL(req.url);
  const withDebt = url.searchParams.get("withDebt") === "true";

  const [branches, warehouses, customers, deliveries, couriers] = await Promise.all([
    db.query(
      `select id, name, address, city, latitude, longitude from branches
       where company_id = $1 and deleted_at is null and latitude is not null`, [companyId]),
    db.query(
      `select id, name, address, latitude, longitude from warehouses
       where company_id = $1 and deleted_at is null and latitude is not null`, [companyId]),
    db.query(
      `select id, name, phone, city, balance, latitude, longitude from customers
       where company_id = $1 and deleted_at is null and latitude is not null
         and (not $2 or balance > 0)
       limit 500`, [companyId, withDebt]),
    db.query(
      `select d.id, d.number, d.status, d.latitude, d.longitude, d.address, d.cod_amount,
              c.name as customer_name, u.full_name as courier_name
       from deliveries d
       left join customers c on c.id = d.customer_id
       left join users u on u.id = d.courier_id
       where d.company_id = $1 and d.deleted_at is null
         and d.status in ('pending','assigned','picked_up','out_for_delivery')`, [companyId]),
    db.query(
      `select m.user_id as id, u.full_name as name
       from company_members m
       join users u on u.id = m.user_id
       join roles r on r.id = m.role_id
       join role_permissions rp on rp.role_id = r.id and rp.permission_code = 'deliveries.update_status'
       where m.company_id = $1 and m.status = 'active'
       group by m.user_id, u.full_name`, [companyId]),
  ]);
  return {
    branches: branches.rows, warehouses: warehouses.rows, customers: customers.rows,
    deliveries: deliveries.rows, couriers: couriers.rows,
  };
});
