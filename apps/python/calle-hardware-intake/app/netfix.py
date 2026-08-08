"""Force IPv4 for Python networking.

This machine has a broken IPv6 route: ``socket.getaddrinfo`` returns the IPv6
address first and connecting to it hangs, which makes httpx, urllib, and the
google-genai SDK all time out. curl works because it falls back to IPv4.

We patch ``socket.getaddrinfo`` so name resolution always returns IPv4
addresses. Import this module before any outbound network call — the patch is
process-global, so importing it once at app/script startup covers everything
(including background threads).

See memory: [[windows-python-ipv6-hang]].
"""
import socket

_orig_getaddrinfo = socket.getaddrinfo


def _force_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    if family == 0:  # AF_UNSPEC -> force IPv4
        family = socket.AF_INET
    return _orig_getaddrinfo(host, port, family, type, proto, flags)


socket.getaddrinfo = _force_ipv4
