import React, { useEffect, useState } from "react";
import { View, Text, Platform, Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import { api, rpc } from "./services/api";
import { Button, Card, Field } from "./components";
import { s } from "./theme";
export async function uploadPrivateDocument(bucket, userId) {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/jpeg", "image/png"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const file = result.assets[0];
  if (file.size && file.size > 4194304)
    throw new Error("Choose a PDF, JPEG or PNG under 4 MiB.");
  const extension = /\.png$/i.test(file.name)
    ? "png"
    : /\.jpe?g$/i.test(file.name)
      ? "jpg"
      : "pdf";
  const mime =
    file.mimeType ||
    { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" }[extension];
  const path = userId + "/" + Crypto.randomUUID() + "." + extension;
  const body =
    Platform.OS === "web"
      ? file.file || (await (await fetch(file.uri)).blob())
      : { uri: file.uri, name: file.name, type: mime };
  const uploaded = await api.storage
    .from(bucket)
    .upload(path, body, { contentType: mime, upsert: false });
  if (uploaded.error) throw uploaded.error;
  return path;
}
export default function DocumentManager({ profile, run, refresh }) {
  const [docs, setDocs] = useState([]),
    [expires, setExpires] = useState(
      new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    ),
    [busy, setBusy] = useState("");
  async function load() {
    const result = await api
      .from("driver_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (result.error) throw result.error;
    setDocs(result.data || []);
  }
  useEffect(() => {
    run(load);
  }, [run]);
  async function upload(type) {
    setBusy(type);
    try {
      await run(async () => {
        const path = await uploadPrivateDocument(
          "driver-documents",
          profile.id,
        );
        if (!path) return;
        await rpc("register_document", {
          p_driver: profile.id,
          p_type: type,
          p_path: path,
          p_expires: expires,
        });
        await load();
        await refresh();
        Alert.alert(
          "Document submitted",
          "Hyzz administrators will review it. You can go online after all required documents are approved.",
        );
      });
    } finally {
      setBusy("");
    }
  }
  return (
    <Card title="Your documents">
      <Text style={s.body}>
        License, identity, insurance and police verification need administrator
        approval. Clear PDF/JPEG/PNG files, maximum 4 MiB each.
      </Text>
      <Field
        label="Document expiry (YYYY-MM-DD)"
        value={expires}
        onChangeText={setExpires}
      />
      {[
        ["driving_license", "Driving license"],
        ["identity", "Identity document"],
        ["insurance", "Insurance"],
        ["police_verification", "Police verification"],
        ["profile_photo", "Profile photo (optional)"],
      ].map(([type, label]) => {
        const current = docs.filter((d) => d.document_type === type);
        return (
          <View key={type} style={{ gap: 8 }}>
            <Text style={s.label}>{label}</Text>
            {current.map((d) => (
              <Text key={d.id} style={s.small}>
                {d.status} · expires {d.expires_on}
                {d.rejection_reason ? " · " + d.rejection_reason : ""}
              </Text>
            ))}
            <Button
              title={
                current.length
                  ? "Upload updated " + label.toLowerCase()
                  : "Upload " + label.toLowerCase()
              }
              secondary
              busy={busy === type}
              disabled={!!busy}
              onPress={() => upload(type)}
            />
          </View>
        );
      })}
      <Text style={s.small}>
        A replacement goes back into review. Keep original documents ready for
        the verification team.
      </Text>
    </Card>
  );
}
