import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, AppState } from "react-native";
import { presentLocalNotice } from "./services/notices";
export default function Notifications({ run, db, rpc, driver }) {
  const [items, setItems] = useState([]),
    [wallet, setWallet] = useState(null);
  useEffect(() => {
    let initialized = false,
      last = new Set(),
      active = true;
    const load = () =>
      run(async () => {
        const { data, error } = await db
          .from("notification_records")
          .select("id,title,created_at,booking_id,release_id")
          .order("created_at", { ascending: false })
          .limit(15);
        if (error) throw error;
        if (!active) return;
        if (initialized)
          for (const item of data || [])
            if (!last.has(item.id)) presentLocalNotice(item).catch(() => {});
        initialized = true;
        last = new Set((data || []).map((v) => v.id));
        setItems(data || []);
        if (driver) setWallet(await rpc("driver_wallet"));
      });
    load();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") load();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [run, db, rpc, driver]);
  return (
    <View style={s.card}>
      {wallet && (
        <>
          <Text style={s.title}>Wallet totals</Text>
          <Text style={s.body}>
            Lifetime earnings: ₹{(wallet.earnings_paise / 100).toFixed(2)}
            {"\n"}Commission outstanding: ₹
            {(wallet.commission_due_paise / 100).toFixed(2)}
            {"\n"}Cash collected: ₹
            {(wallet.cash_collected_paise / 100).toFixed(2)}
          </Text>
        </>
      )}
      <Text style={s.title}>In-app updates</Text>
      {!items.length && (
        <Text style={s.body}>Your booking updates will appear here.</Text>
      )}
      {items.map((n) => (
        <View key={n.id}>
          <Text style={s.body}>{n.title}</Text>
          <Text style={s.small}>
            {new Date(n.created_at).toLocaleString("en-IN")}
          </Text>
        </View>
      ))}
      <Text style={s.small}>
        Updates refresh while this screen is open. Remote push requires Firebase
        credentials and the backend notification worker.
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    padding: 20,
    gap: 14,
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e1e7ec",
  },
  title: { fontSize: 17, fontWeight: "700", color: "#162430" },
  body: { fontSize: 13, lineHeight: 21, color: "#647481" },
  small: { fontSize: 11, lineHeight: 17, color: "#647481" },
});
