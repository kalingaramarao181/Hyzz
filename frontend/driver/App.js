import React from "react";
import MobileApp from "../shared/mobile/MobileApp";
import DriverShell from "./src/DriverShell";
import LoginScreen from "./src/screens/LoginScreen";
export default function DriverApp() {
  return <MobileApp SignedInScreen={DriverShell} LoginScreen={LoginScreen} />;
}
