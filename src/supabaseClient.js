import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://wslymzcbbevnoybbsbgq.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzbHltemNiYmV2bm95YmJzYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMDE0OTAsImV4cCI6MjA5Mjc3NzQ5MH0.Tj8AtBqQbY_LZnMBi7sLH7obepfhIqZ6-oLfwoD5-8g";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);