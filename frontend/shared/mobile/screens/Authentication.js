import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  useWindowDimensions,
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
import { api as supabase, rpc } from "../services/api";
import { C, s, state, date, JOURNEY_IMAGE } from "../theme";
import { DRIVER } from "../runtime";
import { Button, Field, Card, ErrorBox, Empty } from "../components";
import domain from "../../../../packages/domain.cjs";
const { ACTIVE, money } = domain;
import BrandLogo from "../BrandLogo";
import * as WebBrowser from "expo-web-browser";
import { apiRequest, API_BASE_URL } from "../services/api";
function Authentication() {
  const { width } = useWindowDimensions();
  const [capabilities, setCapabilities] = useState({}),
    [method, setMethod] = useState("email");
  useEffect(() => {
    apiRequest("/api/v1/capabilities")
      .then(setCapabilities)
      .catch(() => {});
  }, []);
  async function google() {
    setBusy(true);
    setError("");
    try {
      const redirectTo = DRIVER
        ? "hyzzdriver://auth/callback"
        : "hyzzcustomer://auth/callback";
      const verifier = (Crypto.randomUUID() + Crypto.randomUUID()).replace(
        /-/g,
        "",
      );
      const challenge = (
        await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          verifier,
          { encoding: Crypto.CryptoEncoding.BASE64 },
        )
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const query = new URLSearchParams({
        provider: "google",
        redirect_to: redirectTo,
        code_challenge: challenge,
        code_challenge_method: "s256",
      });
      const result = await WebBrowser.openAuthSessionAsync(
        API_BASE_URL + "/api/v1/auth/authorize?" + query,
        redirectTo,
      );
      if (result.type === "success") {
        const callback = new URL(result.url);
        if (!result.url.startsWith(redirectTo))
          throw new Error("Unexpected sign-in callback.");
        const code = callback.searchParams.get("code");
        if (!code)
          throw new Error("Google sign-in could not finish. Please retry.");
        const session = await apiRequest("/api/v1/auth/token?grant_type=pkce", {
          auth_code: code,
          code_verifier: verifier,
        });
        const exchange = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        if (exchange.error) throw exchange.error;
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  // Match the 1536 x 1024 artwork, including on the capped tablet layout.
  const illustrationHeight = Math.min(220, (Math.min(width, 560) - 52) / 1.5);
  const [email, setEmail] = useState(""),
    [token, setToken] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [wait, setWait] = useState(0);
  useEffect(() => {
    if (!wait) return;
    const id = setTimeout(() => setWait((v) => v - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);
  async function send() {
    setError("");
    setBusy(true);
    try {
      if (
        method === "email" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      )
        throw new Error("Enter a valid email address.");
      const { error: e } = await supabase.auth.signInWithOtp({
        ...(method === "email"
          ? { email: email.trim().toLowerCase() }
          : { phone: email.trim() }),
        options: { shouldCreateUser: true },
      });
      if (e) throw e;
      setSent(true);
      setWait(60);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      if (!/^\d{6,10}$/.test(token.trim()))
        throw new Error("Enter the code from your email.");
      const { error: e } = await supabase.auth.verifyOtp({
        ...(method === "email"
          ? { email: email.trim().toLowerCase() }
          : { phone: email.trim() }),
        type: method === "email" ? "email" : "sms",
        token: token.trim(),
      });
      if (e) throw e;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={s.auth}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.brand}>
          <BrandLogo inverse />
        </View>
        <View style={s.pill}>
          <Text style={s.pillText}>
            {DRIVER ? "DRIVER PARTNER" : "YOUR CAR. OUR DRIVER."}
          </Text>
        </View>
        <Text style={s.hero}>
          {DRIVER
            ? "Your next drive\nstarts here."
            : "Go anywhere.\nLeave the driving\nto us."}
        </Text>
        <Text style={s.body}>
          {DRIVER
            ? "Sign up or sign in with your email. New drivers submit documents for approval."
            : "Book a professional driver for your own car. A smoother journey starts with Hyzz."}
        </Text>
        {!sent && (
          <Image
            source={JOURNEY_IMAGE}
            accessibilityLabel="Illustration of a Hyzz chauffeur beside a customer-owned car"
            style={{ width: "100%", height: illustrationHeight }}
            resizeMode="contain"
          />
        )}
        <Card title={sent ? "Check your inbox" : "Welcome to Hyzz"}>
          {!sent ? (
            <>
              {capabilities.phone && (
                <Button
                  title={
                    method === "email" ? "Use mobile OTP" : "Use email OTP"
                  }
                  secondary
                  onPress={() => {
                    setMethod(method === "email" ? "phone" : "email");
                    setEmail("");
                  }}
                />
              )}
              <Text style={s.link}>Email OTP · passwordless sign-in</Text>
              <Field
                label={
                  method === "email"
                    ? "Email address"
                    : "Mobile number with country code"
                }
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                placeholder="you@example.com"
              />
              <Text style={s.small}>
                {DRIVER
                  ? "New drivers can sign up. Document approval is required before accepting trips."
                  : "We’ll send a sign-in code. No password needed."}
              </Text>
              {capabilities.google && Platform.OS !== "web" && (
                <Button
                  title="Continue with Google"
                  secondary
                  busy={busy}
                  onPress={google}
                />
              )}
              <Button
                title="Send verification code"
                onPress={send}
                busy={busy}
                icon="arrow-forward"
              />
            </>
          ) : (
            <>
              <Text style={s.body}>Enter the code sent to {email}.</Text>
              <Field
                label="Verification code"
                value={token}
                onChangeText={setToken}
                keyboardType="number-pad"
                maxLength={10}
                autoComplete="one-time-code"
              />
              <Button title="Verify & continue" onPress={verify} busy={busy} />
              <Button
                title={wait ? `Resend in ${wait}s` : "Resend code"}
                secondary
                disabled={wait > 0}
                onPress={send}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSent(false);
                  setToken("");
                }}
              >
                <Text style={s.link}>Use another email</Text>
              </Pressable>
            </>
          )}
          <ErrorBox text={error} />
        </Card>
        <Text style={s.small}>
          Email OTP is enabled for this release. Mobile OTP requires an SMS
          provider. Location is requested only when needed.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export default Authentication;
