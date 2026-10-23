import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import domain from "../../../packages/domain.cjs";
export const money = (value) => domain.money(value).replace(/\.00$/, "");
export const green = "#006B50",
  ink = "#101827",
  muted = "#6B7280";
export function Icon({ name, size = 21, color = green }) {
  return <Ionicons name={name} size={size} color={color} />;
}
export function Action({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
  busy = false,
  icon,
  style,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        u.button,
        secondary && u.secondary,
        danger && u.danger,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? green : "white"} />
      ) : (
        <>
          {icon && <Icon name={icon} color={secondary ? green : "white"} />}
          <Text style={[u.buttonText, secondary && { color: green }]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}
export function CircleButton({ icon, label, onPress, danger = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={u.circle}
    >
      <Icon name={icon} color={danger ? "#E42332" : green} />
    </Pressable>
  );
}
export function Row({
  icon,
  title,
  detail,
  onPress,
  danger = false,
  right,
  children,
}) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={title}
      onPress={onPress}
      style={u.menuRow}
    >
      <Icon name={icon} size={20} color={danger ? "#E42332" : green} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[u.body, danger && { color: "#E42332" }]}>{title}</Text>
        {detail && <Text style={u.small}>{detail}</Text>}
        {children}
      </View>
      {right ||
        (onPress && <Icon name="chevron-forward" size={17} color="#9CA3AF" />)}
    </Container>
  );
}
export function Page({ children, refreshControl }) {
  return (
    <ScrollView
      contentContainerStyle={u.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}
export function Panel({ children, style }) {
  return <View style={[u.panel, style]}>{children}</View>;
}
export function Input({ label, value, onChangeText, ...props }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={u.small}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        style={u.input}
        placeholderTextColor="#9CA3AF"
        {...props}
      />
    </View>
  );
}
export function Avatar({ name, size = 46 }) {
  return (
    <View
      accessibilityLabel={name || "Hyzz member"}
      style={[u.avatar, { height: size, width: size, borderRadius: size / 2 }]}
    >
      <Text style={{ color: green, fontWeight: "800", fontSize: size * 0.34 }}>
        {(name || "H").trim().slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}
export function Segments({ items, value, onChange }) {
  return (
    <View style={u.segments}>
      {items.map((item) => {
        const key = Array.isArray(item) ? item[0] : item,
          label = Array.isArray(item) ? item[1] : item;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: value === key }}
            onPress={() => onChange(key)}
            style={[u.segment, value === key && { backgroundColor: green }]}
          >
            <Text
              style={{
                color: value === key ? "white" : ink,
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
export function Empty({ title, text }) {
  return (
    <View style={{ padding: 24, alignItems: "center", gap: 10 }}>
      <Icon name="car-sport-outline" size={36} />
      <Text style={u.h3}>{title}</Text>
      {text && <Text style={[u.small, { textAlign: "center" }]}>{text}</Text>}
    </View>
  );
}
export function Stars({ value, onChange, disabled = false }) {
  return (
    <View
      accessibilityLabel={"Rating " + value + " out of 5"}
      style={{ flexDirection: "row", justifyContent: "center", gap: 10 }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="button"
          accessibilityLabel={"Rate " + n + " stars"}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onChange(n)}
        >
          <Icon name={n <= value ? "star" : "star-outline"} size={31} />
        </Pressable>
      ))}
    </View>
  );
}
export const u = StyleSheet.create({
  root: { flex: 1, backgroundColor: "white" },
  page: { padding: 16, gap: 16, paddingBottom: 28 },
  panel: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#EEF0F3",
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  body: { color: ink, fontSize: 14, lineHeight: 21 },
  small: { color: muted, fontSize: 12, lineHeight: 18 },
  h2: { color: ink, fontSize: 24, fontWeight: "800" },
  h3: { color: ink, fontSize: 16, fontWeight: "700" },
  amount: { color: ink, fontSize: 34, fontWeight: "800" },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  line: { height: 1, backgroundColor: "#EEF0F3" },
  button: {
    backgroundColor: green,
    minHeight: 49,
    borderRadius: 9,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondary: {
    backgroundColor: "#F5F8F7",
    borderWidth: 1,
    borderColor: "#DCE8E1",
  },
  danger: { backgroundColor: "#E31828" },
  buttonText: { fontSize: 14, fontWeight: "700", color: "white" },
  circle: {
    height: 39,
    width: 39,
    borderRadius: 20,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E8ECEF",
    justifyContent: "center",
    alignItems: "center",
  },
  menuRow: {
    minHeight: 55,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F3F5",
  },
  avatar: {
    backgroundColor: "#E6F2DE",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D8EADB",
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2E7EC",
    borderRadius: 9,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: ink,
    backgroundColor: "#FBFCFD",
    fontSize: 14,
  },
  segments: { flexDirection: "row", gap: 7 },
  segment: {
    flex: 1,
    minHeight: 35,
    borderRadius: 8,
    backgroundColor: "#F0F2F5",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badge: {
    color: green,
    backgroundColor: "#E7F4EB",
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    alignSelf: "flex-start",
  },
  sheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 21,
    borderTopRightRadius: 21,
    padding: 17,
    gap: 13,
    borderWidth: 1,
    borderColor: "#E5EAE8",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  mapButton: { position: "absolute", right: 14, top: 16, gap: 10 },
  header: {
    minHeight: 57,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  nav: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#E6EBE7",
    backgroundColor: "white",
    paddingTop: 10,
    paddingBottom: 9,
  },
  navItem: { flex: 1, alignItems: "center", gap: 5 },
  link: { color: green, fontWeight: "600", fontSize: 13 },
});

export function confirmAction(title, message, callback, label = "Confirm") {
  if (Platform.OS === "web") {
    if (globalThis.confirm(title + "\n\n" + message)) callback();
  } else
    Alert.alert(title, message, [
      { text: "Back", style: "cancel" },
      { text: label, onPress: callback },
    ]);
}
