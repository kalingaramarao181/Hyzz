import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  AppState,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import { api, rpc } from "./services/api";
export default function TripChat({ booking, onClose }) {
  const [items, setItems] = useState([]),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [me, setMe] = useState(null);
  useEffect(() => {
    let alive = true;
    api.auth.getSession().then(({ data }) => {
      if (alive) setMe(data.session?.user.id);
    });
    const load = async () => {
      try {
        const data = await rpc("trip_chat", { p_booking: booking });
        if (alive) {
          setItems(data);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") load();
    }, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [booking]);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    const key = Crypto.randomUUID();
    try {
      await rpc("send_trip_message", {
        p_booking: booking,
        p_key: key,
        p_body: text.trim(),
      });
      setText("");
      setItems(await rpc("trip_chat", { p_booking: booking }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "white" }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={{
              padding: 16,
              borderBottomWidth: 1,
              borderColor: "#EDF1EE",
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close trip chat"
              onPress={onClose}
            >
              <Ionicons name="arrow-back" size={24} color="#006B50" />
            </Pressable>
            <Text style={{ fontSize: 18, fontWeight: "700" }}>Trip chat</Text>
          </View>
          <Text style={{ fontSize: 12, color: "#6B7280", padding: 16 }}>
            Messages are shared only with your trip partner and authorized
            operations. Do not type while driving.
          </Text>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
            {items.map((item) => (
              <View
                key={item.id}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  maxWidth: "88%",
                  alignSelf: item.author_id === me ? "flex-end" : "flex-start",
                  backgroundColor:
                    item.author_id === me ? "#E1F3E8" : "#F2F4F7",
                }}
              >
                <Text style={{ color: "#13251F", fontSize: 15 }}>
                  {item.body}
                </Text>
                <Text style={{ fontSize: 10, color: "#6B7280", marginTop: 5 }}>
                  {new Date(item.created_at).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            ))}
            {!items.length && (
              <Text style={{ color: "#6B7280" }}>
                No messages yet. Send a short trip update.
              </Text>
            )}
          </ScrollView>
          {!!error && (
            <Text
              accessibilityRole="alert"
              style={{ padding: 12, color: "#B42332" }}
            >
              {error}
            </Text>
          )}
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              padding: 14,
              borderTopWidth: 1,
              borderColor: "#EDF1EE",
            }}
          >
            <TextInput
              accessibilityLabel="Trip message"
              value={text}
              onChangeText={setText}
              maxLength={1000}
              multiline
              placeholder="Write a message"
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: "#E2E7E4",
                borderRadius: 12,
                padding: 12,
                maxHeight: 100,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send trip message"
              disabled={busy || !text.trim()}
              onPress={send}
              style={{
                backgroundColor: "#006B50",
                width: 48,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Ionicons name="send" size={21} color="white" />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
