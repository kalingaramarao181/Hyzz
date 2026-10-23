import React, { useEffect, useState } from "react";
import { View, Text, AppState, Alert, Platform } from "react-native";
import * as Location from "expo-location";
import LiveMap from "../../../shared/mobile/LiveMap";
import { rpc, apiRequest } from "../../../shared/mobile/services/api";
import { requestTrackingPermission } from "../../../shared/mobile/services/tracking";
import { Action, Avatar, CircleButton, Icon, u, money, green } from "../ui";
export default function IncomingRequest({
  request,
  position,
  onClose,
  onAccept,
  run,
}) {
  const [clock, setClock] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [route, setRoute] = useState(null),
    [height, setHeight] = useState(650);
  const expires = new Date(request.request_expires_at).getTime(),
    seconds = Number.isFinite(expires)
      ? Math.max(0, Math.ceil((expires - clock) / 1000))
      : null;
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (seconds === 0) {
      rpc("expire_requests").catch(() => {});
      onClose();
    }
  }, [seconds]);
  const pickup = { lat: request.pickup_lat, lng: request.pickup_lng },
    destination =
      request.destination_lat != null
        ? { lat: request.destination_lat, lng: request.destination_lng }
        : null;
  useEffect(() => {
    if (!position) return;
    let alive = true;
    apiRequest("/api/v1/maps/route", { from: position, to: pickup })
      .then((r) => {
        if (alive) setRoute(r.available ? r : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [request.id]);
  async function accept() {
    setBusy(true);
    try {
      await run(async () => {
        const permission =
          Platform.OS === "web"
            ? { status: "granted" }
            : await Location.getBackgroundPermissionsAsync();
        if (Platform.OS !== "web" && permission.status !== "granted") {
          const consent = await new Promise((resolve) =>
            Alert.alert(
              "Trip location sharing",
              "Hyzz shares your location with your assigned customer and authorized operations, including when this app is minimized or the phone is locked. Sharing stops when the trip ends. Allow all the time in Android settings.",
              [
                {
                  text: "Back",
                  style: "cancel",
                  onPress: () => resolve(false),
                },
                { text: "Continue", onPress: () => resolve(true) },
              ],
              { cancelable: false },
            ),
          );
          if (!consent) return;
          const allowed = await requestTrackingPermission();
          if (!allowed)
            throw new Error(
              "Allow trip location sharing in Android settings before accepting. It keeps your assigned trip visible when the phone locks.",
            );
        }
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        await rpc("set_availability", {
          p_online: true,
          p_lat: current.coords.latitude,
          p_lng: current.coords.longitude,
        });
        await rpc("accept_booking", { p_booking: request.id });
        await onAccept(request.id);
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      <LiveMap
        height={height}
        pickup={pickup}
        destination={destination}
        driver={position}
        route={route?.coordinates}
      />
      <View style={{ position: "absolute", top: 14, left: 14 }}>
        <CircleButton
          label="Close ride request"
          icon="arrow-back"
          onPress={onClose}
        />
      </View>
      <View
        style={{
          position: "absolute",
          right: 15,
          top: 15,
          backgroundColor: green,
          borderRadius: 40,
          height: 66,
          width: 66,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: "800", color: "white" }}>
          {seconds === null
            ? "Open"
            : seconds > 59
              ? Math.ceil(seconds / 60) + "m"
              : seconds}
        </Text>
        <Text style={{ fontSize: 10, color: "white" }}>
          {seconds === null ? "request" : "remaining"}
        </Text>
      </View>
      <View
        style={[
          u.sheet,
          { position: "absolute", bottom: 0, left: 0, right: 0 },
        ]}
      >
        <View style={u.between}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar name={request.customer_name} />
            <View>
              <Text style={u.h3}>
                {request.customer_name || "Hyzz customer"}
              </Text>
              <Text style={u.small}>New driver request</Text>
            </View>
          </View>
          <Icon name="car-sport" size={27} />
        </View>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Icon name="location" />
            <View style={{ flex: 1 }}>
              <Text style={u.small}>Pickup</Text>
              <Text style={u.body}>{request.pickup_address}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Icon name="location" color="#E62B3D" />
            <View style={{ flex: 1 }}>
              <Text style={u.small}>Drop</Text>
              <Text style={u.body}>
                {request.destination_address ||
                  "Destination to be confirmed with customer"}
              </Text>
            </View>
          </View>
        </View>
        <View style={u.between}>
          <Text style={u.body}>Estimated earnings</Text>
          <Text style={u.h2}>{money(request.estimated_earnings_paise)}</Text>
        </View>
        <Text style={u.small}>
          {route
            ? (route.distance_m / 1000).toFixed(1)
            : "~" + Number(request.pickup_km).toFixed(1)}{" "}
          km to pickup
          {route
            ? " - about " +
              Math.ceil(route.duration_s / 60) +
              " min (no traffic data)"
            : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Action
            title="Accept"
            onPress={accept}
            busy={busy}
            disabled={seconds === 0}
            style={{ flex: 1 }}
          />
          <Action
            title="Reject"
            secondary
            disabled={busy}
            style={{
              flex: 1,
              backgroundColor: "#FFF0F1",
              borderColor: "#FFDADC",
            }}
            onPress={() =>
              run(async () => {
                await rpc("decline_request", { p_booking: request.id });
                onClose();
              })
            }
          />
        </View>
      </View>
    </View>
  );
}
