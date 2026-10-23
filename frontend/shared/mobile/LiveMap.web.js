import React, { useRef, useMemo, useEffect } from "react";
import maps from "../maps/document.cjs";
export default function LiveMap({
  pickup,
  destination,
  driver,
  route,
  zones,
  center,
  onPick,
  height = 300,
}) {
  const ref = useRef(null),
    data = {
      pickup,
      destination,
      driver,
      route,
      zones,
      center,
      editable: !!onPick,
    };
  const html = useMemo(() => maps.mapDocument(data), []);
  useEffect(() => {
    ref.current?.contentWindow?.postMessage(
      { type: "mapUpdate", payload: data },
      "*",
    );
  }, [JSON.stringify(data)]);
  useEffect(() => {
    const receive = (e) => {
      if (e.source !== ref.current?.contentWindow) return;
      try {
        const p = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (
          p.type === "mapPick" &&
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng)
        )
          onPick?.(p);
      } catch {}
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onPick]);
  return (
    <iframe
      ref={ref}
      title="Hyzz live map"
      srcDoc={html}
      sandbox="allow-scripts"
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={() =>
        ref.current?.contentWindow?.postMessage(
          { type: "mapUpdate", payload: data },
          "*",
        )
      }
      style={{ width: "100%", height, border: 0, borderRadius: 18 }}
    />
  );
}
