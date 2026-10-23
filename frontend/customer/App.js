import React from "react";
import MobileApp from "../shared/mobile/MobileApp";
import HomeScreen from "./src/screens/HomeScreen";
import LoginScreen from "./src/screens/LoginScreen";
export default function CustomerApp() {
  return <MobileApp HomeScreen={HomeScreen} LoginScreen={LoginScreen} />;
}
