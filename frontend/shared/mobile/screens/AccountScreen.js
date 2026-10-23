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
import { Button, Field, Card, ErrorBox, Empty } from "../components";
import domain from "../../../../packages/domain.cjs";
import DocumentManager from "../DocumentManager";
import CustomerCars from "../CustomerCars";
import { stopTracking } from "../services/tracking";
import { disableNotifications, enableNotifications } from "../services/notices";
const { ACTIVE, money } = domain;
function Account({ profile, run, refresh }) {
  const [name, setName] = useState(profile.full_name || ""),
    [phone, setPhone] = useState(profile.phone || ""),
    [subject, setSubject] = useState(""),
    [tickets, setTickets] = useState([]),
    [docs, setDocs] = useState([]),
    [ledger, setLedger] = useState([]);
  useEffect(() => {
    run(async () => {
      const t = await supabase
        .from("support_tickets")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (t.error) throw t.error;
      setTickets(t.data || []);
      if (DRIVER) {
        const d = await supabase.from("driver_documents").select("*");
        if (d.error) throw d.error;
        setDocs(d.data || []);
        const l = await supabase
          .from("financial_ledger_entries")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        if (l.error) throw l.error;
        setLedger(l.data || []);
      }
    });
  }, [run]);
  return (
    <>
      <Card title="Your profile">
        <Field label="Full name" value={name} onChangeText={setName} />
        <Field
          label="Contact mobile (optional, not verified)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+919876543210"
        />
        <Text style={s.small}>
          Email is verified for sign-in. This contact number is not phone-OTP
          verified.
        </Text>
        <Button
          title="Save profile"
          onPress={() =>
            run(async () => {
              await rpc("update_my_profile", {
                p_name: name,
                p_phone: phone.trim() || null,
              });
              await refresh();
              Alert.alert("Profile saved");
            })
          }
        />
      </Card>
      {DRIVER && (
        <>
          <DocumentManager profile={profile} run={run} refresh={refresh} />
          <Card title="Earnings & wallet ledger">
            <Text style={s.small}>
              Commission receipts recorded by finance reduce the outstanding
              balance shown on Home. Payouts and refunds are unavailable.
            </Text>
            {!ledger.length && (
              <Text style={s.body}>No financial entries yet.</Text>
            )}
            {ledger.map((l) => (
              <View key={l.id} style={s.between}>
                <Text style={s.body}>{state(l.entry_type)}</Text>
                <Text style={s.label}>{money(l.amount_paise)}</Text>
              </View>
            ))}
          </Card>
        </>
      )}
      {!DRIVER && <CustomerCars profile={profile} run={run} />}
      <Card title="Notifications">
        <Button
          title="Enable notifications"
          onPress={() =>
            run(async () => {
              const result = await enableNotifications(
                DRIVER ? "driver" : "customer",
              );
              Alert.alert(
                "Notifications",
                result.remote
                  ? "Push notifications are enabled."
                  : "Local notifications are enabled. Remote delivery requires Firebase and Expo project setup.",
              );
            })
          }
        />
        <Button
          title="Disable app push notifications"
          secondary
          onPress={() => run(disableNotifications)}
        />
      </Card>
      <Card title="Support">
        <Field
          label="How can we help?"
          value={subject}
          onChangeText={setSubject}
          multiline
          maxLength={1000}
        />
        <Button
          title="Submit support request"
          onPress={() =>
            run(async () => {
              await rpc("submit_support", { p_subject: subject });
              setSubject("");
              const { data } = await supabase
                .from("support_tickets")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(20);
              setTickets(data || []);
              Alert.alert(
                "Request saved",
                "Your request is available to authorized staff. Response time is not guaranteed.",
              );
            })
          }
        />
        {tickets.map((t) => (
          <View key={t.id} style={s.ticket}>
            <Text style={s.label}>{t.subject}</Text>
            <Text style={s.small}>
              {t.status} · {date(t.created_at)}
            </Text>
            {t.admin_note && <Text style={s.body}>{t.admin_note}</Text>}
          </View>
        ))}
      </Card>
      <Card title="Service & privacy">
        <Text style={s.body}>
          Hyzz arranges drivers for your own vehicle. Confirm vehicle fitness
          and insurance before use. Driver location is shared with the assigned
          customer and operations throughout the assigned trip. With driver
          permission it continues while the app is minimized. Sharing stops when
          the trip ends or is cancelled. Cash requires both parties to confirm.
          Pre-trip cancellation is free. This pilot requires operational and
          legal review before public use.
        </Text>
        <Button
          title="Request account deletion"
          secondary
          onPress={() =>
            Alert.alert(
              "Request account deletion?",
              "Staff must review retention obligations. This requests deletion; it does not immediately erase records.",
              [
                { text: "Back", style: "cancel" },
                {
                  text: "Request deletion",
                  onPress: () =>
                    run(async () => {
                      await rpc("request_account_deletion");
                      Alert.alert("Request saved");
                    }),
                },
              ],
            )
          }
        />
      </Card>
      <Button
        title="Sign out"
        secondary
        onPress={() =>
          run(async () => {
            // A suspended account must still be able to clear its Auth session.
            if (DRIVER)
              await rpc("set_availability", { p_online: false }).catch(
                () => {},
              );
            await stopTracking();
            await disableNotifications();
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
          })
        }
      />
    </>
  );
}
export default Account;
