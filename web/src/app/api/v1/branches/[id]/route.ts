import { z } from "zod";
import { makeSimpleCrud } from "@/lib/simpleCrud";
const schema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  phone: z.string().max(30).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  isActive: z.boolean().optional(),
}).partial();
const crud = makeSimpleCrud({
  table: "branches", entityType: "branch",
  viewPerm: "dashboard.view", managePerm: "settings.manage",
  columns: { name: "name", address: "address", city: "city", phone: "phone", isActive: "is_active", latitude: "latitude", longitude: "longitude" },
  schema,
});
export const PATCH = crud.update;
export const DELETE = crud.remove;
