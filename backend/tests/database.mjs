// Real PostgreSQL PL/pgSQL, RLS, PostGIS and pgcrypto in a disposable WASM instance.
// Auth and Storage tables are local adapters; no real email or live database is used.
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const db = new PGlite({ extensions: { postgis, pgcrypto } });
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}
const scalar = async (sql, args = []) =>
  Object.values((await db.query(sql, args)).rows[0])[0];
async function actor(id) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function owner(fn) {
  await db.exec("reset role");
  return fn();
}
const call = async (name, args = []) =>
  scalar(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")})`,
    args,
  );
async function deny(fn, pattern) {
  await assert.rejects(fn, pattern);
}
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,phone text,email_confirmed_at timestamptz,created_at timestamptz default now(),raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 grant execute on function storage.foldername(text) to authenticated;`);
  await check(
    "all migrations apply in a clean PostgreSQL/PostGIS database",
    async () => {
      for (const file of [
        "001_hyzz.sql",
        "002_admin.sql",
        "003_operations.sql",
        "004_demo_workflow.sql",
        "005_demo_seed.sql",
      ])
        await db.exec(
          await readFile(
            new URL(`../database/migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
    },
  );
  const admin = randomUUID(),
    customer = randomUUID(),
    other = randomUUID(),
    driver = randomUUID(),
    driver2 = randomUUID(),
    support = randomUUID();
  for (const [id, email] of [
    [admin, "owner@test.invalid"],
    [customer, "customer@test.invalid"],
    [other, "other@test.invalid"],
    [driver, "driver@test.invalid"],
    [driver2, "driver2@test.invalid"],
    [support, "support@test.invalid"],
  ])
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, email],
    );
  await db.query("update public.users set kind='employee' where id=$1", [
    admin,
  ]);
  await db.query("insert into public.user_roles values($1,'super_admin')", [
    admin,
  ]);
  await actor(customer);
  await check(
    "customer cannot self-promote or write protected tables",
    async () => {
      await deny(
        () =>
          call("admin_provision_user", [
            other,
            "Attacker",
            "employee",
            "super_admin",
          ]),
        /Permission denied/,
      );
      await deny(
        () =>
          db.query("update public.users set kind='employee' where id=$1", [
            customer,
          ]),
        /permission denied/,
      );
      await deny(() => call("admin_overview"), /Staff access/);
    },
  );
  await actor(admin);
  await call("admin_provision_user", [driver, "Driver One", "driver", null]);
  await call("admin_provision_user", [driver2, "Driver Two", "driver", null]);
  await call("admin_provision_user", [
    support,
    "Support Agent",
    "employee",
    "support",
  ]);
  await check("driver cannot go online before approval", async () => {
    await actor(driver);
    await deny(
      () => call("set_availability", [true, 17.385, 78.4867]),
      /Approved account/,
    );
  });
  await actor(admin);
  await check(
    "driver approval requires both current reviewed documents",
    async () => {
      await deny(
        () => call("admin_approve_driver", [driver, "Reviewed account"]),
        /Approve valid license/,
      );
    },
  );
  for (const d of [driver, driver2])
    for (const type of ["driving_license", "identity"]) {
      const path = `${d}/${randomUUID()}.pdf`;
      await owner(() =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('driver-documents',$1)",
          [path],
        ),
      );
      await actor(admin);
      await call("register_document", [d, type, path, "2099-01-01"]);
      const id = await scalar(
        "select id from public.driver_documents where storage_path=$1",
        [path],
      );
      await call("admin_review_document", [
        id,
        "approved",
        "Reviewed original evidence",
      ]);
    }
  for (const d of [driver, driver2])
    await call("admin_approve_driver", [
      d,
      "Reviewed valid identity and license",
    ]);
  await actor(support);
  await check(
    "limited support employee cannot read finance or create staff",
    async () => {
      const data = await call("admin_overview");
      assert.equal(data.financial, undefined);
      assert.equal(data.users, undefined);
      await deny(
        () =>
          call("admin_provision_user", [
            other,
            "Another",
            "employee",
            "super_admin",
          ]),
        /Permission denied/,
      );
    },
  );
  await actor(customer);
  let booking;
  const key = randomUUID();
  await check(
    "fare estimate uses server pricing, no customer commission",
    async () => {
      const q = await call("estimate_fare", ["hourly", 2]);
      assert.equal(q.total_paise, 35000);
      assert.equal(q.payment_method, "cash");
    },
  );
  await check("duplicate request returns the original booking", async () => {
    const args = [
      key,
      "Test pickup, Hyderabad",
      17.385,
      78.4867,
      "hourly",
      2,
      new Date().toISOString(),
    ];
    booking = (await call("create_booking", args)).id;
    assert.equal((await call("create_booking", args)).id, booking);
    assert.equal(
      Number(await scalar("select count(*) from public.bookings")),
      1,
    );
  });
  await actor(other);
  await check(
    "unrelated customer cannot read another booking or request its OTP",
    async () => {
      assert.equal(
        Number(await scalar("select count(*) from public.bookings")),
        0,
      );
      await deny(() => call("booking_details", [booking]), /not available/);
      await deny(() => call("issue_trip_otp", [booking]), /OTP is available/);
    },
  );
  await actor(driver);
  await call("set_availability", [true, 17.385, 78.4867]);
  await check(
    "PostGIS matching excludes drivers outside the radius",
    async () => {
      assert.equal((await call("nearby_requests")).length, 1);
      await call("set_availability", [true, 28.6139, 77.209]);
      assert.equal((await call("nearby_requests")).length, 0);
      await call("set_availability", [true, 17.385, 78.4867]);
    },
  );
  await check(
    "eligible driver wins booking and another driver cannot take it",
    async () => {
      await call("accept_booking", [booking]);
      await actor(driver2);
      await call("set_availability", [true, 17.385, 78.4867]);
      await deny(
        () => call("accept_booking", [booking]),
        /no longer available/,
      );
    },
  );
  await actor(driver);
  await check("cannot skip arrival to start a trip", async () => {
    await deny(() => call("verify_trip_otp", [booking, "123456"]), /at pickup/);
  });
  await call("advance_booking", [booking, "en_route"]);
  await call("advance_booking", [booking, "arrive"]);
  await actor(customer);
  let otp = (await call("issue_trip_otp", [booking])).code;
  await check(
    "OTP is hashed and driver cannot read its raw record",
    async () => {
      await owner(async () => {
        const hash = await scalar(
          "select otp_hash from public.booking_otp_records where booking_id=$1",
          [booking],
        );
        assert.notEqual(hash, otp);
        assert.ok(hash.startsWith("$2"));
      });
      await actor(driver);
      assert.equal(
        Number(await scalar("select count(*) from public.booking_otp_records")),
        0,
      );
    },
  );
  await check(
    "five failed OTP attempts persist and lock verification",
    async () => {
      const wrong = otp === "000000" ? "000001" : "000000";
      for (let i = 0; i < 5; i++)
        assert.equal(
          (await call("verify_trip_otp", [booking, wrong])).ok,
          false,
        );
      assert.equal((await call("verify_trip_otp", [booking, otp])).ok, false);
      await owner(async () =>
        assert.equal(
          await scalar(
            "select attempts from public.booking_otp_records where booking_id=$1",
            [booking],
          ),
          5,
        ),
      );
    },
  );
  await owner(() =>
    db.query(
      "update public.booking_otp_records set last_issued_at=now()-interval '2 minutes' where booking_id=$1",
      [booking],
    ),
  );
  await actor(customer);
  otp = (await call("issue_trip_otp", [booking])).code;
  await check("expired OTP is rejected", async () => {
    await owner(() =>
      db.query(
        "update public.booking_otp_records set expires_at=now()-interval '1 second' where booking_id=$1",
        [booking],
      ),
    );
    await actor(driver);
    assert.equal((await call("verify_trip_otp", [booking, otp])).ok, false);
    await owner(() =>
      db.query(
        "update public.booking_otp_records set expires_at=now()+interval '5 minutes' where booking_id=$1",
        [booking],
      ),
    );
  });
  await actor(driver);
  await check(
    "valid OTP starts trip once and stops pickup location access",
    async () => {
      assert.equal((await call("verify_trip_otp", [booking, otp])).ok, true);
      await deny(() => call("verify_trip_otp", [booking, otp]), /at pickup/);
      await deny(
        () => call("update_pickup_location", [booking, 17.385, 78.4867]),
        /only available before/,
      );
      await actor(customer);
      assert.equal(await call("pickup_driver_location", [booking]), null);
    },
  );
  await actor(admin);
  await call("admin_update_pricing", [10000, 30000, 40000, 240000, 2000]);
  await actor(driver);
  await check(
    "final fare retains price snapshot, booked minimum and commission split",
    async () => {
      const b = await call("complete_trip", [booking]);
      assert.equal(b.final_paise, 35000);
      assert.equal(b.commission_paise, 5250);
      assert.equal(b.earnings_paise, 29750);
      assert.ok(b.started_at && b.ended_at);
      await call("complete_trip", [booking]);
      assert.equal(
        Number(
          await scalar("select count(*) from public.financial_ledger_entries"),
        ),
        2,
      );
    },
  );
  await check(
    "cash needs both parties and duplicate confirmations create one ledger entry",
    async () => {
      await call("confirm_cash", [booking]);
      assert.equal(
        (await call("booking_details", [booking])).payment_status,
        "driver_confirmed",
      );
      await actor(customer);
      await call("confirm_cash", [booking]);
      await call("confirm_cash", [booking]);
      assert.equal(
        (await call("booking_details", [booking])).payment_status,
        "settled",
      );
      await owner(async () =>
        assert.equal(
          Number(
            await scalar(
              "select count(*) from public.financial_ledger_entries where entry_type='cash_collected'",
            ),
          ),
          1,
        ),
      );
    },
  );
  await check(
    "ledger and fare history cannot be rewritten, even by privileged SQL",
    async () => {
      await owner(async () => {
        await deny(
          () =>
            db.query(
              "update public.financial_ledger_entries set amount_paise=1",
            ),
          /Immutable/,
        );
        await deny(
          () => db.query("delete from public.fare_breakdowns"),
          /Immutable/,
        );
      });
    },
  );
  await actor(customer);
  await check(
    "ratings, disputes, support and deletion are persisted",
    async () => {
      await call("submit_rating", [booking, 5, "Good journey"]);
      await deny(
        () => call("submit_rating", [booking, 4, "Duplicate"]),
        /duplicate key/,
      );
      await call("submit_support", ["Payment needs review", booking, true]);
      assert.equal(
        (await call("booking_details", [booking])).payment_status,
        "disputed",
      );
      await deny(() => call("confirm_cash", [booking]), /disputed/);
      await call("request_account_deletion");
      assert.equal(
        Number(
          await scalar("select count(*) from public.account_deletion_requests"),
        ),
        1,
      );
    },
  );
  await actor(admin);
  await call("admin_set_status", [
    driver,
    "suspended",
    "Operational review required",
  ]);
  await actor(driver);
  await check(
    "suspended drivers cannot access protected RPCs or records",
    async () => {
      await deny(() => call("my_profile"), /active Hyzz account/);
      assert.equal(
        Number(await scalar("select count(*) from public.bookings")),
        0,
      );
    },
  );
  await actor(admin);
  await check(
    "audit logs capture privileged changes and reject rewriting",
    async () => {
      assert.ok(
        Number(await scalar("select count(*) from public.audit_logs")) >= 8,
      );
      await owner(() =>
        deny(() => db.exec("delete from public.audit_logs"), /Immutable/),
      );
    },
  );
  await check(
    "staff cannot edit their own role or super-admin permissions",
    async () => {
      await deny(
        () => call("admin_set_role", [admin, "support", "Attempt role change"]),
        /own permissions/,
      );
      await deny(
        () =>
          call("admin_role_permissions", [
            "super_admin",
            ["support.manage"],
            "Changing protected role",
          ]),
        /Super Admin/,
      );
    },
  );
  await call("admin_set_status", [
    driver,
    "active",
    "Review completed successfully",
  ]);
  await actor(other);
  const overtime = (
    await call("create_booking", [
      randomUUID(),
      "Another Hyderabad pickup",
      17.385,
      78.4867,
      "hourly",
      2,
      new Date().toISOString(),
    ])
  ).id;
  await actor(driver);
  await call("set_availability", [true, 17.385, 78.4867]);
  await actor(admin);
  await check(
    "manual assignment enforces eligibility and records a reason",
    async () => {
      await call("admin_assign_driver", [
        overtime,
        driver,
        "Customer requested manual assignment",
      ]);
      const assignments = await scalar(
        "select count(*) from public.booking_assignments where booking_id=$1",
        [overtime],
      );
      assert.equal(Number(assignments), 1);
    },
  );
  await actor(driver);
  await call("advance_booking", [overtime, "en_route"]);
  await call("advance_booking", [overtime, "arrive"]);
  await actor(other);
  let nextCode = (await call("issue_trip_otp", [overtime])).code;
  await actor(driver);
  await call("verify_trip_otp", [overtime, nextCode]);
  await owner(() =>
    db.query(
      "update public.bookings set started_at=now()-interval '2 hours 1 minute' where id=$1",
      [overtime],
    ),
  );
  await actor(driver);
  await check(
    "overtime rounds to 15 minutes using trusted timestamps",
    async () => {
      const b = await call("complete_trip", [overtime]);
      assert.equal(b.fare.billed_minutes, 135);
      assert.equal(b.final_paise, 77500);
      assert.equal(b.commission_paise, 15500);
    },
  );
  await actor(other);
  const day = (
    await call("create_booking", [
      randomUUID(),
      "Full-day Hyderabad pickup",
      17.385,
      78.4867,
      "full_day",
      2,
      new Date().toISOString(),
    ])
  ).id;
  await actor(driver);
  await call("set_availability", [true, 17.385, 78.4867]);
  await call("accept_booking", [day]);
  await call("advance_booking", [day, "en_route"]);
  await call("advance_booking", [day, "arrive"]);
  await actor(other);
  nextCode = (await call("issue_trip_otp", [day])).code;
  await actor(driver);
  await call("verify_trip_otp", [day, nextCode]);
  await owner(() =>
    db.query(
      "update public.bookings set started_at=now()-interval '8 hours 1 minute' where id=$1",
      [day],
    ),
  );
  await actor(driver);
  await check(
    "full-day fare includes eight hours and transparently bills extra time",
    async () => {
      const b = await call("complete_trip", [day]);
      assert.equal(b.hours, 8);
      assert.equal(b.fare.billed_minutes, 495);
      assert.equal(b.final_paise, 247500);
      assert.equal(b.commission_paise, 49500);
    },
  );
  await actor(other);
  const expired = (
    await call("create_booking", [
      randomUUID(),
      "Expiring Hyderabad pickup",
      17.385,
      78.4867,
      "hourly",
      1,
      new Date().toISOString(),
    ])
  ).id;
  await owner(() =>
    db.query(
      "update public.bookings set request_expires_at=now()-interval '1 minute' where id=$1",
      [expired],
    ),
  );
  await actor(driver);
  await check(
    "expired requests cannot be accepted and become no-driver-available",
    async () => {
      await deny(() => call("accept_booking", [expired]), /expired/);
      await call("expire_requests");
      await actor(other);
      assert.equal(
        (await call("booking_details", [expired])).state,
        "NO_DRIVER_AVAILABLE",
      );
    },
  );
  await actor(other);
  const cancelled = (
    await call("create_booking", [
      randomUUID(),
      "Cancelled Hyderabad pickup",
      17.385,
      78.4867,
      "hourly",
      1,
      new Date().toISOString(),
    ])
  ).id;
  await check(
    "customer cancellation persists a reason and cannot start again",
    async () => {
      await call("cancel_booking", [cancelled, "My plans have changed"]);
      assert.equal(
        (await call("booking_details", [cancelled])).state,
        "CANCELLED_BY_CUSTOMER",
      );
      await actor(driver);
      await deny(
        () => call("accept_booking", [cancelled]),
        /no longer available/,
      );
    },
  );
  await owner(() =>
    db.query(
      "update public.driver_documents set expires_on=current_date-1 where driver_id=$1",
      [driver],
    ),
  );
  await actor(driver);
  await check(
    "document expiry blocks new availability even after prior approval",
    async () => {
      await deny(
        () => call("set_availability", [true, 17.385, 78.4867]),
        /Approved account/,
      );
    },
  );
  const demoAdmin=randomUUID(),demoDriver=randomUUID(),demoCustomer=randomUUID();
  await owner(async()=>{
    for(const id of [demoAdmin,demoDriver,demoCustomer])await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),'{\"hyzz_demo\":true}')",[id,id+'@demo.invalid']);
  });
  await check('dedicated demo seed is idempotent and refuses real identities',async()=>{
    await owner(()=>call('api_seed_demo',[demoAdmin,demoDriver,demoCustomer]));
    assert.equal((await owner(()=>call('api_seed_demo',[demoAdmin,demoDriver,demoCustomer]))).already_seeded,true);
    await deny(()=>owner(()=>call('api_seed_demo',[admin,demoDriver,demoCustomer])),/dedicated identities/);
    await actor(demoCustomer);
    await deny(()=>call('api_seed_demo',[demoAdmin,demoDriver,demoCustomer]),/permission denied/i);
  });
  await check('demo hourly, distance and ten-hour package estimates include explicit GST',async()=>{
    const hourly=await call('estimate_service_fare',['hourly',60,0]);assert.equal(hourly.total_paise,29500);assert.equal(hourly.tax_paise,4500);
    assert.equal((await call('estimate_service_fare',['distance',60,10])).total_paise,27140);
    const day=await call('estimate_service_fare',['full_day',60,0]);assert.equal(day.minutes,600);assert.equal(day.total_paise,188800);
  });
  let distance;
  await check('distance booking is idempotent, decline affects only its driver, and acceptance is atomic',async()=>{
    const key=randomUUID();const params=[key,'Railway Station demo',16.301,80.439,'distance',60,new Date().toISOString(),10];
    distance=(await call('create_service_booking',params)).id;assert.equal((await call('create_service_booking',params)).id,distance);
    await actor(demoDriver);await call('set_availability',[true,16.3,80.44]);
    assert.equal((await call('nearby_requests')).find(x=>x.id===distance).estimated_earnings_paise,19550);
    await call('accept_booking',[distance]);await deny(()=>call('accept_booking',[distance]),/no longer available/);
  });
  let newCode;
  await check('pickup verification and start are separate, with no driver overlap or location leak',async()=>{
    await call('advance_booking',[distance,'en_route']);await call('advance_booking',[distance,'arrive']);
    await actor(demoCustomer);newCode=(await call('issue_trip_otp',[distance])).code;
    await actor(demoDriver);assert.equal((await call('verify_pickup_code',[distance,newCode])).ok,true);
    assert.equal((await call('booking_details',[distance])).state,'OTP_VERIFIED');
    await actor(demoCustomer);assert.equal(await call('pickup_driver_location',[distance]),null);
    await deny(()=>call('start_trip',[distance]),/Assigned driver/);
    await actor(demoDriver);await call('start_trip',[distance]);
    assert.equal((await call('booking_details',[distance])).state,'IN_PROGRESS');
  });
  await check('distance finalization enforces km, uses snapshot tax/commission and cannot duplicate ledger',async()=>{
    await deny(()=>call('finish_service_trip',[distance,null]),/distance/);
    const b=await call('finish_service_trip',[distance,25]);assert.equal(b.final_paise,59000);assert.equal(b.commission_paise,7500);assert.equal(b.earnings_paise,42500);assert.equal(b.fare.breakdown.tax_paise,9000);
    assert.equal((await call('finish_service_trip',[distance,25])).final_paise,59000);
    await call('confirm_cash',[distance]);await actor(demoCustomer);await call('confirm_cash',[distance]);
  });
  await check('commission receipts require finance permission, persist once and prevent overcollection',async()=>{
    await deny(()=>call('admin_record_commission',[demoDriver,1000,'DEMO-RECEIPT-001']),/Permission denied/);
    await actor(demoAdmin);const receipt=await call('admin_record_commission',[demoDriver,12000,'DEMO-RECEIPT-001']);assert.equal(await call('admin_record_commission',[demoDriver,12000,'DEMO-RECEIPT-001']),receipt);
    await deny(()=>call('admin_record_commission',[demoDriver,1,'DEMO-RECEIPT-002']),/outstanding/);
    const summary=await call('admin_overview');assert.equal(summary.financial.tax_collected_paise,14400);assert.ok(summary.financial.driver_earnings_paise>=68000);
    await actor(demoDriver);assert.equal((await call('driver_wallet')).commission_due_paise,0);
  });
  await check('declined requests disappear without cancelling another customer booking',async()=>{
    await actor(demoCustomer);const b=await call('create_service_booking',[randomUUID(),'Railway Station demo',16.301,80.439,'hourly',60,new Date().toISOString(),0]);
    await actor(demoDriver);await call('set_availability',[true,16.3,80.44]);await call('decline_request',[b.id]);assert.equal((await call('nearby_requests')).some(x=>x.id===b.id),false);
    await actor(demoCustomer);assert.equal((await call('booking_details',[b.id])).state,'MATCHING');await call('cancel_booking',[b.id,'Customer changed plan']);
  });
  await check('hourly grace/overtime, full-day overtime and tax use immutable price snapshots',async()=>{
    await actor(demoCustomer);const b=await call('create_service_booking',[randomUUID(),'Railway Station demo',16.301,80.439,'hourly',60,new Date().toISOString(),0]);
    await actor(demoDriver);await call('accept_booking',[b.id]);await call('advance_booking',[b.id,'en_route']);await call('advance_booking',[b.id,'arrive']);
    await actor(demoCustomer);const code=(await call('issue_trip_otp',[b.id])).code;
    await actor(demoDriver);await call('verify_pickup_code',[b.id,code]);await call('start_trip',[b.id]);
    await owner(()=>db.query("update public.bookings set started_at=now()-interval '79 minutes' where id=$1",[b.id]));
    await actor(demoAdmin);await call('admin_publish_pricing',[9999,99999,15000,300000,1500,1800,5,1800,10]);
    await actor(demoDriver);const completed=await call('finish_service_trip',[b.id,null]);assert.equal(completed.final_paise,35400);assert.equal(completed.fare.breakdown.overtime_minutes,15);
    await actor(demoCustomer);assert.equal((await call('estimate_service_fare',['hourly',60,0])).total_paise,129798);
  });
  await check('new fare model has exact hourly/full-day grace boundaries and a distance minimum',async()=>{
    const fare=async(service,minutes,km)=>owner(()=>scalar("select private.service_fare(pricing_snapshot,$1,$2,$3::numeric,60) from public.bookings where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'",[service,minutes,km]));
    assert.equal((await fare('hourly',65,0)).total_paise,29500);
    assert.equal((await fare('hourly',66,0)).total_paise,35400);
    assert.equal((await fare('full_day',610,0)).total_paise,188800);
    assert.equal((await fare('full_day',611,0)).total_paise,198240);
    assert.equal((await fare('distance',60,1)).total_paise,17700);
  });
  await check('live platform and durable push upgrades apply after existing data',async()=>{
    await owner(async()=>{for(const file of ['006_live_platform.sql','007_push_delivery.sql'])await db.exec(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));});
  });
  const applicant=randomUUID();
  await owner(()=>db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'applicant@test.invalid',now())",[applicant]));
  await actor(applicant);
  await check('driver may self-register but cannot approve self or go online pending four documents',async()=>{
    await call('register_driver',['New Driver','+919876540000',5,['Telugu','English']]);
    const p=await call('my_profile');assert.equal(p.kind,'driver');assert.equal(p.driver.verification,'pending');
    await deny(()=>call('set_availability',[true,16.301,80.439]),/Approved account/);
    await deny(()=>call('admin_approve_driver',[applicant,'Self approval attempt']),/Permission denied/);
  });
  await check('all four uploaded documents need staff review before approval',async()=>{
    for(const type of ['driving_license','identity','insurance','police_verification']){
      const path=applicant+'/'+type+'.pdf';await owner(()=>db.query("insert into storage.objects(bucket_id,name) values('driver-documents',$1)",[path]));
      await actor(applicant);await call('register_document',[applicant,type,path,'2099-12-31']);
      const id=await owner(()=>scalar('select id from public.driver_documents where storage_path=$1',[path]));
      await actor(demoAdmin);await call('admin_review_document',[id,'approved','Evidence reviewed in test']);
    }
    await call('admin_approve_driver',[applicant,'All required documents reviewed']);
    await actor(applicant);await call('set_availability',[true,16.301,80.439]);
  });
  let liveBooking;
  await check('customer can book without a car and store optional car records separately',async()=>{
    await actor(demoCustomer);const vehicle=await call('save_vehicle',['Maruti','Dzire','TS09AB1234',2022,'White']);assert.ok(vehicle);assert.equal((await call('my_vehicles')).length,1);
    const b=await call('create_service_booking',[randomUUID(),'Live tracking test pickup',16.301,80.439,'hourly',60,new Date().toISOString(),0]);liveBooking=b.id;assert.equal(b.vehicle_id,null);
    await actor(applicant);await call('accept_booking',[liveBooking]);
  });
  await check('only the assigned approved driver can publish points; other customers cannot observe',async()=>{
    const now=new Date().toISOString();await call('update_trip_location',[liveBooking,16.302,80.44,now,5,90,3]);
    await actor(other);await deny(()=>call('trip_tracking',[liveBooking]),/participant/);
    await deny(()=>call('update_trip_location',[liveBooking,16.31,80.44,now]),/assigned driver/);
    await actor(demoCustomer);const point=await call('trip_tracking',[liveBooking]);assert.equal(point.lat,16.302);assert.equal(point.stale,false);
    await actor(demoAdmin);assert.ok((await call('admin_live_locations')).some(p=>p.booking_id===liveBooking));
  });
  await check('tracking survives verification and active trip, rejects out-of-order samples, and stops at completion',async()=>{
    await actor(applicant);await call('advance_booking',[liveBooking,'en_route']);await call('advance_booking',[liveBooking,'arrive']);
    await actor(demoCustomer);const code=(await call('issue_trip_otp',[liveBooking])).code;
    await actor(applicant);await call('verify_pickup_code',[liveBooking,code]);await call('start_trip',[liveBooking]);
    await call('update_trip_location',[liveBooking,16.303,80.441,new Date(Date.now()+1000).toISOString(),4,100,6]);
    await call('update_trip_location',[liveBooking,16.299,80.435,new Date(Date.now()-10000).toISOString(),4,90,5]);
    await actor(demoCustomer);assert.equal((await call('trip_tracking',[liveBooking])).lat,16.303);
    await actor(applicant);await call('finish_service_trip',[liveBooking,null]);
    await deny(()=>call('update_trip_location',[liveBooking,16.3,80.44,new Date().toISOString()]),/not active/);
    await actor(demoCustomer);assert.equal(await call('trip_tracking',[liveBooking]),null);
  });
  await check('maintenance blocks new driver availability but does not erase completed history',async()=>{
    await actor(demoAdmin);await call('admin_update_settings',[10,15,true]);await actor(applicant);
    await deny(()=>call('set_availability',[true,16.3,80.44]),/maintenance/);assert.deepEqual(await call('nearby_requests'),[]);
    await actor(demoAdmin);await call('admin_update_settings',[10,15,false]);
  });
  await check('push utility helpers remain service-only and device registration matches the role',async()=>{
    await actor(applicant);await deny(()=>call('api_push_claim',[10]),/permission denied/i);
    await deny(()=>call('register_push_device',['ExpoPushToken[test-token]','customer']),/matching audience/);
    await call('register_push_device',['ExpoPushToken[test-token]','driver']);
    await owner(()=>db.query("insert into public.notification_records(user_id,title) values($1,'Test-only notification')",[applicant]));
    const jobs=await owner(()=>call('api_push_claim',[10]));assert.equal(jobs.length,1);
    await owner(()=>call('api_push_result',[jobs[0].id,'test-ticket',null]));
    await actor(applicant);await call('unregister_push_device',['ExpoPushToken[test-token]']);
  });
  await check('service zone restrictions and vehicle ownership remain enforced server-side',async()=>{
    await actor(demoAdmin);await call('admin_service_zone',['Restricted test zone',0,0,1,true]);
    await actor(demoCustomer);await deny(()=>call('create_service_booking',[randomUUID(),'Outside service area',16.301,80.439,'hourly',60,new Date().toISOString(),0]),/outside/i);
    const vehicle=(await call('my_vehicles'))[0].id;
    await actor(demoAdmin);await call('admin_service_zone',['Restricted test zone',0,0,1,false]);
    await actor(other);await deny(()=>call('create_service_booking',[randomUUID(),'Vehicle owner test',16.301,80.439,'hourly',60,new Date().toISOString(),0,null,null,null,vehicle,'professional']),/owner/i);
    await deny(()=>call('admin_service_zone',['Unauthorized zone',0,0,1,true]),/Permission denied/);
  });
  await check('successful fifth push attempt is submitted and disabled device jobs stop retrying',async()=>{
    await actor(applicant);await call('register_push_device',['ExpoPushToken[retry-fixture]','driver']);
    await owner(()=>db.query("insert into public.notification_records(user_id,title) values($1,'Retry fixture notification')",[applicant]));
    const jobs=await owner(()=>call('api_push_claim',[10]));assert.equal(jobs.length,1);
    await owner(()=>db.query("update private.push_outbox set attempts=5 where id=$1",[jobs[0].id]));
    await owner(()=>call('api_push_result',[jobs[0].id,'fifth-attempt-ticket',null]));
    assert.equal(await owner(()=>scalar('select state from private.push_outbox where id=$1',[jobs[0].id])),'submitted');
    await owner(()=>db.query("insert into public.notification_records(user_id,title) values($1,'Disabled device fixture')",[applicant]));
    await actor(applicant);await call('unregister_push_device',['ExpoPushToken[retry-fixture]']);
    assert.deepEqual(await owner(()=>call('api_push_claim',[10])),[]);
    assert.equal(await owner(()=>scalar("select count(*)::int from private.push_outbox where state='queued'")),0);
  });

  await check('driver storyboard migration applies after existing live trip data',async()=>{await owner(async()=>db.exec(await readFile(new URL('../database/migrations/008_driver_storyboard.sql',import.meta.url),'utf8')));});
  await check('driver preferences persist and disabled notifications do not enter push outbox',async()=>{
    await actor(applicant);await call('save_driver_preferences',[false,'te','+919876543210']);const p=await call('driver_preferences');assert.equal(p.language,'te');assert.equal(p.notifications,false);
    await call('register_push_device',['ExpoPushToken[muted-fixture]','driver']);
    const notification=await owner(()=>scalar("insert into public.notification_records(user_id,title) values($1,'Muted fixture') returning id",[applicant]));
    assert.equal(await owner(()=>scalar('select count(*)::int from private.push_outbox where notification_id=$1',[notification])),0);
    await call('save_driver_preferences',[true,'en',null]);
    await actor(demoCustomer);await deny(()=>call('driver_finances'),/Driver account/);
  });
  let payout,credit;
  await check('wallet credits are finance-only, idempotent and independent of trip cash',async()=>{
    await actor(applicant);await call('confirm_cash',[liveBooking]);await actor(demoCustomer);await call('confirm_cash',[liveBooking]);await actor(applicant);const due=(await call('driver_wallet')).commission_due_paise;
    await deny(()=>call('admin_credit_driver',[applicant,10000,'incentive','STORY-CREDIT','Fixture incentive']),/Permission denied/);
    await actor(demoAdmin);if(due>0)await call('admin_record_commission',[applicant,due,'STORY-COMMISSION']);
    credit=await call('admin_credit_driver',[applicant,10000,'incentive','STORY-CREDIT','Fixture incentive']);
    assert.equal(await call('admin_credit_driver',[applicant,10000,'incentive','STORY-CREDIT','Fixture incentive']),credit);
    await deny(()=>call('admin_credit_driver',[applicant,20000,'incentive','STORY-CREDIT','Different amount']),/Reference/);
    await actor(applicant);assert.equal((await call('driver_finances')).wallet.available_paise,10000);
    await deny(()=>call('api_store_driver_bank',[applicant,'x'.repeat(64),'Fixture Driver','TEST0123456','1234']),/permission denied/i);
  });
  await check('payout requests reserve credit once and snapshot private payment destinations',async()=>{
    await owner(()=>call('api_store_driver_bank',[applicant,'a'.repeat(64),'Fixture Driver','TEST0123456','1234']));
    await actor(applicant);const key=randomUUID();payout=await call('request_driver_payout',[key,6000]);assert.equal(await call('request_driver_payout',[key,6000]),payout);
    await deny(()=>call('request_driver_payout',[key,5000]),/different amount/);
    await deny(()=>call('request_driver_payout',[randomUUID(),5000]),/exceeds/);
    const own=await call('driver_finances');assert.equal(own.wallet.available_paise,4000);assert.equal(own.bank.last4,'1234');assert.equal(JSON.stringify(own).includes('ciphertext'),false);
    await owner(()=>call('api_store_driver_bank',[applicant,'b'.repeat(64),'Updated Fixture','TEST0123456','5678']));
    assert.equal(await owner(()=>scalar('select last4 from private.payout_requests where id=$1',[payout])),'1234');
    await actor(other);await deny(()=>call('admin_review_payout',[payout,'paid','Unauthorized transfer','INVALID-REF']),/Permission denied/);
  });
  await check('finance payout review requires approval and an actual transfer reference; paid cannot be replayed',async()=>{
    await actor(demoAdmin);await deny(()=>call('admin_review_payout',[payout,'paid','Fixture transfer','STORY-TRANSFER']),/transition/);
    await call('admin_review_payout',[payout,'approved','Fixture review approved',null]);
    await deny(()=>call('admin_review_payout',[payout,'paid','Fixture transfer',null]),/reference/);
    await call('admin_review_payout',[payout,'paid','Fixture external transfer recorded','STORY-TRANSFER']);
    await call('admin_review_payout',[payout,'paid','Same fixture transfer','STORY-TRANSFER']);
    assert.equal(JSON.stringify(await call('admin_driver_payouts')).includes('ciphertext'),false);
    await owner(()=>deny(()=>call('api_reveal_payout_bank',[payout,other]),/Finance permission/));
    const secret=await owner(()=>call('api_reveal_payout_bank',[payout,demoAdmin]));assert.equal(secret.ciphertext,'a'.repeat(64));
    await actor(applicant);const next=await call('request_driver_payout',[randomUUID(),4000]);
    await actor(demoAdmin);await call('admin_review_payout',[next,'rejected','Fixture rejection releases reservation',null]);
    await actor(applicant);assert.equal((await call('driver_finances')).wallet.available_paise,4000);
    await deny(()=>owner(()=>db.query('update private.driver_credits set amount_paise=1 where id=$1',[credit])),/immutable|append/i);
    const summary=await call('driver_summary',['today']);assert.equal(summary.incentives_paise,10000);assert.equal(summary.bars.length,24);
  });
  await check('trip chat is participant-only, idempotent and closes for new messages after cancellation',async()=>{
    await actor(demoCustomer);const b=await call('create_service_booking',[randomUUID(),'Storyboard chat pickup',16.301,80.439,'hourly',60,new Date().toISOString(),0]);
    await deny(()=>call('send_trip_message',[b.id,randomUUID(),'Before assignment']),/only during/);
    await actor(applicant);await call('set_availability',[true,16.301,80.439]);assert.ok((await call('driver_requests')).some(r=>r.id===b.id&&r.request_expires_at));await call('accept_booking',[b.id]);
    await actor(demoCustomer);const key=randomUUID(),id=await call('send_trip_message',[b.id,key,'I am by the gate.']);assert.equal(await call('send_trip_message',[b.id,key,'I am by the gate.']),id);
    await actor(other);await deny(()=>call('trip_chat',[b.id]),/participant/);await deny(()=>call('send_trip_message',[b.id,randomUUID(),'Unauthorized message']),/participant/);
    await actor(applicant);assert.equal((await call('trip_chat',[b.id]))[0].body,'I am by the gate.');await call('send_trip_message',[b.id,randomUUID(),'I will meet you there.']);await call('cancel_booking',[b.id,'Fixture chat test cancellation']);
    await deny(()=>call('send_trip_message',[b.id,randomUUID(),'After closure']),/only during/);assert.equal((await call('trip_chat',[b.id])).length,2);
    assert.ok((await call('driver_history',['cancelled',0])).some(r=>r.id===b.id));
  });
  await check('driver ratings are saved once and only the author can retrieve their own rating',async()=>{
    await actor(applicant);await call('submit_rating',[liveBooking,4,'Fixture rider rating']);assert.equal((await call('my_trip_rating',[liveBooking])).score,4);
    await actor(demoCustomer);assert.equal(await call('my_trip_rating',[liveBooking]),null);
    await actor(other);await deny(()=>call('my_trip_rating',[liveBooking]),/participant/);
  });

  await check('operations and releases migrations apply after existing storyboard data',async()=>{await owner(async()=>{for(const file of ['009_operations_center.sql','010_app_releases.sql'])await db.exec(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));});});
  await check('published content is public via service helper; editing requires content permission',async()=>{
    await actor(demoAdmin);await call('admin_save_content',['faq','Frequently asked questions','Tested service information',true]);
    assert.ok((await call('admin_content')).some(c=>c.key==='faq'));
    await actor(demoCustomer);await deny(()=>call('admin_save_content',['faq','Attempt','Unauthorized change',true]),/Permission/);await deny(()=>call('api_public_content'),/permission denied/);
    const content=await owner(()=>call('api_public_content'));assert.ok(content.some(c=>c.body==='+917730020465'));assert.ok(!content.some(c=>c.key==='terms'));
  });
  await check('contact enquiries are private, validated and reviewed with permission',async()=>{
    const id=await owner(()=>call('api_contact_enquiry',['Fixture visitor','visitor@example.invalid',null,'customer','Please explain service availability.']));
    await actor(demoCustomer);await deny(()=>call('admin_enquiries'),/Permission/);
    await actor(demoAdmin);assert.ok((await call('admin_enquiries')).some(e=>e.id===id));await call('admin_review_enquiry',[id,'resolved','Answered the fixture enquiry']);
  });

  await check('admin-created customers keep customer-only access and editable contacts are audited',async()=>{
    const fresh=randomUUID();await owner(()=>db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'managed@example.invalid',now())",[fresh]));
    await actor(demoAdmin);await call('admin_provision_user',[fresh,'Managed Customer','customer',null]);await call('admin_update_person',[fresh,'Updated Customer','+917730020465','Fixture contact correction']);
    const overview=await call('admin_overview'),row=overview.users.find(u=>u.id===fresh);assert.equal(row.email,'managed@example.invalid');assert.equal(row.phone,'+917730020465');assert.equal(row.kind,'customer');
    await actor(fresh);assert.equal((await call('my_profile')).permissions.length,0);await deny(()=>call('admin_update_person',[fresh,'Attempt',null,'Self escalation attempt']),/Permission/);
  });
  await check('operations can list eligible assignment candidates without access to private documents',async()=>{
    await actor(demoAdmin);await call('admin_set_role',[support,'operations','Fixture operations role assignment']);await actor(support);const available=await call('admin_assignable_drivers');assert.ok(Array.isArray(available));await deny(()=>call('admin_content'),/Permission/);
  });
  await check('ride access is separate from documents and enforced in eligibility',async()=>{
    await actor(demoAdmin);await call('admin_driver_access',[applicant,false,'Pause new rides for fixture review']);await actor(applicant);await deny(()=>call('set_availability',[true,16.301,80.439]),/approved|Approved|eligible/);
    await actor(demoAdmin);await call('admin_driver_access',[applicant,true,'Restore reviewed driver ride access']);await actor(applicant);await call('set_availability',[true,16.301,80.439]);
  });
  let promoBooking;
  await check('coupon booking is atomic, commission funded and preserves tax and driver earnings',async()=>{
    await actor(demoAdmin);await call('admin_save_coupon',['HYZZTEST','flat',1000,1000,0,new Date(Date.now()-60000).toISOString(),new Date(Date.now()+86400000).toISOString(),10,1,true]);
    await owner(()=>db.exec("delete from private.rate_limits where action='booking'"));await actor(demoCustomer);
    promoBooking=await call('create_service_booking',[randomUUID(),'Operations coupon fixture',16.301,80.439,'hourly',60,new Date().toISOString(),0,null,null,null,null,'professional','HYZZTEST']);
    const fares=await owner(async()=>{const b=(await db.query('select * from public.bookings where id=$1',[promoBooking.id])).rows[0];return [await scalar("select private.service_fare($1::jsonb,'hourly',60,0,60)",[JSON.stringify(b.pricing_snapshot)]),await scalar("select private.service_fare_v14($1::jsonb,'hourly',60,0,60)",[JSON.stringify(b.pricing_snapshot)])];});
    assert.equal(fares[0].earnings_paise,fares[1].earnings_paise);assert.equal(fares[0].tax_paise,fares[1].tax_paise);assert.equal(fares[0].total_paise,fares[1].total_paise-1000);assert.equal(fares[0].commission_paise,fares[1].commission_paise-1000);
    await call('cancel_booking',[promoBooking.id,'Fixture coupon release reservation']);
    const key=randomUUID();await deny(()=>call('create_service_booking',[key,'Invalid coupon fixture',16.301,80.439,'hourly',60,new Date().toISOString(),0,null,null,null,null,'professional','UNKNOWN']),/Coupon/);
    assert.equal(await owner(()=>scalar('select count(*) from public.bookings where request_key=$1',[key])),0);
  });
  await check('per-ride commission overrides are audited and locked after assignment',async()=>{
    await actor(demoCustomer);promoBooking=await call('create_service_booking',[randomUUID(),'Commission fixture',16.301,80.439,'hourly',60,new Date().toISOString(),0]);
    await actor(demoAdmin);await call('admin_booking_commission',[promoBooking.id,1000,'Approved pre-assignment rate adjustment']);
    await actor(applicant);await call('set_availability',[true,16.301,80.439]);await actor(demoAdmin);await call('admin_assign_driver',[promoBooking.id,applicant,'Operations assigns the unmatched fixture ride']);assert.equal(await owner(()=>scalar("select count(*) from public.notification_records where booking_id=$1 and title like 'Operations assigned%'",[promoBooking.id])),2);
    await actor(demoAdmin);await deny(()=>call('admin_booking_commission',[promoBooking.id,0,'Attempt after acceptance']),/before driver assignment/);await deny(()=>call('admin_driver_access',[applicant,false,'Attempt during assigned trip']),/active trip/);
    await call('cancel_booking',[promoBooking.id,'Fixture operations cleanup']);
  });
  await check('release drafts, publish monotonicity and private download records enforce roles',async()=>{
    await actor(demoCustomer);await deny(()=>call('admin_release_draft',['driver','9.0.0',90,'Unauthorized release']),/Permission/);
    await actor(demoAdmin);const release=await call('admin_release_draft',['driver','9.0.0',90,'Fixture release; not an actual binary']);
    await deny(()=>call('api_publish_release',[release.id,demoAdmin,'a'.repeat(64),4096]),/permission denied/);
    await owner(()=>call('api_publish_release',[release.id,demoAdmin,'a'.repeat(64),4096]));
    assert.equal((await owner(()=>call('api_latest_release',['driver']))).id,release.id);
    await actor(demoAdmin);await deny(()=>call('admin_release_draft',['driver','8.0.0',80,'Outdated fixture release']),/exceed/);
    const first=await owner(()=>call('api_release_notifications'));assert.ok(first>0);assert.equal(await owner(()=>call('api_release_notifications')),0);
    const count=await owner(()=>scalar('select count(*) from public.notification_records where release_id=$1',[release.id]));assert.equal(count,first);
    await actor(demoAdmin);await call('admin_retire_release',[release.id,'Fixture retirement for testing']);assert.equal(await owner(()=>call('api_release_record',[release.id,null])),null);
  });
  console.log(`\n${checks} database checks passed. Auth/Storage are adapters; multi-connection contention and hosted integrations require Supabase staging tests.`);
} catch (e) {
  console.error(
    "DATABASE CHECK FAILED:",
    e.message,
    e.detail || "",
    e.where || "",
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
