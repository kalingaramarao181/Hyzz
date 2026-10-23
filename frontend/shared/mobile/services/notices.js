import { Platform, Linking } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { rpc, apiRequest, API_BASE_URL } from "./api";
const KEY = "hyzz.push.token";
let lastOpenedNotice;
if (Platform.OS !== "web")
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
export async function enableNotifications(audience) {
  if (Platform.OS === "web") return { remote: false };
  await Notifications.setNotificationChannelAsync("bookings", {
    name: "Bookings and trip updates",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Notifications are disabled. You can enable them in phone settings.",
    );
  const capabilities = await apiRequest("/api/v1/capabilities");
  if (!capabilities.push) return { remote: false };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!Device.isDevice || !projectId) return { remote: false };
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId }))
      .data;
    await rpc("register_push_device", { p_token: token, p_audience: audience });
    await SecureStore.setItemAsync(KEY, token);
    return { remote: true };
  } catch {
    return { remote: false };
  }
}
export async function disableNotifications() {
  if (Platform.OS === "web") return;
  const token = await SecureStore.getItemAsync(KEY);
  if (token)
    await rpc("unregister_push_device", { p_token: token }).catch(() => {});
  await SecureStore.deleteItemAsync(KEY);
}
export async function presentLocalNotice(item) {
  if (Platform.OS === "web") return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === "granted")
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Hyzz",
        body: item.title,
        data: { bookingId: item.booking_id, releaseId: item.release_id },
        sound: "default",
      },
      trigger: null,
    });
}
export function noticeSubscription(open) {
  if (Platform.OS === "web") return () => {};
  const handle = (e) => {
    if (!e) return;
    const identifier = e.notification.request.identifier;
    if (identifier === lastOpenedNotice) return;
    lastOpenedNotice = identifier;
    const release = e.notification.request.content.data?.releaseId;
    if (typeof release === "string" && /^[a-f0-9-]{36}$/i.test(release)) {
      Linking.openURL(
        API_BASE_URL + "/api/v1/releases/" + release + "/download",
      ).catch(() => {});
      return;
    }
    const id = e.notification.request.content.data?.bookingId;
    if (typeof id === "string") open(id);
  };
  const subscription =
    Notifications.addNotificationResponseReceivedListener(handle);
  Notifications.getLastNotificationResponseAsync()
    .then(handle)
    .catch(() => {});
  return () => subscription.remove();
}
