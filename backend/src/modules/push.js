import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { fail } from "../middleware/security.js";
export async function processPush(
  provider,
  config,
  fetcher = globalThis.fetch,
) {
  const db = provider.admin();
  if (!db) throw fail(503, "Server service key required.");
  const offered = await db.rpc("api_offer_scan");
  if (offered.error) throw fail(503, "Apply migration 007.", "SETUP_REQUIRED");
  const releases=await db.rpc('api_release_notifications');
  if(releases.error)throw fail(503,'Apply release migration 010.','SETUP_REQUIRED');
  if (config.PUSH_ENABLED !== "true")
    return { push_enabled: false, offers: offered.data };
  const { data: jobs, error } = await db.rpc("api_push_claim", { p_limit: 10 });
  if (error) throw fail(503, "Push queue unavailable.");
  // One message per request: customer and driver use separate Expo projects.
  // Bound the claim to ten so parallel HTTP requests remain safe for serverless workers.
  await Promise.all(
    jobs.map(async (job) => {
      try {
        const response = await fetcher("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.EXPO_ACCESS_TOKEN
              ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` }
              : {}),
          },
          body: JSON.stringify([
            {
              to: job.token,
              sound: "default",
              title: "Hyzz",
              body: job.title,
              data: { bookingId: job.booking_id, releaseId: job.release_id },
              channelId: "bookings",
            },
          ]),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("Push provider rejected request");
        const result = await response.json(),
          ticket = result.data?.[0];
        await db.rpc("api_push_result", {
          p_id: job.id,
          p_ticket: ticket?.status === "ok" ? ticket.id : null,
          p_error:
            ticket?.status === "ok"
              ? null
              : ticket?.details?.error || "ProviderError",
        });
      } catch {
        await db.rpc("api_push_result", {
          p_id: job.id,
          p_error: "TransportError",
        });
      }
    }),
  );
  const { data: receipts } = await db.rpc("api_push_receipts");
  if (receipts?.length) {
    try {
      const r = await fetcher("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({ ids: receipts.map((v) => v.ticket) }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const result = await r.json();
        for (const item of receipts) {
          const receipt = result.data?.[item.ticket];
          if (receipt)
            await db.rpc("api_push_receipt", {
              p_id: item.id,
              p_ok: receipt.status === "ok",
              p_error: receipt.details?.error || null,
            });
        }
      }
    } catch {
      /* Unresolved receipts remain queued for the next scheduled invocation. */
    }
  }
  return { push_enabled: true, offers: offered.data, processed: jobs.length };
}
export function pushWorker(provider, config) {
  const router = Router();
  router.get("/push", async (req, res) => {
    const expected = config.CRON_SECRET,
      provided = (req.get("Authorization") || "").replace(/^Bearer /, "");
    if (
      !expected ||
      Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    )
      throw fail(401, "Worker authorization required.");
    return res.json(await processPush(provider, config));
  });
  return router;
}
