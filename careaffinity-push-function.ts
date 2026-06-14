// ============================================================
//  careaffinity — Edge Function "push"
//  Envoie une notification push à chaque INSERT (demandes / intervenants).
//  Déclenchée par un Database Webhook.
// ============================================================
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contact@careaffinity.fr";
const SECRET        = Deno.env.get("WEBHOOK_SECRET") ?? "";

// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement
const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  if (SECRET && req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const { table, record } = await req.json();
    let title = "careaffinity", body = "Nouvelle activité";
    if (table === "demandes") {
      title = "🟢 Nouvelle demande";
      body = `${record.type === "enfants" ? "Garde d'enfants" : "Aide à un proche"} · ${record.commune ?? ""} · ${record.prenom ?? ""}`;
    } else if (table === "intervenants") {
      title = "👤 Nouvel intervenant";
      body = `${record.nom ?? ""} · ${record.zone ?? ""}`;
    }
    const payload = JSON.stringify({ title, body, url: "admin.html" });

    const { data: subs } = await supa.from("push_subscriptions").select("*");
    let ok = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(s.subscription, payload);
        ok++;
      } catch (e) {
        // abonnement expiré -> on le supprime
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await supa.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        } else {
          console.error("push error", e?.statusCode, e?.body);
        }
      }
    }
    return new Response(JSON.stringify({ sent: ok }), { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
