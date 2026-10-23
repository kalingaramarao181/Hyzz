import { z } from "zod";
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_API_URL: z.url().default("https://api.srtechcreators.in"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  TRUST_PROXY: z.enum(["none", "loopback"]).default("none"),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  VERCEL: z.string().optional(),
  GOOGLE_AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
  SMS_AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
  PUSH_ENABLED: z.enum(["true", "false"]).default("false"),
  BANK_DETAILS_ENCRYPTION_KEY: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  ROUTING_URL: z.url().default("https://router.project-osrm.org"),
  RATE_LIMIT_STORE: z.enum(["memory", "database"]).default("database"),
  AUTH_EMAIL_DELIVERY: z.enum(["supabase", "smtp"]).default("smtp"),
  SMTP_HOST: z.string().default("smtp.ionos.com"),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default("ramarao.teamweb@bedatatech.com"),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM_ADDRESS: z.email().default("ramarao.teamweb@bedatatech.com"),
  MAIL_FROM_NAME: z.string().default("Hyzz"),
  MAIL_ENCRYPTION: z.enum(["tls", "ssl"]).default("tls"),
  REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(120),
  AUTH_REQUESTS_PER_15_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(20),
});
export function loadConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      "Invalid server environment: " +
        result.error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("; "),
    );
  const c = result.data;
  if (
    c.PUSH_ENABLED === "true" &&
    (!c.CRON_SECRET || c.CRON_SECRET.length < 32)
  )
    throw new Error(
      "PUSH_ENABLED requires a server-only CRON_SECRET of at least 32 characters.",
    );
  if (
    c.AUTH_EMAIL_DELIVERY === "smtp" &&
    (!c.SMTP_PASS || !c.SUPABASE_SERVICE_ROLE_KEY)
  )
    throw new Error(
      "SMTP delivery requires SMTP_PASS and SUPABASE_SERVICE_ROLE_KEY in server environment variables.",
    );
  c.origins = c.ALLOWED_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    new URL(c.SUPABASE_URL).protocol !== "https:" &&
    c.NODE_ENV === "production"
  )
    throw new Error("Production Supabase URL must use HTTPS");
  if (
    c.NODE_ENV === "production" &&
    (new URL(c.PUBLIC_API_URL).protocol !== "https:" ||
      c.origins.some((o) => !o.startsWith("https://")))
  )
    throw new Error("Production API and admin origins must use HTTPS");
  return c;
}
