import React from "react";
import { Pressable, Text } from "react-native";
import BookingForm from "./BookingForm";
import { Card } from "../../../shared/mobile/components";
import { s, state } from "../../../shared/mobile/theme";
import domain from "../../../../packages/domain.cjs";
export default function CustomerHome({
  profile,
  run,
  bookings,
  open,
  refresh,
}) {
  return (
    <>
      <Text style={s.h2}>
        Hello{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}{" "}
        👋
      </Text>
      <Text style={s.body}>Where will today take you?</Text>
      {bookings
        .filter((b) => domain.ACTIVE.includes(b.state))
        .map((b) => (
          <Pressable
            accessibilityRole="button"
            key={b.id}
            onPress={() => open(b.id)}
          >
            <Card title="Your current booking">
              <Text style={s.badge}>{state(b.state)}</Text>
              <Text style={s.body}>{b.pickup_address}</Text>
              <Text style={s.link}>View booking →</Text>
            </Card>
          </Pressable>
        ))}
      <BookingForm
        run={run}
        onCreated={(id) => {
          open(id);
          run(refresh);
        }}
      />
    </>
  );
}
