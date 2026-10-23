import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Alert,
  Linking,
  AppState,
  ActivityIndicator,
} from "react-native";
import LiveMap from "../../../shared/mobile/LiveMap";
import TripChat from "../../../shared/mobile/TripChat";
import { rpc, apiRequest } from "../../../shared/mobile/services/api";
import {
  Action,
  Avatar,
  CircleButton,
  Input,
  Icon,
  Panel,
  Stars,
  u,
  money,
  green,
  confirmAction,
} from "../ui";
export default function DriverTrip({
  id,
  onDone,
  onBack = onDone,
  run,
  refresh,
  onSettings,
}) {
  const [focus, setFocus] = useState(null);
  const [b, setB] = useState(null),
    [point, setPoint] = useState(null),
    [route, setRoute] = useState(null),
    [code, setCode] = useState(""),
    [km, setKm] = useState(""),
    [chat, setChat] = useState(false),
    [score, setScore] = useState(0),
    [rated, setRated] = useState(false),
    [review, setReview] = useState(""),
    [busy, setBusy] = useState(false),
    [height, setHeight] = useState(700);
  const load = useCallback(async () => {
    const value = await rpc("booking_details", { p_booking: id });
    setB(value);
    if (value.state === "COMPLETED") {
      const rating = await rpc("my_trip_rating", { p_booking: id });
      setRated(!!rating);
      if (rating) setScore(rating.score);
    }
    setPoint(await rpc("trip_tracking", { p_booking: id }));
  }, [id]);
  useEffect(() => {
    run(load);
    const timer = setInterval(() => {
      if (AppState.currentState === "active") load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (
      !b ||
      !point ||
      ![
        "DRIVER_ASSIGNED",
        "DRIVER_EN_ROUTE",
        "DRIVER_ARRIVED",
        "OTP_VERIFIED",
        "IN_PROGRESS",
      ].includes(b.state)
    ) {
      setRoute(null);
      return;
    }
    let alive = true;
    const target =
      b.state === "IN_PROGRESS" && b.destination_lat != null
        ? { lat: b.destination_lat, lng: b.destination_lng }
        : { lat: b.pickup_lat, lng: b.pickup_lng };
    apiRequest("/api/v1/maps/route", {
      from: { lat: point.lat, lng: point.lng },
      to: target,
    })
      .then((value) => {
        if (alive) setRoute(value.available ? value : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [b?.state, point?.lat, point?.lng]);
  async function act(name, params = {}) {
    setBusy(true);
    try {
      await run(async () => {
        const result = await rpc(name, { p_booking: id, ...params });
        if (result?.ok === false) throw new Error(result.message);
        await load();
        await refresh();
      });
    } finally {
      setBusy(false);
    }
  }
  function call() {
    const phone = b.customer_phone;
    if (!phone) {
      Alert.alert(
        "Contact number unavailable",
        "Use trip chat to contact your customer.",
      );
      return;
    }
    run(() => Linking.openURL("tel:" + phone.replace(/[^+0-9]/g, "")));
  }
  function navigate() {
    const drop = b.state === "IN_PROGRESS" && b.destination_lat != null;
    run(() =>
      Linking.openURL(
        "https://www.google.com/maps/dir/?api=1&destination=" +
          (drop
            ? b.destination_lat + "," + b.destination_lng
            : b.pickup_lat + "," + b.pickup_lng),
      ),
    );
  }
  function safety() {
    Alert.alert(
      "Trip safety",
      "Pull over safely before using your phone. You can call your emergency contact from Support. Recording an incident alerts Hyzz operations; it does not dispatch emergency services.",
      [
        { text: "Close", style: "cancel" },
        {
          text: "Record incident",
          onPress: () =>
            run(async () => {
              await rpc("report_emergency", { p_booking: id });
              Alert.alert(
                "Incident recorded",
                "Contact local emergency services directly when urgent help is needed.",
              );
            }),
        },
      ],
    );
  }
  if (!b)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={green} />
      </View>
    );
  const active = b.state === "IN_PROGRESS",
    completed = b.state === "COMPLETED",
    terminal =
      completed ||
      b.state.startsWith("CANCELLED") ||
      b.state === "NO_DRIVER_AVAILABLE";
  if (terminal)
    return (
      <ScrollView contentContainerStyle={[u.page, { paddingTop: 28 }]}>
        <CircleButton
          icon="arrow-back"
          label="Back to driver home"
          onPress={onBack}
        />
        <View style={{ alignItems: "center", gap: 12, paddingVertical: 14 }}>
          <View
            style={{
              width: 83,
              height: 83,
              borderRadius: 42,
              backgroundColor: completed ? "#16A323" : "#F4A338",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              name={completed ? "checkmark" : "close"}
              size={53}
              color="white"
            />
          </View>
          <Text style={u.h2}>
            {completed ? "Trip completed!" : "Booking closed"}
          </Text>
          <Text style={u.small}>
            {completed
              ? "Great job, keep going!"
              : b.state.toLowerCase().replaceAll("_", " ")}
          </Text>
        </View>
        {completed && (
          <>
            <Panel>
              <View style={u.between}>
                <Text style={u.h3}>Total fare</Text>
                <Text style={u.h3}>{money(b.final_paise)}</Text>
              </View>
              {[
                ["Base fare", b.fare?.breakdown?.base_paise],
                ["Service fare", b.fare?.breakdown?.service_paise],
                ["GST", b.fare?.breakdown?.tax_paise],
                ["Coupon discount (platform funded)", -(b.fare?.breakdown?.discount_paise||0)],
                ["Platform commission", b.commission_paise],
                ["Your earnings", b.earnings_paise],
              ].map(([label, value]) => (
                <View key={label} style={u.between}>
                  <Text style={u.small}>{label}</Text>
                  <Text style={u.body}>{money(value || 0)}</Text>
                </View>
              ))}
            </Panel>
            <Panel>
              <View
                style={{ flexDirection: "row", gap: 9, alignItems: "center" }}
              >
                <Icon name="cash" />
                <Text style={u.h3}>Cash payment</Text>
              </View>
              <View style={u.between}>
                <Text style={u.small}>Collection status</Text>
                <Text style={u.body}>
                  {b.payment_status.replaceAll("_", " ")}
                </Text>
              </View>
              <Text style={u.small}>
                Cash stays with the driver. Both parties confirm payment
                separately.
              </Text>
              {!b.driver_cash_confirmed &&
                !["settled", "disputed"].includes(b.payment_status) && (
                  <Action
                    title="Confirm cash collected"
                    busy={busy}
                    onPress={() =>
                      confirmAction(
                        "Confirm cash collection?",
                        "Confirm only after receiving the cash.",
                        () => act("confirm_cash"),
                      )
                    }
                  />
                )}
            </Panel>
            <Text style={[u.h3, { textAlign: "center" }]}>
              How was your rider?
            </Text>
            <Stars value={score} onChange={setScore} disabled={rated} />
            {rated && (
              <Text style={[u.small, { textAlign: "center" }]}>
                Your rating has been submitted
              </Text>
            )}
          </>
        )}
        <Action
          title="Done"
          onPress={() =>
            run(async () => {
              if (completed && score > 0 && !rated)
                await rpc("submit_rating", {
                  p_booking: id,
                  p_score: score,
                  p_review: "",
                });
              onDone();
            })
          }
        />
      </ScrollView>
    );
  const heading = active
    ? "Head to drop location"
    : b.state === "DRIVER_ARRIVED"
      ? "You have arrived"
      : b.state === "OTP_VERIFIED"
        ? "Ready to start"
        : "Go to pickup location";
  return (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      <LiveMap
        height={height}
        pickup={{ lat: b.pickup_lat, lng: b.pickup_lng }}
        destination={
          b.destination_lat != null
            ? { lat: b.destination_lat, lng: b.destination_lng }
            : null
        }
        driver={point}
        route={route?.coordinates}
        center={focus}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          backgroundColor: "#004D3D",
          padding: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <CircleButton
          label="Back to driver home"
          icon="arrow-back"
          onPress={onBack}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>
            {heading}
          </Text>
          <Text style={{ color: "#D4E9E0", fontSize: 12, marginTop: 5 }}>
            {route
              ? (route.distance_m / 1000).toFixed(1) +
                " km - " +
                Math.ceil(route.duration_s / 60) +
                " min (no traffic)"
              : active
                ? b.destination_address || "Confirm destination with customer"
                : b.pickup_address}
          </Text>
        </View>
      </View>
      <View style={[u.mapButton, { top: 93 }]}>
        <CircleButton
          label="Center trip on my location"
          icon="locate"
          onPress={() => point && setFocus({ ...point, nonce: Date.now() })}
        />
        <CircleButton
          label="Open navigation"
          icon="navigate"
          onPress={navigate}
        />
        <CircleButton
          label="Tracking settings"
          icon="settings-outline"
          onPress={onSettings}
        />
      </View>
      <View
        style={[
          u.sheet,
          {
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            maxHeight: height * 0.62,
          },
        ]}
      >
        <ScrollView contentContainerStyle={{ gap: 13 }}>
          <View style={u.between}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Avatar name={b.customer_name} />
              <View>
                <Text style={u.h3}>{b.customer_name || "Hyzz customer"}</Text>
                <Text style={u.small}>
                  {b.vehicle
                    ? b.vehicle.brand + " " + b.vehicle.model
                    : "Your customer's own car"}
                </Text>
              </View>
            </View>
            <CircleButton label="Call customer" icon="call" onPress={call} />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Icon name="location" color={active ? "#E42332" : green} />
            <View style={{ flex: 1 }}>
              <Text style={u.h3}>{active ? "Drop" : "Pickup"}</Text>
              <Text style={u.body}>
                {active
                  ? b.destination_address || "Confirm with customer"
                  : b.pickup_address}
              </Text>
              {b.vehicle && (
                <Text style={u.small}>
                  {b.vehicle.registration + " - " + (b.vehicle.color || "")}
                </Text>
              )}
            </View>
          </View>
          {point?.stale && (
            <Text
              accessibilityRole="alert"
              style={{ color: "#9A6500", fontSize: 12 }}
            >
              GPS signal delayed. Showing last known location.
            </Text>
          )}
          {!point && (
            <Text style={u.small}>
              Waiting for your GPS position. Check tracking permission.
            </Text>
          )}
          {b.state === "DRIVER_ASSIGNED" && (
            <Action
              title="Start heading to pickup"
              busy={busy}
              onPress={() => act("advance_booking", { p_action: "en_route" })}
            />
          )}
          {b.state === "DRIVER_EN_ROUTE" && (
            <Action
              title="I have arrived"
              busy={busy}
              onPress={() => act("advance_booking", { p_action: "arrive" })}
            />
          )}
          {b.state === "DRIVER_ARRIVED" && (
            <>
              <Input
                label="Customer pickup OTP"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
              <Action
                title="Verify pickup code"
                busy={busy}
                onPress={() => act("verify_pickup_code", { p_code: code })}
              />
            </>
          )}
          {b.state === "OTP_VERIFIED" && (
            <Action
              title="Start trip"
              busy={busy}
              onPress={() => act("start_trip")}
            />
          )}
          <Action
            title="Navigate with Maps"
            icon="navigate-circle"
            onPress={navigate}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[
              ["call", "Call", call],
              ["chatbubble-ellipses", "Chat", () => setChat(true)],
              ["shield-checkmark", "Safety", safety],
            ].map(([icon, label, fn]) => (
              <Action
                key={label}
                title={label}
                icon={icon}
                secondary
                style={{ flex: 1, paddingHorizontal: 4 }}
                onPress={fn}
              />
            ))}
          </View>
          {active && (
            <>
              {b.service_type === "distance" && (
                <Input
                  label="Completed distance (km)"
                  keyboardType="decimal-pad"
                  value={km}
                  onChangeText={setKm}
                />
              )}
              <Action
                title="End trip"
                icon="add-circle"
                danger
                busy={busy}
                onPress={() =>
                  confirmAction(
                    "Complete this trip?",
                    "The server will calculate the final fare.",
                    () =>
                      act("finish_service_trip", {
                        p_km: b.service_type === "distance" ? Number(km) : null,
                      }),
                    "Complete trip",
                  )
                }
              />
            </>
          )}
          {!active && !["OTP_VERIFIED", "DRIVER_ARRIVED"].includes(b.state) && (
            <Action
              title="Cancel booking"
              secondary
              onPress={() =>
                Alert.alert(
                  "Cancel this booking?",
                  "A cancellation is recorded for operations review.",
                  [
                    { text: "Back", style: "cancel" },
                    {
                      text: "Cancel booking",
                      style: "destructive",
                      onPress: () =>
                        act("cancel_booking", {
                          p_reason:
                            "Driver requested cancellation before trip start",
                        }),
                    },
                  ],
                )
              }
            />
          )}
        </ScrollView>
      </View>
      {chat && <TripChat booking={id} onClose={() => setChat(false)} />}
    </View>
  );
}
