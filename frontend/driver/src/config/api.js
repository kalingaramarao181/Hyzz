import { DEFAULT_API_BASE_URL } from "../../../shared/config";
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_DRIVER_API_URL || DEFAULT_API_BASE_URL;
