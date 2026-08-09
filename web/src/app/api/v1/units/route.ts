import { z } from "zod";
import { makeSimpleCrud } from "@/lib/simpleCrud";
const schema = z.object({
  name: z.string().min(1).max(60),
  abbreviation: z.string().min(1).max(10),
  allowDecimal: z.boolean().default(false),
});
const crud = makeSimpleCrud({
  table: "units", entityType: "unit",
  viewPerm: "products.view", managePerm: "products.edit",
  columns: { name: "name", abbreviation: "abbreviation", allowDecimal: "allow_decimal" },
  schema, softDelete: false,
});
export const GET = crud.list;
export const POST = crud.create;
