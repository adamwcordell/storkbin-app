import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const trim = (v: unknown) => String(v ?? "").trim();

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    const userId = userData?.user?.id;
    if (userErr || !userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const row = {
      id: userId,
      full_name: trim(body.full_name),
      email: trim(body.email),
      address_line1: trim(body.address_line1),
      address_line2: trim(body.address_line2),
      city: trim(body.city),
      state: trim(body.state).toUpperCase(),
      zip: trim(body.zip),
    };

    if (!row.address_line1 || !row.city || !row.state || !row.zip) {
      return jsonResponse({ error: "address_line1, city, state, and zip are required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: profile, error } = await admin
      .from("profiles")
      .upsert(row, { onConflict: "id" })
      .select("full_name,email,address_line1,address_line2,city,state,zip")
      .single();

    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    return jsonResponse({ ok: true, profile: profile || null });
  } catch (error) {
    console.error(error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
