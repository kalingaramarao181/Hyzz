import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
const config = {
  NODE_ENV: "test",
  TRUST_PROXY: "none",
  origins: ["http://localhost:5173"],
  RATE_LIMIT_PER_MINUTE: 1000,
  AUTH_REQUESTS_PER_15_MINUTES: 20,
};
test('SMTP sends a provider-generated code without returning it or accepting privilege metadata',async()=>{
 const sent=[],links=[];
 const f=fixture({admin:()=>({auth:{admin:{generateLink:async value=>{links.push(value);return {data:{properties:{email_otp:'482961'}}};}}}})});
 const app=createApp({config,provider:f.provider,mailer:{sendCode:async(email,code)=>sent.push({email,code})}});
 const r=await request(app).post('/api/v1/auth/otp').send({email:'new@test.invalid',create_user:true,data:{role:'super_admin'}});
 assert.equal(r.status,200);assert.deepEqual(r.body,{});assert.deepEqual(sent,[{email:'new@test.invalid',code:'482961'}]);assert.deepEqual(links,[{type:'magiclink',email:'new@test.invalid'}]);
});
test('SMTP never creates an unknown driver or staff identity when signup is disabled',async()=>{
 let links=0,sends=0;
 const f=fixture({admin:()=>({rpc:async()=>({data:false}),auth:{admin:{generateLink:async()=>{links++;}}}})});
 const app=createApp({config,provider:f.provider,mailer:{sendCode:async()=>{sends++;}}});
 const r=await request(app).post('/api/v1/auth/otp').send({email:'unknown@test.invalid',create_user:false});
 assert.equal(r.status,200);assert.deepEqual(r.body,{});assert.equal(links,0);assert.equal(sends,0);
});
test('database rate limit rejects across function instances and fails closed',async()=>{
 const f=fixture({admin:()=>({rpc:async()=>({data:false})})});
 const app=createApp({config:{...config,RATE_LIMIT_STORE:'database'},provider:f.provider});
 const r=await request(app).post('/api/v1/auth/otp').send({email:'test@test.invalid'});
 assert.equal(r.status,429);assert.equal(r.headers['retry-after'],'60');
});
test('SMTP per-address persistent limit returns a friendly error without issuing another OTP',async()=>{
 let links=0;
 const f=fixture({admin:()=>({rpc:async(_name,args)=>({data:!args.p_key.startsWith('email:')}),auth:{admin:{generateLink:async()=>{links++;}}}})});
 const app=createApp({config:{...config,RATE_LIMIT_STORE:'database'},provider:f.provider,mailer:{sendCode:async()=>{throw new Error('Must not send');}}});
 const r=await request(app).post('/api/v1/auth/otp').send({email:'limit@test.invalid',create_user:true});
 assert.equal(r.status,429);assert.match(r.body.message,/15 minutes/);assert.equal(links,0);
});
function fixture(overrides = {}) {
  const calls = [];
  let adminCalls = 0;
  const profile = {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "customer",
    permissions: [],
  };
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "my_profile") return { data: profile, error: null };
      return { data: { ok: true }, error: null };
    },
    storage: {
      from: () => ({
        upload: async (path, _buffer, options) => {
          calls.push({ upload: path, options });
          return {
            data: { fullPath: "driver-documents/" + path, id: "file-id" },
            error: null,
          };
        },
        createSignedUrl: async (path, expiry) => ({
          data: { signedUrl: "https://storage.test/private?token=test" },
          error: null,
        }),
      }),
    },
  };
  const provider = {
    identify: async (token) =>
      token === "valid-token"
        ? { user: { id: profile.id, email: "verified@test.invalid" }, client }
        : token === "inactive-token"
          ? {
              user: { id: profile.id },
              client: {
                rpc: async () => ({
                  error: { code: "P0001", message: "inactive" },
                }),
              },
            }
          : null,
    request: async (path, options) => {
      calls.push({ path, options });
      return { status: 200, data: { ok: true } };
    },
    admin: () => {
      adminCalls++;
      return null;
    },
    ...overrides,
  };
  return {
    app: createApp({ config, provider }),
    provider,
    profile,
    calls,
    client,
    get adminCalls() {
      return adminCalls;
    },
  };
}
const auth = { Authorization: "Bearer valid-token" };
test("health has security/request headers and no server fingerprint", async () => {
  const { app } = fixture();
  const r = await request(app).get("/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.service, "hyzz-node-api");
  assert.ok(r.headers["x-request-id"]);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["x-powered-by"], undefined);
});
test("protected actions reject missing and invalid access tokens", async () => {
  const { app } = fixture();
  for (const token of [null, "bad-token"]) {
    const r = await request(app)
      .post("/api/v1/actions/my_profile")
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .send({});
    assert.equal(r.status, 401);
  }
});
test("suspended users cannot use business endpoints", async () => {
  const { app } = fixture();
  const r = await request(app)
    .post("/api/v1/actions/my_profile")
    .set("Authorization", "Bearer inactive-token")
    .send({});
  assert.equal(r.status, 403);
});
test("customer RPCs retain caller scope and do not use the service role", async () => {
  const f = fixture();
  const r = await request(f.app)
    .post("/api/v1/actions/estimate_fare")
    .set(auth)
    .send({ p_service: "hourly", p_hours: 2 });
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls.at(-1), {
    name: "estimate_fare",
    args: { p_service: "hourly", p_hours: 2 },
  });
  assert.equal(f.adminCalls, 0);
});
test("unknown/internal functions and extra authority/fare fields are rejected", async () => {
  const { app } = fixture();
  for (const action of ["admin_provision_user", "exec_sql", "unknown"])
    assert.equal(
      (
        await request(app)
          .post("/api/v1/actions/" + action)
          .set(auth)
          .send({})
      ).status,
      404,
    );
  const r = await request(app)
    .post("/api/v1/actions/estimate_fare")
    .set(auth)
    .send({ p_service: "hourly", p_hours: 2, role: "super_admin", fare: 1 });
  assert.equal(r.status, 400);
});
test("UUID, OTP and duration validations run before SQL", async () => {
  const { app } = fixture();
  assert.equal(
    (
      await request(app)
        .post("/api/v1/actions/verify_trip_otp")
        .set(auth)
        .send({ p_booking: "invalid", p_code: "123456" })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/actions/estimate_fare")
        .set(auth)
        .send({ p_service: "hourly", p_hours: 1.5 })
    ).status,
    400,
  );
});
test("reads are bounded, accept single-row responses, and disallow arbitrary resources", async () => {
  const f = fixture();
  let r = await request(f.app)
    .get("/api/v1/data/system_settings?select=*")
    .set({ ...auth, Accept: "application/vnd.pgrst.object+json" });
  assert.equal(r.status, 200);
  assert.equal(
    f.calls.at(-1).options.headers.Accept,
    "application/vnd.pgrst.object+json",
  );
  for (const url of [
    "/api/v1/data/users",
    "/api/v1/data/bookings?limit=999999",
    "/api/v1/data/bookings?select=*,users(*)",
    "/api/v1/data/bookings?customer_id=eq.someone",
  ])
    assert.equal(
      (await request(f.app).get(url).set(auth)).status,
      url.includes("/users") ? 404 : 400,
    );
});
test("admin provisioning checks permissions before touching the service role", async () => {
  const f = fixture();
  const r = await request(f.app)
    .post("/api/v1/admin/accounts")
    .set(auth)
    .send({
      email: "driver@test.invalid",
      name: "Test Driver",
      kind: "driver",
      role: null,
    });
  assert.equal(r.status, 403);
  assert.equal(f.adminCalls, 0);
});
test("authorized account creation reports missing server credentials honestly", async () => {
  const f = fixture();
  f.profile.permissions = ["users.manage"];
  const r = await request(f.app)
    .post("/api/v1/admin/accounts")
    .set(auth)
    .send({
      email: "driver@test.invalid",
      name: "Test Driver",
      kind: "driver",
    });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "SETUP_REQUIRED");
});
test("email OTP allows no public phone/password endpoints or role metadata", async () => {
  const f = fixture();
  let r = await request(f.app)
    .post("/api/v1/auth/otp")
    .send({
      email: "customer@test.invalid",
      create_user: true,
      data: { role: "super_admin" },
    });
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls.at(-1).options.body.data, {});
  assert.equal(
    (
      await request(f.app)
        .post("/api/v1/auth/otp")
        .send({ phone: "+919876543210" })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(f.app)
        .post("/api/v1/auth/token?grant_type=password")
        .send({ refresh_token: "long-refresh-token" })
    ).status,
    400,
  );
});
test("refresh tokens are forwarded only to the configured refresh endpoint", async () => {
  const f = fixture();
  const r = await request(f.app)
    .post("/api/v1/auth/token?grant_type=refresh_token")
    .send({ refresh_token: "long-refresh-token" });
  assert.equal(r.status, 200);
  assert.equal(f.calls.at(-1).path, "/auth/v1/token?grant_type=refresh_token");
});
test("blocked accounts can still log out of Auth", async () => {
  const { app } = fixture();
  const r = await request(app)
    .post("/api/v1/auth/logout?scope=local")
    .set("Authorization", "Bearer inactive-token")
    .send({});
  assert.equal(r.status, 200);
});
test("CORS blocks unapproved browser origins and does not require Origin for native clients", async () => {
  const { app } = fixture();
  assert.equal(
    (await request(app).get("/health").set("Origin", "https://evil.test"))
      .status,
    403,
  );
  const r = await request(app)
    .get("/health")
    .set("Origin", "http://localhost:5173");
  assert.equal(
    r.headers["access-control-allow-origin"],
    "http://localhost:5173",
  );
  assert.equal((await request(app).get("/health")).status, 200);
});
test("document uploads inspect content and prevent upserts", async () => {
  const f = fixture(),
    path = "11111111-1111-4111-8111-111111111111/license.pdf";
  f.profile.kind = "driver";
  let r = await request(f.app)
    .post("/api/v1/documents/upload/" + path)
    .set(auth)
    .attach("file", Buffer.from("not a PDF"), {
      filename: "license.pdf",
      contentType: "application/pdf",
    });
  assert.equal(r.status, 400);
  r = await request(f.app)
    .post("/api/v1/documents/upload/" + path)
    .set(auth)
    .attach("file", Buffer.from("%PDF-1.4\n test fixture"), {
      filename: "license.pdf",
      contentType: "application/pdf",
    });
  assert.equal(r.status, 200);
  assert.equal(f.calls.at(-1).options.upsert, false);
});
test("private document signing requires the fixed expiry and a safe path", async () => {
  const { app } = fixture(),
    path = "11111111-1111-4111-8111-111111111111/license.pdf";
  assert.equal(
    (
      await request(app)
        .post("/api/v1/documents/sign/" + path)
        .set(auth)
        .send({ expiresIn: 3600 })
    ).status,
    400,
  );
  const r = await request(app)
    .post("/api/v1/documents/sign/" + path)
    .set(auth)
    .send({ expiresIn: 60 });
  assert.equal(r.status, 200);
  assert.ok(r.body.signedURL.startsWith("https://"));
});
test("unexpected server errors do not expose provider messages or tokens", async () => {
  const f = fixture({
    identify: async () => {
      throw new Error("secret-token and DB password");
    },
  });
  const r = await request(f.app)
    .post("/api/v1/actions/my_profile")
    .set(auth)
    .send({});
  assert.equal(r.status, 500);
  assert.equal(JSON.stringify(r.body).includes("secret-token"), false);
});
test("production configuration rejects insecure deployment origins", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        AUTH_EMAIL_DELIVERY: 'supabase',
        SUPABASE_URL: "https://database.test",
        SUPABASE_PUBLISHABLE_KEY: "public-key-with-enough-length",
        ALLOWED_ORIGINS: "http://admin.test",
      }),
    /HTTPS/,
  );
});

