// Groopa Telegram status Edge Function
// Called by the Chrome extension settings page to show Telegram connection state.
// Requires an authenticated Supabase user.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DISCONNECTED_RESPONSE = {
  ok: true,
  connected: false,
  telegram: {
    status: "disconnected",
    username: null,
    linkedAt: null,
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ ok: false, error: "Server configuration error" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

  if (authError || !user) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const { data: row, error: selectError } = await supabase
    .from("telegram_connections")
    .select("status, telegram_username, connected_at")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (selectError) {
    return jsonResponse({ ok: false, error: "Database error" }, 500);
  }

  if (!row) {
    return jsonResponse(DISCONNECTED_RESPONSE, 200);
  }

  return jsonResponse(
    {
      ok: true,
      connected: row.status === "connected",
      telegram: {
        status: row.status ?? "disconnected",
        username: row.telegram_username ?? null,
        linkedAt: row.connected_at ?? null,
      },
    },
    200
  );
});
