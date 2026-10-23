import React from "react";
import Constants from "expo-constants";
import CustomerApp from "./frontend/customer/App";
import DriverApp from "./frontend/driver/App";
export default function App() {
  return Constants.expoConfig?.extra?.appVariant === "driver" ? (
    <DriverApp />
  ) : (
    <CustomerApp />
  );
}
