// Groopa Telegram webhook Edge Function
// Receives POST from Telegram when a user opens the bot and presses Start.
// Links the Telegram chat to a pending telegram_connections row using the start token.

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

/** Safely parse Telegram update payload. Returns null if invalid or missing message. */
function parseTelegramUpdate(body: string): {
  text: string;
  chatId: number;
  username: string | null;
} | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const update = data as Record<string, unknown>;
  const message = update?.message;
  if (!message || typeof message !== "object") return null;
  const msg = message as Record<string, unknown>;
  const text = msg?.text;
  if (typeof text !== "string") return null;
  const chat = msg?.chat;
  if (!chat || typeof chat !== "object") return null;
  const chatObj = chat as Record<string, unknown>;
  const chatId = chatObj?.id;
  if (typeof chatId !== "number") return null;
  const from = msg?.from;
  const username =
    from && typeof from === "object" && typeof (from as Record<string, unknown>)?.username === "string"
      ? (from as Record<string, unknown>).username as string
      : null;
  return { text: text.trim(), chatId, username };
}

/** Extract token from /start command. E.g. "/start" -> null, "/start abc123" -> "abc123". */
function extractStartToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/start")) return null;
  const rest = trimmed.slice(6).trim();
  return rest.length > 0 ? rest : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid body" }, 400);
  }

  const parsed = parseTelegramUpdate(body);
  if (!parsed) {
    return jsonResponse({ ok: true, handled: false }, 200);
  }

  const token = extractStartToken(parsed.text);
  if (!token) {
    return jsonResponse({ ok: true, handled: false }, 200);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Server configuration error" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date().toISOString();

  const { data: rows, error: selectError } = await supabase
    .from("telegram_connections")
    .select("id")
    .eq("connection_token", token)
    .gt("connection_token_expires_at", now)
    .limit(1);

  if (selectError || !rows?.length) {
    return jsonResponse({ ok: true, handled: false }, 200);
  }

  const row = rows[0];
  const { error: updateError } = await supabase
    .from("telegram_connections")
    .update({
      telegram_chat_id: String(parsed.chatId),
      telegram_username: parsed.username,
      status: "connected",
      connected_at: now,
      connection_token: null,
      connection_token_expires_at: null,
    })
    .eq("id", row.id);

  if (updateError) {
    return jsonResponse({ ok: false, error: "Update failed" }, 500);
  }

  return jsonResponse({ ok: true, handled: true }, 200);
});
