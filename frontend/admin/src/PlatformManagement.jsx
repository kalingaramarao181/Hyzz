import React, { useEffect, useState } from "react";
export function ServiceZones({ db, rpc, run }) {
  const [zones, setZones] = useState([]),
    [status, setStatus] = useState(null);
  async function load() {
    const result = await db.from("service_areas").select("*");
    if (result.error) throw result.error;
    setZones(result.data || []);
    setStatus(await rpc("admin_push_status"));
  }
  useEffect(() => {
    run(load);
  }, [run]);
  return (
    <section className="panel">
      <h2>Service zones & notification queue</h2>
      <p>
        When enabled zones have coordinates, new pickups must fall inside one of
        their circles. Enter the same zone name to update or disable it.
      </p>
      {zones.map((z) => (
        <p key={z.id}>
          {z.name} · {z.lat}, {z.lng} · {z.radius_km} km ·{" "}
          {z.enabled ? "Enabled" : "Disabled"}
        </p>
      ))}
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () => {
            await rpc("admin_service_zone", {
              p_name: f.get("name"),
              p_lat: Number(f.get("lat")),
              p_lng: Number(f.get("lng")),
              p_radius: Number(f.get("radius")),
              p_enabled: f.get("enabled") === "on",
            });
            await load();
          });
        }}
      >
        <label>
          Zone name
          <input name="name" required minLength={2} />
        </label>
        <label>
          Latitude
          <input
            name="lat"
            type="number"
            min="-90"
            max="90"
            step="any"
            required
          />
        </label>
        <label>
          Longitude
          <input
            name="lng"
            type="number"
            min="-180"
            max="180"
            step="any"
            required
          />
        </label>
        <label>
          Radius (km)
          <input name="radius" type="number" min="1" max="100" required />
        </label>
        <label>
          <input type="checkbox" name="enabled" defaultChecked />
          Enabled
        </label>
        <button>Save zone</button>
      </form>
      <h3>Notification delivery status</h3>
      <pre>{status ? JSON.stringify(status, null, 2) : "Loading…"}</pre>
      <p>
        Remote delivery requires Firebase credentials and a scheduled backend
        worker.
      </p>
    </section>
  );
}
export function DriverTags({ drivers, rpc, run }) {
  return (
    <section className="panel">
      <h2>Driver service categories</h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(() =>
            rpc("admin_driver_tags", {
              p_driver: f.get("driver"),
              p_tags: f.getAll("tags"),
              p_reason: f.get("reason"),
            }),
          );
        }}
      >
        <label>
          Driver
          <select name="driver" required>
            {drivers.map((d) => (
              <option key={d.user_id} value={d.user_id}>
                {d.full_name || d.user_id}
              </option>
            ))}
          </select>
        </label>
        {["professional", "premium", "lady"].map((tag) => (
          <label key={tag}>
            <input
              name="tags"
              type="checkbox"
              value={tag}
              defaultChecked={tag === "professional"}
            />
            {tag}
          </label>
        ))}
        <label>
          Review reason
          <input name="reason" minLength={5} required />
        </label>
        <button>Update categories</button>
      </form>
      <p>
        Only assign categories after reviewing eligibility. Selecting a category
        does not approve a driver.
      </p>
    </section>
  );
}
export function VehicleReview({ db, rpc, run }) {
  const [items, setItems] = useState([]);
  async function load() {
    const r = await db
      .from("vehicle_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (r.error) throw r.error;
    setItems(r.data || []);
  }
  useEffect(() => {
    run(load);
  }, [run]);
  return (
    <section className="panel">
      <h2>Optional customer car documents</h2>
      <p>Customers can book without these documents.</p>
      {items.map((d) => (
        <div key={d.id}>
          <p>
            {d.vehicle_id} · {d.document_type} · {d.status}
          </p>
          <button
            className="ghost"
            onClick={() =>
              run(async () => {
                const r = await db.storage
                  .from("customer-vehicles")
                  .createSignedUrl(d.storage_path, 60);
                if (r.error) throw r.error;
                window.open(r.data.signedUrl, "_blank", "noopener,noreferrer");
              })
            }
          >
            View private document
          </button>
          {["approved", "rejected"].map((status) => (
            <button
              key={status}
              className="ghost"
              onClick={() => {
                const reason = window.prompt(
                  "Review reason (at least 5 characters)",
                );
                if (reason)
                  run(async () => {
                    await rpc("admin_vehicle_document", {
                      p_document: d.id,
                      p_status: status,
                      p_reason: reason,
                    });
                    await load();
                  });
              }}
            >
              {status}
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
