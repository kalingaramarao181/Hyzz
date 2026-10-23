import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authenticate, fail, relay, validate } from "../middleware/security.js";
import { limiter } from "../middleware/limits.js";
import { createHash } from "node:crypto";
const meta = z
  .object({ captcha_token: z.string().max(4096).optional() })
  .optional();
const otp = z
  .object({
    email: z.email().max(254).optional(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    channel: z.literal("sms").optional(),
    create_user: z.boolean().default(true),
    data: z.record(z.string(), z.unknown()).optional(),
    gotrue_meta_security: meta,
    code_challenge: z.string().max(200).nullable().optional(),
    code_challenge_method: z.enum(["s256", "plain"]).nullable().optional(),
  })
  .strict()
  .refine((v) => !!v.email !== !!v.phone, {
    message: "Provide either email or international phone number.",
  });
const verify = z
  .object({
    email: z.email().max(254).optional(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    token: z.string().regex(/^\d{6,10}$/),
    type: z.enum(["email", "sms"]),
    gotrue_meta_security: meta,
  })
  .strict()
  .refine(
    (v) =>
      !!v.email !== !!v.phone &&
      (v.email ? v.type === "email" : v.type === "sms"),
    { message: "Use the matching email or SMS verification type." },
  );
export function authRoutes(provider, config, mailer) {
  const router = Router();
  const limit = limiter(provider, config, {
    name: "auth",
    seconds: 900,
    limit: config.AUTH_REQUESTS_PER_15_MINUTES,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      message: "Too many sign-in attempts. Please wait and retry.",
      code: "RATE_LIMITED",
    },
  });
  router.post("/otp", limit, validate(otp), async (req, res) => {
    if (req.body.phone) {
      if (config.SMS_AUTH_ENABLED !== "true")
        throw fail(400, "Phone sign-in is not available yet. Use email.");
      return relay(
        res,
        await provider.request("/auth/v1/otp", {
          method: "POST",
          body: { ...req.body, data: {}, channel: "sms" },
        }),
      );
    }
    if (mailer) {
      const admin = provider.admin();
      if (!admin)
        throw fail(
          503,
          "Configure the server service credential.",
          "SETUP_REQUIRED",
        );
      const email = req.body.email.trim().toLowerCase();
      if (config.RATE_LIMIT_STORE === "database") {
        const key = createHash("sha256").update(email).digest("hex");
        const { data: allowed, error } = await admin.rpc(
          "api_take_rate_limit",
          { p_key: "email:" + key, p_limit: 3, p_seconds: 900 },
        );
        if (error)
          throw fail(
            503,
            "Email rate limiter unavailable. Apply migration 004.",
            "SETUP_REQUIRED",
          );
        if (allowed !== true)
          throw fail(
            429,
            "Too many codes requested for this address. Please wait 15 minutes.",
            "RATE_LIMITED",
          );
      }
      if (!req.body.create_user) {
        const { data, error } = await admin.rpc("api_email_exists", {
          p_email: email,
        });
        if (error)
          throw fail(
            503,
            "Apply migration 004 before enabling SMTP.",
            "SETUP_REQUIRED",
          );
        // A generic result avoids revealing whether a staff/driver email exists.
        if (!data) return res.json({});
      }
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (error || !data?.properties?.email_otp)
        throw fail(
          503,
          "Unable to issue a sign-in code. Retry shortly.",
          "AUTH_UNAVAILABLE",
        );
      await mailer.sendCode(email, data.properties.email_otp);
      return res.json({});
    }
    return relay(
      res,
      await provider.request("/auth/v1/otp", {
        method: "POST",
        body: { ...req.body, data: {} },
      }),
    );
  });
  router.post("/verify", limit, validate(verify), async (req, res) =>
    req.body.phone && config.SMS_AUTH_ENABLED !== "true"
      ? Promise.reject(
          fail(400, "Phone sign-in is not available yet. Use email."),
        )
      : relay(
          res,
          await provider.request("/auth/v1/verify", {
            method: "POST",
            body: req.body,
          }),
        ),
  );
  router.post(
    "/token",
    (req, res, next) => {
      if (
        req.query.grant_type === "pkce" &&
        config.GOOGLE_AUTH_ENABLED === "true"
      )
        return validate(
          z
            .object({
              auth_code: z.string().min(1).max(2048),
              code_verifier: z.string().min(43).max(128),
            })
            .strict(),
        )(req, res, next);
      return validate(
        z.object({ refresh_token: z.string().min(10).max(16000) }).strict(),
      )(req, res, next);
    },
    async (req, res) => {
      if (
        req.query.grant_type !== "refresh_token" &&
        !(
          req.query.grant_type === "pkce" &&
          config.GOOGLE_AUTH_ENABLED === "true"
        )
      )
        throw fail(400, "Only refresh-token sessions are supported.");
      return relay(
        res,
        await provider.request(
          "/auth/v1/token?grant_type=" + req.query.grant_type,
          {
            method: "POST",
            body: req.body,
          },
        ),
      );
    },
  );
  router.get("/authorize", limit, (req, res) => {
    if (config.GOOGLE_AUTH_ENABLED !== "true")
      throw fail(400, "Google sign-in is not enabled yet. Use email.");
    const {
      provider: kind,
      redirect_to: redirect,
      code_challenge: challenge,
      code_challenge_method: method,
    } = req.query;
    if (
      kind !== "google" ||
      !["hyzzcustomer://auth/callback", "hyzzdriver://auth/callback"].includes(
        redirect,
      ) ||
      method !== "s256" ||
      typeof challenge !== "string" ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)
    )
      throw fail(400, "Invalid OAuth provider, redirect or PKCE challenge.");
    const url = new URL("/auth/v1/authorize", config.SUPABASE_URL);
    for (const [k, v] of Object.entries({
      provider: "google",
      redirect_to: redirect,
      code_challenge: challenge,
      code_challenge_method: "s256",
    }))
      url.searchParams.set(k, v);
    res.redirect(302, url.toString());
  });
  router.get(
    "/user",
    authenticate(provider, { active: false }),
    async (req, res) => res.json(req.user),
  );
  router.post(
    "/logout",
    authenticate(provider, { active: false }),
    async (req, res) => {
      const scope = req.query.scope || "global";
      if (!["global", "local", "others"].includes(scope))
        throw fail(400, "Invalid logout scope.");
      return relay(
        res,
        await provider.request(`/auth/v1/logout?scope=${scope}`, {
          method: "POST",
          token: req.token,
        }),
      );
    },
  );
  return router;
}
