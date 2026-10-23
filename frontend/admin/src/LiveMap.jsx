import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
export default function LiveMap({ rpc }) {
  const container = useRef(null),
    map = useRef(null),
    markers = useRef(null),
    first = useRef(true),
    [positions, setPositions] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    const m = L.map(container.current).setView([17.385, 78.4867], 12);
    map.current = m;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    markers.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const values = await rpc("admin_live_locations");
        if (active) {
          setPositions(values);
          setError("");
        }
      } catch (e) {
        if (active) setError(e.message);
      }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [rpc]);
  useEffect(() => {
    if (!map.current) return;
    markers.current.clearLayers();
    const valid = positions.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
    for (const p of valid) {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 10,
        color: "white",
        weight: 3,
        fillColor: p.stale ? "#a97620" : "#14765b",
        fillOpacity: 1,
      }).addTo(markers.current);
      const tip = document.createElement("span");
      tip.textContent =
        (p.name || "Driver") +
        " · " +
        p.state +
        (p.stale ? " · delayed signal" : "");
      marker.bindTooltip(tip);
    }
    if (first.current && valid.length) {
      map.current.fitBounds(
        valid.map((p) => [p.lat, p.lng]),
        { padding: [30, 30], maxZoom: 15 },
      );
      first.current = false;
    }
  }, [positions]);
  return (
    <section className="panel">
      <h2>Live driver & trip map</h2>
      <div
        ref={container}
        style={{ height: 380, borderRadius: 16, zIndex: 0 }}
        aria-label="Driver trip locations on OpenStreetMap"
      />
      <p>
        {error ||
          (!positions.length
            ? "No shared driver locations yet."
            : "Refreshes every 5 seconds. Amber markers indicate delayed signals.")}
      </p>
      {positions.map((p) => (
        <p key={p.id}>
          {p.name} · {p.state} · {new Date(p.updated_at).toLocaleTimeString()}{" "}
          {p.stale ? "(last known location)" : ""}
        </p>
      ))}
    </section>
  );
}
