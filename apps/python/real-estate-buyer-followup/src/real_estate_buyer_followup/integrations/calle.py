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
            raise ValueError("模拟电话身份不匹配")
        return result


class LiveProvider:
    def __init__(self, settings):
        self.settings = settings

    def _client(self):
        if not self.settings.enable_live or not self.settings.calle_key:
            raise ProviderError("真实拨号未启用或未配置本项目CALL-E凭证")
        from calle import CalleClient
        return CalleClient(api_key=self.settings.calle_key, base_url="https://api.heycall-e.com")

    def submit(self, request, key):
        # The workflow freezes the user-entered destination during approval.
        # Do not consult a global default that can change after that approval.
        if not re.fullmatch(r'\+[1-9][0-9]{7,14}',request.get('phone','')) or not request.get('locale'):
            raise ProviderError("授权号码或语言格式无效，未提交")
        try:
            return self._client().calls.create(**request, idempotency_key=key)
        except ProviderError:
            raise
        except Exception as exc:
            status = getattr(exc, "status_code", None)
            rejected = status in {400,401,402,403,422}
            explanation={
                'unsupported_region':'CALL-E暂不支持该号码地区',
                'unsupported_language':'CALL-E不支持该地区的所选语言',
                'input_incomplete':'CALL-E需要补充或修正号码、地区或语言',
                'unauthorized':'CALL-E项目API Key未通过认证',
                'forbidden':'CALL-E项目无权执行本次操作',
                'insufficient_balance':'CALL-E项目余额不足',
            }.get(getattr(exc,'code',None))
            if rejected and explanation:
                raise ProviderError(explanation+'；本次请求被拒绝，未创建电话',uncertain=False) from None
            raise ProviderError(f"CALL-E提交未成功确认（HTTP {status or '未知'}）；保留原请求身份", uncertain=not rejected) from None

    def read(self, request, key, resource_id):
        try:
            return self._client().calls.get(resource_id)
        except Exception:
            raise ProviderError("查询失败，未改变原电话，可稍后继续查询") from None
