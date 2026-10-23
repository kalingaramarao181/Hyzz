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
import { C, s, JOURNEY_IMAGE } from "./theme";
function Button({ title, onPress, busy, secondary, danger, disabled, icon }) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue) =>
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 28,
      bounciness: 3,
    }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
        disabled={disabled || busy}
        onPress={onPress}
        onPressIn={() => animate(0.98)}
        onPressOut={() => animate(1)}
        style={({ pressed }) => [
          s.button,
          secondary && s.secondary,
          danger && { backgroundColor: C.red },
          (disabled || busy) && { opacity: 0.55 },
          pressed && { opacity: 0.75 },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={secondary ? C.green : C.white} />
        ) : (
          <>
            {icon && (
              <Ionicons
                name={icon}
                size={18}
                color={secondary ? C.green : C.white}
              />
            )}
            <Text style={[s.buttonText, secondary && { color: C.green }]}>
              {title}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}
function Field({ label, value, onChangeText, ...props }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="#8A969E"
        style={s.input}
        {...props}
      />
    </View>
  );
}
function Card({ children, title }) {
  return (
    <View style={s.card}>
      {title && <Text style={s.h3}>{title}</Text>}
      {children}
    </View>
  );
}
function ErrorBox({ text }) {
  return text ? (
    <View accessibilityLiveRegion="polite" style={s.error}>
      <Ionicons name="alert-circle-outline" size={20} color={C.red} />
      <Text style={{ color: C.red, flex: 1, lineHeight: 20 }}>{text}</Text>
    </View>
  ) : null;
}
function Empty({ title, text }) {
  return (
    <Card>
      <Image
        source={JOURNEY_IMAGE}
        style={{ width: 156, height: 104, borderRadius: 14 }}
        accessible={false}
      />
      <Text style={s.h3}>{title}</Text>
      <Text style={s.body}>{text}</Text>
    </Card>
  );
}
export { Button, Field, Card, ErrorBox, Empty };
