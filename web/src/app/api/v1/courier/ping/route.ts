import { z } from "zod";
import { withApi, parseBody } from "@/lib/api";

const schema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(99999).nullish(),
  heading: z.number().min(0).max(360).nullish(),
});

/** Courier position ping — any member with delivery status rights can report their own position. */
export const POST = withApi(async ({ req, db, companyId, session, require }) => {
  await require("deliveries.update_status");
  const body = await parseBody(req, schema);
  await db.query(
    `insert into courier_positions (company_id, courier_id, latitude, longitude, accuracy_m, heading)
     values ($1,$2,$3,$4,$5,$6)`,
    [companyId, session.userId, body.latitude, body.longitude, body.accuracy ?? null, body.heading ?? null]
  );
  return { ok: true };
});
