"""HTTP surface for Reality Resolver.

Deliberately empty of re-exports: importing `api` must not pull in the
server, and importing api.server must not start one. Callers name the
module they want (api.server, api.store, api.serialize).
"""
