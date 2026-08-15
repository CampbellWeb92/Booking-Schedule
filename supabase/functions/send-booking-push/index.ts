import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function secretApiKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || Object.values(keys)[0] || "";
  } catch (_) {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = secretApiKey();
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:infocampbellweb@gmail.com";
  const webhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET") || "";

  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate) {
    return jsonResponse({ error: "Push server secrets are incomplete." }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: any = {};
  try { payload = await req.json(); } catch (_) { return jsonResponse({ error: "Invalid JSON" }, 400); }

  let testUserId: string | null = null;
  let appointment: any = null;

  if (payload?.type === "TEST_PUSH") {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return jsonResponse({ error: "Sign in before sending a test push." }, 401);

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user?.email) return jsonResponse({ error: "Invalid session." }, 401);

    const { data: adminRow } = await supabaseAdmin
      .from("schedule_admins")
      .select("email,active")
      .eq("email", userData.user.email.toLowerCase())
      .eq("active", true)
      .maybeSingle();

    if (!adminRow) return jsonResponse({ error: "This account is not an authorised schedule administrator." }, 403);
    testUserId = userData.user.id;
  } else {
    const incomingSecret = req.headers.get("x-push-webhook-secret") || "";
    if (!webhookSecret || incomingSecret !== webhookSecret) {
      return jsonResponse({ error: "Invalid webhook secret." }, 401);
    }

    appointment = payload?.record || null;
    if (!appointment || appointment.kind !== "booking" || appointment.status !== "pending" || appointment.source !== "website") {
      return jsonResponse({ ignored: true });
    }
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let query = supabaseAdmin
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .eq("enabled", true);
  if (testUserId) query = query.eq("user_id", testUserId);

  const { data: subscriptions, error: subscriptionError } = await query;
  if (subscriptionError) return jsonResponse({ error: subscriptionError.message }, 500);
  if (!subscriptions?.length) return jsonResponse({ sent: 0, message: "No registered push devices." });

  const start = appointment ? String(appointment.start_time || "").slice(0, 5).replace(":", "h") : "";
  const notification = testUserId
    ? {
        title: "Massage by Ash — Background Push Test",
        body: "This notification came from the Supabase Edge Function. You can receive future booking alerts after signing out.",
        data: { appointmentId: null, url: "./?pending=1" },
      }
    : {
        title: "New Booking Request",
        body: `${appointment.client_name || "Client"} · ${appointment.day}${start ? ` at ${start}` : ""}${appointment.service ? ` · ${appointment.service}` : ""}`,
        data: { appointmentId: appointment.id || null, url: "./?pending=1" },
      };

  let sent = 0;
  let removed = 0;
  const failures: string[] = [];

  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(notification),
        { TTL: 120, urgency: "high" },
      );
      sent += 1;
    } catch (error: any) {
      const statusCode = Number(error?.statusCode || error?.status || 0);
      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("id", row.id);
        removed += 1;
      } else {
        failures.push(`${statusCode || "error"}: ${error?.message || String(error)}`);
      }
    }
  }

  return jsonResponse({ sent, removed, failures: failures.slice(0, 5) });
});
