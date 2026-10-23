import React, { useRef, useEffect, useMemo } from "react";
import { View, Text } from "react-native";
import { WebView } from "react-native-webview";
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
  function update() {
    ref.current?.injectJavaScript(
      "window.updateHyzzMap&&window.updateHyzzMap(" +
        JSON.stringify(data).replace(/</g, "\\u003c") +
        ");true;",
    );
  }
  useEffect(update, [JSON.stringify(data)]);
  return (
    <View
      style={{
        height,
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: "#e4eee8",
      }}
    >
      <WebView
        ref={ref}
        source={{ html, baseUrl: "https://hyzz.srtechcreators.in/" }}
        userAgent="Hyzz/1.5.0 (+https://hyzz.srtechcreators.in)"
        originWhitelist={["https://*", "about:blank"]}
        javaScriptEnabled
        domStorageEnabled={false}
        mixedContentMode="never"
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        onLoadEnd={update}
        onShouldStartLoadWithRequest={(r) =>
          r.url === "about:blank" || r.url === "https://hyzz.srtechcreators.in/"
        }
        onMessage={(e) => {
          try {
            const p = JSON.parse(e.nativeEvent.data);
            if (
              p.type === "mapPick" &&
              Number.isFinite(p.lat) &&
              Number.isFinite(p.lng) &&
              Math.abs(p.lat) <= 90 &&
              Math.abs(p.lng) <= 180
            )
              onPick?.(p);
          } catch {}
        }}
      />
      <Text
        accessibilityElementsHidden
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          fontSize: 10,
          color: "#425f53",
          backgroundColor: "#ffffffcc",
        }}
      >
        Live map · OpenStreetMap
      </Text>
    </View>
  );
}
