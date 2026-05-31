import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = "https://wslymzcbbevnoybbsbgq.supabase.co";
export const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzbHltemNiYmV2bm95YmJzYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMDE0OTAsImV4cCI6MjA5Mjc3NzQ5MH0.Tj8AtBqQbY_LZnMBi7sLH7obepfhIqZ6-oLfwoD5-8g";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    /** Email confirmation links include tokens in the URL; this must be true so `/dashboard` can establish a session. */
    detectSessionInUrl: true,
  },
});

/** Use with functions.invoke({ headers }) so Edge Functions with verify_jwt receive the logged-in user. */
export async function supabaseFunctionAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = { apikey: supabaseAnonKey };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}