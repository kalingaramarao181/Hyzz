import { randomUUID } from "node:crypto";
export function requestId(req, res, next) {
  req.id = randomUUID();
  res.set("X-Request-Id", req.id);
  res.set("Cache-Control", "no-store");
  next();
}
export function fail(status, message, code = "HYZZ_ERROR") {
  return Object.assign(new Error(message), { status, code });
}
export function authenticate(provider, { active = true } = {}) {
  return async (req, res, next) => {
    try {
      const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(
        req.get("Authorization") || "",
      );
      if (!match || match[1].length > 12000)
        throw fail(401, "Sign in with a valid session.", "NOT_AUTHENTICATED");
      const identity = await provider.identify(match[1]);
      if (!identity)
        throw fail(
          401,
          "Session expired. Please sign in again.",
          "NOT_AUTHENTICATED",
        );
      req.token = match[1];
      req.user = identity.user;
      req.db = identity.client;
      if (active) {
        const { data, error } = await req.db.rpc("my_profile");
        if (error) {
          if (error.code === "PGRST202")
            throw fail(
              503,
              "Apply the Hyzz database migrations before using the API.",
              "SETUP_REQUIRED",
            );
          throw fail(
            403,
            "An active Hyzz account is required.",
            "ACCOUNT_INACTIVE",
          );
        }
        req.profile = data;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success)
      return next(
        fail(
          400,
          result.error.issues
            .map((i) => `${i.path.join(".") || "request"}: ${i.message}`)
            .join("; "),
          "VALIDATION_ERROR",
        ),
      );
    req.body = result.data;
    next();
  };
}
export function permission(name) {
  return (req, res, next) =>
    req.profile?.permissions?.includes(name)
      ? next()
      : next(
          fail(403, "You do not have permission for this action.", "FORBIDDEN"),
        );
}
export function errors(err, req, res, _next) {
  let status = err.status || 500;
  if (err.type === "entity.too.large" || err.code === "LIMIT_FILE_SIZE")
    status = 413;
  else if (err.name === "MulterError") status = 400;
  if (err instanceof SyntaxError && "body" in err) status = 400;
  const safe =
    status < 500
      ? err.message
      : status === 503
        ? err.message
        : "The service is temporarily unavailable. Please retry.";
  console.error(
    JSON.stringify({
      event: "request_failed",
      requestId: req.id,
      status,
      code: err.code || "INTERNAL_ERROR",
    }),
  );
  res
    .status(status)
    .json({
      message: safe,
      error: safe,
      code: err.code || "REQUEST_FAILED",
      request_id: req.id,
    });
}
export function relay(res, result) {
  if (result.status >= 400) {
    const message =
      result.data?.message ||
      result.data?.msg ||
      result.data?.error_description ||
      result.data?.error ||
      "Request rejected";
    return res
      .status(result.status)
      .json({
        message: typeof message === "string" ? message : "Request rejected",
        code:
          result.data?.code || result.data?.error_code || "PROVIDER_REJECTED",
      });
  }
  if (result.contentRange) res.set("Content-Range", result.contentRange);
  if (result.status === 204) return res.status(204).end();
  return res.status(result.status).json(result.data);
}
