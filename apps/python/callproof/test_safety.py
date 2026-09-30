import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

import app as service


class LiveSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_authorization_is_required_before_network(self):
        with patch.dict("os.environ", {}, clear=True), patch.object(service.httpx, "AsyncClient") as client:
            with self.assertRaises(HTTPException) as error:
                await service.create_call(service.VerifyRequest(claim="Fictional delivery is ready", phone="+12025550100"))
            self.assertEqual(error.exception.status_code, 403)
            client.assert_not_called()

    async def test_invalid_destinations_are_rejected_before_network(self):
        for phone in ("+02025550100", "+１２０２５５５０１００", "2025550100"):
            with self.subTest(phone=phone), patch.object(service.httpx, "AsyncClient") as client:
                with self.assertRaises(HTTPException) as error:
                    await service.create_call(service.VerifyRequest(claim="Fictional delivery is ready", phone=phone, authorized=True))
                self.assertEqual(error.exception.status_code, 422)
                self.assertNotIn(phone, error.exception.detail)
                client.assert_not_called()

    async def test_remote_live_requests_are_rejected(self):
        for peer, origin in (("192.0.2.1", "http://127.0.0.1"), ("127.0.0.1", "http://example.invalid")):
            with self.subTest(peer=peer, origin=origin), patch.object(service, "create_call", new_callable=AsyncMock) as create:
                transport = httpx.ASGITransport(app=service.app, client=(peer, 12345))
                async with httpx.AsyncClient(transport=transport, base_url=origin) as client:
                    response = await client.post("/verify", json={})
                self.assertEqual(response.status_code, 403)
                create.assert_not_called()

    async def test_live_response_masks_nested_and_claim_phone_numbers(self):
        phone = "+12025550100"
        call = {"id": "offline-call", "status": "completed", "summary": f"Call {phone}", "evidence": ["Contact +1 (202) 555-0100"]}
        with patch.object(service, "create_call", new_callable=AsyncMock, return_value={"id": "offline-call"}), patch.object(service, "wait_for_terminal", new_callable=AsyncMock, return_value=call):
            result = await service.verify(service.VerifyRequest(claim=f"Fictional delivery contact {phone}", phone=phone, authorized=True))
        serialized = result.model_dump_json()
        self.assertNotIn(phone, serialized)
        self.assertNotIn("+1 (202) 555-0100", serialized)
        self.assertIn("+***0100", serialized)

    async def test_provider_error_body_is_not_exposed(self):
        response = httpx.Response(400, text="private-provider-error-body")
        fake_client = AsyncMock()
        fake_client.__aenter__.return_value = fake_client
        fake_client.post.return_value = response
        with patch.dict("os.environ", {"CALLE_API_KEY": "offline-test-placeholder"}, clear=True), patch.object(service.httpx, "AsyncClient", return_value=fake_client):
            with self.assertRaises(HTTPException) as error:
                await service.create_call(service.VerifyRequest(claim="Fictional delivery is ready", phone="+12025550100", authorized=True))
        self.assertNotIn("private-provider-error-body", error.exception.detail)


if __name__ == "__main__":
    unittest.main()
