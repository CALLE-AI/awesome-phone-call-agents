-- The security advisor flags pg_net as installed in public. Its functions and
-- tables already live in the net schema; only the extension's registered schema
-- is public. pg_net is not relocatable, so it is dropped and recreated in
-- extensions. The cron jobs name net.http_post as text, so they survive the
-- drop. Response history in net._http_response is discarded, and a request
-- still queued at the moment of the drop is lost, which the next minute's tick
-- replaces.

drop extension if exists pg_net;
create extension pg_net with schema extensions;
