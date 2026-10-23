// Auth/session parsing uses the maintained SDK; network requests go to Node.
function apiURL(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new Error(
      "API URL must use HTTPS. Localhost/emulator HTTP is allowed for development.",
    );
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Use the API origin without /api/v1 or credentials.");
  return url.origin;
}
function rewriteProviderURL(input, baseURL) {
  const base = apiURL(baseURL),
    url = new URL(typeof input === "string" ? input : input.url);
  const prefix = "/api/v1/provider";
  if (url.origin !== base || !url.pathname.startsWith(prefix + "/"))
    throw new Error("Blocked request outside the configured Hyzz API.");
  const path = url.pathname.slice(prefix.length);
  let target;
  if (path.startsWith("/auth/v1/"))
    target = "/auth/" + path.slice("/auth/v1/".length);
  else if (path.startsWith("/rest/v1/rpc/"))
    target = "/actions/" + path.slice("/rest/v1/rpc/".length);
  else if (path.startsWith("/rest/v1/")) {
    const table = path.slice("/rest/v1/".length);
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unsupported data path");
    target = "/data/" + table;
  } else if (path === "/functions/v1/admin-accounts")
    target = "/admin/accounts";
  else if (path.startsWith("/storage/v1/object/driver-documents/"))
    target =
      "/documents/upload/" +
      path.slice("/storage/v1/object/driver-documents/".length);
  else throw new Error("This operation has no Hyzz Node API route.");
  return base + "/api/v1" + target + url.search;
}
module.exports = { apiURL, rewriteProviderURL };
