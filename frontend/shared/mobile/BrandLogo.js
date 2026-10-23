import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
const driver = Constants.expoConfig?.extra?.appVariant === "driver";
const mark = driver
  ? require("../../../assets/hyzz-driver-icon.png")
  : require("../../../assets/hyzz-customer-icon.png");
export default function BrandLogo({ inverse = false, onPress }) {
  const content = (
    <>
      <Image source={mark} style={s.mark} accessible={false} />
      <Text style={[s.name, { color: inverse ? "#fff" : "#162430" }]}>
        hyzz<Text style={{ color: inverse ? "#D4F467" : "#16765B" }}>.</Text>
      </Text>
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hyzz home"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View
      accessibilityRole="image"
      accessibilityLabel={driver ? "Hyzz Driver" : "Hyzz Customer"}
      style={s.row}
    >
      {content}
    </View>
  );
}
const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    minHeight: 48,
    alignSelf: "flex-start",
  },
  mark: { width: 44, height: 44, borderRadius: 12 },
  name: { fontSize: 37, fontWeight: "900", letterSpacing: -2 },
});
