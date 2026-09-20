begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.seniors), 1, 'member can read their senior');
select is((select count(*)::integer from public.senior_memberships), 1, 'member can read their own membership');
select is((select count(*)::integer from public.trusted_contacts), 1, 'member can read approved senior records');

set local "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.seniors), 0, 'unrelated user cannot read senior');
select is((select count(*)::integer from public.trusted_contacts), 0, 'unrelated user cannot read contacts');

reset role;
select ok(not has_table_privilege('anon', 'public.seniors', 'SELECT'), 'anonymous role has no senior access');
select ok(not has_table_privilege('authenticated', 'public.seniors', 'INSERT'), 'authenticated users cannot create senior rows directly');
select ok(not has_table_privilege('authenticated', 'public.membership_invites', 'SELECT'), 'membership invite hashes are not exposed');

select * from finish();
rollback;
