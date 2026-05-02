import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";

import { env } from "./env";

// Supabase JS uses localStorage on web, AsyncStorage on native.
// (Could swap AsyncStorage for expo-secure-store, but the JWT here is short-lived
//  and AsyncStorage is the documented pattern that survives RN reloads.)
const storage = Platform.OS === "web" ? undefined : AsyncStorage;

export const supabase = createClient(
  env.EXPO_PUBLIC_SUPABASE_URL || "http://placeholder.local",
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === "web",
    },
  },
);
