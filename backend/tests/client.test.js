import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import request from "supertest";
import { createApp } from "../src/app.js";
const require = createRequire(import.meta.url);
let source = await readFile(
  new URL("../../frontend/shared/api/client.js", import.meta.url),
  "utf8",
);
source = source
  .replace(
    '"@supabase/supabase-js"',
    JSON.stringify(
      pathToFileURL(require.resolve("@supabase/supabase-js")).href,
    ),
  )
  .replace(
    '"./transport.cjs"',
    JSON.stringify(
      new URL("../../frontend/shared/api/transport.cjs", import.meta.url).href,
    ),
  );
const { createHyzzClient } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("browser preflight permits actual admin SDK RPC and table headers", async () => {
  const origin = "https://hyzz.srtechcreators.in";
  const app = createApp({config:{TRUST_PROXY:"none",origins:[origin],RATE_LIMIT_PER_MINUTE:1000},provider:{}});
  const calls=[];
  const client=createHyzzClient({baseURL:"https://api.srtechcreators.in",auth:{persistSession:false,autoRefreshToken:false},fetchImpl:async(url,init)=>{
    const headers=new Headers(init.headers);
    const names=[...headers.keys()].filter(name=>!["accept","accept-language","content-language"].includes(name));
    const preflight=await request(app).options(new URL(url).pathname).set("Origin",origin).set("Access-Control-Request-Method",init.method||"GET").set("Access-Control-Request-Headers",names.join(","));
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers["access-control-allow-origin"],origin);
    const allowed=preflight.headers["access-control-allow-headers"].toLowerCase().split(",").map(v=>v.trim());
    for(const name of names)assert.ok(allowed.includes(name),"Browser would block SDK header: "+name);
    calls.push({url,headers});
    return new Response(JSON.stringify(url.includes("/actions/")?{users:[],drivers:[],bookings:[]}:[]),{status:200,headers:{"Content-Type":"application/json","Content-Range":"0-0/0"}});
  }});
  try {
    assert.equal((await client.rpc("admin_overview")).error,null);
    assert.equal((await client.from("bookings").select("*",{count:"exact"}).range(0,49)).error,null);
    assert.equal(calls[0].headers.get("content-profile"),"public");
    assert.equal(calls[1].headers.get("accept-profile"),"public");
    assert.match(calls[1].headers.get("prefer"),/count=exact/);
    const denied=await request(app).options("/api/v1/actions/admin_overview").set("Origin","https://untrusted.invalid").set("Access-Control-Request-Method","POST").set("Access-Control-Request-Headers","content-profile");
    assert.equal(denied.status,403);
    assert.equal(denied.headers["access-control-allow-origin"],undefined);
  }finally{await client.auth.stopAutoRefresh();}
});
test("the actual frontend Auth SDK calls Node OTP and verification paths", async () => {
  const calls = [];
  const client = createHyzzClient({
    baseURL: "https://api.srtechcreators.in",
    auth: { persistSession: false, autoRefreshToken: false },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ message_id: "local-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const otp = await client.auth.signInWithOtp({
    email: "customer@test.invalid",
    options: { shouldCreateUser: true },
  });
  assert.equal(otp.error, null);
  assert.equal(calls[0].url, "https://api.srtechcreators.in/api/v1/auth/otp");
  assert.equal(calls[0].body.create_user, true);
  assert.equal(calls[0].body.email, "customer@test.invalid");
  await client.auth.verifyOtp({
    email: "customer@test.invalid",
    type: "email",
    token: "123456",
  });
  assert.equal(
    calls[1].url,
    "https://api.srtechcreators.in/api/v1/auth/verify",
  );
  await client.auth.stopAutoRefresh();
});

test("actual SDK null challenge fields pass Node OTP validation for customer and staff", async () => {
  const calls = [];
  const provider = {
    request: async (path, options) => {
      calls.push({ path, body: options.body });
      return { status: 200, data: {} };
    },
  };
  const app = createApp({
    config: {
      TRUST_PROXY: "none",
      origins: [],
      RATE_LIMIT_STORE: "memory",
      RATE_LIMIT_PER_MINUTE: 1000,
      AUTH_REQUESTS_PER_15_MINUTES: 20,
      AUTH_EMAIL_DELIVERY: "supabase",
    },
    provider,
  });
  const client = createHyzzClient({
    baseURL: "https://api.srtechcreators.in",
    auth: { persistSession: false, autoRefreshToken: false },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.code_challenge, null);
      assert.equal(body.code_challenge_method, null);
      const response = await request(app)
        .post(new URL(url).pathname)
        .send(body);
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  try {
    for (const shouldCreateUser of [true, false]) {
      const result = await client.auth.signInWithOtp({
        email: "sdk-flow@test.invalid",
        options: { shouldCreateUser },
      });
      assert.equal(result.error, null);
      assert.equal(calls.at(-1).body.create_user, shouldCreateUser);
      assert.equal(calls.at(-1).body.code_challenge, null);
    }
    assert.equal(calls.length, 2);
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

test("gateway and unavailable errors show readable messages instead of native Response JSON", async () => {
  for (const status of [502, 503, 504]) {
    const client = createHyzzClient({
      baseURL: "https://api.srtechcreators.in",
      auth: { persistSession: false, autoRefreshToken: false },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            code: "SERVER_SETUP_REQUIRED",
            message: "Internal setup details",
          }),
          {
            status,
            headers: {
              "Content-Type": "application/json",
              "x-internal-detail": "must-not-display",
            },
          },
        ),
    });
    try {
      const result = await client.auth.signInWithOtp({
        email: "unavailable@test.invalid",
      });
      assert.equal(result.error.status, status);
      assert.equal(
        result.error.message,
        "Hyzz is temporarily unavailable. Please try again later.",
      );
      assert.equal(result.error.message.includes("headers"), false);
      assert.equal(result.error.message.includes("Internal setup"), false);
    } finally {
      await client.auth.stopAutoRefresh();
    }
  }
});
