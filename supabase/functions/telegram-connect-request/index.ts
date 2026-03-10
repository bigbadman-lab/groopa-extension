// Groopa Telegram connect-request Edge Function
// Called by the extension when the user clicks "Connect Telegram".
// Requires an authenticated Supabase user; returns a one-time deep link to the Telegram bot.

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

/** Generate a secure random token (hex, URL-safe for Telegram start param). */
function generateConnectionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

  const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME");
  if (!botUsername || !String(botUsername).trim()) {
    return jsonResponse({ ok: false, error: "Telegram bot not configured" }, 500);
  }

  const token = generateConnectionToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: existing } = await supabase
    .from("telegram_connections")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("telegram_connections")
      .update({
        status: "pending",
        connection_token: token,
        connection_token_expires_at: expiresAt,
      })
      .eq("id", existing.id);

    if (updateError) {
      return jsonResponse({ ok: false, error: "Database error" }, 500);
    }
  } else {
    const { error: insertError } = await supabase.from("telegram_connections").insert({
      user_id: user.id,
      status: "pending",
      connection_token: token,
      connection_token_expires_at: expiresAt,
    });

    if (insertError) {
      return jsonResponse({ ok: false, error: "Database error" }, 500);
    }
  }

  const bot = String(botUsername).trim().replace(/^@/, "");
  const connectUrl = `https://t.me/${bot}?start=${token}`;

  return jsonResponse({ ok: true, connectUrl }, 200);
});
