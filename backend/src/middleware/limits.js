import { createHash } from "node:crypto";
import { isIP } from "node:net";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { fail } from "./security.js";
export function limiter(provider, config, { name, seconds, limit }) {
  if (config.RATE_LIMIT_STORE !== "database")
    return rateLimit({
      windowMs: seconds * 1000,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        message: "Too many requests. Please wait and retry.",
        code: "RATE_LIMITED",
      },
    });
  return async (req, res, next) => {
    try {
      const client = provider.admin();
      if (!client)
        throw fail(
          503,
          "Server service credential is required.",
          "SETUP_REQUIRED",
        );
      // Only trust the platform-overwritten header when deployed on Vercel.
      const forwarded =
        config.VERCEL === "1"
          ? req.get("x-vercel-forwarded-for")?.split(",")[0].trim()
          : null;
      const ip = forwarded && isIP(forwarded) ? forwarded : req.ip;
      const hash = createHash("sha256")
        .update(ipKeyGenerator(String(ip)))
        .digest("hex");
      const { data, error } = await client.rpc("api_take_rate_limit", {
        p_key: name + ":" + hash,
        p_limit: limit,
        p_seconds: seconds,
      });
      if (error)
        throw fail(
          503,
          "Database rate limiter is unavailable. Apply migration 004.",
          "SETUP_REQUIRED",
        );
      if (data !== true) {
        res.set("Retry-After", String(seconds));
        throw fail(
          429,
          "Too many requests. Please wait and retry.",
          "RATE_LIMITED",
        );
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
