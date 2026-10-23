import { createClient } from "@supabase/supabase-js";
export function createProvider(config) {
  const create = (token, key = config.SUPABASE_PUBLISHABLE_KEY) =>
    createClient(config.SUPABASE_URL, key, {
      global: {
        fetch: (input, init = {}) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
            redirect: "error",
          }),
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  return {
    async identify(token) {
      const client = create(token);
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      return { user: data.user, client };
    },
    client: (token) => create(token),
    admin: () =>
      config.SUPABASE_SERVICE_ROLE_KEY
        ? create(null, config.SUPABASE_SERVICE_ROLE_KEY)
        : null,
    async request(path, { token, method = "GET", body, headers = {} } = {}) {
      // Only server modules construct this path. A client cannot supply another host.
      const h = { apikey: config.SUPABASE_PUBLISHABLE_KEY, ...headers };
      if (token) h.Authorization = `Bearer ${token}`;
      if (body !== undefined) {
        h["Content-Type"] = "application/json";
        body = JSON.stringify(body);
      }
      const response = await fetch(config.SUPABASE_URL + path, {
        method,
        headers: h,
        body,
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
      const raw = await response.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw Object.assign(
          new Error("Upstream service returned an invalid response"),
          { status: 502 },
        );
      }
      return {
        status: response.status,
        data,
        contentRange: response.headers.get("content-range"),
      };
    },
  };
}
