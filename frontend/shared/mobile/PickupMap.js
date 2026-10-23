import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
export const DEMO_PLACES = [
  { name: "Railway Station", lat: 16.301, lng: 80.439 },
  { name: "Central Market", lat: 16.312, lng: 80.43 },
  { name: "City Hospital", lat: 16.32, lng: 80.452 },
  { name: "Lake Park", lat: 16.29, lng: 80.42 },
];
// A schematic like the supplied HTML. Coordinates are real; streets are illustrative.
export default function PickupMap({ pickup, driver, onPick }) {
  const [width, setWidth] = useState(300);
  const center = pickup || driver || DEMO_PLACES[0];
  const point = (p) => ({
    left: `${Math.max(3, Math.min(97, 50 + ((p.lng - center.lng) / 0.06) * 100))}%`,
    top: `${Math.max(10, Math.min(90, 50 - ((p.lat - center.lat) / 0.05) * 100))}%`,
  });
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole={onPick ? "button" : "image"}
        accessibilityLabel={
          onPick
            ? "Pickup schematic. Tap to move the pickup pin, or use the coordinate fields below."
            : "Pickup schematic showing the latest shared driver position"
        }
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={
          onPick
            ? (e) =>
                onPick({
                  name: "Dropped pin",
                  lat: +(
                    center.lat +
                    (0.5 - e.nativeEvent.locationY / 190) * 0.05
                  ).toFixed(6),
                  lng: +(
                    center.lng +
                    (e.nativeEvent.locationX / width - 0.5) * 0.06
                  ).toFixed(6),
                })
            : undefined
        }
        style={styles.map}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={styles.river} />
          {[25, 50, 75].map((x) => (
            <View
              key={x}
              style={[
                styles.road,
                {
                  left: `${x}%`,
                  height: 240,
                  width: 7,
                  top: -20,
                  transform: [{ rotate: "-9deg" }],
                },
              ]}
            />
          ))}
          {[30, 62].map((y) => (
            <View
              key={y}
              style={[
                styles.road,
                {
                  top: `${y}%`,
                  width: "110%",
                  height: 7,
                  left: -10,
                  transform: [{ rotate: "-5deg" }],
                },
              ]}
            />
          ))}
          {DEMO_PLACES.filter(
            (p) =>
              Math.abs(p.lat - center.lat) < 0.022 &&
              Math.abs(p.lng - center.lng) < 0.027,
          ).map((p) => (
            <Text key={p.name} style={[styles.place, point(p)]}>
              {p.name}
            </Text>
          ))}
          {pickup && (
            <View style={[styles.marker, point(pickup)]}>
              <Ionicons name="location" size={30} color="#DC4437" />
            </View>
          )}
          {driver && (
            <View style={[styles.marker, point(driver)]}>
              <Ionicons name="car" size={25} color="#176653" />
            </View>
          )}
        </View>
      </Pressable>
      <Text style={styles.caption}>
        Schematic · {onPick ? "Tap to move the pickup pin. " : ""}Use Navigate
        for real roads. No simulated driver movement.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  map: {
    height: 190,
    width: "100%",
    backgroundColor: "#E4EEE8",
    borderRadius: 16,
    overflow: "hidden",
  },
  river: {
    position: "absolute",
    height: 28,
    bottom: 0,
    width: "100%",
    backgroundColor: "#B9D6EA",
  },
  road: { position: "absolute", backgroundColor: "#FFFFFF" },
  place: { position: "absolute", fontSize: 9, color: "#526B61" },
  marker: { position: "absolute", marginLeft: -13, marginTop: -24 },
  caption: { fontSize: 11, lineHeight: 16, color: "#60796F" },
});
