import React, { useEffect, useState } from "react";
import { Text, View, Alert } from "react-native";
import { rpc } from "./services/api";
import { uploadPrivateDocument } from "./DocumentManager";
import { Card, Field, Button } from "./components";
import { s } from "./theme";
export default function CustomerCars({ profile, run }) {
  const [cars, setCars] = useState([]),
    [brand, setBrand] = useState(""),
    [model, setModel] = useState(""),
    [registration, setRegistration] = useState(""),
    [year, setYear] = useState(String(new Date().getFullYear())),
    [color, setColor] = useState("");
  async function load() {
    setCars(await rpc("my_vehicles"));
  }
  useEffect(() => {
    run(load);
  }, [run]);
  return (
    <Card title="My cars (optional)">
      <Text style={s.body}>
        You can book a driver without uploading car documents. Save your car
        here to include it with future bookings.
      </Text>
      {cars.map((car) => (
        <View key={car.id} style={{ gap: 10, paddingVertical: 12 }}>
          <Text style={s.h3}>
            {car.brand} {car.model}
          </Text>
          <Text style={s.small}>
            {car.registration} · {car.year} · {car.color}
          </Text>
          {(car.documents || []).map((d) => (
            <Text key={d.id} style={s.small}>
              {d.document_type}: {d.status}
              {d.review_note ? " · " + d.review_note : ""}
            </Text>
          ))}
          {[
            ["registration", "RC"],
            ["insurance", "Insurance"],
            ["puc", "PUC"],
            ["photo", "Car photo"],
          ].map(([type, label]) => (
            <Button
              key={type}
              title={"Upload " + label + " (optional)"}
              secondary
              onPress={() =>
                run(async () => {
                  const path = await uploadPrivateDocument(
                    "customer-vehicles",
                    profile.id,
                  );
                  if (path) {
                    await rpc("register_vehicle_document", {
                      p_vehicle: car.id,
                      p_type: type,
                      p_path: path,
                    });
                    await load();
                    Alert.alert(
                      "Saved",
                      "Your optional car document is stored privately.",
                    );
                  }
                })
              }
            />
          ))}
        </View>
      ))}
      <Field label="Car brand" value={brand} onChangeText={setBrand} />
      <Field label="Model" value={model} onChangeText={setModel} />
      <Field
        label="Registration number"
        value={registration}
        onChangeText={setRegistration}
        autoCapitalize="characters"
      />
      <Field
        label="Year"
        value={year}
        onChangeText={setYear}
        keyboardType="number-pad"
      />
      <Field label="Color" value={color} onChangeText={setColor} />
      <Button
        title="Save car"
        onPress={() =>
          run(async () => {
            await rpc("save_vehicle", {
              p_brand: brand,
              p_model: model,
              p_registration: registration,
              p_year: Number(year),
              p_color: color,
            });
            await load();
            setRegistration("");
          })
        }
      />
    </Card>
  );
}
