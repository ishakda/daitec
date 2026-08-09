import { z } from "zod";
import { makeSimpleCrud } from "@/lib/simpleCrud";
const schema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().uuid().nullish(),
});
const crud = makeSimpleCrud({
  table: "product_categories", entityType: "category",
  viewPerm: "products.view", managePerm: "products.edit",
  columns: { name: "name", parentId: "parent_id" },
  schema,
});
export const GET = crud.list;
export const POST = crud.create;
