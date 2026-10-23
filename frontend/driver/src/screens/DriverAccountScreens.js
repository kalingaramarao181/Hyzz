import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Switch,
  Alert,
  Linking,
  Image,
  Pressable,
} from "react-native";
import { api, rpc } from "../../../shared/mobile/services/api";
import DocumentManager from "../../../shared/mobile/DocumentManager";
import TrackingControl from "../../../shared/mobile/TrackingControl";
import {
  Action,
  Avatar,
  Empty,
  Icon,
  Input,
  Page,
  Panel,
  Row,
  u,
  green,
} from "../ui";
export const labels = {
  en: {
    home: "Home",
    history: "Bookings",
    wallet: "Wallet",
    account: "Account",
    profile: "My Profile",
    earnings: "Earnings",
    support: "Support",
    notifications: "Notifications",
    bank: "Bank details",
    transactions: "Transaction history",
    payouts: "Payout history",
    documents: "Documents",
    settings: "Settings",
    language: "Language",
    privacy: "Privacy policy",
    terms: "Terms & conditions",
    ticket: "Support request",
    feedback: "App feedback",
    help: "Help & FAQs",
    emergency: "Emergency contact",
  },
  te: {
    home: "\u0c39\u0c4b\u0c2e\u0c4d",
    history: "\u0c2c\u0c41\u0c15\u0c3f\u0c02\u0c17\u0c4d\u0c38\u0c4d",
    wallet: "\u0c35\u0c3e\u0c32\u0c46\u0c1f\u0c4d",
    account: "\u0c16\u0c3e\u0c24\u0c3e",
  },
  hi: {
    home: "\u0939\u094b\u092e",
    history: "\u092c\u0941\u0915\u093f\u0902\u0917",
    wallet: "\u0935\u0949\u0932\u0947\u091f",
    account: "\u0916\u093e\u0924\u093e",
  },
};
export function DriverAccount({
  profile,
  prefs,
  onNavigate,
  onToggle,
  onLogout,
}) {
  return (
    <Page>
      <Pressable
        accessibilityRole="button"
        onPress={() => onNavigate("profile")}
      >
        <Panel style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
          <Avatar name={profile.full_name} size={60} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={u.h3}>{profile.full_name || "Your profile"}</Text>
            <Text style={u.small}>
              {profile.phone || "Add a contact number"}
            </Text>
          </View>
          <Icon name="chevron-forward" />
        </Panel>
      </Pressable>
      <View>
        {[
          ["person-outline", "Edit profile", "profile"],
          ["wallet-outline", "Wallet & payouts", "wallet"],
          ["bar-chart-outline", "Earnings", "earnings"],
        ].map(([icon, title, page]) => (
          <Row
            key={page}
            icon={icon}
            title={title}
            onPress={() => onNavigate(page)}
          />
        ))}
        <Row
          icon="notifications-outline"
          title="Notifications"
          onPress={() => onNavigate("notifications")}
          right={
            <Switch
              accessibilityLabel="Booking notifications"
              value={prefs.notifications !== false}
              trackColor={{ false: "#DDE3E8", true: "#0CBC57" }}
              thumbColor="white"
              onValueChange={onToggle}
            />
          }
        />
        <Row
          icon="globe-outline"
          title="Language"
          detail={
            { en: "English", te: "Telugu", hi: "Hindi" }[prefs.language || "en"]
          }
          onPress={() => onNavigate("language")}
        />
        {[
          ["headset-outline", "Help & support", "support"],
          ["lock-closed-outline", "Privacy policy", "privacy"],
          ["document-text-outline", "Terms & conditions", "terms"],
          ["settings-outline", "Settings", "settings"],
        ].map(([icon, title, page]) => (
          <Row
            key={page}
            icon={icon}
            title={title}
            onPress={() => onNavigate(page)}
          />
        ))}
        <Row icon="log-out-outline" title="Logout" danger onPress={onLogout} />
      </View>
    </Page>
  );
}
export function DriverProfile({ profile, summary, run, refresh, onNavigate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.full_name || ""),
    [phone, setPhone] = useState(profile.phone || ""),
    [docs, setDocs] = useState([]),
    [photo, setPhoto] = useState(null);
  useEffect(() => {
    run(async () => {
      const result = await api
        .from("driver_documents")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (result.error) throw result.error;
      setDocs(result.data || []);
      const image = result.data?.find(
        (d) =>
          d.document_type === "profile_photo" &&
          /\.(jpg|jpeg|png)$/i.test(d.storage_path),
      );
      if (image) {
        const signed = await api.storage
          .from("driver-documents")
          .createSignedUrl(image.storage_path, 60);
        if (signed.data) setPhoto(signed.data.signedUrl);
      }
    });
  }, []);
  return (
    <Page>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
        {photo ? (
          <Image
            accessibilityLabel="Your profile photo"
            source={{ uri: photo }}
            style={{ height: 76, width: 76, borderRadius: 38 }}
            onError={() => setPhoto(null)}
          />
        ) : (
          <Avatar name={profile.full_name} size={76} />
        )}
        <View style={{ gap: 5, flex: 1 }}>
          <Text style={u.h2}>{profile.full_name || "Driver partner"}</Text>
          <Text style={u.small}>
            {summary?.rating
              ? "\u2605 " +
                summary.rating +
                " (" +
                summary.rating_count +
                " reviews)"
              : "No ratings yet"}
          </Text>
          <Text style={u.small}>Hyzz Driver Partner</Text>
          <Text style={u.badge}>
            {profile.driver?.online ? "Online" : "Offline"}
          </Text>
        </View>
      </View>
      <View style={u.between}>
        <Text style={u.h3}>Documents</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onNavigate("documents")}
        >
          <Text style={u.link}>View all</Text>
        </Pressable>
      </View>
      <View>
        {[
          ["driving_license", "Driving License", "card-outline"],
          ["identity", "Identity / Aadhaar", "id-card-outline"],
          ["insurance", "Insurance", "shield-checkmark-outline"],
          ["police_verification", "Police Verification", "shield-outline"],
        ].map(([type, title, icon]) => {
          const document =
            docs.find(
              (d) =>
                d.document_type === type &&
                d.status === "approved" &&
                d.expires_on >= new Date().toISOString().slice(0, 10),
            ) || docs.find((d) => d.document_type === type);
          const valid =
            document?.status === "approved" &&
            document.expires_on >= new Date().toISOString().slice(0, 10);
          return (
            <Row
              key={type}
              icon={icon}
              title={title}
              detail={
                valid ? "Verified" : document?.status || "Upload required"
              }
              onPress={() => onNavigate("documents")}
              right={
                <Icon
                  name={valid ? "checkmark-circle" : "chevron-forward"}
                  color={valid ? "#14A624" : "#9CA3AF"}
                />
              }
            />
          );
        })}
      </View>
      <Panel>
        <Text style={u.h3}>Account details</Text>
        {editing ? (
          <>
            <Input label="Full name" value={name} onChangeText={setName} />
            <Input
              label="Contact mobile number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+919876543210"
            />
            <Text style={u.small}>
              Email verifies sign-in. This contact number is not verified by
              email OTP.
            </Text>
            <Action
              title="Save profile"
              onPress={() =>
                run(async () => {
                  await rpc("update_my_profile", {
                    p_name: name,
                    p_phone: phone.trim() || null,
                  });
                  await refresh();
                  setEditing(false);
                  Alert.alert("Profile updated");
                })
              }
            />
            <Action
              title="Cancel profile edit"
              secondary
              onPress={() => {
                setName(profile.full_name || "");
                setPhone(profile.phone || "");
                setEditing(false);
              }}
            />
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit full name"
              onPress={() => setEditing(true)}
              style={u.between}
            >
              <Text style={u.small}>Name</Text>
              <Text style={u.body}>{profile.full_name || "Add name"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit mobile number"
              onPress={() => setEditing(true)}
              style={u.between}
            >
              <Text style={u.small}>Mobile number</Text>
              <Text style={u.body}>{profile.phone || "Add number"}</Text>
            </Pressable>
            <Action
              title="Edit account details"
              secondary
              onPress={() => setEditing(true)}
            />
          </>
        )}
      </Panel>
    </Page>
  );
}
export function DriverDocuments(props) {
  return (
    <Page>
      <DocumentManager {...props} />
    </Page>
  );
}
export function DriverSupport({ onNavigate, prefs }) {
  return (
    <Page>
      <View>
        {[
          ["help-circle-outline", "Help & FAQs", "help"],
          ["chatbox-ellipses-outline", "Raise a support ticket", "ticket"],
          ["notifications-outline", "Report an issue", "issue"],
          ["call-outline", "Emergency contact", "emergency"],
          ["shield-checkmark-outline", "Safety tips", "safety"],
          ["phone-portrait-outline", "App feedback", "feedback"],
          ["lock-closed-outline", "Privacy policy", "privacy"],
          ["document-text-outline", "Terms & policies", "terms"],
        ].map(([icon, title, page]) => (
          <Row
            key={page}
            icon={icon}
            title={title}
            onPress={() => onNavigate(page)}
          />
        ))}
      </View>
      <Panel
        style={{
          backgroundColor: "#EDF7E9",
          borderColor: "#EDF7E9",
          flexDirection: "row",
          alignItems: "center",
          gap: 15,
        }}
      >
        <Icon name="headset" size={38} />
        <View style={{ flex: 1 }}>
          <Text style={u.h3}>Hyzz Support</Text>
          <Text style={u.small}>Send a ticket to our support team</Text>
        </View>
      </Panel>
      <Text style={u.small}>
        Ticket response time depends on staff availability. For urgent danger,
        contact local emergency services directly.
      </Text>
    </Page>
  );
}
export function DriverTicket({ run, topic = "Support" }) {
  const [text, setText] = useState(""),
    [items, setItems] = useState([]);
  async function load() {
    const result = await api
      .from("support_tickets")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (result.error) throw result.error;
    setItems(result.data || []);
  }
  useEffect(() => {
    run(load);
  }, []);
  return (
    <Page>
      <Panel>
        <Text style={u.h3}>{topic}</Text>
        <Input
          label="Tell us how we can help"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={900}
        />
        <Action
          title="Submit support request"
          onPress={() =>
            run(async () => {
              if (text.trim().length < 5)
                throw new Error("Please enter at least five characters.");
              await rpc("submit_support", {
                p_subject: topic + ": " + text.trim(),
              });
              setText("");
              await load();
              Alert.alert(
                "Request submitted",
                "Your request is saved for the support team.",
              );
            })
          }
        />
      </Panel>
      <Text style={u.h3}>Your requests</Text>
      {!items.length && <Empty title="No support requests yet" />}
      {items.map((t) => (
        <Panel key={t.id}>
          <Text style={u.body}>{t.subject}</Text>
          <Text style={u.badge}>{t.status.replaceAll("_", " ")}</Text>
          {t.admin_note && <Text style={u.small}>{t.admin_note}</Text>}
        </Panel>
      ))}
    </Page>
  );
}
export function DriverNotifications({ items, prefs, onToggle, onOpen }) {
  return (
    <Page>
      <Row
        icon="notifications-outline"
        title="Trip notifications"
        right={
          <Switch
            accessibilityLabel="Trip notification preference"
            value={prefs.notifications !== false}
            onValueChange={onToggle}
            trackColor={{ false: "#DDE3E8", true: "#0CBC57" }}
            thumbColor="white"
          />
        }
      />
      {!items.length && (
        <Empty
          title="You're all caught up"
          text="Booking and account updates appear here."
        />
      )}
      {items.map((n) => (
        <Row
          key={n.id}
          icon="notifications-outline"
          title={n.title}
          detail={new Date(n.created_at).toLocaleString("en-IN")}
          onPress={n.booking_id ? () => onOpen(n.booking_id) : undefined}
        />
      ))}
      <Text style={u.small}>
        In-app updates appear here. Background alerts depend on your phone
        permissions and service availability.
      </Text>
    </Page>
  );
}
export function DriverSettings({ bookings, run, prefs, onNavigate, onToggle }) {
  return (
    <Page>
      <TrackingControl bookings={bookings} run={run} />
      <Row
        icon="notifications-outline"
        title="Notifications"
        onPress={() => onNavigate("notifications")}
      />
      <Row
        icon="globe-outline"
        title="Language"
        onPress={() => onNavigate("language")}
      />
      <Row
        icon="call-outline"
        title="Emergency contact"
        onPress={() => onNavigate("emergency")}
      />
      <Row
        icon="document-text-outline"
        title="Driver documents"
        onPress={() => onNavigate("documents")}
      />
    </Page>
  );
}
export function DriverLanguage({ prefs, savePrefs }) {
  return (
    <Page>
      <Text style={u.small}>
        Choose the language for the main navigation. Addresses, documents and
        detailed service information retain their original language.
      </Text>
      {[
        ["en", "English"],
        ["te", "Telugu"],
        ["hi", "Hindi"],
      ].map(([id, name]) => (
        <Row
          key={id}
          icon="globe-outline"
          title={name}
          onPress={() => savePrefs({ language: id })}
          right={
            <Icon
              name={
                prefs.language === id ? "radio-button-on" : "radio-button-off"
              }
            />
          }
        />
      ))}
    </Page>
  );
}
export function DriverEmergency({ prefs, savePrefs, run }) {
  const [phone, setPhone] = useState(prefs.emergency_phone || "");
  return (
    <Page>
      <Panel>
        <Text style={u.h3}>Your emergency contact</Text>
        <Text style={u.small}>
          Save someone you trust, including the country code. This number is not
          an emergency dispatch service.
        </Text>
        <Input
          label="Emergency contact mobile"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+919876543210"
        />
        <Action
          title="Save emergency contact"
          onPress={() => savePrefs({ emergency_phone: phone.trim() || null })}
        />
        {prefs.emergency_phone && (
          <Action
            title="Call emergency contact"
            secondary
            icon="call"
            onPress={() =>
              run(() => Linking.openURL("tel:" + prefs.emergency_phone))
            }
          />
        )}
      </Panel>
    </Page>
  );
}
const information = {
  help: [
    [
      "How do I receive rides?",
      "Complete document verification, enable location, and go online from Home. Eligible nearby requests appear with an expiry timer.",
    ],
    [
      "How do trips start?",
      "Accept a request, navigate to pickup, mark arrival, verify the customer pickup OTP, then start the trip.",
    ],
    [
      "How do earnings and payouts work?",
      "Trip cash stays with you. Wallet separately shows platform credits owed to you. Finance reviews payout requests and records actual external transfer references.",
    ],
    [
      "Why is tracking delayed?",
      "Allow location all the time, enable GPS and internet, and check battery restrictions. A force-stopped app cannot reliably keep sharing location.",
    ],
  ],
  safety: [
    [
      "Before the trip",
      "Review customer and vehicle details. Confirm that the vehicle is suitable and legal to drive. Verify the customer pickup OTP in person.",
    ],
    [
      "While driving",
      "Do not type or interact with the phone while driving. Pull over safely for calls, messages or trip controls. External Maps provides navigation.",
    ],
    [
      "If you need urgent help",
      "Use your saved emergency contact or local emergency services. Recording a Hyzz incident does not dispatch emergency services.",
    ],
  ],
  privacy: [
    [
      "Location",
      "During an assigned trip your latest location is shared with the customer and authorized operations, including while locked if Android permission allows it. Active trip points are removed when the booking ends or changes driver.",
    ],
    [
      "Documents and bank details",
      "Documents are private and reviewed by authorized staff. Bank account numbers are encrypted on the Node backend. Authorized finance staff can reveal a submitted payout destination, which is audited.",
    ],
    [
      "Messages and records",
      "Trip participants and authorized operations can view trip messages. Financial, support and audit records are retained for service administration. Contact support for access or deletion requests; deletion is subject to retention review.",
    ],
  ],
  terms: [
    [
      "Driver service",
      "Hyzz arranges a driver for a customer-owned car. Driver approval requires review of current required documents; a badge is not a guarantee of safety.",
    ],
    [
      "Fare and cash",
      "The server calculates disclosed estimates and final trip fares. The customer pays cash to the driver, and both confirm it. Commission is settled separately with finance.",
    ],
    [
      "Payouts and support",
      "Submitting a payout request does not move money. Finance records an actual external transfer only after making it. Support tickets do not guarantee immediate assistance. This pilot service information must be reviewed by the service owner before public release.",
    ],
  ],
};
export function DriverInformation({ topic }) {
  return (
    <Page>
      {(information[topic] || information.help).map(([title, text]) => (
        <Panel key={title}>
          <Text style={u.h3}>{title}</Text>
          <Text style={u.body}>{text}</Text>
        </Panel>
      ))}
    </Page>
  );
}
