import { withApi } from "@/lib/api";

/** Latest position per courier + their active delivery count (dispatch map). */
export const GET = withApi(async ({ db, companyId, require }) => {
  await require("deliveries.track");
  const rows = await db.query(
    `select p.courier_id, p.latitude, p.longitude, p.accuracy_m, p.heading, p.recorded_at,
            u.full_name as courier_name,
            (select count(*)::int from deliveries d
             where d.courier_id = p.courier_id and d.company_id = $1
               and d.status in ('assigned','picked_up','out_for_delivery') and d.deleted_at is null
            ) as active_deliveries
     from courier_latest_positions p
     join users u on u.id = p.courier_id
     where p.company_id = $1 and p.recorded_at > now() - interval '8 hours'
     order by p.recorded_at desc`,
    [companyId]
  );
  return { data: rows.rows };
});
