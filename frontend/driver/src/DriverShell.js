import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
} from "react-native";
import BrandLogo from "../../shared/mobile/BrandLogo";
import DriverOnboarding from "../../shared/mobile/DriverOnboarding";
import { api, rpc } from "../../shared/mobile/services/api";
import {
  syncTracking,
  stopTracking,
} from "../../shared/mobile/services/tracking";
import {
  enableNotifications,
  disableNotifications,
  noticeSubscription,
  presentLocalNotice,
} from "../../shared/mobile/services/notices";
import DriverHome from "./screens/DriverHomeScreen";
import IncomingRequest from "./screens/IncomingRequestScreen";
import DriverTrip from "./screens/DriverTripScreen";
import {
  DriverBookings,
  DriverEarnings,
  DriverWallet,
  DriverTransactions,
  DriverPayouts,
  DriverBank,
} from "./screens/DriverFinanceScreens";
import {
  DriverAccount,
  DriverProfile,
  DriverDocuments,
  DriverSupport,
  DriverTicket,
  DriverNotifications,
  DriverSettings,
  DriverLanguage,
  DriverEmergency,
  DriverInformation,
  labels,
} from "./screens/DriverAccountScreens";
import {
  Action,
  CircleButton,
  Icon,
  Page,
  u,
  green,
  confirmAction,
} from "./ui";
const activeStates = [
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "OTP_VERIFIED",
  "IN_PROGRESS",
];
export default function DriverShell() {
  const [profile, setProfile] = useState(null),
    [bookings, setBookings] = useState([]),
    [summary, setSummary] = useState(null),
    [finances, setFinances] = useState(null),
    [prefs, setPrefs] = useState({ language: "en", notifications: true }),
    [zones, setZones] = useState([]),
    [position, setPosition] = useState(null),
    [view, setView] = useState("home"),
    [selected, setSelected] = useState(null),
    [incoming, setIncoming] = useState(null),
    [error, setError] = useState(""),
    [notices, setNotices] = useState([]);
  const dismissed = useRef(new Set()),
    noticeIds = useRef(null),
    prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const routeRef = useRef({ view, selected }),
    history = useRef([]);
  routeRef.current = { view, selected };
  const run = useCallback(async (fn) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(
        e.message || "Please retry. Hyzz could not complete this request.",
      );
      return undefined;
    }
  }, []);
  const refresh = useCallback(async () => {
    const p = await rpc("my_profile");
    setProfile(p);
    if (p.kind !== "driver") return;
    const result = await Promise.all([
      api
        .from("bookings")
        .select(
          "id,reference,pickup_address,destination_address,state,scheduled_at,estimate_paise,final_paise,earnings_paise,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      rpc("driver_summary", { p_period: "today" }),
      rpc("driver_finances"),
      rpc("driver_preferences"),
    ]);
    if (result[0].error) throw result[0].error;
    setBookings(result[0].data || []);
    setSummary(result[1]);
    setFinances(result[2]);
    setPrefs(result[3]);
    const areas = await api.from("service_areas").select("*");
    if (!areas.error)
      setZones(
        (areas.data || []).filter(
          (z) => z.enabled && z.lat != null && z.lng != null,
        ),
      );
  }, []);
  useEffect(() => {
    run(refresh);
    const timer = setInterval(() => {
      if (AppState.currentState === "active") run(refresh);
    }, 20000);
    return () => clearInterval(timer);
  }, [refresh, run]);
  useEffect(() => {
    if (
      profile?.kind === "driver" &&
      profile.driver?.verification === "approved"
    )
      syncTracking(bookings).catch((e) => setError(e.message));
    else stopTracking().catch(() => {});
  }, [bookings, profile?.kind, profile?.driver?.verification]);
  const receiveRequest = useCallback((requests) => {
    const next = requests.find((r) => !dismissed.current.has(r.id));
    if (next) setIncoming(next);
  }, []);
  function closeIncoming() {
    if (incoming) dismissed.current.add(incoming.id);
    setIncoming(null);
  }
  const navigate = useCallback((page) => {
    if (["home", "history", "wallet", "account"].includes(page))
      history.current = [];
    else if (page !== routeRef.current.view || routeRef.current.selected)
      history.current.push({ ...routeRef.current });
    setIncoming(null);
    setSelected(null);
    setView(page);
    setError("");
  }, []);
  const open = useCallback(
    (id) =>
      run(async () => {
        if (bookings.some((b) => b.id === id)) {
          setSelected(id);
          setIncoming(null);
          return;
        }
        const requests = await rpc("driver_requests");
        const offer = requests.find((r) => r.id === id);
        if (offer) {
          setIncoming(offer);
          return;
        }
        await rpc("booking_details", { p_booking: id });
        setSelected(id);
      }),
    [bookings, run],
  );
  useEffect(() => noticeSubscription(open), [open]);
  useEffect(() => {
    if (profile?.kind !== "driver") return;
    let alive = true;
    async function load() {
      try {
        const result = await api
          .from("notification_records")
          .select("id,title,created_at,booking_id,release_id")
          .order("created_at", { ascending: false })
          .limit(30);
        if (result.error) throw result.error;
        if (!alive) return;
        setNotices(result.data || []);
        if (noticeIds.current && prefsRef.current.notifications !== false)
          for (const item of result.data || [])
            if (!noticeIds.current.has(item.id))
              presentLocalNotice(item).catch(() => {});
        noticeIds.current = new Set((result.data || []).map((n) => n.id));
      } catch {}
    }
    load();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") load();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [profile?.kind]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (incoming) {
          closeIncoming();
          return true;
        }
        if (selected || view !== "home") {
          goBack();
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [incoming, selected, view]);
  const savePrefs = useCallback(
    (changes) =>
      run(async () => {
        const merged = { ...prefsRef.current, ...changes };
        await rpc("save_driver_preferences", {
          p_notifications: merged.notifications !== false,
          p_language: merged.language || "en",
          p_emergency: merged.emergency_phone || null,
        });
        setPrefs(merged);
      }),
    [run],
  );
  function toggleNotifications(next) {
    run(async () => {
      if (next) await enableNotifications("driver");
      await rpc("save_driver_preferences", {
        p_notifications: next,
        p_language: prefs.language || "en",
        p_emergency: prefs.emergency_phone || null,
      });
      if (!next) await disableNotifications();
      setPrefs({ ...prefs, notifications: next });
    });
  }
  function logout() {
    confirmAction(
      "Logout?",
      bookings.some((b) => activeStates.includes(b.state))
        ? "You have an assigned trip. Signing out stops live location sharing until you sign in again."
        : "You can sign back in with your email.",
      () =>
        run(async () => {
          await rpc("set_availability", { p_online: false }).catch(() => {});
          await stopTracking();
          await disableNotifications();
          const result = await api.auth.signOut();
          if (result.error) throw result.error;
        }),
      "Logout",
    );
  }
  function goBack() {
    if (incoming) {
      closeIncoming();
      return;
    }
    if (selected) {
      setSelected(null);
      return;
    }
    const previous = history.current.pop();
    if (previous) {
      setSelected(previous.selected);
      setView(previous.view);
      setError("");
    } else navigate("home");
  }
  const common = {
    profile,
    summary,
    finances,
    prefs,
    run,
    refresh,
    bookings,
    savePrefs,
    onNavigate: navigate,
    onToggle: toggleNotifications,
    onOpen: open,
  };
  const language = { ...labels.en, ...labels[prefs.language || "en"] },
    title =
      language[view] ||
      { issue: "Report an issue", safety: "Safety tips" }[view] ||
      "Hyzz";
  const tab = ["wallet", "transactions", "payouts", "bank"].includes(view)
    ? "wallet"
    : [
          "account",
          "profile",
          "documents",
          "language",
          "privacy",
          "terms",
          "settings",
          "notifications",
        ].includes(view)
      ? "account"
      : view === "history"
        ? "history"
        : "home";
  let content;
  if (!profile)
    content = (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          gap: 20,
        }}
      >
        <ActivityIndicator color={green} />
        <Action title="Retry connection" onPress={() => run(refresh)} />
      </View>
    );
  else if (profile.kind === "customer")
    content = (
      <Page>
        <DriverOnboarding run={run} refresh={refresh} />
        <Action title="Use another email" secondary onPress={logout} />
      </Page>
    );
  else if (profile.kind !== "driver")
    content = (
      <Page>
        <Text style={u.h3}>Use your assigned Hyzz application</Text>
        <Text style={u.body}>
          This is a staff account. Use the admin website.
        </Text>
        <Action title="Logout" onPress={logout} />
      </Page>
    );
  else if (selected)
    content = (
      <DriverTrip
        id={selected}
        run={run}
        refresh={refresh}
        onDone={() => navigate("home")}
        onBack={goBack}
        onSettings={() => navigate("settings")}
      />
    );
  else if (incoming)
    content = (
      <IncomingRequest
        request={incoming}
        position={position}
        run={run}
        onClose={closeIncoming}
        onAccept={async (id) => {
          setSelected(id);
          setIncoming(null);
          await refresh();
        }}
      />
    );
  else
    switch (view) {
      case "history":
        content = <DriverBookings {...common} />;
        break;
      case "earnings":
        content = <DriverEarnings {...common} />;
        break;
      case "wallet":
        content = <DriverWallet {...common} />;
        break;
      case "transactions":
        content = <DriverTransactions {...common} />;
        break;
      case "payouts":
        content = <DriverPayouts {...common} />;
        break;
      case "bank":
        content = <DriverBank {...common} />;
        break;
      case "account":
        content = <DriverAccount {...common} onLogout={logout} />;
        break;
      case "profile":
        content = <DriverProfile {...common} />;
        break;
      case "documents":
        content = <DriverDocuments {...common} />;
        break;
      case "support":
        content = <DriverSupport {...common} />;
        break;
      case "notifications":
        content = <DriverNotifications {...common} items={notices} />;
        break;
      case "settings":
        content = <DriverSettings {...common} />;
        break;
      case "language":
        content = <DriverLanguage {...common} />;
        break;
      case "emergency":
        content = <DriverEmergency {...common} />;
        break;
      case "ticket":
      case "issue":
      case "feedback":
        content = (
          <DriverTicket
            {...common}
            topic={
              view === "feedback"
                ? "App feedback"
                : view === "issue"
                  ? "Report an issue"
                  : "Support"
            }
          />
        );
        break;
      case "privacy":
      case "terms":
      case "safety":
      case "help":
        content = <DriverInformation topic={view} />;
        break;
      default:
        content = (
          <DriverHome
            {...common}
            zones={zones}
            position={position}
            setPosition={setPosition}
            onIncoming={receiveRequest}
          />
        );
    }
  const full = !!(selected || incoming);
  return (
    <View style={u.root}>
      {!full &&
        (view === "home" ? (
          <View
            style={[
              u.header,
              { justifyContent: "space-between", minHeight: 69 },
            ]}
          >
            <View>
              <BrandLogo onPress={() => navigate("home")} />
              <Text style={{ fontSize: 8, color: "#79858D", letterSpacing: 1 }}>
                DRIVER PARTNER
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 13 }}>
              <CircleButton
                label="Open notifications"
                icon="notifications-outline"
                onPress={() => navigate("notifications")}
              />
              <CircleButton
                label="Open my profile"
                icon="car-sport"
                onPress={() => navigate("profile")}
              />
            </View>
          </View>
        ) : (
          <View style={u.header}>
            <CircleButton icon="arrow-back" label="Back" onPress={goBack} />
            <Text style={u.h3}>{title}</Text>
          </View>
        ))}
      {!!error && (
        <Pressable
          accessibilityRole="alert"
          onPress={() => setError("")}
          style={{
            backgroundColor: "#FFF1F0",
            padding: 12,
            borderBottomWidth: 1,
            borderColor: "#F8D2CE",
          }}
        >
          <Text style={{ color: "#A42932", fontSize: 13 }}>{error}</Text>
        </Pressable>
      )}
      {content}
      {!full && profile?.kind === "driver" && (
        <View style={u.nav}>
          {[
            ["home", "home-outline"],
            ["history", "receipt-outline"],
            ["wallet", "wallet-outline"],
            ["account", "person-outline"],
          ].map(([page, icon]) => (
            <Pressable
              key={page}
              accessibilityRole="tab"
              accessibilityLabel={labels.en[page]}
              accessibilityState={{ selected: tab === page }}
              onPress={() => navigate(page)}
              style={u.navItem}
            >
              <Icon
                name={tab === page ? icon.replace("-outline", "") : icon}
                size={23}
                color={tab === page ? green : "#83909F"}
              />
              <Text
                style={{
                  fontSize: 10,
                  color: tab === page ? green : "#83909F",
                  fontWeight: tab === page ? "700" : "400",
                }}
              >
                {language[page]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