test('privileged account provisioning uses server credentials only after permission checks',async()=>{let created;const f=fixture({admin:()=>({auth:{admin:{createUser:async input=>{created=input;return {data:{user:{id:'22222222-2222-4222-8222-222222222222'}},error:null};}}}})});f.profile.kind='employee';f.profile.permissions=['users.manage'];const r=await request(f.app).post('/api/v1/admin/accounts').set(auth).send({email:'newdriver@test.invalid',name:'New Driver',kind:'driver'});assert.equal(r.status,201);assert.equal(created.email_confirm,false);assert.equal(created.password,undefined);assert.equal(f.calls.at(-1).name,'admin_provision_user');});
test('sign-in rate limits and JSON body limits are enforced',async()=>{const f=fixture();const app=createApp({config:{...config,AUTH_REQUESTS_PER_15_MINUTES:1},provider:f.provider});const body={email:'customer@test.invalid',create_user:true};assert.equal((await request(app).post('/api/v1/auth/otp').send(body)).status,200);assert.equal((await request(app).post('/api/v1/auth/otp').send(body)).status,429);assert.equal((await request(app).post('/api/v1/auth/otp').send({email:'x'.repeat(70000)})).status,413);});
test('customer accounts cannot upload private driver evidence',async()=>{const f=fixture();const r=await request(f.app).post('/api/v1/documents/upload/11111111-1111-4111-8111-111111111111/license.pdf').set(auth).attach('file',Buffer.from('%PDF-1.4\ntest'),{filename:'license.pdf',contentType:'application/pdf'});assert.equal(r.status,403);assert.equal(f.calls.some(c=>c.upload),false);});
test('browser preflight permits the headers used by the Auth SDK',async()=>{const {app}=fixture();const r=await request(app).options('/api/v1/auth/otp').set('Origin','http://localhost:5173').set('Access-Control-Request-Method','POST').set('Access-Control-Request-Headers','content-type,apikey,x-client-info,x-supabase-api-version');assert.equal(r.status,204);assert.ok(r.headers['access-control-allow-headers'].toLowerCase().includes('x-supabase-api-version'));});
test('integration capabilities stay disabled until explicitly configured',async()=>{
 const f=fixture();const r=await request(f.app).get('/api/v1/capabilities');assert.equal(r.status,200);assert.deepEqual(r.body,{google:false,phone:false,push:false,tracking:true});
});
test('OAuth accepts only configured Google PKCE and app callback destinations',async()=>{
 const f=fixture(),app=createApp({config:{...config,GOOGLE_AUTH_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co'},provider:f.provider});
 const query={provider:'google',redirect_to:'hyzzdriver://auth/callback',code_challenge:'a'.repeat(43),code_challenge_method:'s256'};
 const r=await request(app).get('/api/v1/auth/authorize').query(query);assert.equal(r.status,302);assert.match(r.headers.location,/^https:\/\/example.supabase.co\/auth\/v1\/authorize\?/);
 const bad=await request(app).get('/api/v1/auth/authorize').query({...query,redirect_to:'https://attacker.invalid'});assert.equal(bad.status,400);
 const disabled=await request(f.app).get('/api/v1/auth/authorize').query(query);assert.equal(disabled.status,400);
});
test('map routing validates points and requires a signed-in active account',async()=>{
 const f=fixture();assert.equal((await request(f.app).post('/api/v1/maps/route').send({})).status,401);
 const r=await request(f.app).post('/api/v1/maps/route').set('Authorization','Bearer valid-token').send({from:{lat:100,lng:0},to:{lat:0,lng:0}});assert.equal(r.status,400);
});
test('push worker rejects missing or malformed worker credentials',async()=>{
 const f=fixture(),app=createApp({config:{...config,CRON_SECRET:'worker-secret'},provider:f.provider});
 assert.equal((await request(app).get('/api/internal/push')).status,401);
 assert.equal((await request(app).get('/api/internal/push').set('Authorization','Bearer wrong-secret')).status,401);
});
test('customers can upload optional private car documents but not driver documents',async()=>{
 const f=fixture();const r=await request(f.app).post('/api/v1/documents/vehicles/upload/'+f.profile.id+'/test.pdf').set('Authorization','Bearer valid-token').attach('file',Buffer.from('%PDF-1.4\nfixture'),{filename:'test.pdf',contentType:'application/pdf'});assert.equal(r.status,200);
});
test('remote push configuration requires a strong server-only worker secret',()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test-marker-at-least-20-characters',AUTH_EMAIL_DELIVERY:'supabase',PUSH_ENABLED:'true',CRON_SECRET:'short'};
 assert.throws(()=>loadConfig(env),/CRON_SECRET/);assert.equal(loadConfig({...env,CRON_SECRET:'x'.repeat(40)}).PUSH_ENABLED,'true');
});
