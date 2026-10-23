import { Router } from "express";
import { fail, relay } from "../middleware/security.js";
const tables = {
  bookings: ["created_at"],
  support_tickets: ["created_at"],
  driver_documents: ["created_at"],
  financial_ledger_entries: ["created_at"],
  notification_records: ["created_at"],
  pricing_rules: ["effective_at", "created_at"],
  system_settings: [],
  roles: [],
  role_permissions: ["role_id"],
  account_deletion_requests: ["requested_at"],
  service_areas: [],
  customer_vehicles: ['created_at'],
  vehicle_documents: ['created_at'],
};
export function dataRoutes(provider) {
  const router = Router();
  router.get("/:table", async (req, res) => {
    const fields = tables[req.params.table];
    if (!fields) throw fail(404, "This data resource is unavailable.");
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value !== "string") throw fail(400, "Invalid query.");
      if (key === "select") {
        if (
          value.length > 1000 ||
          !/^([a-z_]+|\*)(,([a-z_]+|\*))*$/.test(value)
        )
          throw fail(400, "Select only ordinary columns.");
        q.set(key, value);
      } else if (key === "order") {
        if (
          !value.split(",").every((v) => {
            const [field, ...options] = v.split(".");
            return (
              fields.includes(field) &&
              options.every((o) =>
                ["asc", "desc", "nullsfirst", "nullslast"].includes(o),
              )
            );
          })
        )
          throw fail(400, "Unsupported sort.");
        q.set(key, value);
      } else if (key === "limit" || key === "offset") {
        if (!/^\d+$/.test(value)) throw fail(400, "Invalid pagination.");
        const number = Number(value);
        if (number > (key === "limit" ? 1000 : 100000))
          throw fail(400, "Pagination exceeds limit.");
        q.set(key, value);
      } else if (
        key === "role_id" &&
        req.params.table === "role_permissions" &&
        /^eq\.[a-z_]{1,40}$/.test(value)
      ) {
        q.set(key, value);
      } else throw fail(400, "Unsupported query filter.");
    }
    if (!q.has("limit")) q.set("limit", "100");
    const accept =
      req.get("Accept") === "application/vnd.pgrst.object+json"
        ? "application/vnd.pgrst.object+json"
        : "application/json";
    return relay(
      res,
      await provider.request(`/rest/v1/${req.params.table}?${q}`, {
        token: req.token,
        headers: { Accept: accept },
      }),
    );
  });
  return router;
}
