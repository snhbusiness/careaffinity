-- ============================================================
--  careaffinity — Ajout du marqueur "urgent" aux demandes
--  À coller dans Supabase > SQL Editor > Run.
-- ============================================================
alter table public.demandes
  add column if not exists urgent boolean not null default false;
