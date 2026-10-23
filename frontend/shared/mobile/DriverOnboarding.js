import React, { useState } from "react";
import { Text } from "react-native";
import { Card, Field, Button } from "./components";
import { rpc } from "./services/api";
import { s } from "./theme";
export default function DriverOnboarding({ run, refresh }) {
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [experience, setExperience] = useState("0"),
    [languages, setLanguages] = useState("Telugu, English");
  return (
    <Card title="Become a Hyzz driver">
      <Text style={s.body}>
        Create your driver profile, upload your documents, and wait for the Hyzz
        team to approve them before going online.
      </Text>
      <Field label="Full name" value={name} onChangeText={setName} />
      <Field
        label="Contact phone (international format)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+919876543210"
      />
      <Field
        label="Years of driving experience"
        value={experience}
        onChangeText={setExperience}
        keyboardType="number-pad"
      />
      <Field
        label="Languages, separated by commas"
        value={languages}
        onChangeText={setLanguages}
      />
      <Button
        title="Create driver profile"
        onPress={() =>
          run(async () => {
            await rpc("register_driver", {
              p_name: name,
              p_phone: phone.trim() || null,
              p_experience: Number(experience),
              p_languages: languages
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            });
            await refresh();
          })
        }
      />
    </Card>
  );
}
