import { createClient } from "@supabase/supabase-js";
const env = process.env;
if (env.DEMO_SEED_CONFIRM !== "TEST_PROJECT_ONLY")
  throw new Error(
    "Set DEMO_SEED_CONFIRM=TEST_PROJECT_ONLY. Use a separate test Supabase project: seeding publishes test prices and approved fictional documents.",
  );
if (!env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Set the server-only SUPABASE_SERVICE_ROLE_KEY.");
const emails = [
  "DEMO_ADMIN_EMAIL",
  "DEMO_DRIVER_EMAIL",
  "DEMO_CUSTOMER_EMAIL",
].map((k) => env[k]?.trim().toLowerCase());
if (
  emails.some((v) => !v || !/^\S+@\S+\.\S+$/.test(v)) ||
  new Set(emails).size !== 3
)
  throw new Error(
    "Configure three different real inboxes you control for the demo roles.",
  );
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const users = [];
let page = 1;
for (;;) {
  const { data, error } = await db.auth.admin.listUsers({
    page,
    perPage: 1000,
  });
  if (error) throw error;
  users.push(...data.users);
  if (data.users.length < 1000) break;
  page++;
}
const ids = [];
for (const email of emails) {
  let user = users.find((u) => u.email?.toLowerCase() === email);
  if (user && !user.app_metadata?.hyzz_demo)
    throw new Error(
      "Refusing to change an existing non-demo identity. Use fresh demo inboxes.",
    );
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: false,
      app_metadata: { hyzz_demo: true },
    });
    if (error) throw error;
    user = data.user;
  }
  ids.push(user.id);
}
// Real files in private storage, prominently labelled as fictional test documents.
const text = "HYZZ DEMO ONLY - NOT A VALID IDENTITY OR DRIVING LICENCE";
const content = `BT /F1 12 Tf 30 100 Td (${text}) Tj ET`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
];
let pdf = "%PDF-1.4\n",
  offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf +=
  `xref\n0 6\n0000000000 65535 f \n` +
  offsets
    .slice(1)
    .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
    .join("") +
  `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
for (const name of ["identity", "license"]) {
  const { error } = await db.storage
    .from("driver-documents")
    .upload(`${ids[1]}/demo-${name}.pdf`, Buffer.from(pdf), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw error;
}
const { data, error } = await db.rpc("api_seed_demo", {
  p_admin: ids[0],
  p_driver: ids[1],
  p_customer: ids[2],
});
if (error) throw error;
console.log("Demo fixtures ready:", data);
console.log(
  "Sign in to each audience with its configured demo email and the real code delivered to that inbox. There are no shared demo passwords or OTP bypasses.",
);
