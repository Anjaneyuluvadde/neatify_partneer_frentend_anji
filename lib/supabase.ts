import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "https://gdhtydiycsgxcxestwin.supabase.co";

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkaHR5ZGl5Y3NneGN4ZXN0d2luIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTQyMDUsImV4cCI6MjA4ODM3MDIwNX0.nbMCxiA4z35d3Mf7jjQ2PygmRZdIfDuweC3inm0sRC0";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
