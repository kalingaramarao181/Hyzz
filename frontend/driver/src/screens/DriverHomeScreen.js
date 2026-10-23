import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Switch,
  Animated,
  AppState,
  Pressable,
} from "react-native";
import * as Location from "expo-location";
import LiveMap from "../../../shared/mobile/LiveMap";
import { rpc } from "../../../shared/mobile/services/api";
import { Action, CircleButton, Icon, green, u, money } from "../ui";
export default function DriverHome({
  profile,
  summary,
  bookings,
  zones,
  position,
  setPosition,
  run,
  refresh,
  onIncoming,
  onOpen,
  onNavigate,
}) {
  const [focus, setFocus] = useState(null);
  const [height, setHeight] = useState(580),
    [busy, setBusy] = useState(false),
    pulse = useRef(new Animated.Value(0)).current;
  const online = profile.driver?.online,
    active = bookings.find((b) =>
      [
        "DRIVER_ASSIGNED",
        "DRIVER_EN_ROUTE",
        "DRIVER_ARRIVED",
        "OTP_VERIFIED",
        "IN_PROGRESS",
      ].includes(b.state),
    );
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    if (online) animation.start();
    return () => animation.stop();
  }, [online, pulse]);
  const availabilityIntent = useRef(!!online);
  useEffect(() => {
    availabilityIntent.current = !!online;
  }, [online]);
  async function locate() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted")
      throw new Error("Allow location access to find nearby requests.");
    const point = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const coords = { lat: point.coords.latitude, lng: point.coords.longitude };
    setPosition(coords);
    return coords;
  }
  useEffect(() => {
    let alive = true;
    Location.getForegroundPermissionsAsync()
      .then(async (p) => {
        if (p.status === "granted" && alive) await locate();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  async function availability(next) {
    availabilityIntent.current = next;
    setBusy(true);
    try {
      await run(async () => {
        const p = next ? await locate() : null;
        await rpc("set_availability", {
          p_online: next,
          ...(p ? { p_lat: p.lat, p_lng: p.lng } : {}),
        });
        await refresh();
      });
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!online || active) return;
    let alive = true;
    const load = async () => {
      if (AppState.currentState !== "active" || !availabilityIntent.current)
        return;
      try {
        const requests = await rpc("driver_requests");
        if (alive && availabilityIntent.current && requests.length)
          onIncoming(requests);
      } catch (e) {
        if (alive) run(() => Promise.reject(e));
      }
    };
    load();
    const timer = setInterval(load, 5000);
    const gps = setInterval(() => {
      if (AppState.currentState === "active")
        locate()
          .then(
            (p) =>
              alive &&
              availabilityIntent.current &&
              rpc("set_availability", {
                p_online: true,
                p_lat: p.lat,
                p_lng: p.lng,
              }),
          )
          .catch(() => {});
    }, 45000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(gps);
    };
  }, [online, active?.id, onIncoming]);
  return (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      <LiveMap
        driver={position}
        zones={zones}
        center={focus}
        height={Math.max(200, height)}
      />
      <View style={u.mapButton}>
        <CircleButton
          label="Center on my location"
          icon="locate"
          onPress={() =>
            run(async () => {
              const p = await locate();
              setFocus({ ...p, nonce: Date.now() });
            })
          }
        />
        <CircleButton
          label="Open map and tracking settings"
          icon="settings-outline"
          onPress={() => onNavigate("settings")}
        />
      </View>
      {online && !active && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: "rgba(0,48,38,0.62)",
            alignItems: "center",
            paddingTop: 58,
          }}
        >
          <Text
            style={{
              fontSize: 23,
              fontWeight: "800",
              color: "white",
              textAlign: "center",
            }}
          >
            Searching for rides{"\n"}near you...
          </Text>
          <Text style={{ color: "white", fontSize: 14, marginTop: 14 }}>
            Connecting you with nearby customers
          </Text>
          <View
            style={{
              marginTop: 65,
              width: 200,
              height: 200,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {[180, 130, 80].map((size, index) => (
              <Animated.View
                key={size}
                style={{
                  position: "absolute",
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderWidth: 1,
                  borderColor: "white",
                  backgroundColor: "rgba(255,255,255,.12)",
                  opacity: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.4, 0.9],
                  }),
                  transform: [
                    {
                      scale: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 1.1 + index * 0.04],
                      }),
                    },
                  ],
                }}
              />
            ))}
            <Icon name="navigate-circle" size={52} color="white" />
          </View>
        </View>
      )}
      <View
        style={[
          u.sheet,
          { position: "absolute", bottom: 0, left: 0, right: 0 },
        ]}
      >
        {active ? (
          <>
            <Text style={u.h3}>Your current trip</Text>
            <Text style={u.small}>{active.pickup_address}</Text>
            <Action
              title="Open current trip"
              icon="navigate"
              onPress={() => onOpen(active.id)}
            />
          </>
        ) : (
          <>
            <View style={u.between}>
              <Text style={u.h3}>
                {online ? "Searching for requests" : "Go Online"}
              </Text>
              <Switch
                accessibilityLabel="Driver availability"
                value={!!online}
                disabled={busy || profile.driver?.verification !== "approved"}
                trackColor={{ false: "#DDE3E8", true: "#00B753" }}
                thumbColor="white"
                onValueChange={availability}
              />
            </View>
            {profile.driver?.verification !== "approved" && (
              <Action
                title="Complete document verification"
                secondary
                onPress={() => onNavigate("documents")}
              />
            )}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                [
                  "Earnings",
                  money(
                    (summary?.trip_earnings_paise || 0) +
                      (summary?.incentives_paise || 0),
                  ),
                  "earnings",
                ],
                [
                  "Incentives",
                  money(summary?.incentives_paise || 0),
                  "earnings",
                ],
                ["Today's Trips", String(summary?.trips || 0), "history"],
              ].map(([label, value, page]) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  onPress={() => onNavigate(page)}
                  style={{
                    flex: 1,
                    padding: 10,
                    borderWidth: 1,
                    borderColor: "#E9EDF1",
                    borderRadius: 10,
                    gap: 7,
                  }}
                >
                  <Text style={{ fontSize: 10, color: "#374151" }}>
                    {label}
                  </Text>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "800",
                      color: "#101827",
                    }}
                  >
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            {online && (
              <Action
                title="Go offline"
                secondary
                busy={busy}
                onPress={() => availability(false)}
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}
