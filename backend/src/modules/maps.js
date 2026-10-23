import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/security.js";
const point = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export function mapRoutes(config) {
  const router = Router(),
    cache = new Map();
  router.post(
    "/route",
    validate(z.object({ from: point, to: point }).strict()),
    async (req, res) => {
      const { from, to } = req.body,
        key = JSON.stringify([from, to]);
      const previous = cache.get(key);
      if (previous && previous.until > Date.now())
        return res.json(previous.data);
      try {
        const host = new URL(config.ROUTING_URL);
        if (host.protocol !== "https:")
          throw new Error("Routing provider must use HTTPS");
        const route = await fetch(
          new URL(
            `/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
            host,
          ),
          { signal: AbortSignal.timeout(7000), redirect: "error" },
        );
        if (!route.ok) throw new Error("Route unavailable");
        const data = await route.json(),
          r = data.routes?.[0];
        if (
          data.code !== "Ok" ||
          !r ||
          !Array.isArray(r.geometry?.coordinates) ||
          r.geometry.coordinates.length > 30000
        )
          throw new Error("Invalid route");
        const result = {
          available: true,
          coordinates: r.geometry.coordinates,
          distance_m: r.distance,
          duration_s: r.duration,
        };
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(key, { data: result, until: Date.now() + 300000 });
        return res.json(result);
      } catch {
        return res.json({
          available: false,
          message:
            "Road route is unavailable. Pins and live location still work; open navigation for directions.",
        });
      }
    },
  );
  return router;
}
