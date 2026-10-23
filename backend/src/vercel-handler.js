import { randomUUID } from "node:crypto";

async function initialize() {
  // Import inside the guarded initializer so missing bundled files are reported too.
  const [{ loadConfig }, { createProvider }, { createApp }] = await Promise.all(
    [import("./config.js"), import("./lib/provider.js"), import("./app.js")],
  );
  const config = loadConfig();
  return createApp({ config, provider: createProvider(config) });
}

export function createVercelHandler(start = initialize) {
  let startup;
  return async (req, res) => {
    let app;
    try {
      startup ||= Promise.resolve().then(start);
      app = await startup;
    } catch (error) {
      const requestId = randomUUID();
      const configuration =
        /^(Invalid server environment:|SMTP delivery requires|Production .*HTTPS)/.test(
          error.message || "",
        );
      const fileFailure = [
        "ENOENT",
        "MODULE_NOT_FOUND",
        "ERR_MODULE_NOT_FOUND",
      ].includes(error.code);
      let detail = fileFailure ? String(error.message || "") : undefined;
      if (detail)
        for (const name of [
          "SMTP_PASS",
          "SUPABASE_SERVICE_ROLE_KEY",
          "SUPABASE_PUBLISHABLE_KEY",
        ]) {
          const secret = process.env[name];
          if (secret && secret.length > 5)
            detail = detail.split(secret).join("[REDACTED]");
        }
      console.error(
        JSON.stringify({
          event: "startup_failed",
          requestId,
          code: configuration
            ? "SERVER_CONFIGURATION_ERROR"
            : error.code || "STARTUP_FAILED",
          message: configuration
            ? error.message
            : "Check installed dependencies and bundled src files, including action-contracts.json.",
          detail,
        }),
      );
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Request-Id", requestId);
      return res.end(
        JSON.stringify({
          code: "SERVER_SETUP_REQUIRED",
          message:
            "Backend startup failed. Check Vercel runtime logs, server environment variables and project Root Directory, then redeploy.",
          request_id: requestId,
        }),
      );
    }
    return app(req, res);
  };
}
