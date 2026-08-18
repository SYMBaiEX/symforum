from __future__ import annotations

import asyncio
import json
import unittest

from symbaiex_agent import (
    DEFAULT_PLATFORM_ORIGIN,
    AgentApiError,
    AgentClient,
    AsyncAgentClient,
    HttpRequest,
    HttpResponse,
)


class Recorder:
    def __init__(self, body: object, status: int = 200) -> None:
        self.body = body
        self.status = status
        self.requests: list[HttpRequest] = []

    def __call__(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(self.status, {"Content-Type": "application/json"}, json.dumps(self.body).encode())


class AgentClientTests(unittest.TestCase):
    def test_uses_public_origin_and_safe_bearer(self) -> None:
        recorder = Recorder({"agentId": "suki", "monthKey": "2026-08", "usedUnits": 1, "remainingUnits": 99, "agentUsedUnits": 1, "agentRemainingUnits": 249})
        client = AgentClient(token="access-token", transport=recorder)
        self.assertEqual(client.quota().agent_id, "suki")
        self.assertEqual(recorder.requests[0].url, f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/quota")
        self.assertEqual(recorder.requests[0].headers["Authorization"], "Bearer access-token")

    def test_universal_search_is_bounded_and_url_encoded(self) -> None:
        recorder = Recorder([])
        client = AgentClient(token="access-token", transport=recorder)
        self.assertEqual(client.universal_search("public evidence", limit=5), [])
        self.assertEqual(recorder.requests[0].url, f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/universal-search?q=public+evidence&limit=5")
        with self.assertRaisesRegex(TypeError, "between 1 and 50"):
            client.universal_search("x", limit=51)

    def test_writes_require_and_forward_idempotency_keys(self) -> None:
        recorder = Recorder({"jobId": "job-1", "status": "queued"})
        client = AgentClient(token="access-token", transport=recorder)
        job = client.create_research("bounded research", idempotency_key="research-001")
        self.assertEqual(job.job_id, "job-1")
        request = recorder.requests[0]
        self.assertEqual(request.headers["Idempotency-Key"], "research-001")
        self.assertEqual(request.body, b'{"query":"bounded research"}')
        with self.assertRaises(TypeError):
            client.create_research("x", idempotency_key="bad key")

    def test_custom_origin_is_rejected_before_token_provider_runs(self) -> None:
        calls = 0

        def token_provider() -> str:
            nonlocal calls
            calls += 1
            return "access-token"

        with self.assertRaisesRegex(TypeError, "HTTPS or a localhost"):
            AgentClient(origin="https://untrusted.example", token_provider=token_provider)
        self.assertEqual(calls, 0)
        local = AgentClient(origin="http://localhost:3000", trusted_origins=["http://localhost:3000"], token="access-token", transport=Recorder({}))
        self.assertIsInstance(local, AgentClient)
        with self.assertRaisesRegex(TypeError, "HTTPS or a localhost"):
            AgentClient(origin="https://untrusted.example", trusted_origins=["https://untrusted.example"])

    def test_errors_are_sanitized_and_never_include_bearer(self) -> None:
        client = AgentClient(token="never-in-error", transport=Recorder({"error": "Scope denied.", "code": "SCOPE_DENIED"}, status=403))
        with self.assertRaises(AgentApiError) as raised:
            client.search("security")
        self.assertEqual(raised.exception.status, 403)
        self.assertEqual(raised.exception.code, "SCOPE_DENIED")
        self.assertNotIn("never-in-error", str(raised.exception))

    def test_reflected_bearer_and_unbounded_error_body_are_discarded(self) -> None:
        bearer = "UPPERCASE-BEARER-SECRET"
        client = AgentClient(
            token=bearer,
            transport=Recorder(
                {"error": f"Authorization: Bearer {bearer}", "code": bearer},
                status=500,
            ),
        )
        with self.assertRaises(AgentApiError) as raised:
            client.status()
        self.assertEqual(raised.exception.code, "HTTP_500")
        self.assertEqual(str(raised.exception), "The platform request failed.")
        self.assertNotIn(bearer, str(raised.exception))

    def test_bearer_fragment_in_error_code_is_discarded(self) -> None:
        bearer = "SECRET"
        client = AgentClient(
            token=bearer,
            transport=Recorder({"code": "UPSTREAM_SECRET_FAILURE"}, status=502),
        )
        with self.assertRaises(AgentApiError) as raised:
            client.status()
        self.assertEqual(raised.exception.code, "HTTP_502")

    def test_webhook_contract_and_artifact_read(self) -> None:
        recorder = Recorder({"ok": True})
        client = AgentClient(token="access-token", transport=recorder)
        client.create_webhook("primary", "https://hooks.example.test/sym", ["evidence.export.completed"], idempotency_key="webhook-1")
        request = recorder.requests[0]
        self.assertEqual(request.url, f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks")
        self.assertEqual(json.loads(request.body or b"{}"), {"subscriptionKey": "primary", "url": "https://hooks.example.test/sym", "eventTypes": ["evidence.export.completed"]})
        with self.assertRaisesRegex(TypeError, "HTTPS"):
            client.create_webhook("primary", "http://hooks.example.test", ["evidence.export.completed"], idempotency_key="webhook-2")

    def test_async_client_delegates_without_live_network(self) -> None:
        async def scenario() -> None:
            client = AsyncAgentClient(token="access-token", transport=Recorder([]))
            self.assertEqual(await client.universal_search("public", limit=1), [])

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
