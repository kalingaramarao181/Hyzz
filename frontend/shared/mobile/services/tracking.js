import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";
import { rpc } from "./api";
const TASK = "hyzz-trip-location-v1",
  KEY = "hyzz.active.tracking";
let foreground,
  activeId,
  queue = Promise.resolve();
const validStates = [
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "OTP_VERIFIED",
  "IN_PROGRESS",
];
async function publish(id, position) {
  const c = position.coords;
  return rpc("update_trip_location", {
    p_booking: id,
    p_lat: c.latitude,
    p_lng: c.longitude,
    p_recorded_at: new Date(position.timestamp || Date.now()).toISOString(),
    p_accuracy:
      Number.isFinite(c.accuracy) && c.accuracy >= 0 ? c.accuracy : null,
    p_heading: Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null,
    p_speed: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
  });
}
if (Platform.OS !== "web" && !TaskManager.isTaskDefined(TASK))
  TaskManager.defineTask(TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const id = await SecureStore.getItemAsync(KEY);
    if (!id) return;
    try {
      await publish(id, data.locations[data.locations.length - 1]);
    } catch (e) {
      if (
        /not active|not assigned|no longer eligible|Sign in with|Session expired|active Hyzz account/i.test(
          e.message || "",
        )
      )
        await stopTracking();
    }
  });
export async function requestTrackingPermission() {
  if (Platform.OS === "web")
    return (
      (await Location.requestForegroundPermissionsAsync()).status === "granted"
    );
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") return false;
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === "granted";
}
async function start(id) {
  if (activeId === id) return;
  await stopTracking();
  if (!id) return;
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted") return;
  activeId = id;
  if (Platform.OS === "web") {
    // Expo SDK 54's web event subscription cannot remove a native-style listener.
    // Use the browser watcher directly so ending a preview trip clears GPS cleanly.
    const browserLocation = globalThis.navigator?.geolocation;
    if (!browserLocation)
      throw new Error("Location is unavailable in this browser.");
    const watcher = browserLocation.watchPosition(
      (p) => publish(id, p).catch(() => {}),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    foreground = { remove: () => browserLocation.clearWatch(watcher) };
    return;
  }
  await SecureStore.setItemAsync(KEY, id);
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.status === "granted")
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,
      distanceInterval: 5,
      deferredUpdatesInterval: 5000,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: "Hyzz live trip tracking",
        notificationBody:
          "Sharing your trip location with your customer and Hyzz operations.",
        notificationColor: "#14765B",
        killServiceOnDestroy: false,
      },
    });
  else
    foreground = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 5,
      },
      (p) => publish(id, p).catch(() => {}),
    );
  try {
    await publish(
      id,
      await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      }),
    );
  } catch {
    /* A later GPS sample will retry a transient location/network failure. */
  }
}
export function syncTracking(bookings) {
  const id = bookings.find((b) => validStates.includes(b.state))?.id || null;
  queue = queue
    .catch(() => {})
    .then(() =>
      start(id).catch(async (e) => {
        await stopTracking();
        throw e;
      }),
    );
  return queue;
}
export async function stopTracking() {
  activeId = null;
  foreground?.remove();
  foreground = null;
  if (Platform.OS !== "web") {
    await SecureStore.deleteItemAsync(KEY);
    if (await Location.hasStartedLocationUpdatesAsync(TASK))
      await Location.stopLocationUpdatesAsync(TASK);
  }
}
