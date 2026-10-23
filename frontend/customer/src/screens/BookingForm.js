import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { api as supabase, rpc } from "../../../shared/mobile/services/api";
import { C, s, state, date, JOURNEY_IMAGE } from "../../../shared/mobile/theme";
import LiveMap from "../../../shared/mobile/LiveMap";
import {
  Button,
  Field,
  Card,
  ErrorBox,
  Empty,
} from "../../../shared/mobile/components";
import domain from "../../../../packages/domain.cjs";
const { ACTIVE, money } = domain;
function BookingForm({ run, onCreated }) {
  const [address, setAddress] = useState(""),
    [lat, setLat] = useState(""),
    [lng, setLng] = useState(""),
    [minutes, setMinutes] = useState("60"),
    [km, setKm] = useState("10"),
    [service, setService] = useState("hourly"),
    [scheduled, setScheduled] = useState(""),
    [quote, setQuote] = useState(null),
    [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState([]),
    [placeLabel, setPlaceLabel] = useState("");
  const [destination, setDestination] = useState(""),
    [drop, setDrop] = useState(null),
    [pickMode, setPickMode] = useState("pickup"),
    [preference, setPreference] = useState("professional"),
    [vehicles, setVehicles] = useState([]),
    [vehicle, setVehicle] = useState(null);
  useEffect(() => {
    run(async () => {
      setVehicles(await rpc("my_vehicles"));
      setPlaces(await rpc("my_places"));
    });
  }, [run]);
  const requestKey = useRef(Crypto.randomUUID());
  const [coupon,setCoupon]=useState('');
  async function locate() {
    await run(async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted")
        throw new Error(
          "Location access was denied. Enter the address and coordinates manually.",
        );
      const p = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLat(String(p.coords.latitude));
      setLng(String(p.coords.longitude));
    });
  }
  async function book() {
    setBusy(true);
    await run(async () => {
      if (!quote) throw new Error("Review a fare estimate first.");
      if (!address.trim() || !lat.trim() || !lng.trim())
        throw new Error("Enter pickup address and coordinates.");
      const when = scheduled.trim() ? new Date(scheduled) : new Date();
      if (Number.isNaN(when.getTime()))
        throw new Error("Use YYYY-MM-DDTHH:mm for the pickup date.");
      const b = await rpc("create_service_booking", {
        p_request_key: requestKey.current,
        p_coupon: coupon.trim()||null,
        p_destination: destination.trim() || null,
        p_dest_lat: drop?.lat ?? null,
        p_dest_lng: drop?.lng ?? null,
        p_vehicle: vehicle,
        p_preference: preference,
        p_address: address,
        p_lat: Number(lat),
        p_lng: Number(lng),
        p_service: service,
        p_minutes: Number(minutes),
        p_km: Number(km),
        p_scheduled_at: when.toISOString(),
      });
      requestKey.current = Crypto.randomUUID();
      onCreated(b.id);
    });
    setBusy(false);
  }
  return (
    <>
      <View style={s.banner}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={s.bannerTitle}>Your plans. Your car.</Text>
          <Text style={{ color: "#DDECE5", lineHeight: 21 }}>
            A trusted driver for the journey ahead.
          </Text>
        </View>
        <Image
          source={JOURNEY_IMAGE}
          accessible={false}
          style={{ width: 112, height: 95, borderRadius: 16 }}
          resizeMode="cover"
        />
      </View>
      <Card title="Where are we picking you up?">
        <Field label="Coupon code (optional)" value={coupon} onChangeText={setCoupon} autoCapitalize="characters" placeholder="Enter a Hyzz coupon"/>
        {!!coupon.trim()&&<Text style={s.small}>The server validates your coupon when booking. Discounts are capped at the platform commission; your final receipt shows the discount.</Text>}
        <LiveMap
          pickup={
            lat &&
            lng &&
            Number.isFinite(Number(lat)) &&
            Number.isFinite(Number(lng))
              ? { lat: Number(lat), lng: Number(lng) }
              : null
          }
          destination={drop}
          onPick={(p) => {
            if (pickMode === "destination") {
              setDrop({ lat: p.lat, lng: p.lng });
              setQuote(null);
              return;
            }
            setLat(String(p.lat));
            setLng(String(p.lng));
            if (!address) setAddress("Selected pickup location");
            setQuote(null);
          }}
        />
        <View style={s.row}>
          {["pickup", "destination"].map((mode) => (
            <Button
              key={mode}
              title={"Select " + mode}
              secondary={pickMode !== mode}
              onPress={() => setPickMode(mode)}
            />
          ))}
        </View>
        <Field
          label="Destination address (optional)"
          value={destination}
          onChangeText={setDestination}
          placeholder="Where do you want to go?"
        />
        {drop && (
          <Text style={s.small}>
            Destination pin: {drop.lat.toFixed(5)}, {drop.lng.toFixed(5)}
          </Text>
        )}
        {places.map((p) => (
          <Button
            key={p.id}
            title={p.label + " ? " + p.address}
            secondary
            onPress={() => {
              setLat(String(p.lat));
              setLng(String(p.lng));
              setAddress(p.address);
            }}
          />
        ))}
        <Field
          label="Save pickup as (optional)"
          value={placeLabel}
          onChangeText={setPlaceLabel}
          placeholder="Home or Work"
        />
        <Button
          title="Save pickup location"
          secondary
          onPress={() =>
            run(async () => {
              await rpc("save_place", {
                p_label: placeLabel,
                p_address: address,
                p_lat: Number(lat),
                p_lng: Number(lng),
              });
              setPlaces(await rpc("my_places"));
            })
          }
        />
        <Field
          label="Pickup address"
          value={address}
          onChangeText={setAddress}
          placeholder="Building, street, area, city"
        />
        <Button
          title="Use my location"
          icon="locate-outline"
          secondary
          onPress={locate}
        />
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Field
              label="Latitude"
              value={lat}
              onChangeText={setLat}
              keyboardType="numbers-and-punctuation"
              placeholder="17.3850"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Longitude"
              value={lng}
              onChangeText={setLng}
              keyboardType="numbers-and-punctuation"
              placeholder="78.4867"
            />
          </View>
        </View>
        <Text style={s.small}>
          Tap the map to choose pickup or destination. Use GPS for your current
          pickup and enter an address the driver can recognize.
        </Text>
      </Card>
      <Card title="Driver & car">
        {["professional", "premium", "lady"].map((type) => (
          <Button
            key={type}
            title={
              state(type) +
              " driver" +
              (preference === type ? " - selected" : "")
            }
            secondary={preference !== type}
            onPress={() => setPreference(type)}
          />
        ))}
        <Text style={s.small}>
          Availability depends on approved drivers in your area.
        </Text>
        <Button
          title={vehicle ? "Book without a saved car" : "No saved car selected"}
          secondary
          onPress={() => setVehicle(null)}
        />
        {vehicles.map((v) => (
          <Button
            key={v.id}
            title={
              v.brand +
              " " +
              v.model +
              " - " +
              v.registration +
              (vehicle === v.id ? " - selected" : "")
            }
            secondary={vehicle !== v.id}
            onPress={() => setVehicle(v.id)}
          />
        ))}
        <Text style={s.small}>
          Adding a car or uploading car documents is optional. Manage cars in
          Account.
        </Text>
      </Card>
      <Card title="Make it your kind of trip">
        <View style={s.row}>
          {["hourly", "distance", "full_day"].map((type) => (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ checked: service === type }}
              onPress={() => {
                setService(type);
                setQuote(null);
              }}
              style={[s.choice, service === type && s.choiceSelected]}
            >
              <Ionicons
                name={type === "hourly" ? "time-outline" : "sunny-outline"}
                size={24}
                color={C.green}
              />
              <Text style={s.label}>
                {type === "hourly"
                  ? "By the hour"
                  : type === "distance"
                    ? "By distance"
                    : "Full day"}
              </Text>
            </Pressable>
          ))}
        </View>
        {service === "hourly" && (
          <Field
            label="Duration in minutes (30–1440)"
            value={minutes}
            onChangeText={(v) => {
              setMinutes(v);
              setQuote(null);
            }}
            keyboardType="number-pad"
          />
        )}
        {service === "distance" && (
          <Field
            label="Estimated distance (km)"
            value={km}
            onChangeText={(v) => {
              setKm(v);
              setQuote(null);
            }}
            keyboardType="decimal-pad"
          />
        )}
        <Field
          label="Pickup date & time (optional, local time)"
          value={scheduled}
          onChangeText={setScheduled}
          placeholder="Now, or YYYY-MM-DDTHH:mm"
          autoCapitalize="none"
        />
        <Text style={s.small}>
          Schedule up to 7 days ahead. Drivers can accept within 30 minutes of
          pickup. Requests expire after the matching window.
        </Text>
        <Button
          title="Get fare estimate"
          secondary
          onPress={() =>
            run(async () =>
              setQuote(
                await rpc("estimate_service_fare", {
                  p_service: service,
                  p_minutes: Number(minutes),
                  p_km: Number(km),
                }),
              ),
            )
          }
        />
        {quote && (
          <>
            <View style={s.between}>
              <Text style={s.h3}>Estimated fare</Text>
              <Text style={s.amount}>{money(quote.total_paise)}</Text>
            </View>
            <Text style={s.body}>{quote.policy}</Text>
            <Text style={s.small}>
              Subtotal: {money(quote.subtotal_paise)} · GST:{" "}
              {money(quote.tax_paise)}. Cash is paid directly to your driver.
              Online payments are unavailable.
            </Text>
            <Button title="Confirm booking" onPress={book} busy={busy} />
          </>
        )}
      </Card>
    </>
  );
}
export default BookingForm;
