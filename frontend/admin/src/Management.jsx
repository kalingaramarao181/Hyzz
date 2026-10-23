import React, { useEffect, useState } from "react";
function Section({ title, children }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
const field = (label, name, props = {}) => (
  <label>
    {label}
    <input name={name} required {...props} />
  </label>
);
const amount = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    (n || 0) / 100,
  );
export function RideAccess({ drivers, rpc, run, load }) {
  return (
    <Section title="Driver ride access">
      <p>
        Allow or pause new assignments independently of document approval.
        Active trips must be finished or reassigned first.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () => {
            await rpc("admin_driver_access", {
              p_driver: f.get("driver"),
              p_enabled: f.get("access") === "allow",
              p_reason: f.get("reason"),
            });
            await load();
          });
        }}
      >
        <label>
          Driver
          <select name="driver" required>
            <option value="">Choose a driver</option>
            {drivers.map((d) => (
              <option key={d.user_id} value={d.user_id}>
                {d.full_name} ·{" "}
                {d.ride_access === false ? "Paused" : "Access enabled"} ·{" "}
                {d.verification}
              </option>
            ))}
          </select>
        </label>
        <label>
          New ride access
          <select name="access">
            <option value="allow">Enable</option>
            <option value="pause">Pause</option>
          </select>
        </label>
        {field("Audit reason", "reason", { minLength: 5 })}
        <button>Save ride access</button>
      </form>
    </Section>
  );
}
export function RideCommission({ bookings, rpc, run, load }) {
  return (
    <Section title="Commission for an individual ride">
      <p>
        Set the platform commission before assignment. Accepted trips retain
        their agreed pricing snapshot. Default rates and commission are managed
        in Settings.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (
            window.confirm(
              "Update this unassigned ride’s commission and estimate?",
            )
          )
            run(async () => {
              await rpc("admin_booking_commission", {
                p_booking: f.get("booking"),
                p_bps: Math.round(Number(f.get("percent")) * 100),
                p_reason: f.get("reason"),
              });
              await load();
            });
        }}
      >
        <label>
          Unassigned ride
          <select name="booking" required>
            <option value="">Choose a ride</option>
            {bookings
              .filter(
                (b) =>
                  !b.driver_id &&
                  ["MATCHING", "NO_DRIVER_AVAILABLE"].includes(b.state),
              )
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.reference} · {b.pickup_address} ·{" "}
                  {(b.pricing_snapshot?.commission_bps || 0) / 100}%
                </option>
              ))}
          </select>
        </label>
        {field("Commission %", "percent", {
          type: "number",
          min: 0,
          max: 100,
          step: "0.01",
        })}
        {field("Audit reason", "reason", { minLength: 5 })}
        <button>Update commission</button>
      </form>
    </Section>
  );
}
export function ContentManagement({ rpc, run }) {
  const [items, setItems] = useState([]),
    [current, setCurrent] = useState({
      key: "",
      title: "",
      body: "",
      published: false,
    });
  const load = async () => setItems(await rpc("admin_content"));
  useEffect(() => {
    run(load);
  }, [run]);
  return (
    <Section title="Website guides, policies and contact details">
      <p>
        Content is plain text. Draft policies stay private until reviewed and
        published. Phone numbers use international format, for example
        +917730020465.
      </p>
      <div className="actions">
        {items.map((i) => (
          <button className="ghost" key={i.key} onClick={() => setCurrent(i)}>
            {i.title} · {i.published ? "Published" : "Draft"}
          </button>
        ))}
        <button
          className="ghost"
          onClick={() =>
            setCurrent({ key: "", title: "", body: "", published: false })
          }
        >
          New page / policy
        </button>
      </div>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await rpc("admin_save_content", {
              p_key: current.key,
              p_title: current.title,
              p_body: current.body,
              p_published: current.published,
            });
            await load();
          });
        }}
      >
        <label>
          Unique key
          <input
            required
            pattern="[a-z_]{2,40}"
            value={current.key}
            onChange={(e) => setCurrent({ ...current, key: e.target.value })}
          />
        </label>
        <label>
          Title
          <input
            required
            minLength={2}
            maxLength={150}
            value={current.title}
            onChange={(e) => setCurrent({ ...current, title: e.target.value })}
          />
        </label>
        <label className="wide-field">
          Body / contact value
          <textarea
            rows={8}
            maxLength={12000}
            value={current.body}
            onChange={(e) => setCurrent({ ...current, body: e.target.value })}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={current.published}
            onChange={(e) =>
              setCurrent({ ...current, published: e.target.checked })
            }
          />
          Publish on public website and in apps
        </label>
        <button>Save content</button>
      </form>
    </Section>
  );
}
export function Enquiries({ rpc, run }) {
  const [items, setItems] = useState([]);
  const load = async () => setItems(await rpc("admin_enquiries"));
  useEffect(() => {
    run(load);
  }, [run]);
  return (
    <Section title="Website contact enquiries">
      <p>
        Contact forms are stored privately for your team. No automatic reply or
        staffed response time is promised.
      </p>
      {!items.length && <p>No enquiries yet.</p>}
      {items.map((i) => (
        <article className="enquiry" key={i.id}>
          <h3>
            {i.name} · {i.topic} · {i.status}
          </h3>
          <a href={"mailto:" + i.email}>{i.email}</a>
          {i.phone && <a href={"tel:" + i.phone}> · {i.phone}</a>}
          <p className="plain-text">{i.message}</p>
          {i.note && <p>Team note: {i.note}</p>}
          <div className="actions">
            {["in_review", "resolved"].map((status) => (
              <button
                key={status}
                className="ghost"
                onClick={() => {
                  const note = window.prompt(
                    "Review note (at least 5 characters)",
                  );
                  if (note)
                    run(async () => {
                      await rpc("admin_review_enquiry", {
                        p_id: i.id,
                        p_status: status,
                        p_note: note,
                      });
                      await load();
                    });
                }}
              >
                {status.replace("_", " ")}
              </button>
            ))}
          </div>
        </article>
      ))}
    </Section>
  );
}
export function Promotions({ rpc, run }) {
  const [items, setItems] = useState([]);
  const load = async () => setItems(await rpc("admin_coupons"));
  useEffect(() => {
    run(load);
  }, [run]);
  return (
    <Section title="Coupon codes">
      <p>
        Discounts are funded from platform commission and capped at the
        commission on each trip. Driver earnings and tax stay unchanged.
        Existing bookings keep their coupon snapshot.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () => {
            await rpc("admin_save_coupon", {
              p_code_text: f.get("code").toUpperCase(),
              p_kind: f.get("kind"),
              p_value: Number(f.get("value")),
              p_cap: Math.round(Number(f.get("cap")) * 100),
              p_minimum: Math.round(Number(f.get("minimum")) * 100),
              p_starts: new Date(f.get("starts")).toISOString(),
              p_ends: new Date(f.get("ends")).toISOString(),
              p_max: Number(f.get("max")),
              p_per_customer: Number(f.get("per")),
              p_enabled: f.get("enabled") === "on",
            });
            await load();
          });
        }}
      >
        {field("Code (A–Z, 0–9)", "code", { pattern: "[A-Za-z0-9]{3,24}" })}
        <label>
          Discount type
          <select name="kind">
            <option value="flat">Flat amount in paise</option>
            <option value="percent">Percentage of pre-tax fare</option>
          </select>
        </label>
        {field("Value (paise or percent)", "value", { type: "number", min: 1 })}
        {field("Maximum discount ₹", "cap", {
          type: "number",
          min: 0.01,
          step: "0.01",
        })}
        {field("Minimum estimated fare ₹", "minimum", {
          type: "number",
          min: 0,
          step: "0.01",
          defaultValue: 0,
        })}
        {field("Starts", "starts", { type: "datetime-local" })}
        {field("Ends", "ends", { type: "datetime-local" })}
        {field("Total uses", "max", {
          type: "number",
          min: 1,
          defaultValue: 100,
        })}
        {field("Uses per customer", "per", {
          type: "number",
          min: 1,
          defaultValue: 1,
        })}
        <label className="checkbox">
          <input type="checkbox" name="enabled" defaultChecked />
          Enabled
        </label>
        <button>Save coupon</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Discount</th>
              <th>Cap</th>
              <th>Reserved uses</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.code}>
                <td>{i.code}</td>
                <td>{i.kind === "flat" ? amount(i.value) : i.value + "%"}</td>
                <td>{amount(i.cap_paise)}</td>
                <td>
                  {i.reserved_uses} / {i.max_uses}
                </td>
                <td>
                  {i.enabled ? "Enabled" : "Disabled"}
                  <button
                    className="ghost"
                    onClick={() =>
                      run(async () => {
                        await rpc("admin_save_coupon", {
                          p_code_text: i.code,
                          p_kind: i.kind,
                          p_value: i.value,
                          p_cap: i.cap_paise,
                          p_minimum: i.minimum_paise,
                          p_starts: i.starts_at,
                          p_ends: i.ends_at,
                          p_max: i.max_uses,
                          p_per_customer: i.per_customer,
                          p_enabled: !i.enabled,
                        });
                        await load();
                      })
                    }
                  >
                    Toggle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
