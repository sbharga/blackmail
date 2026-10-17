-- Run AFTER the migration, as postgres in SQL Editor. All fixtures roll back.
begin;
insert into auth.users(id, email, raw_user_meta_data) values
('b0000000-0000-4000-8000-000000000001','alice-rls@blackmail.invalid','{"username":"rls_alice","display_name":"Alice RLS"}'),
('b0000000-0000-4000-8000-000000000002','bob-rls@blackmail.invalid','{"username":"rls_bob","display_name":"Bob RLS"}'),
('b0000000-0000-4000-8000-000000000003','eve-rls@blackmail.invalid','{"username":"rls_eve","display_name":"Eve RLS"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.add_contact('rls_bob');
select public.send_formal_message('b0000000-0000-4000-8000-000000000002','Please check the report.','c0000000-0000-4000-8000-000000000001');
-- Same request twice must not duplicate delivery.
select public.send_formal_message('b0000000-0000-4000-8000-000000000002','Please check the report.','c0000000-0000-4000-8000-000000000001');
do $$ begin
  if (select count(*) from public.formal_messages) <> 1 then raise exception 'Duplicate delivery'; end if;
  if (select count(*) from public.profiles) <> 2 then raise exception 'Unrelated profile exposed'; end if;
  begin
    insert into public.formal_messages(sender_id,recipient_id,body_formal,client_message_id)
    values('b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','Spoof','c0000000-0000-4000-8000-000000000002');
    raise exception 'Sender spoof accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.formal_messages set body_formal='Changed';
    raise exception 'Formal record editable';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.get_formal_thread('b0000000-0000-4000-8000-000000000001')) <> 1 then raise exception 'Recipient cannot read delivery'; end if;
  if (select count(*) from public.list_contacts()) <> 1 then raise exception 'Sender absent from inbox'; end if;
end $$;
-- Bob may reply without manually re-adding the incoming sender.
select public.send_formal_message('b0000000-0000-4000-8000-000000000001','I will check it.','c0000000-0000-4000-8000-000000000003');

select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.formal_messages) <> 0 then raise exception 'Third party read messages'; end if;
  if (select count(*) from public.get_formal_thread('b0000000-0000-4000-8000-000000000001')) <> 0 then raise exception 'Third party read thread'; end if;
  begin
    perform public.send_formal_message('b0000000-0000-4000-8000-000000000001','No contact','c0000000-0000-4000-8000-000000000004');
    raise exception 'Unknown contact accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'RLS checks passed; all fixtures rolled back.' as result;
