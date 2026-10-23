import React, { useEffect, useState } from "react";
const roles = ["operations", "verification", "support", "finance", "reporting"];
const permissions = [
  "users.manage",
  "drivers.review",
  "staff.manage",
  "bookings.manage",
  "finance.read",
  "finance.manage",
  "settings.manage",
  "support.manage",
  "reports.read",
  "content.manage",
  "releases.manage",
];
export function ManualAssignment({ bookings, drivers = [], run, rpc, load }) {
  const [available, setAvailable] = useState([]);
  useEffect(() => {
    run(async () => setAvailable(await rpc("admin_assignable_drivers")));
  }, [run, rpc]);
  return (
    <section className="panel">
      <h2>Manual assignment / reassignment</h2>
      <button
        className="ghost"
        onClick={() =>
          run(async () => setAvailable(await rpc("admin_assignable_drivers")))
        }
      >
        Refresh available drivers
      </button>
      <p>
        For eligible pre-trip bookings only. The driver must be online, approved
        and free of other assignments. A reason is required and audited.
        Existing pickup codes are invalidated.
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (window.confirm("Assign this booking to the selected driver?"))
            run(async () => {
              await rpc("admin_assign_driver", {
                p_booking: f.get("booking"),
                p_driver: f.get("driver"),
                p_reason: f.get("reason"),
              });
              await load();
            });
        }}
      >
        <label>
          Booking
          <select name="booking" required>
            <option value="">Select booking…</option>
            {bookings
              .filter((b) =>
                [
                  "MATCHING",
                  "DRIVER_ASSIGNED",
                  "DRIVER_EN_ROUTE",
                  "DRIVER_ARRIVED",
                  "NO_DRIVER_AVAILABLE",
                ].includes(b.state),
              )
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.reference} · {b.state}
                </option>
              ))}
          </select>
        </label>
        <label>
          Driver
          <select name="driver" required>
            <option value="">Choose an approved online driver</option>
            {available.map((d) => (
              <option key={d.user_id} value={d.user_id}>
                {d.full_name} · {d.user_id}
              </option>
            ))}
          </select>
          {!available.length && (
            <small>
              No approved, online, unassigned drivers are currently available.
            </small>
          )}
        </label>
        <label>
          Operational reason
          <input name="reason" required minLength={5} />
        </label>
        <button>Assign driver</button>
      </form>
    </section>
  );
}
export function RolePermissions({ run, rpc, db, load }) {
  const [role, setRole] = useState("operations"),
    [checked, setChecked] = useState([]);
  useEffect(() => {
    run(async () => {
      const { data, error } = await db
        .from("role_permissions")
        .select("permission_id")
        .eq("role_id", role);
      if (error) throw error;
      setChecked(data.map((x) => x.permission_id));
    });
  }, [role, run, db]);
  return (
    <section className="panel">
      <h2>Granular role permissions</h2>
      <p>
        Super Admin permissions and your own role cannot be edited. Changes take
        effect on the next server request.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (window.confirm(`Change permissions for ${role}?`))
            run(async () => {
              await rpc("admin_role_permissions", {
                p_role: role,
                p_permissions: checked,
                p_reason: f.get("reason"),
              });
              await load();
            });
        }}
      >
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          {permissions.map((p) => (
            <label key={p} className="checkbox">
              <input
                type="checkbox"
                checked={checked.includes(p)}
                onChange={(e) =>
                  setChecked(
                    e.target.checked
                      ? [...checked, p]
                      : checked.filter((v) => v !== p),
                  )
                }
              />
              {p}
            </label>
          ))}
        </div>
        <label>
          Change reason
          <input name="reason" required minLength={5} />
        </label>
        <button>Save role permissions</button>
      </form>
    </section>
  );
}
export function DeletionRequests({ run, db }) {
  const [requests, setRequests] = useState([]);
  useEffect(() => {
    run(async () => {
      const { data, error } = await db
        .from("account_deletion_requests")
        .select("*")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      setRequests(data || []);
    });
  }, [run, db]);
  return (
    <section className="panel">
      <h2>Account deletion requests</h2>
      <p>
        Requests require a documented privacy and financial retention review.
        This interface does not silently delete financial records.
      </p>
      {!requests.length ? (
        <p>No requests.</p>
      ) : (
        requests.map((r) => (
          <p key={r.user_id}>
            <strong>{r.user_id}</strong> · {r.status} ·{" "}
            {new Date(r.requested_at).toLocaleString()}
          </p>
        ))
      )}
    </section>
  );
}
