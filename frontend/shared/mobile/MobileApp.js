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
import { api as supabase, rpc } from "./services/api";
import { C, s, state, date, JOURNEY_IMAGE } from "./theme";
import { DRIVER } from "./runtime";
import { Button, Field, Card, ErrorBox, Empty } from "./components";
import domain from "../../../packages/domain.cjs";
import BookingDetail from "./screens/TripScreen";
import Account from "./screens/AccountScreen";
import Notifications from "./Notifications";
import BrandLogo from "./BrandLogo";
import DriverOnboarding from "./DriverOnboarding";
import TrackingControl from "./TrackingControl";
import AppServices from './AppServices';
import { syncTracking, stopTracking } from "./services/tracking";
import { disableNotifications, noticeSubscription } from "./services/notices";
const { ACTIVE, money } = domain;
function SignedIn({ HomeScreen }) {
  const [profile, setProfile] = useState(null),
    [bookings, setBookings] = useState([]),
    [tab, setTab] = useState("home"),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [historyFilter, setHistoryFilter] = useState("All");
  const run = useCallback(async (fn) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message || "Something went wrong. Please retry.");
    }
  }, []);
  const refresh = useCallback(async () => {
    await rpc("expire_requests");
    setProfile(await rpc("my_profile"));
    const { data, error: e } = await supabase
      .from("bookings")
      .select(
        "id,reference,pickup_address,state,scheduled_at,estimate_paise,final_paise,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (e) throw e;
    setBookings(data || []);
  }, []);
  useEffect(() => {
    run(refresh);
    const t = setInterval(() => {
      if (AppState.currentState === "active") run(refresh);
    }, 20000);
    return () => {
      clearInterval(t);
    };
  }, [refresh, run]);
  const wrongRole =
    profile &&
    (DRIVER ? profile.kind !== "driver" : profile.kind !== "customer");
  useEffect(() => {
    if (
      DRIVER &&
      profile?.kind === "driver" &&
      profile.driver?.verification === "approved"
    )
      syncTracking(bookings).catch(() => {});
    else if (DRIVER) stopTracking().catch(() => {});
  }, [bookings, profile?.kind, profile?.driver?.verification]);
  useEffect(() => noticeSubscription(setSelected), []);
  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <View>
          <BrandLogo
            onPress={() => {
              setTab("home");
              setSelected(null);
            }}
          />
          <Text style={s.small}>
            {DRIVER ? "DRIVER PARTNER" : "DRIVE YOUR DAY"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your account"
          onPress={() => {
            setTab("account");
            setSelected(null);
          }}
          style={({ pressed }) => [s.avatar, pressed && { opacity: 0.6 }]}
        >
          <Ionicons
            name={DRIVER ? "car-sport-outline" : "person-outline"}
            size={24}
            color={C.green}
          />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={C.green}
            onRefresh={async () => {
              setRefreshing(true);
              await run(refresh);
              setRefreshing(false);
            }}
          />
        }
      >
        <ErrorBox text={error} />
        {!profile ? (
          <Card>
            <Text style={s.body}>
              Connecting to Hyzz… If setup is pending, apply the supplied
              migrations.
            </Text>
            <Button title="Retry connection" onPress={() => run(refresh)} />
            <Button
              title="Sign out"
              secondary
              onPress={() => supabase.auth.signOut()}
            />
          </Card>
        ) : wrongRole && DRIVER && profile.kind === "customer" ? (
          <DriverOnboarding run={run} refresh={refresh} />
        ) : wrongRole ? (
          <Card title="Use your assigned Hyzz app">
            <Text style={s.body}>
              This account is registered as {profile.kind}.{" "}
              {DRIVER
                ? "An administrator must create your driver account."
                : "Use the driver app or admin website for your role."}
            </Text>
            <Button title="Sign out" onPress={() => supabase.auth.signOut()} />
          </Card>
        ) : selected ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected(null)}
            >
              <Text style={s.link}>← Back</Text>
            </Pressable>
            <BookingDetail id={selected} run={run} refreshParent={refresh} />
          </>
        ) : tab === "account" ? (
          <>
            {DRIVER && <TrackingControl bookings={bookings} run={run} />}
            <Notifications run={run} db={supabase} rpc={rpc} driver={DRIVER} />
            <Account profile={profile} run={run} refresh={refresh} />
          </>
        ) : tab === "history" ? (
          <>
            <Text style={s.h2}>Your bookings</Text>
            <View style={[s.row, { flexWrap: "wrap" }]}>
              {["All", "Upcoming", "Completed", "Cancelled"].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  onPress={() => setHistoryFilter(value)}
                >
                  <Text style={historyFilter === value ? s.badge : s.link}>
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            {!bookings.length ? (
              <Empty
                title="Your journeys start here"
                text="Bookings and receipts will appear here."
              />
            ) : (
              bookings
                .filter(
                  (b) =>
                    historyFilter === "All" ||
                    (historyFilter === "Completed" &&
                      b.state === "COMPLETED") ||
                    (historyFilter === "Upcoming" &&
                      ACTIVE.includes(b.state)) ||
                    (historyFilter === "Cancelled" &&
                      ["CANCELLED", "NO_DRIVER_AVAILABLE"].includes(b.state)),
                )
                .map((b) => (
                  <Pressable
                    accessibilityRole="button"
                    key={b.id}
                    onPress={() => setSelected(b.id)}
                  >
                    <Card>
                      <View style={s.between}>
                        <Text style={s.eyebrow}>{b.reference}</Text>
                        <Text style={s.badge}>{state(b.state)}</Text>
                      </View>
                      <Text style={s.h3}>{b.pickup_address}</Text>
                      <Text style={s.small}>{date(b.scheduled_at)}</Text>
                      <Text style={s.h3}>
                        {money(b.final_paise ?? b.estimate_paise)}
                      </Text>
                    </Card>
                  </Pressable>
                ))
            )}
          </>
        ) : (
          <HomeScreen
            profile={profile}
            run={run}
            bookings={bookings}
            open={setSelected}
            refresh={refresh}
          />
        )}
      </ScrollView>
      <View style={s.nav}>
        {[
          ["home", DRIVER ? "Requests" : "Book", "navigate-outline"],
          ["history", "Bookings", "receipt-outline"],
          ["account", "Account", "person-outline"],
        ].map(([key, title, icon]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key && !selected }}
            accessibilityLabel={title}
            onPress={() => {
              setTab(key);
              setSelected(null);
            }}
            style={({ pressed }) => [
              s.navItem,
              pressed && { opacity: 0.6, transform: [{ scale: 0.94 }] },
            ]}
          >
            <Ionicons
              name={
                tab === key && !selected ? icon.replace("-outline", "") : icon
              }
              size={23}
              color={tab === key ? C.green : C.muted}
            />
            <Text
              style={[
                s.small,
                tab === key && { color: C.green, fontWeight: "700" },
              ]}
            >
              {title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export default function MobileApp({ HomeScreen, LoginScreen, SignedInScreen }) {
  const [session, setSession] = useState(undefined),
    [error, setError] = useState("");
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        setSession(data.session);
      })
      .catch((e) => {
        setError(e.message);
        setSession(null);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, v) => {
      setSession(v);
      if (!v) stopTracking().catch(() => {});
    });
    if (AppState.currentState === "active") supabase.auth.startAutoRefresh();
    const listener = AppState.addEventListener("change", (v) => {
      if (v === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => {
      subscription.unsubscribe();
      listener.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="dark" />
        <AppServices/>
        {error && <ErrorBox text={error} />}{" "}
        {session === undefined ? (
          <View style={s.auth}>
            <ActivityIndicator color={C.green} />
          </View>
        ) : session ? (
          SignedInScreen ? (
            <SignedInScreen />
          ) : (
            <SignedIn HomeScreen={HomeScreen} />
          )
        ) : (
          <LoginScreen />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
