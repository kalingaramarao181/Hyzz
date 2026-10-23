import test from "node:test";
import assert from "node:assert/strict";
import { processPush } from "../src/modules/push.js";
function fixture() {
  const results = [];
  return {
    results,
    provider: {
      admin: () => ({
        rpc: async (name, args) => {
          if (name === "api_offer_scan") return { data: 2 };
          if (name === "api_release_notifications") return {data:0};
          if (name === "api_push_claim")
            return {
              data: [
                {
                  id: "one",
                  token: "ExpoPushToken[driver]",
                  title: "Trip update",
                },
                {
                  id: "two",
                  token: "ExpoPushToken[customer]",
                  title: "Trip update",
                },
              ],
            };
          if (name === "api_push_receipts") return { data: [] };
          results.push({ name, args });
          return { data: null };
        },
      }),
    },
  };
}
test("push messages from separate applications are never mixed into one Expo project batch", async () => {
  const f = fixture(),
    sent = [];
  const result = await processPush(
    f.provider,
    { PUSH_ENABLED: "true" },
    async (url, options) => {
      sent.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          data: [{ status: "ok", id: "ticket-" + sent.length }],
        }),
      };
    },
  );
  assert.equal(result.processed, 2);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((batch) => batch.length === 1));
  assert.ok(f.results.every((r) => r.args.p_ticket && r.args.p_error === null));
});
test("push transport failure returns jobs to the durable SQL retry policy", async () => {
  const f = fixture();
  await processPush(f.provider, { PUSH_ENABLED: "true" }, async () => {
    throw new Error("Offline");
  });
  assert.equal(f.results.length, 2);
  assert.ok(f.results.every((r) => r.args.p_error === "TransportError"));
});
test("disabled remote push still scans offers without sending any provider message", async () => {
  const f = fixture();
  const result = await processPush(
    f.provider,
    { PUSH_ENABLED: "false" },
    async () => {
      throw new Error("Must not send");
    },
  );
  assert.equal(result.push_enabled, false);
  assert.equal(f.results.length, 0);
});
