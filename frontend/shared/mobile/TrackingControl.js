import React, { useState } from "react";
import { Text, Alert, Platform } from "react-native";
import { Card, Button } from "./components";
import {
  requestTrackingPermission,
  syncTracking,
  stopTracking,
} from "./services/tracking";
import { s } from "./theme";
export default function TrackingControl({ bookings, run }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <Card title="Live trip sharing">
      <Text style={s.body}>
        During an assigned trip, Hyzz shares your location with your customer
        and authorized operations staff. Android shows a tracking notification,
        including while the phone is locked. Sharing stops when the booking
        finishes or is cancelled.
      </Text>
      <Button
        title={enabled ? "Check live tracking" : "Enable live tracking"}
        onPress={() =>
          Alert.alert(
            "Allow trip location sharing",
            "Choose Allow all the time in Android settings when requested. You can stop permissions in phone settings; the customer will see location updates become stale.",
            [
              { text: "Back", style: "cancel" },
              {
                text: "Continue",
                onPress: () =>
                  run(async () => {
                    const allowed = await requestTrackingPermission();
                    if (!allowed)
                      throw new Error(
                        "Allow location access in phone settings to enable live trip tracking.",
                      );
                    await stopTracking();
                    await syncTracking(bookings);
                    setEnabled(true);
                  }),
              },
            ],
          )
        }
      />
      <Text style={s.small}>
        {Platform.OS === "web"
          ? "Browser preview tracks only while open."
          : "Battery restrictions and force-stopping the app can interrupt location delivery. Keep location and internet enabled."}
      </Text>
    </Card>
  );
}
