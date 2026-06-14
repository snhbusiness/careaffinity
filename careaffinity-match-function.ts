// ============================================================
//  careaffinity — Edge Function "match" (matching IA)
//  Reçoit une demande, classe les intervenants VALIDÉS via le modèle.
//  Ne renvoie jamais les coordonnées (téléphone/email).
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = Deno.env.get("MATCH_MODEL") ?? "claude-3-5-haiku-latest";

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // 1) Qui appelle ?
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await supa.auth.getUser(token);
    if (!user) return json({ error: "non connecté" }, 401);
    const { data: prof } = await supa.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = prof?.role || "famille";

    // 2) Récupérer le besoin (demande)
    const { demande_id, besoin } = await req.json().catch(() => ({}));
    let demande: any = null;
    if (demande_id) {
      const { data } = await supa.from("demandes").select("*").eq("id", demande_id).maybeSingle();
      demande = data;
      if (!demande) return json({ error: "demande introuvable" }, 404);
      // une famille ne peut matcher que SA demande
      if (role !== "admin" && demande.famille_user_id !== user.id) return json({ error: "accès refusé" }, 403);
    }

    // 3) Intervenants validés
    const { data: interv } = await supa.from("intervenants")
      .select("id,nom,zone,services,specialites,experience,disponibilites,casier_ok")
      .eq("statut", "valide");
    const pool = interv || [];
    if (!pool.length) return json({ matches: [] });

    // 4) Construire le prompt
    const need = demande
      ? `Type d'aide: ${demande.type === "enfants" ? "garde d'enfants" : "aide à un proche âgé/handicap"}. Commune: ${demande.commune || "?"}. ${demande.urgent ? "URGENT." : ""}`
      : (besoin || "Besoin non précisé");
    const liste = pool.map((i) => ({
      id: i.id, nom: i.nom, zone: i.zone, services: i.services,
      specialites: i.specialites, experience: i.experience, dispos: i.disponibilites,
    }));

    const prompt = `Tu es l'assistant de mise en relation de careaffinity (aide à domicile, Dijon).
Besoin de la famille : ${need}

Intervenants validés disponibles (JSON) :
${JSON.stringify(liste)}

Choisis les intervenants les plus adaptés à ce besoin (zone proche de la commune, services correspondants, spécialités utiles, disponibilités). 
Réponds UNIQUEMENT en JSON valide, sans texte autour, au format :
{"matches":[{"id":"<id>","score":<0-100>,"raison":"<une phrase courte en français>"}]}
Trie du plus adapté au moins adapté, maximum 5, n'inclus que les pertinents.`;

    // 5) Appel au modèle
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { console.error("anthropic", await r.text()); return json({ error: "modèle indisponible" }, 502); }
    const out = await r.json();
    const txt = (out.content || []).map((b: any) => b.text || "").join("").replace(/```json|```/g, "").trim();

    let parsed: any = { matches: [] };
    try { parsed = JSON.parse(txt); } catch { parsed = { matches: [] }; }

    // 6) Réassocier les champs sûrs (jamais de téléphone/email)
    const byId: Record<string, any> = {};
    for (const i of pool) byId[i.id] = i;
    const matches = (parsed.matches || []).map((m: any) => {
      const i = byId[m.id]; if (!i) return null;
      return { nom: i.nom, zone: i.zone, specialites: i.specialites, experience: i.experience,
               casier_ok: i.casier_ok, score: m.score, raison: m.raison };
    }).filter(Boolean);

    return json({ matches });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
