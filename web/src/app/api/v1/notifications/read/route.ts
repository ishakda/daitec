import { z } from "zod";
import { withApi, parseBody } from "@/lib/api";

const schema = z.object({
  ids: z.array(z.string().uuid()).max(200).optional(),
  all: z.boolean().default(false),
});

export const POST = withApi(async ({ req, db, companyId, session }) => {
  const body = await parseBody(req, schema);
  if (body.all) {
    await db.query(
      `update notifications set read_at = now()
       where company_id = $1 and (user_id is null or user_id = $2) and read_at is null`,
      [companyId, session.userId]
    );
  } else if (body.ids?.length) {
    await db.query(
      `update notifications set read_at = now()
       where company_id = $1 and (user_id is null or user_id = $2) and id = any($3::uuid[]) and read_at is null`,
      [companyId, session.userId, body.ids]
    );
  }
  return { ok: true };
});
