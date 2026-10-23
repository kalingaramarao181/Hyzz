import React, { useEffect, useState } from "react";
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { API_BASE_URL } from "./services/api";
import { DRIVER } from "./runtime";
const audience = DRIVER ? "driver" : "customer";
export default function AppServices() {
  const [release, setRelease] = useState(null),
    [content, setContent] = useState([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [form, setForm] = useState({ name: "", email: "", message: "" }),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const installed = Constants.expoConfig?.android?.versionCode || 0;
  async function load() {
    const response = await fetch(
      API_BASE_URL + "/api/v1/releases/latest/" + audience,
    );
    if (!response.ok)
      throw Error("Update service is unavailable. Please retry later.");
    setRelease(await response.json());
  }
  useEffect(() => {
    const check = () => {
      if (AppState.currentState === "active") load().catch(() => {});
    };
    check();
    const timer = setInterval(check, 60000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  async function show() {
    setOpen(true);
    setError("");
    try {
      await load();
      const r = await fetch(API_BASE_URL + "/api/v1/public/content");
      if (!r.ok) throw Error("Guides could not be loaded. Please retry.");
      setContent(await r.json());
    } catch (e) {
      setError(e.message);
    }
  }
  const newer = release && release.version_code > installed;
  const phone =
    content.find((c) => c.key === "contact_phone")?.body ?? "+917730020465";
  async function send() {
    setError("");
    setNotice("");
    if (
      form.name.trim().length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ||
      form.message.trim().length < 10 ||
      !consent
    ) {
      setError(
        "Enter your name, valid email, a message of at least 10 characters and agree to contact consent.",
      );
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(API_BASE_URL + "/api/v1/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          email: form.email.trim(),
          topic: audience,
          phone: null,
          consent: true,
          website: "",
        }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.message || "Enquiry could not be sent.");
      setNotice(result.message);
      setForm({ name: "", email: "", message: "" });
      setConsent(false);
    } catch (e) {
      setError(e.message || "Please check your connection.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={
          newer
            ? "Download available Hyzz update"
            : "Help, guides and app updates"
        }
        style={[s.strip, newer && s.new]}
      >
        <Text style={s.stripText}>
          {newer
            ? "↑ Hyzz " + release.version + " is available — view update"
            : "Help, guides & app updates  ↗"}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
          <ScrollView
            contentContainerStyle={s.page}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close help and updates"
              onPress={() => setOpen(false)}
              style={s.close}
            >
              <Text style={s.green}>← Back to Hyzz</Text>
            </Pressable>
            <Text style={s.title}>Hyzz help & updates</Text>
            <Text style={s.body}>
              Installed version {Constants.expoConfig?.version || "development"}{" "}
              · Android code {installed}
            </Text>
            {release && (
              <View style={s.card}>
                <Text style={s.heading}>
                  {newer
                    ? "A new version is ready"
                    : "Latest published release"}{" "}
                  · {release.version}
                </Text>
                <Text style={s.body}>{release.notes}</Text>
                <Text style={s.small}>SHA256: {release.sha256}</Text>
                {newer ? (
                  <Pressable
                    style={s.button}
                    accessibilityRole="link"
                    accessibilityLabel="Download APK update"
                    onPress={() =>
                      Linking.openURL(
                        API_BASE_URL +
                          "/api/v1/releases/" +
                          release.id +
                          "/download",
                      ).catch(() => setError("Cannot open the download."))
                    }
                  >
                    <Text style={s.white}>Download Android update</Text>
                  </Pressable>
                ) : (
                  <Text style={s.body}>
                    No newer published version is available for this
                    installation.
                  </Text>
                )}
                <Text style={s.small}>
                  Your browser downloads the APK. Android asks you to approve
                  installation. Keep the same signing certificate; updates
                  cannot install silently.
                </Text>
              </View>
            )}
            {!release && (
              <Text style={s.body}>
                No published APK update is currently available.
              </Text>
            )}
            {content
              .filter((c) => !c.key.startsWith("contact_"))
              .map((c) => (
                <View key={c.key} style={s.card}>
                  <Text style={s.heading}>{c.title}</Text>
                  <Text style={s.body}>{c.body}</Text>
                </View>
              ))}
            <Text style={s.heading}>Contact the Hyzz team</Text>
            {phone && (
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  Linking.openURL("tel:" + phone).catch(() =>
                    setError("The phone dialer is unavailable."),
                  )
                }
              >
                <Text style={s.green}>{phone}</Text>
              </Pressable>
            )}
            <Text style={s.small}>
              We use your contact details to respond to this enquiry. Response
              times depend on team availability.
            </Text>
            {[
              ["name", "Your name"],
              ["email", "Reply email"],
              ["message", "How can we help?"],
            ].map(([key, label]) => (
              <View key={key}>
                <Text style={s.label}>{label}</Text>
                <TextInput
                  style={[
                    s.input,
                    key === "message" && {
                      height: 100,
                      textAlignVertical: "top",
                    },
                  ]}
                  accessibilityLabel={"Contact " + label}
                  value={form[key]}
                  onChangeText={(value) => setForm({ ...form, [key]: value })}
                  maxLength={
                    key === "message" ? 2000 : key === "name" ? 100 : 254
                  }
                  multiline={key === "message"}
                  keyboardType={key === "email" ? "email-address" : "default"}
                  autoCapitalize={key === "email" ? "none" : "sentences"}
                />
              </View>
            ))}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consent }}
              accessibilityLabel="Consent to contact response"
              onPress={() => setConsent(!consent)}
            >
              <Text style={s.body}>
                {consent ? "☑" : "☐"} I agree Hyzz may use these details to
                respond.
              </Text>
            </Pressable>
            <Pressable
              style={s.button}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Send contact enquiry"
              onPress={send}
            >
              <Text style={s.white}>{busy ? "Sending…" : "Send enquiry"}</Text>
            </Pressable>
            {error && (
              <Text accessibilityRole="alert" style={{ color: "#ab3030" }}>
                {error}
              </Text>
            )}
            {notice && <Text style={s.green}>{notice}</Text>}
            <Pressable accessibilityRole="button" onPress={show}>
              <Text style={s.green}>Refresh guides & updates</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
const s = StyleSheet.create({
  strip: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    backgroundColor: "#edf5ec",
  },
  new: { backgroundColor: "#d6f36d" },
  stripText: { fontSize: 11, color: "#075b42", textAlign: "center" },
  page: { padding: 22, gap: 16 },
  close: { paddingVertical: 8 },
  title: { fontSize: 25, fontWeight: "800", color: "#153d30" },
  heading: { fontSize: 17, fontWeight: "700", color: "#153d30" },
  body: { fontSize: 14, lineHeight: 23, color: "#5e7167" },
  small: { fontSize: 11, lineHeight: 18, color: "#64766a" },
  green: { color: "#006b50", fontWeight: "600" },
  card: { backgroundColor: "#f3f7ef", borderRadius: 16, padding: 18, gap: 12 },
  button: {
    backgroundColor: "#006b50",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  white: { color: "#fff", fontWeight: "700" },
  label: { fontSize: 13, marginBottom: 8, color: "#163d30" },
  input: {
    borderWidth: 1,
    borderColor: "#d6e1d0",
    borderRadius: 10,
    padding: 12,
    color: "#153d30",
  },
});
