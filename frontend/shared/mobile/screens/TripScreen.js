import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import { api as supabase, rpc } from "../services/api";
import { C, s, state, date, JOURNEY_IMAGE } from "../theme";
import { DRIVER } from "../runtime";
import LiveMap from "../LiveMap";
import TripChat from "../TripChat";
import { apiRequest } from "../services/api";
import { Button, Field, Card, ErrorBox, Empty } from "../components";
import domain from "../../../../packages/domain.cjs";
const { ACTIVE, money } = domain;
function BookingDetail({ id, run, refreshParent }) {
  const [chat, setChat] = useState(false);
  const [b, setB] = useState(null),
    [road, setRoad] = useState(null),
    [otp, setOtp] = useState(""),
    [until, setUntil] = useState(0),
    [code, setCode] = useState(""),
    [reason, setReason] = useState(""),
    [review, setReview] = useState(""),
    [location, setLocation] = useState(null),
    [score, setScore] = useState("5"),
    [km, setKm] = useState(""),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const load = useCallback(async () => {
    setB(await rpc("booking_details", { p_booking: id }));
    setLocation(await rpc("trip_tracking", { p_booking: id }));
  }, [id]);
  useEffect(() => {
    run(load);
    const t = setInterval(() => {
      if (AppState.currentState === "active") load().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [load, run]);
  useEffect(() => {
    if (!otp) return;
    const t = setInterval(() => {
      if (Date.now() > until) setOtp("");
    }, 1000);
    return () => clearInterval(t);
  }, [otp, until]);
  useEffect(() => {
    if (!b) return;
    let alive = true;
    const target =
      b.state === "IN_PROGRESS" && b.destination_lat != null
        ? { lat: b.destination_lat, lng: b.destination_lng }
        : { lat: b.pickup_lat, lng: b.pickup_lng };
    if (!location) {
      setRoad(null);
      return;
    }
    apiRequest("/api/v1/maps/route", {
      from: { lat: location.lat, lng: location.lng },
      to: target,
    })
      .then((r) => {
        if (alive) setRoad(r.available ? r : null);
      })
      .catch(() => {
        if (alive) setRoad(null);
      });
    return () => {
      alive = false;
    };
  }, [
    b?.state,
    b?.pickup_lat,
    b?.pickup_lng,
    b?.destination_lat,
    b?.destination_lng,
    location?.lat,
    location?.lng,
  ]);
  async function act(name, params = {}) {
    await run(async () => {
      const result = await rpc(name, { p_booking: id, ...params });
      if (result?.ok === false) throw new Error(result.message);
      await load();
      await refreshParent();
    });
  }
  const confirm = (title, callback) =>
    Alert.alert(title, "Please confirm this action.", [
      { text: "Back", style: "cancel" },
      { text: "Confirm", onPress: callback },
    ]);
  if (!b) return <ActivityIndicator color={C.green} />;
  const pickup = [
    "DRIVER_ASSIGNED",
    "DRIVER_EN_ROUTE",
    "DRIVER_ARRIVED",
  ].includes(b.state);
  return (
    <>
      <Card>
        <View style={s.between}>
          <Text style={s.eyebrow}>{b.reference}</Text>
          <Text style={s.badge}>{state(b.state)}</Text>
        </View>
        <Text style={s.h3}>{b.pickup_address}</Text>
        <Text style={s.body}>
          {date(b.scheduled_at)} · {b.hours} hours · {state(b.service_type)}
        </Text>
        <Text style={s.body}>
          {DRIVER
            ? `Customer: ${b.customer_name || "Hyzz customer"}`
            : `Driver: ${b.driver_name || "Waiting for an available driver"}`}
        </Text>
        {(DRIVER ? b.customer_phone : b.driver_phone) && (
          <Button
            title={DRIVER ? "Call customer" : "Call driver"}
            secondary
            icon="call-outline"
            onPress={() =>
              run(() =>
                Linking.openURL(
                  "tel:" +
                    (DRIVER ? b.customer_phone : b.driver_phone).replace(
                      /[^+0-9]/g,
                      "",
                    ),
                ),
              )
            }
          />
        )}
        {b.vehicle && (
          <Text style={s.body}>
            {b.vehicle.brand} {b.vehicle.model} ? {b.vehicle.registration} ?{" "}
            {b.vehicle.color}
          </Text>
        )}
        {b.driver_rating && (
          <Text style={s.small}>Driver rating: {b.driver_rating} / 5</Text>
        )}
        <Text style={s.amount}>{money(b.final_paise ?? b.estimate_paise)}</Text>
        {ACTIVE.includes(b.state) && (
          <LiveMap
            pickup={{ lat: b.pickup_lat, lng: b.pickup_lng }}
            destination={
              b.destination_lat != null
                ? { lat: b.destination_lat, lng: b.destination_lng }
                : null
            }
            driver={location}
            route={road?.coordinates}
          />
        )}
        {road && (
          <Text style={s.small}>
            Road route: {(road.distance_m / 1000).toFixed(1)} km, about{" "}
            {Math.ceil(road.duration_s / 60)} min (traffic not included)
          </Text>
        )}
        {ACTIVE.includes(b.state) && b.driver_id && (
          <Button
            title="Chat with your trip partner"
            secondary
            icon="chatbubble-ellipses-outline"
            onPress={() => setChat(true)}
          />
        )}
        {b.destination_address && (
          <Text style={s.body}>Destination: {b.destination_address}</Text>
        )}
        {ACTIVE.includes(b.state) && !location && (
          <Text style={s.small}>
            Waiting for a fresh driver location. Tracking requires driver
            permission and an internet connection.
          </Text>
        )}
        {b.state === "IN_PROGRESS" && DRIVER && b.destination_lat != null && (
          <Button
            title="Navigate to destination"
            secondary
            onPress={() =>
              run(() =>
                Linking.openURL(
                  `https://www.google.com/maps/dir/?api=1&destination=${b.destination_lat},${b.destination_lng}`,
                ),
              )
            }
          />
        )}
        {b.state === "MATCHING" && (
          <Text style={s.small}>
            Matching nearby approved drivers. Request expires{" "}
            {date(b.request_expires_at)}. Keep this screen open for updates.
          </Text>
        )}
        {DRIVER && pickup && (
          <Button
            title="Navigate to pickup"
            secondary
            icon="navigate-outline"
            onPress={() =>
              run(() =>
                Linking.openURL(
                  `https://www.google.com/maps/dir/?api=1&destination=${b.pickup_lat},${b.pickup_lng}`,
                ),
              )
            }
          />
        )}
        {!DRIVER && location && (
          <>
            <Text style={s.small}>
              Driver location updated {date(location.updated_at)}.{" "}
              {location.stale
                ? "Signal is delayed; this is the last known position."
                : "Live trip location."}
            </Text>
            <Button
              title="View driver location"
              secondary
              onPress={() =>
                run(() =>
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`,
                  ),
                )
              }
            />
          </>
        )}
        {!DRIVER && pickup && (
          <>
            <Button
              title="Generate pickup OTP"
              onPress={() =>
                run(async () => {
                  const r = await rpc("issue_trip_otp", { p_booking: id });
                  setOtp(r.code);
                  setUntil(Date.now() + r.expires_in_seconds * 1000);
                })
              }
            />
            {otp && (
              <View style={s.otp}>
                <Text style={s.small}>SHARE ONLY WHEN YOUR DRIVER ARRIVES</Text>
                <Text style={s.otpCode}>{otp}</Text>
                <Text style={s.small}>
                  Valid until {new Date(until).toLocaleTimeString()}
                </Text>
              </View>
            )}
          </>
        )}
        {DRIVER && b.state === "DRIVER_ASSIGNED" && (
          <Button
            title="Start heading to pickup"
            onPress={() => act("advance_booking", { p_action: "en_route" })}
          />
        )}
        {DRIVER && b.state === "DRIVER_EN_ROUTE" && (
          <Button
            title="I have arrived"
            onPress={() => act("advance_booking", { p_action: "arrive" })}
          />
        )}
        {DRIVER && b.state === "DRIVER_ARRIVED" && (
          <>
            <Field
              label="Customer’s pickup OTP"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
            />
            <Button
              title="Verify pickup code"
              onPress={() => act("verify_pickup_code", { p_code: code })}
            />
          </>
        )}
        {b.state === "OTP_VERIFIED" && (
          <>
            <Text style={s.body}>
              Pickup code verified. Waiting for the driver to start the trip.
            </Text>
            {DRIVER && (
              <Button title="Start trip" onPress={() => act("start_trip")} />
            )}
          </>
        )}
        {b.state === "IN_PROGRESS" && (
          <>
            <Text style={s.body}>
              Running time:{" "}
              {Math.max(
                0,
                Math.floor((clock - new Date(b.started_at).getTime()) / 60000),
              )}{" "}
              minutes.{"\n"}
              Trip started {date(b.started_at)}. The server calculates final
              duration. Live driver tracking continues until this trip ends.
            </Text>
            {DRIVER && (
              <Button
                title="Complete trip"
                onPress={() =>
                  confirm("Complete this trip?", () =>
                    act("finish_service_trip", {
                      p_km: b.service_type === "distance" ? Number(km) : null,
                    }),
                  )
                }
              />
            )}
          </>
        )}
        {DRIVER &&
          b.state === "IN_PROGRESS" &&
          b.service_type === "distance" && (
            <Field
              label="Completed distance (km)"
              value={km}
              onChangeText={setKm}
              keyboardType="decimal-pad"
            />
          )}
        {ACTIVE.includes(b.state) &&
          !["IN_PROGRESS", "OTP_VERIFIED"].includes(b.state) && (
            <>
              <Field
                label="Cancellation reason"
                value={reason}
                onChangeText={setReason}
                placeholder="At least 5 characters"
              />
              <Button
                title="Cancel booking"
                secondary
                onPress={() =>
                  confirm("Cancel this booking?", () =>
                    act("cancel_booking", { p_reason: reason }),
                  )
                }
              />
            </>
          )}
        {b.state === "COMPLETED" && (
          <>
            <Text style={s.h3}>Trip receipt</Text>
            {!!b.fare?.breakdown?.discount_paise&&<Text style={s.body}>Coupon {b.fare.breakdown.coupon_code}: −{money(b.fare.breakdown.discount_paise)} (platform funded)</Text>}
            <Text style={s.body}>
              Started: {date(b.started_at)}
              {"\n"}Completed: {date(b.ended_at)}
              {"\n"}Billed: {b.fare?.billed_minutes} minutes{"\n"}Base:{" "}
              {money(b.fare?.breakdown?.base_paise)}
              {"\n"}Service: {money(b.fare?.breakdown?.service_paise)}
              {"\n"}Overtime included: {b.fare?.breakdown?.overtime_minutes}{" "}
              minutes{"\n"}Customer commission: ₹0.00{"\n"}Total:{" "}
              {money(b.final_paise)}
            </Text>
            {DRIVER && (
              <Text style={s.body}>
                Platform commission due: {money(b.commission_paise)}
                {"\n"}Your earnings: {money(b.earnings_paise)}
                {"\n"}Cash stays with you; platform commission must be settled
                separately.
              </Text>
            )}
            <Text style={s.badge}>
              Cash payment · {state(b.payment_status)}
            </Text>
            <Text style={s.body}>
              GST: {money(b.fare?.breakdown?.tax_paise)}
              {b.service_type === "distance"
                ? ` · Distance: ${b.actual_km} km`
                : ""}
            </Text>
            <Text style={s.small}>
              Driver confirmed: {b.driver_cash_confirmed ? "Yes" : "No"} ·
              Customer confirmed: {b.customer_cash_confirmed ? "Yes" : "No"}
            </Text>
            {!["settled", "disputed"].includes(b.payment_status) &&
              (DRIVER || b.driver_cash_confirmed) && (
                <Button
                  title={
                    DRIVER ? "Confirm cash collected" : "Confirm I paid cash"
                  }
                  onPress={() =>
                    confirm("Confirm cash payment?", () => act("confirm_cash"))
                  }
                />
              )}
            <Field
              label="Rating (1–5)"
              value={score}
              onChangeText={setScore}
              keyboardType="number-pad"
            />
            <Field
              label="Review (optional)"
              value={review}
              onChangeText={setReview}
            />
            <Button
              title="Submit rating"
              secondary
              onPress={() =>
                run(async () => {
                  await rpc("submit_rating", {
                    p_booking: id,
                    p_score: Number(score),
                    p_review: review,
                  });
                  Alert.alert("Thank you", "Your rating was saved.");
                })
              }
            />
            <Button
              title="Report payment disagreement"
              secondary
              onPress={() =>
                run(async () => {
                  await rpc("submit_support", {
                    p_booking: id,
                    p_subject:
                      "Cash payment disagreement; please contact me to investigate.",
                    p_dispute: true,
                  });
                  await load();
                  Alert.alert(
                    "Dispute recorded",
                    "Staff must review this dispute. No money has been moved.",
                  );
                })
              }
            />
          </>
        )}
      </Card>
      {chat && <TripChat booking={id} onClose={() => setChat(false)} />}
      <Card title="Trip updates">
        {(b.history || []).map((h) => (
          <View key={h.id} style={s.timeline}>
            <View style={s.dot} />
            <View>
              <Text style={s.label}>{state(h.to_state)}</Text>
              <Text style={s.small}>{date(h.created_at)}</Text>
            </View>
          </View>
        ))}
      </Card>
      <Button
        title="Share trip details"
        secondary
        onPress={() =>
          run(() =>
            Share.share({
              message: `Hyzz ${b.reference}\nPickup: ${b.pickup_address}\nStatus: ${state(b.state)}\nPickup: ${date(b.scheduled_at)}\nTrip summary only; not a live tracking link.`,
            }),
          )
        }
      />
      <Button
        title="SOS / urgent help"
        danger
        onPress={() =>
          Alert.alert(
            "Urgent help",
            "Hyzz can record an incident for staff review. This does not dispatch emergency services. Contact local emergency services directly if needed.",
            [
              { text: "Close", style: "cancel" },
              {
                text: "Record incident",
                onPress: () =>
                  run(async () => {
                    await rpc("report_emergency", { p_booking: id });
                    Alert.alert(
                      "Incident recorded",
                      "Emergency service delivery is not configured. Do not wait here for urgent help.",
                    );
                  }),
              },
            ],
          )
        }
      />
    </>
  );
}
export default BookingDetail;