export function AppReleases({ db, rpc, run, apiURL }) {
  const [items, setItems] = useState([]),
    [progress, setProgress] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => setItems(await rpc("admin_app_releases"));
  useEffect(() => {
    run(load);
  }, [run]);
  async function request(path, body) {
    const {
      data: { session },
    } = await db.auth.getSession();
    const r = await fetch(apiURL + "/api/v1/admin/releases" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + session?.access_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.message || "Release operation failed");
    return data;
  }
  async function publish(id) {
    if (
      !window.confirm(
        "Have you verified this APK with apksigner, checked the native package/version and confirmed it uses the same signing certificate as installed apps? Publishing makes it downloadable and queues update notices.",
      )
    )
      return;
    setBusy(true);
    try {
      await run(async () => {
        setProgress("Checking APK and publishing…");
        const result = await request("/" + id + "/publish", {
          signature_checked: true,
        });
        setProgress("Published. SHA256: " + result.sha256);
        await load();
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Customer and driver APK updates">
      <p>
        Upload a signed APK, then publish it. Maximum 50 MiB. Verify its native
        signature/package before publishing; server checks archive structure,
        embedded Expo audience/version and computes SHA256, but does not run
        Android apksigner. Keep the same signing key and increase Android
        versionCode.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            file = f.get("apk");
          setBusy(true);
          run(async () => {
            if (
              !file.name.toLowerCase().endsWith(".apk") ||
              file.size < 1024 ||
              file.size > 50 * 1024 * 1024
            )
              throw Error("Choose an APK between 1 KiB and 50 MiB.");
            const draft = await request("/upload", {
              audience: f.get("audience"),
              version: f.get("version"),
              version_code: Number(f.get("code")),
              notes: f.get("notes"),
            });
            setProgress("Uploading directly to private storage…");
            await new Promise((resolve, reject) => {
              const x = new XMLHttpRequest();
              x.open("PUT", draft.signedUrl);
              x.timeout = 180000;
              x.upload.onprogress = (e) => {
                if (e.lengthComputable)
                  setProgress(
                    "Uploading " + Math.round((e.loaded / e.total) * 100) + "%",
                  );
              };
              x.onload = () =>
                x.status >= 200 && x.status < 300
                  ? resolve()
                  : reject(
                      Error(
                        "Upload failed. For an existing uploaded draft use Publish below; otherwise retry.",
                      ),
                    );
              x.onerror = () =>
                reject(Error("Storage upload failed. Check your connection."));
              x.ontimeout = () =>
                reject(
                  Error("Upload timed out. Retry on a stable connection."),
                );
              const body = new FormData();
              body.append("cacheControl", "3600");
              // Windows/browser MIME associations differ for .apk files.
              body.append(
                "",
                new Blob([file], {
                  type: "application/vnd.android.package-archive",
                }),
                file.name,
              );
              x.send(body);
            });
            setProgress(
              "Upload complete. Review the draft below and publish when ready.",
            );
            await load();
          }).finally(() => setBusy(false));
        }}
      >
        <label>
          Application
          <select name="audience">
            <option value="customer">Customer</option>
            <option value="driver">Driver</option>
          </select>
        </label>
        {field("Version, for example 1.5.0", "version", {
          pattern: "[0-9]+\\.[0-9]+\\.[0-9]+",
        })}
        {field("Android versionCode", "code", { type: "number", min: 1 })}
        <label>
          Release notes
          <textarea name="notes" required minLength={5} maxLength={2000} />
        </label>
        {field("Signed APK", "apk", { type: "file", accept: ".apk" })}
        <button disabled={busy}>Upload APK draft</button>
      </form>
      <p role="status" className="plain-text">
        {progress}
      </p>
      <button
        className="ghost"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const r = await request("/notify", {});
            setProgress(
              "Processed " +
                r.notified +
                " update notices. Repeat while batches remain, or configure the scheduler.",
            );
            await load();
          })
        }
      >
        Process next notification batch
      </button>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Application</th>
              <th>Version</th>
              <th>Status / announcements</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.audience}</td>
                <td>
                  {i.version} ({i.version_code})<p>{i.notes}</p>
                </td>
                <td>
                  {i.state} · {i.notified} notified
                  {!i.announcement_complete && i.state === "published"
                    ? " · batch pending"
                    : ""}
                </td>
                <td>
                  {i.state === "draft" && (
                    <button disabled={busy} onClick={() => publish(i.id)}>
                      Publish verified APK
                    </button>
                  )}
                  {i.state === "published" && (
                    <a href={apiURL + "/api/v1/releases/" + i.id + "/download"}>
                      Download APK
                    </a>
                  )}
                  {i.state !== "retired" && (
                    <button
                      className="ghost"
                      onClick={() => {
                        const reason = window.prompt("Retirement reason");
                        if (reason)
                          run(async () => {
                            await rpc("admin_retire_release", {
                              p_id: i.id,
                              p_reason: reason,
                            });
                            await load();
                          });
                      }}
                    >
                      Retire
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        In-app update checks work without FCM. Closed-app push needs Firebase
        credentials and the notification scheduler. Android asks the user to
        install; there are no silent updates.
      </p>
    </Section>
  );
}
