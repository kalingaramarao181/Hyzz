import { Router } from "express";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fail, validate } from "../middleware/security.js";
const contracts = JSON.parse(
  readFileSync(new URL("./action-contracts.json", import.meta.url), "utf8"),
);
function field(key, s) {
  if (s.anyOf) {
    const nonNull = s.anyOf.find((x) => x.type !== "null");
    return field(key, nonNull).nullable();
  }
  if (s.enum) return z.enum(s.enum);
  if (s.type === "boolean") return z.boolean();
  if (s.type === "array") return z.array(z.string().max(100)).max(16);
  if (s.type === "integer") {
    let v = z.number().int().safe();
    if (["p_hours", "p_score", "p_radius", "p_expiry"].includes(key))
      return v
        .min(1)
        .max(
          key === "p_score"
            ? 5
            : key === "p_hours"
              ? 24
              : key === "p_radius"
                ? 100
                : 60,
        );
    return v.min(0).max(key === "p_commission" ? 10000 : 100000000);
  }
  if (s.type === "number" && key === "p_km")
    return z.number().min(0).max(10000);
  if (s.type === "number")
    return z
      .number()
      .min(key.endsWith("_lat") ? -90 : key.endsWith("_lng") ? -180 : 0)
      .max(
        key.endsWith("_lat")
          ? 90
          : key.endsWith("_lng")
            ? 180
            : key === "p_heading"
              ? 360
              : key === "p_speed"
                ? 150
                : 10000,
      );
  if (s.format === "uuid") return z.uuid();
  if (s.format === "date") return z.iso.date();
  if (s.format === "date-time") return z.iso.datetime({ offset: true });
  if (key === "p_code") return z.string().regex(/^\d{6}$/);
  return z
    .string()
    .max(key === "p_body" ? 12000 : key === "p_notes" ? 2000 : key === "p_address" ? 500 : key === "p_name" ? 100 : 1000);
}
export function actionRoutes(provider) {
  const router = Router();
  router.post(
    "/:action",
    (req, res, next) => {
      const contract = contracts[req.params.action];
      if (!contract)
        return next(fail(404, "This action is not exposed by the API."));
      const properties = {};
      for (const [key, type] of Object.entries(contract.properties)) {
        let v = field(key, type);
        if (!contract.required.includes(key)) v = v.optional();
        properties[key] = v;
      }
      return validate(z.object(properties).strict())(req, res, next);
    },
    async (req, res) => {
      const { data, error } = await req.db.rpc(req.params.action, req.body);
      if (error) {
        if (error.code === "PGRST202" || error.code === "42P01")
          throw fail(
            503,
            "Apply the supplied database migrations.",
            "SETUP_REQUIRED",
          );
        const message =
          error.code === "23505"
            ? "This action has already been recorded."
            : error.code?.startsWith("23")
              ? "The operation failed a data integrity check. Review the submitted values."
              : error.message;
        throw fail(error.code === "42501" ? 403 : 400, message, error.code);
      }
      if (
        ["create_service_booking", "set_availability"].includes(
          req.params.action,
        )
      ) {
        // Offer creation is best effort; booking success never depends on remote notification delivery.
        try {
          await provider?.admin()?.rpc("api_offer_scan");
        } catch {}
      }
      return res.json(data);
    },
  );
  return router;
}
