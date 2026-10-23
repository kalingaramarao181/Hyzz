import "react-native-url-polyfill/auto";
import { Platform } from "react-native";
import { processLock } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { createHyzzClient, action } from "../../api/client";
import { API_BASE_URL as customerURL } from "../../../customer/src/config/api";
import { API_BASE_URL as driverURL } from "../../../driver/src/config/api";
import { DRIVER } from "../runtime";
const storage = {
  async getItem(key) {
    const manifest = await SecureStore.getItemAsync(`${key}.manifest`);
    if (!manifest) return null;
    const { id, count } = JSON.parse(manifest);
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.${id}.${i}`),
      ),
    );
    return parts.some((p) => p === null) ? null : parts.join("");
  },
  async setItem(key, value) {
    const previous = await SecureStore.getItemAsync(`${key}.manifest`);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const count = Math.ceil(value.length / 1500);
    for (let i = 0; i < count; i++)
      await SecureStore.setItemAsync(
        `${key}.${id}.${i}`,
        value.slice(i * 1500, (i + 1) * 1500),
      );
    await SecureStore.setItemAsync(
      `${key}.manifest`,
      JSON.stringify({ id, count }),
    );
    if (previous) {
      const old = JSON.parse(previous);
      for (let i = 0; i < old.count; i++)
        await SecureStore.deleteItemAsync(`${key}.${old.id}.${i}`);
    }
  },
  async removeItem(key) {
    const raw = await SecureStore.getItemAsync(`${key}.manifest`);
    await SecureStore.deleteItemAsync(`${key}.manifest`);
    if (raw) {
      const old = JSON.parse(raw);
      for (let i = 0; i < old.count; i++)
        await SecureStore.deleteItemAsync(`${key}.${old.id}.${i}`);
    }
  },
};

const memory = new Map();
const webStorage = {
  getItem: async (k) => memory.get(k) || null,
  setItem: async (k, v) => {
    memory.set(k, v);
  },
  removeItem: async (k) => {
    memory.delete(k);
  },
};
export const api = createHyzzClient({
  baseURL: DRIVER ? driverURL : customerURL,
  auth: {
    storage: Platform.OS === "web" ? webStorage : storage,
    autoRefreshToken: true,
    persistSession: Platform.OS !== "web",
    lock: processLock,
  },
});
export const rpc = (name, params = {}) => action(api, name, params);

export const API_BASE_URL = DRIVER ? driverURL : customerURL;
export async function apiRequest(path, body) {
  const {
    data: { session },
  } = await api.auth.getSession();
  const response = await fetch(API_BASE_URL + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: "Bearer " + session.access_token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message || "Hyzz request failed. Please retry.");
  return result;
}
