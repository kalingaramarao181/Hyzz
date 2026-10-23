import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import {
  requestId,
  authenticate,
  errors,
  fail,
} from "./middleware/security.js";
import { authRoutes } from "./modules/auth.js";
import { dataRoutes } from "./modules/data.js";
import { actionRoutes } from "./modules/actions.js";
import { adminRoutes } from "./modules/admin.js";
import { documentRoutes } from "./modules/documents.js";
import { limiter } from "./middleware/limits.js";
import { createMailer } from "./lib/mailer.js";
import { mapRoutes } from "./modules/maps.js";
import { bankRoutes } from "./modules/bank.js";
import { pushWorker } from "./modules/push.js";
import { publicRoutes } from './modules/public.js';
import { releasePublicRoutes, releaseAdminRoutes } from './modules/releases.js';
export function createApp({ config, provider, mailer = createMailer(config) }) {
  const app = express();
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    config.TRUST_PROXY === "loopback" ? "loopback" : false,
  );
  app.use(requestId, helmet());
  app.use(
    cors({
      origin: (origin, cb) =>
        !origin || config.origins.includes(origin)
          ? cb(null, true)
          : cb(fail(403, "This browser origin is not allowed.")),
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        // PostgREST SDK adds schema headers even for the default public schema.
        // Browsers preflight these before sending dashboard RPC/table requests.
        "Content-Profile",
        "Accept-Profile",
        "Prefer",
        "Range",
        "Range-Unit",
        "apikey",
        "x-client-info",
        "x-supabase-api-version",
        "x-upsert",
        "x-hyzz-audience",
      ],
      exposedHeaders: ["Content-Range", "X-Request-Id"],
      methods: ["GET", "POST", "OPTIONS"],
      credentials: false,
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "64kb", strict: true }));
  app.get("/api/v1/capabilities", (_req, res) =>
    res.json({
      google: config.GOOGLE_AUTH_ENABLED === "true",
      phone: config.SMS_AUTH_ENABLED === "true",
      push: config.PUSH_ENABLED === "true",
      tracking: true,
    }),
  );
  app.use("/api/internal", pushWorker(provider, config));
  app.get("/health", (_req, res) =>
    res.json({ status: "ok", service: "hyzz-node-api", version: "1.5.0" }),
  );
  app.use(
    "/api/v1",
    limiter(provider, config, {
      name: "api",
      seconds: 60,
      limit: config.RATE_LIMIT_PER_MINUTE,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        message: "Too many requests. Please retry shortly.",
        code: "RATE_LIMITED",
      },
    }),
  );
  app.use("/api/v1/auth", authRoutes(provider, config, mailer));
  app.use('/api/v1/public',publicRoutes(provider,config));
  app.use('/api/v1/releases',releasePublicRoutes(provider));
  app.use("/api/v1", authenticate(provider));
  app.use("/api/v1/bank", bankRoutes(provider, config));
  app.use('/api/v1/admin/releases',releaseAdminRoutes(provider));
  app.use("/api/v1/maps", mapRoutes(config));
  app.use("/api/v1/actions", actionRoutes(provider));
  app.use("/api/v1/data", dataRoutes(provider));
  app.use("/api/v1/admin", adminRoutes(provider));
  app.use("/api/v1/documents", documentRoutes());
  app.use((_req, _res, next) => next(fail(404, "API route not found.")));
  app.use(errors);
  return app;
}
