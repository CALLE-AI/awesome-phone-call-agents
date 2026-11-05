"""One-shot provider boundary. No request occurs on construction or import."""
import re
from ..storage import fixture, digest


class ProviderError(ValueError):
    def __init__(self, message, uncertain=False):
        super().__init__(message)
        self.uncertain = uncertain


class FakeProvider:
    def submit(self, request, key):
        case = fixture("replays.json")[request["metadata"]["replay_case"]]
        return {"id":"fake_" + digest(key)[:20], "call_id":None, "status":"completed",
                "call_outcome":case["call_outcome"], "result_status":case["result_status"],
                "transcript":case["transcript"], "result":None if case["result_status"] != "available" else {"summary":case["analysis"]["summary"]},
                "error":None, "simulation":True}

    def read(self, request, key, resource_id):
        result = self.submit(request, key)
        if result["id"] != resource_id:
            raise ValueError('Mock call identity mismatch')
        return result


class LiveProvider:
    def __init__(self, settings):
        self.settings = settings

    def _client(self):
        if not self.settings.enable_live or not self.settings.calle_key:
            raise ProviderError("Live calling disabled or this project's CALL-E credentials missing")
        from calle import CalleClient
        return CalleClient(api_key=self.settings.calle_key, base_url="https://api.heycall-e.com")

    def submit(self, request, key):
        # The workflow freezes the user-entered destination during approval.
        # Do not consult a global default that can change after that approval.
        if not re.fullmatch(r'\+[1-9][0-9]{7,14}',request.get('phone','')) or not request.get('locale'):
            raise ProviderError('Invalid authorized destination or locale; not submitted')
        try:
            return self._client().calls.create(**request, idempotency_key=key)
        except ProviderError:
            raise
        except Exception as exc:
            status = getattr(exc, "status_code", None)
            rejected = status in {400,401,402,403,422}
            explanation={
                'unsupported_region':'CALL-E does not currently support this destination region',
                'unsupported_language':'CALL-E does not support the selected language in this region',
                'input_incomplete':'CALL-E requires a corrected destination, region or locale',
                'unauthorized':'CALL-E project API key authentication failed',
                'forbidden':'CALL-E project is not authorized for this operation',
                'insufficient_balance':'Insufficient CALL-E project balance',
            }.get(getattr(exc,'code',None))
            if rejected and explanation:
                raise ProviderError(explanation+'; request rejected, no call created',uncertain=False) from None
            raise ProviderError(f"CALL-E submission was not confirmed (HTTP {status or 'Unknown'}); retain the original request identity", uncertain=not rejected) from None

    def read(self, request, key, resource_id):
        try:
            return self._client().calls.get(resource_id)
        except Exception:
            raise ProviderError('Read failed; original call unchanged, retry reading later') from None
