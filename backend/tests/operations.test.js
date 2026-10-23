import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { readFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { inspectApk } from "../src/modules/releases.js";
const id = "11111111-1111-4111-8111-111111111111";
const bytes = Buffer.from(
  JSON.parse(
    await readFile(
      new URL("./fixtures/apk-structure.json", import.meta.url),
      "utf8",
    ),
  ).base64,
  "base64",
);
const config = {
  TRUST_PROXY: "none",
  origins: ["https://hyzz.srtechcreators.in"],
  RATE_LIMIT_PER_MINUTE: 1000,
  AUTH_REQUESTS_PER_15_MINUTES: 20,
};
function fixture(permissions = ["releases.manage", "users.manage"]) {
  const calls = [],
    row = {
      id,
      audience: "driver",
      version: "1.5.0",
      version_code: 7,
      storage_path: "driver/" + id + ".apk",
    };
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "my_profile")
        return { data: { kind: "employee", permissions } };
      if (name === "admin_release_draft") return { data: row };
      return { data: null };
    },
  };
  const admin = {
    auth: {
      admin: {
        createUser: async () => ({ data: { user: { id } } }),
        deleteUser: async () => ({}),
      },
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data:
          name === "api_release_record"
            ? row
            : name === "api_public_content"
              ? []
              : 0,
      };
    },
    storage: {
      from: (bucket) => {
        assert.equal(bucket, "app-releases");
        return {
          createSignedUploadUrl: async (path, options) => {
            calls.push({ path, options });
            return {
              data: { signedUrl: "https://storage.example.invalid/upload" },
            };
          },
          download: async () => ({ data: new Blob([bytes]) }),
          createSignedUrl: async () => ({
            data: { signedUrl: "https://storage.example.invalid/download" },
          }),
        };
      },
    },
  };
  return {
    calls,
    row,
    app: createApp({
      config,
      provider: {
        identify: async (token) =>
          token === "fixture" ? { user: { id }, client } : null,
        admin: () => admin,
      },
    }),
  };
}
test("APK inspection reads bounded metadata and rejects malformed/non-APK archives", async () => {
  const cfg = await inspectApk(bytes);
  assert.equal(cfg.android.versionCode, 7);
  assert.equal(cfg.extra.appVariant, "driver");
  await assert.rejects(() => inspectApk(Buffer.alloc(2000)), /valid APK/);
  await assert.rejects(() => inspectApk(Buffer.alloc(10)), /between/);
});
test("release draft requires authenticated release permission before issuing an upload capability", async () => {
  const f = fixture([]);
  const payload = {
    audience: "driver",
    version: "1.5.0",
    version_code: 7,
    notes: "Fixture release",
  };
  assert.equal(
    (await request(f.app).post("/api/v1/admin/releases/upload").send(payload))
      .status,
    401,
  );
  assert.equal(
    (
      await request(f.app)
        .post("/api/v1/admin/releases/upload")
        .set("Authorization", "Bearer fixture")
        .send(payload)
    ).status,
    403,
  );
  assert.equal(
    f.calls.some((c) => c.name === "admin_release_draft"),
    false,
  );
});
test("release publishing checks uploaded bytes, embedded audience/version and administrator confirmation", async () => {
  const f = fixture();
  const r = await request(f.app)
    .post("/api/v1/admin/releases/" + id + "/publish")
    .set("Authorization", "Bearer fixture")
    .send({ signature_checked: true });
  assert.equal(r.status, 200);
  assert.match(r.body.sha256, /^[a-f0-9]{64}$/);
  const call = f.calls.find((c) => c.name === "api_publish_release");
  assert.equal(call.args.p_actor, id);
  assert.equal(call.args.p_bytes, bytes.length);
  f.row.audience = "customer";
  assert.equal(
    (
      await request(f.app)
        .post("/api/v1/admin/releases/" + id + "/publish")
        .set("Authorization", "Bearer fixture")
        .send({ signature_checked: true })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(f.app)
        .post("/api/v1/admin/releases/" + id + "/publish")
        .set("Authorization", "Bearer fixture")
        .send({ signature_checked: false })
    ).status,
    400,
  );
});
test("release uploads target server-generated immutable storage paths", async () => {
  const f = fixture();
  const r = await request(f.app)
    .post("/api/v1/admin/releases/upload")
    .set("Authorization", "Bearer fixture")
    .send({
      audience: "driver",
      version: "1.5.0",
      version_code: 7,
      notes: "Fixture release",
    });
  assert.equal(r.status, 200);
  assert.equal(r.body.path, "driver/" + id + ".apk");
  assert.deepEqual(f.calls.find((c) => c.path)?.options, { upsert: false });
});
test("public contact requires consent and valid fields; private enquiry actor fields are rejected", async () => {
  const f = fixture();
  const payload = {
    name: "Visitor",
    email: "visitor@example.invalid",
    topic: "customer",
    message: "Please explain the booking process.",
    consent: true,
    website: "",
  };
  assert.equal(
    (
      await request(f.app)
        .post("/api/v1/public/contact")
        .send({ ...payload, consent: false })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(f.app)
        .post("/api/v1/public/contact")
        .send({ ...payload, user_id: id })
    ).status,
    400,
  );
  assert.equal(
    (await request(f.app).post("/api/v1/public/contact").send(payload)).status,
    201,
  );
  assert.equal(
    f.calls.find((c) => c.name === "api_contact_enquiry").args.p_topic,
    "customer",
  );
});
test("administrators can provision customers without granting staff access", async () => {
  const f = fixture();
  const r = await request(f.app)
    .post("/api/v1/admin/accounts")
    .set("Authorization", "Bearer fixture")
    .send({
      name: "Fixture Customer",
      email: "customer@example.invalid",
      kind: "customer",
    });
  assert.equal(r.status, 201);
  assert.equal(
    f.calls.find((c) => c.name === "admin_provision_user").args.p_kind,
    "customer",
  );
  assert.equal(
    f.calls.find((c) => c.name === "admin_provision_user").args.p_role,
    null,
  );
});
