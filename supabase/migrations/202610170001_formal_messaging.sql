begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{2,23}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 60)
);
create table public.contacts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_id),
  check (owner_id <> contact_id)
);
create table public.formal_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  body_formal text not null check (length(btrim(body_formal)) between 1 and 6000),
  client_message_id uuid not null,
  created_at timestamptz not null default now(),
  unique (sender_id, client_message_id),
  check (sender_id <> recipient_id)
);
create index formal_messages_sender_time on public.formal_messages(sender_id, created_at desc);
create index formal_messages_recipient_time on public.formal_messages(recipient_id, created_at desc);

create function public.handle_new_blackmail_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, username, display_name)
  values (new.id, lower(btrim(new.raw_user_meta_data->>'username')), btrim(new.raw_user_meta_data->>'display_name'));
  return new;
end;
$$;
revoke all on function public.handle_new_blackmail_user() from public, anon, authenticated;
create trigger on_blackmail_user_created after insert on auth.users
for each row execute function public.handle_new_blackmail_user();

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.formal_messages enable row level security;

create policy contacts_read_own on public.contacts for select to authenticated using (owner_id = (select auth.uid()));
create policy contacts_add_own on public.contacts for insert to authenticated with check (owner_id = (select auth.uid()) and contact_id <> (select auth.uid()));
create policy messages_read_participant on public.formal_messages for select to authenticated
using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));
-- Definer helper avoids recursive RLS when checking an existing incoming thread.
-- Actor always comes from auth.uid(), never a caller-supplied sender ID.
create function public.can_send_formal_to(p_recipient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.contacts c where c.owner_id = auth.uid() and c.contact_id = p_recipient)
    or exists (select 1 from public.formal_messages m where m.sender_id = p_recipient and m.recipient_id = auth.uid())
  );
$$;
revoke all on function public.can_send_formal_to(uuid) from public, anon;
grant execute on function public.can_send_formal_to(uuid) to authenticated;
create policy messages_send_as_self on public.formal_messages for insert to authenticated
with check (
  sender_id = (select auth.uid()) and recipient_id <> (select auth.uid()) and public.can_send_formal_to(recipient_id)
);
create policy profiles_read_known on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or exists (select 1 from public.contacts c where c.owner_id = (select auth.uid()) and c.contact_id = profiles.id)
  or exists (select 1 from public.formal_messages m where
    (m.sender_id = (select auth.uid()) and m.recipient_id = profiles.id)
    or (m.recipient_id = (select auth.uid()) and m.sender_id = profiles.id))
);
revoke all on public.profiles, public.contacts, public.formal_messages from anon, authenticated;
grant select on public.profiles, public.contacts, public.formal_messages to authenticated;
grant insert on public.contacts, public.formal_messages to authenticated;
-- No update/delete grants: the formal record is append-only for app users.

create function public.add_contact(p_username text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into target from public.profiles where username = lower(btrim(p_username));
  if not found then raise exception 'No user with that username.'; end if;
  if target.id = auth.uid() then raise exception 'Choose someone else as a contact.'; end if;
  insert into public.contacts(owner_id, contact_id) values(auth.uid(), target.id) on conflict do nothing;
  return target;
end;
$$;
create function public.list_contacts() returns setof public.profiles
language sql security invoker set search_path = '' as $$
  select p.* from public.profiles p where p.id in (
    select c.contact_id from public.contacts c where c.owner_id = auth.uid()
    union select m.sender_id from public.formal_messages m where m.recipient_id = auth.uid()
    union select m.recipient_id from public.formal_messages m where m.sender_id = auth.uid()
  ) order by p.display_name, p.username;
$$;
create function public.get_formal_thread(p_contact uuid) returns setof public.formal_messages
language sql security invoker set search_path = '' as $$
  select recent.* from (
    select m.* from public.formal_messages m where
      (m.sender_id = auth.uid() and m.recipient_id = p_contact)
      or (m.recipient_id = auth.uid() and m.sender_id = p_contact)
    order by m.created_at desc, m.id desc limit 100
  ) recent order by recent.created_at, recent.id;
$$;
create function public.send_formal_message(p_recipient uuid, p_body text, p_client_message_id uuid) returns public.formal_messages
language plpgsql security invoker set search_path = '' as $$
declare result public.formal_messages;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.formal_messages(sender_id, recipient_id, body_formal, client_message_id)
  values(auth.uid(), p_recipient, btrim(p_body), p_client_message_id)
  on conflict(sender_id, client_message_id) do nothing returning * into result;
  if result.id is null then
    select * into result from public.formal_messages where sender_id = auth.uid() and client_message_id = p_client_message_id;
    if result.recipient_id <> p_recipient or result.body_formal <> btrim(p_body) then raise exception 'Request ID already used for another message.'; end if;
  end if;
  return result;
end;
$$;
revoke all on function public.add_contact(text), public.list_contacts(), public.get_formal_thread(uuid), public.send_formal_message(uuid,text,uuid) from public, anon;
grant execute on function public.add_contact(text), public.list_contacts(), public.get_formal_thread(uuid), public.send_formal_message(uuid,text,uuid) to authenticated;

commit;
