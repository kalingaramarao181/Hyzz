import { createClient } from "@supabase/supabase-js";
import transport from "./transport.cjs";
export function createHyzzClient({
  baseURL,
  auth = {},
  fetchImpl = globalThis.fetch,
}) {
  const base = transport.apiURL(baseURL);
  const send = async (input, init) => {
    const url = transport.rewriteProviderURL(input, base);
    try {
      const response = await fetchImpl(url, init);
      if ([502, 503, 504].includes(response.status)) {
        // This SDK reads response.message without parsing these error bodies.
        // Without it, React Native serializes the entire Response into the UI.
        Object.defineProperty(response, "message", {
          value: "Hyzz is temporarily unavailable. Please try again later.",
          configurable: true,
        });
      }
      return response;
    } catch {
      throw new Error(
        "Cannot reach the Hyzz API. Check your internet connection and API server configuration.",
      );
    }
  };
  // A non-secret marker, not a Supabase credential. Node replaces provider credentials server-side.
  const client = createClient(
    base + "/api/v1/provider",
    "hyzz-node-api-public",
    { global: { fetch: send }, auth: { ...auth, detectSessionInUrl: false } },
  );
  const originalFrom = client.storage.from.bind(client.storage);
  client.storage.from = (bucket) => {
    if (!['driver-documents','customer-vehicles'].includes(bucket))
      throw new Error("Unsupported document bucket");
    const storage = originalFrom(bucket);
    const documentPrefix='/api/v1/documents/'+(bucket==='customer-vehicles'?'vehicles/':'');
    storage.upload = async (path, file, options = {}) => {
      try {
        if (options.upsert)
          throw new Error("Document replacement is not permitted");
        const {
          data: { session },
        } = await client.auth.getSession();
        const body = new FormData();
        body.append("file", file);
        const response = await fetchImpl(
          base +
            documentPrefix+'upload/' +
            path.split("/").map(encodeURIComponent).join("/"),
          {
            method: "POST",
            headers: { Authorization: "Bearer " + session?.access_token },
            body,
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.message || "Document upload rejected");
        return {
          data: { path, id: result.Id, fullPath: result.Key },
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    };
    storage.createSignedUrl = async (path, expiresIn) => {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const result = await fetchImpl(
          base +
            documentPrefix+'sign/' +
            path.split("/").map(encodeURIComponent).join("/"),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + session?.access_token,
            },
            body: JSON.stringify({ expiresIn }),
          },
        );
        const body = await result.json();
        if (!result.ok)
          throw new Error(body.message || "Document access rejected");
        return { data: { signedUrl: body.signedURL }, error: null };
      } catch (error) {
        return { data: null, error };
      }
    };
    return storage;
  };
  // No provider WebSocket connection: foreground screens reconcile through Node HTTP polling.
  return client;
}
export async function action(client, name, params = {}) {
  const { data, error } = await client.rpc(name, params);
  if (error)
    throw new Error(error.message || "The Hyzz API rejected this request.");
  return data;
}
