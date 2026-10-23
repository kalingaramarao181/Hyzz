import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  Alert,
  RefreshControl,
} from "react-native";
import * as Crypto from "expo-crypto";
import { rpc, apiRequest } from "../../../shared/mobile/services/api";
import {
  Action,
  Icon,
  Input,
  Page,
  Panel,
  Row,
  Segments,
  Empty,
  u,
  money,
  green,
} from "../ui";
const date = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })
    : "";
function BookingRow({ item, onOpen }) {
  const cancelled =
    item.state.startsWith("CANCELLED") || item.state === "NO_DRIVER_AVAILABLE";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={"Open booking " + (item.reference || item.id)}
      onPress={() => onOpen(item.id)}
      style={[u.menuRow, { alignItems: "flex-start" }]}
    >
      <View
        style={{
          backgroundColor: cancelled ? "#FFF0F0" : "#E8F5ED",
          padding: 9,
          borderRadius: 24,
        }}
      >
        <Icon name="location" color={cancelled ? "#E32B3A" : green} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={u.body} numberOfLines={1}>
          {item.pickup_address.split(",")[0]} {"\u2192"}{" "}
          {item.destination_address?.split(",")[0] || "Driver service"}
        </Text>
        <Text style={u.small}>{date(item.ended_at || item.scheduled_at)}</Text>
        <Text
          style={[
            u.badge,
            cancelled && { color: "#D63242", backgroundColor: "#FFF0F0" },
          ]}
        >
          {item.state.toLowerCase().replaceAll("_", " ")}
        </Text>
      </View>
      <Text style={[u.body, { fontWeight: "700" }]}>
        {money(item.earnings_paise ?? item.final_paise ?? item.estimate_paise)}
      </Text>
    </Pressable>
  );
}
export function DriverBookings({ run, onOpen }) {
  const [filter, setFilter] = useState("all"),
    [items, setItems] = useState([]),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(false);
  async function load(next = 0) {
    setBusy(true);
    try {
      await run(async () => {
        const data = await rpc("driver_history", {
          p_filter: filter,
          p_offset: next,
        });
        setItems((old) => (next ? [...old, ...data] : data));
        setOffset(next);
        setMore(data.length === 50);
      });
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load(0);
  }, [filter]);
  return (
    <Page
      refreshControl={
        <RefreshControl refreshing={busy} onRefresh={() => load(0)} />
      }
    >
      <Segments
        items={[
          ["all", "All"],
          ["completed", "Completed"],
          ["cancelled", "Cancelled"],
        ]}
        value={filter}
        onChange={setFilter}
      />
      {!items.length && !busy ? (
        <Empty
          title="No bookings yet"
          text="Accepted trips and their receipts will appear here."
        />
      ) : (
        items.map((b) => <BookingRow key={b.id} item={b} onOpen={onOpen} />)
      )}
      {more && (
        <Action
          title="Load more bookings"
          secondary
          busy={busy}
          onPress={() => load(offset + 50)}
        />
      )}
    </Page>
  );
}
export function DriverEarnings({ run, onOpen, onNavigate }) {
  const [period, setPeriod] = useState("today"),
    [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    run(async () => {
      const result = await rpc("driver_summary", { p_period: period });
      if (alive) setData(result);
    });
    return () => {
      alive = false;
    };
  }, [period]);
  const bars = data?.bars || [],
    max = Math.max(1, ...bars.map((b) => b.amount_paise));
  return (
    <Page>
      <Segments
        items={[
          ["today", "Today"],
          ["week", "Week"],
          ["month", "Month"],
        ]}
        value={period}
        onChange={setPeriod}
      />
      <View style={{ alignItems: "center", paddingVertical: 12, gap: 6 }}>
        <Text style={u.amount}>
          {money(
            (data?.trip_earnings_paise || 0) + (data?.incentives_paise || 0),
          )}
        </Text>
        <Text style={u.body}>
          {period === "today"
            ? "Today's"
            : period === "week"
              ? "Last 7 days"
              : "This month's"}{" "}
          earnings
        </Text>
        <Text style={u.small}>{data?.trips || 0} trips - India time</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
        {[
          ["Trip earnings", data?.trip_earnings_paise],
          ["Incentives", data?.incentives_paise],
        ].map(([label, value]) => (
          <View key={label} style={{ alignItems: "center", gap: 7 }}>
            <Text style={u.h3}>{money(value || 0)}</Text>
            <Text style={u.small}>{label}</Text>
          </View>
        ))}
      </View>
      <View
        accessibilityLabel="Earnings by time period"
        style={{
          height: 145,
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 4,
          borderBottomWidth: 1,
          borderBottomColor: "#DDE8DF",
          paddingTop: 15,
        }}
      >
        {bars.map((b, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "flex-end",
              height: "100%",
              gap: 5,
            }}
          >
            <View
              accessibilityLabel={b.label + ": " + money(b.amount_paise)}
              style={{
                width: "100%",
                maxWidth: 24,
                height: Math.max(3, (105 * b.amount_paise) / max),
                backgroundColor: i % 2 ? "#BFE7CB" : "#11B45C",
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            />
            {(bars.length <= 8 || i % Math.ceil(bars.length / 6) === 0) && (
              <Text style={{ fontSize: 8, color: "#788278" }}>{b.label}</Text>
            )}
          </View>
        ))}
      </View>
      <Text style={u.small}>
        Trip earnings are earned on completed trips. Available payout credit is
        shown separately in Wallet.
      </Text>
      <View style={u.between}>
        <Text style={u.h3}>Recent trips</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onNavigate("history")}
        >
          <Text style={u.link}>See all</Text>
        </Pressable>
      </View>
      {!(data?.recent || []).length && <Empty title="No completed trips yet" />}
      {(data?.recent || []).map((b) => (
        <BookingRow key={b.id} item={b} onOpen={onOpen} />
      ))}
    </Page>
  );
}
export function DriverWallet({ finances, run, refresh, onNavigate }) {
  const [modalError, setModalError] = useState("");
  const [show, setShow] = useState(false),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    key = useRef(Crypto.randomUUID());
  const wallet = finances?.wallet || {};
  async function request() {
    setBusy(true);
    setModalError("");
    try {
      await run(async () => {
        try {
          if (!/^\d+(\.\d{1,2})?$/.test(amount))
            throw new Error(
              "Enter a valid rupee amount with at most two decimal places.",
            );
          await rpc("request_driver_payout", {
            p_key: key.current,
            p_amount: Math.round(Number(amount) * 100),
          });
          key.current = Crypto.randomUUID();
          setShow(false);
          setAmount("");
          await refresh();
          Alert.alert(
            "Payout requested",
            "Finance will review your request. Funds are transferred separately; this action does not move money.",
          );
        } catch (e) {
          setModalError(e.message);
          throw e;
        }
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Panel style={{ backgroundColor: green, borderColor: green }}>
        <Text style={{ color: "white", fontSize: 14 }}>
          Available platform credit
        </Text>
        <Text style={[u.amount, { color: "white" }]}>
          {money(wallet.available_paise || 0)}
        </Text>
        <Action
          title="Request payout"
          secondary
          disabled={
            !finances?.bank ||
            !(wallet.available_paise > 0) ||
            wallet.commission_due_paise > 0
          }
          onPress={() => setShow(true)}
        />
      </Panel>
      <Text style={u.small}>
        Cash collected from customers stays with you. Payouts apply only to
        credits owed by Hyzz, such as approved incentives. Settle outstanding
        commission before requesting a payout.
      </Text>
      <Panel>
        {[
          ["Lifetime trip earnings", wallet.earnings_paise],
          ["Cash collected", wallet.cash_collected_paise],
          ["Commission outstanding", wallet.commission_due_paise],
        ].map(([label, value]) => (
          <View key={label} style={u.between}>
            <Text style={u.small}>{label}</Text>
            <Text style={u.body}>{money(value || 0)}</Text>
          </View>
        ))}
      </Panel>
      <View>
        {[
          ["time-outline", "Transaction history", "transactions"],
          ["wallet-outline", "Payout history", "payouts"],
          ["business-outline", "Bank details", "bank"],
          ["reader-outline", "Earnings summary", "earnings"],
        ].map(([icon, title, page]) => (
          <Row
            key={page}
            icon={icon}
            title={title}
            onPress={() => onNavigate(page)}
          />
        ))}
      </View>
      {!finances?.bank && (
        <Action
          title="Add bank details for payouts"
          secondary
          onPress={() => onNavigate("bank")}
        />
      )}
      <Modal
        visible={show}
        transparent
        animationType="slide"
        onRequestClose={() => setShow(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,.35)",
            justifyContent: "center",
            padding: 22,
          }}
        >
          <Panel>
            <Text style={u.h3}>Request payout</Text>
            <Text style={u.small}>
              Available: {money(wallet.available_paise || 0)}. Destination
              ending {finances?.bank?.last4}.
            </Text>
            <Input
              label="Amount in rupees"
              value={amount}
              onChangeText={(v) => {
                setAmount(v);
                key.current = Crypto.randomUUID();
              }}
              keyboardType="decimal-pad"
            />
            <Action
              title="Submit payout request"
              busy={busy}
              onPress={request}
            />
            <Action
              title="Cancel payout request"
              secondary
              disabled={busy}
              onPress={() => setShow(false)}
            />
            <Text style={u.small}>
              If the request fails, close this dialog to view the error message
              and retry.
            </Text>
          </Panel>
        </View>
      </Modal>
    </Page>
  );
}
export function DriverTransactions({ finances }) {
  return (
    <Page>
      {!(finances?.transactions || []).length && (
        <Empty title="No transactions yet" />
      )}
      {(finances?.transactions || []).map((t) => (
        <Row
          key={t.id}
          icon="swap-horizontal-outline"
          title={t.entry_type.replaceAll("_", " ")}
          detail={date(t.created_at)}
          right={<Text style={u.body}>{money(t.amount_paise)}</Text>}
        />
      ))}
    </Page>
  );
}
export function DriverPayouts({ finances }) {
  return (
    <Page>
      <Text style={u.small}>
        Pending requests await finance review. Paid means finance recorded an
        external bank transfer reference.
      </Text>
      {!(finances?.payouts || []).length && (
        <Empty title="No payout requests" />
      )}
      {(finances?.payouts || []).map((p) => (
        <Panel key={p.id}>
          <View style={u.between}>
            <Text style={u.h3}>{money(p.amount_paise)}</Text>
            <Text style={u.badge}>{p.state}</Text>
          </View>
          <Text style={u.small}>
            {date(p.created_at)} - Bank ending {p.last4}
          </Text>
          {p.review_note && <Text style={u.body}>{p.review_note}</Text>}
          {p.external_reference && (
            <Text style={u.small}>
              Transfer reference: {p.external_reference}
            </Text>
          )}
        </Panel>
      ))}
    </Page>
  );
}
export function DriverBank({ finances, run, refresh }) {
  const [name, setName] = useState(finances?.bank?.payee_name || ""),
    [ifsc, setIfsc] = useState(finances?.bank?.ifsc || ""),
    [account, setAccount] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Page>
      <Panel>
        <Text style={u.h3}>Bank details</Text>
        {finances?.bank && (
          <Text style={u.badge}>
            Saved account ending {finances.bank.last4}
          </Text>
        )}
        <Text style={u.small}>
          Bank account numbers are encrypted by the backend. Updating these
          details affects future requests; submitted requests keep their
          original destination.
        </Text>
        <Input
          label="Account holder name"
          value={name}
          onChangeText={setName}
        />
        <Input
          label="Account number"
          value={account}
          onChangeText={setAccount}
          keyboardType="number-pad"
          secureTextEntry
          autoComplete="off"
          maxLength={18}
        />
        <Input
          label="Confirm account number"
          value={confirm}
          onChangeText={setConfirm}
          keyboardType="number-pad"
          autoComplete="off"
          maxLength={18}
        />
        <Input
          label="IFSC code"
          value={ifsc}
          onChangeText={(v) => setIfsc(v.toUpperCase())}
          autoCapitalize="characters"
          maxLength={11}
        />
        <Action
          title="Save bank details"
          busy={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await run(async () => {
                if (account !== confirm)
                  throw new Error("Account numbers do not match.");
                await apiRequest("/api/v1/bank/details", {
                  name: name.trim(),
                  account,
                  ifsc: ifsc.trim(),
                });
                setAccount("");
                setConfirm("");
                await refresh();
                Alert.alert(
                  "Bank details saved",
                  "Please confirm the payee details before requesting a payout.",
                );
              });
            } finally {
              setBusy(false);
            }
          }}
        />
      </Panel>
    </Page>
  );
}
