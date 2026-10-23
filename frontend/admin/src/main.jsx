import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHyzzClient, action } from "../../shared/api/client";
import { API_BASE_URL } from "./config/api";
import "./style.css";
import Brand, { NavIcon } from "./Brand";
import journeyImage from "../../../assets/hyzz-journey.png";
import LiveMap from "./LiveMap";
import DriverPayoutReview from "./DriverPayoutReview";
import ContactUs from "./ContactUs";
import {
  RideAccess,
  RideCommission,
  ContentManagement,
  Enquiries,
  Promotions,
  AppReleases,
} from "./Management";
import { ServiceZones, DriverTags, VehicleReview } from "./PlatformManagement";
import {
  ManualAssignment,
  RolePermissions,
  DeletionRequests,
} from "./Operations";
const db = createHyzzClient({
  baseURL: API_BASE_URL,
  auth: { persistSession: false },
});
const money = (v) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(v || 0) / 100,
  );
const when = (v) => new Date(v).toLocaleString("en-IN");
const readable = (v) => String(v || "—").replaceAll("_", " ");
const rpc = (name, params = {}) => action(db, name, params);
function Input({ label, ...props }) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}
function Panel({ title, children }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Badge({ children }) {
  return <span className="badge">{readable(children)}</span>;
}
function Table({ columns, rows, render }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map(render)
          ) : (
            <tr>
              <td colSpan={columns.length} className="empty">
                No records to display.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
const permissions = {
  Overview: null,
  Bookings: "bookings.manage",
  Customers: "users.manage",
  Drivers: "drivers.review",
  Employees: "staff.manage",
  Finance: "finance.read",
  Support: "support.manage",
  Settings: "settings.manage",
  Audit: "staff.manage",
  Reports: "reports.read",
  Content: "content.manage",
  Enquiries: "support.manage",
  Promotions: "finance.manage",
  "App updates": "releases.manage",
};
function App() {
  const [session, setSession] = useState(null),
    [email, setEmail] = useState(""),
    [token, setToken] = useState(""),
    [sent, setSent] = useState(false),
    [wait, setWait] = useState(0),
    [profile, setProfile] = useState(null),
    [data, setData] = useState({}),
    [loaded, setLoaded] = useState(false),
    [selectedBooking, setSelectedBooking] = useState(null),
    [page, setPage] = useState("Overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("");
  const run = useCallback(async (fn) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message || "Request failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }, []);
  const load = useCallback(async () => {
    const current = await rpc("my_profile");
    setProfile(current);
    if (current.kind !== "employee") return;
    const overview = await rpc("admin_overview");
    setData(overview);
    setLoaded(true);
  }, []);
  useEffect(() => {
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        setData({});
        setLoaded(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session) run(load);
  }, [session, load, run]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        load().catch((e) =>
          setError(e.message || "Dashboard refresh failed. Please retry."),
        );
    }, 15000);
    return () => clearInterval(timer);
  }, [session, load]);
  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const has = (p) => profile?.permissions?.includes(p);
  const change = async (name, args) => {
    await rpc(name, args);
    await load();
    setNotice("Change saved.");
  };
  const reason = () =>
    window.prompt("Enter the reason for this action (at least 5 characters):");
  const rows = (data.bookings || []).filter((b) =>
    `${b.reference} ${b.state} ${b.pickup_address}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  if (!session)
    return (
      <main className="login">
        <div className="login-art">
          <Brand />
          <p className="eyebrow">OPERATIONS, CONNECTED.</p>
          <h1>
            Every great journey
            <br />
            starts behind
            <br />
            the scenes.
          </h1>
          <p>
            People, drivers and journeys.
            <br />
            One place to keep it all moving.
          </p>
          <img
            className="journey-art"
            src={journeyImage}
            alt="Illustration of a Hyzz chauffeur beside a customer-owned car"
            width="1536"
            height="1024"
          />
        </div>
        <div className="login-form">
          <div className="eyebrow">HYZZ ADMIN CONSOLE</div>
          <h2>Welcome back.</h2>
          <p>Secure access for authorized Hyzz staff.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (!sent) {
                  const { error: e } = await db.auth.signInWithOtp({
                    email: email.trim().toLowerCase(),
                    options: { shouldCreateUser: false },
                  });
                  if (e) throw e;
                  setSent(true);
                  setWait(60);
                } else {
                  const { error: e } = await db.auth.verifyOtp({
                    email: email.trim().toLowerCase(),
                    token: token.trim(),
                    type: "email",
                  });
                  if (e) throw e;
                }
              });
            }}
          >
            <Input
              label="Work email"
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={sent}
              onChange={(e) => setEmail(e.target.value)}
            />
            {sent && (
              <Input
                label="Email verification code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,10}"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            )}
            <button disabled={busy}>
              {busy
                ? "Please wait…"
                : sent
                  ? "Verify & sign in"
                  : "Send sign-in code"}{" "}
              →
            </button>
          </form>
          {sent && (
            <div className="actions">
              <button
                className="ghost"
                onClick={() => {
                  setSent(false);
                  setToken("");
                }}
              >
                Change email
              </button>
              <button
                className="ghost"
                disabled={wait > 0 || busy}
                onClick={() =>
                  run(async () => {
                    const { error: e } = await db.auth.signInWithOtp({
                      email,
                      options: { shouldCreateUser: false },
                    });
                    if (e) throw e;
                    setWait(60);
                  })
                }
              >
                {wait ? `Resend in ${wait}s` : "Resend code"}
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <p className="fine">
            First admin setup requires the supplied bootstrap SQL. No public
            staff registration.
          </p>
          <ContactUs />
        </div>
      </main>
    );
  return (
    <div className="layout">
      <aside>
        <Brand onClick={() => setPage("Overview")} />
        <div className="workspace">OPERATIONS WORKSPACE</div>
        <nav aria-label="Main navigation">
          {Object.entries(permissions)
            .filter(([_, p]) => !p || has(p))
            .map(([title]) => (
              <button
                key={title}
                className={page === title ? "active" : ""}
                onClick={() => {
                  setPage(title);
                  setFilter("");
                }}
              >
                <NavIcon name={title} />
                {title}
              </button>
            ))}
        </nav>
        <div className="aside-bottom">
          <strong>{profile?.full_name || "Hyzz staff"}</strong>
          <small>Permissions enforced by Supabase</small>
          <button className="ghost" onClick={() => db.auth.signOut()}>
            Sign out ↗
          </button>
        </div>
      </aside>
      <main className="main">
        <header>
          <div>
            <p className="eyebrow">HYZZ / {page.toUpperCase()}</p>
            <h1>
              {page === "Overview" ? "A clear view of the road ahead." : page}
            </h1>
            <p>Manage the journeys that move your business.</p>
          </div>
          <button className="ghost" disabled={busy} onClick={() => run(load)}>
            {busy ? "Updating…" : "↻ Refresh"}
          </button>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {!profile ? (
          <Panel title="Connect your backend">
            <p>
              Apply the supplied Supabase migrations, configure SMTP and
              bootstrap the first administrator.
            </p>
            <button onClick={() => run(load)}>Retry connection</button>
          </Panel>
        ) : profile.kind !== "employee" ? (
          <Panel title="Staff account required">
            <p>
              Your account has no administrative access. Ask the project owner
              to complete administrator setup.
            </p>
          </Panel>
        ) : !loaded ? (
          <Panel
            title={
              error ? "Dashboard data is unavailable" : "Loading admin details"
            }
          >
            <p>
              {error
                ? "Your account is signed in, but the dashboard request failed. Retry after checking the API deployment."
                : "Loading the records your staff role is allowed to view."}
            </p>
            <button disabled={busy} onClick={() => run(load)}>
              Retry loading details
            </button>
          </Panel>
        ) : (
          <>
            {page === "Overview" && (
              <>
                <div className="welcome">
                  <div>
                    <span className="eyebrow">
                      YOUR OPERATIONS, AT A GLANCE
                    </span>
                    <h2>
                      Keep every journey
                      <br />
                      moving forward.
                    </h2>
                    <p>
                      Live database records. Demo fixtures are labelled for
                      testing.
                    </p>
                  </div>
                  <img
                    className="dashboard-journey"
                    src={journeyImage}
                    alt=""
                    width="1536"
                    height="1024"
                  />
                </div>
                <div className="stats">
                  {Object.entries(data.counts || {}).map(([k, v]) => (
                    <div className="stat" key={k}>
                      <span>{readable(k)}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                  {!Object.keys(data.counts || {}).length && (
                    <div className="stat">
                      <span>Booking activity</span>
                      <strong>—</strong>
                      <small>No records or report permission</small>
                    </div>
                  )}
                </div>
                <div className="grid">
                  <Panel title="Release capabilities">
                    <p>
                      Customer and driver email OTP, approved driver matching,
                      pickup OTP, server-timed fares, cash confirmation, support
                      and audited operations.
                    </p>
                    <div className="notice">
                      Pilot configuration · INR · customer-owned vehicles
                    </div>
                  </Panel>
                  <Panel title="External integrations">
                    <p>
                      Online payments, background push, map search and automated
                      payouts are unavailable until their providers and
                      workflows are implemented.
                    </p>
                    <p>
                      SMTP and database setup must be completed before live use.
                    </p>
                  </Panel>
                </div>
              </>
            )}
            {page === "Bookings" && (
              <Panel title="Booking operations">
                <button
                  className="ghost"
                  onClick={() =>
                    downloadCsv(
                      "hyzz-bookings.csv",
                      rows.map(({ pricing_snapshot, ...b }) => b),
                    )
                  }
                >
                  Export visible bookings CSV
                </button>
                <Input
                  label="Search reference, pickup or status"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <Table
                  columns={[
                    "Booking",
                    "Pickup & schedule",
                    "Status",
                    "Fare",
                    "Action",
                  ]}
                  rows={rows}
                  render={(b) => (
                    <tr key={b.id}>
                      <td>
                        <strong>{b.reference}</strong>
                        <small>{b.id}</small>
                      </td>
                      <td>
                        {b.pickup_address}
                        <small>{when(b.scheduled_at)}</small>
                      </td>
                      <td>
                        <Badge>{b.state}</Badge>
                        <small>Payment: {b.payment_status}</small>
                      </td>
                      <td>{money(b.final_paise ?? b.estimate_paise)}</td>
                      <td>
                        <button
                          className="ghost"
                          onClick={() =>
                            run(async () => {
                              const details = await rpc("booking_details", {
                                p_booking: b.id,
                              });
                              setSelectedBooking(details);
                            })
                          }
                        >
                          Details
                        </button>
                        {[
                          "MATCHING",
                          "DRIVER_ASSIGNED",
                          "DRIVER_EN_ROUTE",
                          "DRIVER_ARRIVED",
                          "OTP_VERIFIED",
                        ].includes(b.state) && (
                          <button
                            className="danger ghost"
                            onClick={() => {
                              const r = reason();
                              if (r && window.confirm("Cancel this booking?"))
                                run(() =>
                                  change("cancel_booking", {
                                    p_booking: b.id,
                                    p_reason: r,
                                  }),
                                );
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                />
              </Panel>
            )}
            {page === "Customers" && (
              <>
                <AccountCreation run={run} load={load} kind="driver" />
                <AccountCreation run={run} load={load} kind="customer" />
                <Panel title="Customer & driver accounts">
                  <Input
                    label="Search name or ID"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                  <Table
                    columns={["Name", "Contact", "Type", "Status", "Actions"]}
                    rows={(data.users || []).filter(
                      (u) =>
                        u.kind !== "employee" &&
                        `${u.full_name} ${u.id} ${u.email || ""} ${u.phone || ""}`
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                    )}
                    render={(u) => (
                      <tr key={u.id}>
                        <td>
                          {u.full_name || "Name not set"}
                          <small>{u.id}</small>
                        </td>
                        <td>
                          {u.email || "Email not available"}
                          <small>{u.phone || "Phone not provided"}</small>
                        </td>
                        <td>{u.kind}</td>
                        <td>
                          <Badge>{u.status}</Badge>
                        </td>
                        <td>
                          <button
                            className="ghost"
                            onClick={() => {
                              const name = window.prompt(
                                "Full name",
                                u.full_name,
                              );
                              if (name === null) return;
                              const phone = window.prompt(
                                "International phone, or leave blank",
                                u.phone || "",
                              );
                              if (phone === null) return;
                              const r = reason();
                              if (r)
                                run(() =>
                                  change("admin_update_person", {
                                    p_user: u.id,
                                    p_name: name,
                                    p_phone: phone.trim() || null,
                                    p_reason: r,
                                  }),
                                );
                            }}
                          >
                            Edit details
                          </button>
                          {["active", "suspended", "blocked"]
                            .filter((v) => v !== u.status)
                            .map((v) => (
                              <button
                                className="ghost"
                                key={v}
                                onClick={() => {
                                  const r = reason();
                                  if (r && window.confirm(`Set account ${v}?`))
                                    run(() =>
                                      change("admin_set_status", {
                                        p_user: u.id,
                                        p_status: v,
                                        p_reason: r,
                                      }),
                                    );
                                }}
                              >
                                {v}
                              </button>
                            ))}
                        </td>
                      </tr>
                    )}
                  />
                </Panel>
              </>
            )}
            {page === "Bookings" && selectedBooking && (
              <Panel title={`Timeline and fare · ${selectedBooking.reference}`}>
                <button
                  className="ghost"
                  onClick={() => setSelectedBooking(null)}
                >
                  Close details
                </button>
                <p>
                  {selectedBooking.pickup_address} ·{" "}
                  {readable(selectedBooking.state)} ·{" "}
                  {readable(selectedBooking.payment_status)}
                </p>
                <div className="grid">
                  <div>
                    {(selectedBooking.history || []).map((h) => (
                      <p key={h.id}>
                        {when(h.created_at)} · {readable(h.to_state)}
                        {h.detail ? ` · ${h.detail}` : ""}
                      </p>
                    ))}
                  </div>
                  <div>
                    {selectedBooking.fare ? (
                      <>
                        <p>
                          Base:{" "}
                          {money(selectedBooking.fare.breakdown.base_paise)}
                        </p>
                        <p>
                          Service:{" "}
                          {money(selectedBooking.fare.breakdown.service_paise)}
                        </p>
                        <p>
                          GST: {money(selectedBooking.fare.breakdown.tax_paise)}
                        </p>
                        <p>Total: {money(selectedBooking.final_paise)}</p>
                        <p>
                          Driver earnings:{" "}
                          {money(selectedBooking.earnings_paise)}
                        </p>
                        <p>
                          Commission: {money(selectedBooking.commission_paise)}
                        </p>
                      </>
                    ) : (
                      <p>
                        Estimate: {money(selectedBooking.estimate_paise)}. Final
                        fare is calculated at completion.
                      </p>
                    )}
                    <p>
                      Pricing snapshot: {selectedBooking.pricing_snapshot?.id}
                    </p>
                  </div>
                </div>
              </Panel>
            )}
            {page === "Drivers" && (
              <>
                {has("users.manage") && (
                  <AccountCreation run={run} load={load} kind="driver" />
                )}
                <RideAccess
                  drivers={data.drivers || []}
                  rpc={rpc}
                  run={run}
                  load={load}
                />
                <Panel title="Driver verification">
                  <Table
                    columns={[
                      "Driver",
                      "Verification",
                      "Availability",
                      "Action",
                    ]}
                    rows={data.drivers || []}
                    render={(d) => (
                      <tr key={d.user_id}>
                        <td>
                          {d.full_name || "Driver"}
                          <small>{d.user_id}</small>
                          <small>
                            {d.email || ""} {d.phone || ""}
                          </small>
                        </td>
                        <td>
                          <Badge>{d.verification}</Badge>
                        </td>
                        <td>{d.online ? "Online" : "Offline"}</td>
                        <td>
                          <button
                            className="ghost"
                            onClick={() => {
                              const r = reason();
                              if (
                                r &&
                                window.confirm(
                                  "Approve this driver after reviewing their documents?",
                                )
                              )
                                run(() =>
                                  change("admin_approve_driver", {
                                    p_driver: d.user_id,
                                    p_reason: r,
                                  }),
                                );
                            }}
                          >
                            Approve driver
                          </button>
                        </td>
                      </tr>
                    )}
                  />
                </Panel>
                <DriverTags drivers={data.drivers || []} rpc={rpc} run={run} />
                <DocumentUpload
                  drivers={data.drivers || []}
                  run={run}
                  load={load}
                />
                <Panel title="Private document review">
                  <Table
                    columns={[
                      "Driver",
                      "Document",
                      "Expiry",
                      "Status",
                      "Actions",
                    ]}
                    rows={data.documents || []}
                    render={(d) => (
                      <tr key={d.id}>
                        <td>
                          <small>{d.driver_id}</small>
                        </td>
                        <td>{readable(d.document_type)}</td>
                        <td>{d.expires_on}</td>
                        <td>
                          <Badge>{d.status}</Badge>
                          {d.rejection_reason && (
                            <small>{d.rejection_reason}</small>
                          )}
                        </td>
                        <td>
                          <button
                            className="ghost"
                            onClick={() =>
                              run(async () => {
                                const { data, error } = await db.storage
                                  .from("driver-documents")
                                  .createSignedUrl(d.storage_path, 60);
                                if (error) throw error;
                                window.open(
                                  data.signedUrl,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              })
                            }
                          >
                            View (60s)
                          </button>
                          {["approved", "rejected"].map((status) => (
                            <button
                              key={status}
                              className="ghost"
                              onClick={() => {
                                const r = reason();
                                if (r)
                                  run(() =>
                                    change("admin_review_document", {
                                      p_document: d.id,
                                      p_status: status,
                                      p_reason: r,
                                    }),
                                  );
                              }}
                            >
                              {status === "approved" ? "Approve" : "Reject"}
                            </button>
                          ))}
                        </td>
                      </tr>
                    )}
                  />
                </Panel>
              </>
            )}
            {page === "Employees" && (
              <>
                <AccountCreation run={run} load={load} kind="employee" />
                <Panel title="Employee permissions">
                  <Table
                    columns={["Employee", "Roles", "Status", "Action"]}
                    rows={data.employees || []}
                    render={(u) => (
                      <tr key={u.id}>
                        <td>
                          {u.full_name}
                          <small>{u.id}</small>
                        </td>
                        <td>{(u.roles || []).join(", ")}</td>
                        <td>{u.status}</td>
                        <td>
                          <select
                            aria-label={`Role for ${u.full_name}`}
                            defaultValue=""
                            onChange={(e) => {
                              const r = reason();
                              if (r)
                                run(() =>
                                  change("admin_set_role", {
                                    p_user: u.id,
                                    p_role: e.target.value,
                                    p_reason: r,
                                  }),
                                );
                              e.target.value = "";
                            }}
                          >
                            <option value="">Assign role…</option>
                            {[
                              "super_admin",
                              "operations",
                              "verification",
                              "support",
                              "finance",
                              "reporting",
                            ].map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                          {["active", "suspended"]
                            .filter((v) => v !== u.status)
                            .map((v) => (
                              <button
                                key={v}
                                className="ghost"
                                onClick={() => {
                                  const r = reason();
                                  if (r && window.confirm(`Set employee ${v}?`))
                                    run(() =>
                                      change("admin_set_status", {
                                        p_user: u.id,
                                        p_status: v,
                                        p_reason: r,
                                      }),
                                    );
                                }}
                              >
                                {v}
                              </button>
                            ))}
                        </td>
                      </tr>
                    )}
                  />
                </Panel>
              </>
            )}
            {page === "Overview" && has("bookings.manage") && (
              <LiveMap rpc={rpc} />
            )}
            {page === "Finance" && (
              <>
                <div className="stats">
                  {Object.entries(data.financial || {}).map(([k, v]) => (
                    <div className="stat" key={k}>
                      <span>{readable(k)}</span>
                      <strong>{money(v)}</strong>
                    </div>
                  ))}
                </div>
                <div className="notice">
                  Cash collected by drivers is not platform cash. Commission due
                  remains outstanding; online payments, refunds and payouts are
                  unavailable.
                </div>
                <Panel title="Immutable financial ledger">
                  {has("finance.manage") && (
                    <form
                      className="form-grid"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        if (
                          window.confirm(
                            "Record commission actually received? This does not move money.",
                          )
                        )
                          run(() =>
                            change("admin_record_commission", {
                              p_driver: f.get("driver"),
                              p_amount: Number(f.get("amount")),
                              p_reference: f.get("reference"),
                            }),
                          );
                      }}
                    >
                      <Input label="Driver UUID" name="driver" required />
                      <Input
                        label="Commission received (paise)"
                        name="amount"
                        type="number"
                        min="1"
                        step="1"
                        required
                      />
                      <Input
                        label="Unique bank/cash receipt reference"
                        name="reference"
                        minLength={5}
                        maxLength={100}
                        required
                      />
                      <button>Record commission receipt</button>
                    </form>
                  )}
                  {(data.commission_receipts || []).map((r) => (
                    <p key={r.id}>
                      Receipt {r.reference}: {money(r.amount_paise)} ·{" "}
                      {when(r.created_at)}
                    </p>
                  ))}
                  <Table
                    columns={["Booking", "Type", "Amount", "Recorded"]}
                    rows={data.ledger || []}
                    render={(l) => (
                      <tr key={l.id}>
                        <td>
                          <small>{l.booking_id}</small>
                        </td>
                        <td>{readable(l.entry_type)}</td>
                        <td>{money(l.amount_paise)}</td>
                        <td>{when(l.created_at)}</td>
                      </tr>
                    )}
                  />
                  <button
                    className="ghost"
                    onClick={() =>
                      downloadCsv("hyzz-ledger.csv", data.ledger || [])
                    }
                  >
                    Export visible ledger CSV
                  </button>
                </Panel>
              </>
            )}
            {page === "Support" && (
              <>
                <Panel title="Urgent incident records">
                  <p>
                    These records do not contact emergency services. Establish
                    and staff an operational escalation process before launch.
                  </p>
                  <Table
                    columns={["User", "Message", "Recorded"]}
                    rows={data.emergencies || []}
                    render={(e) => (
                      <tr key={e.id}>
                        <td>
                          <small>{e.user_id}</small>
                        </td>
                        <td>{e.message}</td>
                        <td>{when(e.created_at)}</td>
                      </tr>
                    )}
                  />
                </Panel>
                <Panel title="Support & disputes">
                  <Table
                    columns={["Request", "Status", "Staff note", "Action"]}
                    rows={data.tickets || []}
                    render={(t) => (
                      <tr key={t.id}>
                        <td>
                          {t.subject}
                          <small>{t.user_id}</small>
                        </td>
                        <td>
                          <Badge>{t.status}</Badge>
                        </td>
                        <td>{t.admin_note || "—"}</td>
                        <td>
                          {["in_review", "resolved"].map((status) => (
                            <button
                              className="ghost"
                              key={status}
                              onClick={() => {
                                const note = window.prompt(
                                  "Staff note (5+ characters):",
                                );
                                if (note)
                                  run(() =>
                                    change("admin_resolve_ticket", {
                                      p_ticket: t.id,
                                      p_status: status,
                                      p_note: note,
                                    }),
                                  );
                              }}
                            >
                              {readable(status)}
                            </button>
                          ))}
                        </td>
                      </tr>
                    )}
                  />
                </Panel>
              </>
            )}
            {page === "Bookings" && (
              <ManualAssignment
                bookings={data.bookings || []}
                drivers={data.drivers || []}
                run={run}
                rpc={rpc}
                load={load}
              />
            )}
            {page === "Bookings" && has("finance.manage") && (
              <RideCommission
                bookings={data.bookings || []}
                rpc={rpc}
                run={run}
                load={load}
              />
            )}
            {page === "Content" && <ContentManagement rpc={rpc} run={run} />}
            {page === "Enquiries" && <Enquiries rpc={rpc} run={run} />}
            {page === "Promotions" && <Promotions rpc={rpc} run={run} />}
            {page === "App updates" && (
              <AppReleases db={db} rpc={rpc} run={run} apiURL={API_BASE_URL} />
            )}
            {page === "Employees" && (
              <RolePermissions run={run} rpc={rpc} db={db} load={load} />
            )}
            {page === "Customers" && <DeletionRequests run={run} db={db} />}
            {page === "Customers" && (
              <VehicleReview db={db} rpc={rpc} run={run} />
            )}
            {page === "Finance" && (
              <DriverPayoutReview
                db={db}
                rpc={rpc}
                run={run}
                apiURL={API_BASE_URL}
                canManage={profile.permissions.includes("finance.manage")}
              />
            )}
            {page === "Settings" && (
              <>
                <Settings run={run} load={load} />
                <ServiceZones db={db} rpc={rpc} run={run} />
              </>
            )}
            {page === "Audit" && (
              <Panel title="Administrative audit history">
                <Table
                  columns={["Action", "Actor", "Reason", "Time"]}
                  rows={data.audit || []}
                  render={(a) => (
                    <tr key={a.id}>
                      <td>
                        {a.action}
                        <small>{a.target_id}</small>
                      </td>
                      <td>
                        <small>{a.actor_id}</small>
                      </td>
                      <td>{a.reason || "—"}</td>
                      <td>{when(a.created_at)}</td>
                    </tr>
                  )}
                />
              </Panel>
            )}
            {page === "Reports" && (
              <Panel title="Booking state report">
                <p>
                  All-time server aggregate. Personal and financial records are
                  restricted by separate permissions.
                </p>
                <Table
                  columns={["State", "Count"]}
                  rows={Object.entries(data.counts || {})}
                  render={([k, v]) => (
                    <tr key={k}>
                      <td>{readable(k)}</td>
                      <td>{v}</td>
                    </tr>
                  )}
                />
                <button
                  className="ghost"
                  onClick={() =>
                    downloadCsv(
                      "hyzz-booking-counts.csv",
                      Object.entries(data.counts || {}).map(
                        ([state, count]) => ({ state, count }),
                      ),
                    )
                  }
                >
                  Export counts CSV
                </button>
              </Panel>
            )}
          </>
        )}
        <footer>
          Hyzz Operations · Connected to your Supabase project · Pilot release
        </footer>
      </main>
    </div>
  );
}
function AccountCreation({ run, load, kind }) {
  return (
    <Panel
      title={
        kind === "driver"
          ? "Create driver account"
          : kind === "customer"
            ? "Create customer account"
            : "Create employee account"
      }
    >
      <p>
        Creates a passwordless account. The user requests an email code in their
        app. Driver document approval and ride access are managed separately.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            form = e.currentTarget;
          run(async () => {
            const { data, error } = await db.functions.invoke(
              "admin-accounts",
              {
                body: {
                  kind,
                  name: f.get("name"),
                  email: f.get("email"),
                  role: f.get("role"),
                },
              },
            );
            if (error)
              throw new Error(
                "Account creation failed. Confirm the Node API is deployed, its server credentials are configured and you have permission.",
              );
            if (data.error) throw new Error(data.error);
            form.reset();
            await load();
            window.alert(data.message);
          });
        }}
      >
        <Input
          label="Full name"
          name="name"
          required
          minLength={2}
          maxLength={100}
        />
        <Input label="Email address" name="email" type="email" required />
        {kind === "employee" && (
          <label>
            Role
            <select name="role">
              {[
                "operations",
                "verification",
                "support",
                "finance",
                "reporting",
                "super_admin",
              ].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
        <button>Create {kind}</button>
      </form>
    </Panel>
  );
}
function DocumentUpload({ drivers, run, load }) {
  return (
    <Panel title="Upload private driver document">
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            form = e.currentTarget;
          run(async () => {
            const file = f.get("file"),
              driver = f.get("driver");
            if (!driver || !file?.size || file.size > 4194304)
              throw new Error("Choose a driver and a file under 4 MiB.");
            const ext = {
              "application/pdf": "pdf",
              "image/jpeg": "jpg",
              "image/png": "png",
            }[file.type];
            if (!ext) throw new Error("Use PDF, PNG or JPEG.");
            const path = `${driver}/${crypto.randomUUID()}.${ext}`;
            const { error } = await db.storage
              .from("driver-documents")
              .upload(path, file, { contentType: file.type, upsert: false });
            if (error) throw error;
            await rpc("register_document", {
              p_driver: driver,
              p_type: f.get("type"),
              p_path: path,
              p_expires: f.get("expires"),
            });
            form.reset();
            await load();
          });
        }}
      >
        <label>
          Driver
          <select name="driver" required>
            <option value="">Select driver…</option>
            {drivers.map((d) => (
              <option key={d.user_id} value={d.user_id}>
                {d.full_name || d.user_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Document type
          <select name="type">
            <option value="driving_license">Driving license</option>
            <option value="identity">Identity</option>
            <option value="insurance">Insurance</option>
            <option value="police_verification">Police verification</option>
            <option value="profile_photo">Profile photo</option>
          </select>
        </label>
        <Input
          label="Expiry / review-by date"
          type="date"
          name="expires"
          required
        />
        <Input
          label="Private file (up to 4 MiB)"
          type="file"
          name="file"
          required
          accept=".pdf,.png,.jpg,.jpeg"
        />
        <button>Upload for review</button>
      </form>
    </Panel>
  );
}
function Settings({ run, load }) {
  const [pricing, setPricing] = useState(null),
    [settings, setSettings] = useState(null);
  useEffect(() => {
    run(async () => {
      const p = await db
        .from("pricing_rules")
        .select("*")
        .order("effective_at", { ascending: false })
        .limit(1);
      if (p.error) throw p.error;
      setPricing(p.data[0]);
      const s = await db.from("system_settings").select("*").single();
      if (s.error) throw s.error;
      setSettings(s.data);
    });
  }, [run]);
  return (
    <>
      {pricing && (
        <Panel title="Pricing · append a new version">
          <p>
            Amounts in integer paise. 100 paise = ₹1. Commission in basis
            points: 1500 = 15%. Existing booking prices remain unchanged.
          </p>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                window.confirm(
                  "Publish a new price version for future bookings?",
                )
              )
                run(async () => {
                  await rpc("admin_publish_pricing", {
                    p_base: Number(f.get("base")),
                    p_hourly: Number(f.get("hourly")),
                    p_minimum: Number(f.get("minimum")),
                    p_day: Number(f.get("day")),
                    p_commission: Number(f.get("commission")),
                    p_per_km: Number(f.get("per_km")),
                    p_grace: Number(f.get("grace")),
                    p_tax: Number(f.get("tax")),
                    p_day_hours: Number(f.get("day_hours")),
                  });
                  await load();
                });
            }}
          >
            {[
              ["base", "Base fare", pricing.base_paise],
              ["hourly", "Hourly rate", pricing.hourly_paise],
              ["minimum", "Minimum charge", pricing.minimum_paise],
              ["day", "8-hour day package", pricing.day_paise],
              ["per_km", "Per km (paise)", pricing.per_km_paise],
              ["grace", "Hourly grace minutes", pricing.grace_minutes],
              ["tax", "GST (bps; 1800 = 18%)", pricing.tax_bps],
              ["day_hours", "Full-day included hours", pricing.day_hours],
              ["commission", "Driver commission (bps)", pricing.commission_bps],
            ].map(([key, label, value]) => (
              <Input
                key={key}
                label={label}
                name={key}
                defaultValue={value}
                type="number"
                min="0"
                step="1"
                required
              />
            ))}
            <button>Publish pricing version</button>
          </form>
        </Panel>
      )}
      {settings && (
        <Panel title="Matching & maintenance">
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                await rpc("admin_update_settings", {
                  p_radius: Number(f.get("radius")),
                  p_expiry: Number(f.get("expiry")),
                  p_maintenance: f.get("maintenance") === "on",
                });
                await load();
              });
            }}
          >
            <Input
              label="Matching radius (km)"
              name="radius"
              type="number"
              min="1"
              max="100"
              defaultValue={settings.matching_radius_km}
              required
            />
            <Input
              label="Request lifetime (minutes)"
              name="expiry"
              type="number"
              min="1"
              max="60"
              defaultValue={settings.acceptance_minutes}
              required
            />
            <label className="checkbox">
              <input
                type="checkbox"
                name="maintenance"
                defaultChecked={settings.maintenance}
              />
              Pause new bookings
            </label>
            <button>Save settings</button>
          </form>
        </Panel>
      )}
    </>
  );
}
function downloadCsv(name, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const cell = (v) =>
    `"${String(v ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""')}"`;
  const blob = new Blob(
    [
      "\uFEFF" +
        [
          keys.map(cell).join(","),
          ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
        ].join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
createRoot(document.getElementById("root")).render(<App />);
