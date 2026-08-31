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
        self.assertEqual(client.claim_timeline("release-security", limit=2), [])
        self.assertEqual(recorder.requests[1].url, f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/claims/release-security/timeline?limit=2")
        with self.assertRaisesRegex(TypeError, "between 1 and 50"):
            client.universal_search("x", limit=51)

    def test_source_registry_uses_the_bounded_public_contract(self) -> None:
        recorder = Recorder([])
        client = AgentClient(token="access-token", transport=recorder)
        self.assertEqual(client.source_registry(), [])
        self.assertEqual(
            recorder.requests[0].url,
            f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/source-registry",
        )

    def test_export_manifest_uses_the_authenticated_artifact_contract(self) -> None:
        recorder = Recorder({"schemaVersion": "symbaiex-evidence-document-v2"})
        client = AgentClient(token="access-token", transport=recorder)
        self.assertIn(b"schemaVersion", client.export_manifest("job-1"))
        self.assertEqual(
            recorder.requests[0].url,
            f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/exports/job-1/manifest",
        )

    def test_semantic_search_uses_public_replay_safe_contract(self) -> None:
        recorder = Recorder([])
        client = AgentClient(token="access-token", transport=recorder)
        self.assertEqual(
            client.semantic_search(
                "public evidence",
                limit=5,
                idempotency_key="semantic-python-001",
            ),
            [],
        )
        request = recorder.requests[0]
        self.assertEqual(
            request.url,
            f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/semantic-search?q=public+evidence&limit=5",
        )
        self.assertEqual(request.headers["Idempotency-Key"], "semantic-python-001")
        with self.assertRaisesRegex(TypeError, "between 1 and 20"):
            client.semantic_search("x", limit=21, idempotency_key="semantic-python-002")
        with self.assertRaisesRegex(TypeError, "8-96"):
            client.semantic_search("x", idempotency_key="short")

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

    def test_transport_failures_and_timeouts_are_normalized(self) -> None:
        def offline(_request: HttpRequest) -> HttpResponse:
            raise OSError("private network detail")

        client = AgentClient(token="access-token", transport=offline)
        with self.assertRaises(AgentApiError) as network_error:
            client.status()
        self.assertEqual(network_error.exception.status, 0)
        self.assertEqual(network_error.exception.code, "NETWORK_ERROR")
        self.assertNotIn("private network detail", str(network_error.exception))

        def stalled(_request: HttpRequest) -> HttpResponse:
            raise TimeoutError("private timeout detail")

        client = AgentClient(token="access-token", transport=stalled)
        with self.assertRaises(AgentApiError) as timeout_error:
            client.status()
        self.assertEqual(timeout_error.exception.status, 408)
        self.assertEqual(timeout_error.exception.code, "REQUEST_TIMEOUT")
        self.assertNotIn("private timeout detail", str(timeout_error.exception))

        with self.assertRaisesRegex(TypeError, "artifact_timeout"):
            AgentClient(token="access-token", artifact_timeout=0)

    def test_artifacts_use_the_separate_timeout(self) -> None:
        recorder = Recorder({})
        client = AgentClient(
            token="access-token",
            timeout=2,
            artifact_timeout=45,
            transport=recorder,
        )
        client.research_artifact("job-1")
        self.assertEqual(recorder.requests[0].timeout, 45)

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

    def test_webhook_operations_use_bounded_public_paths(self) -> None:
        recorder = Recorder({"ok": True})
        client = AgentClient(token="access-token", transport=recorder)
        client.webhook_availability()
        client.webhook_health("primary")
        client.webhook_deliveries("primary", limit=5)
        client.rotate_webhook_secret("primary", idempotency_key="rotate-1")
        client.replay_webhook_delivery("primary", "event-1", idempotency_key="replay-1")
        client.send_webhook_test("primary", "evidence.claim.verified", idempotency_key="test-1")
        self.assertEqual(
            [request.url for request in recorder.requests],
            [
                f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/availability",
                f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/primary/health",
                f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/primary/deliveries?limit=5",
                f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/primary/rotate",
                f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/primary/deliveries/event-1/replay",
                f"{DEFAULT_PLATFORM_ORIGIN}/api/agent/v1/webhooks/primary/test",
            ],
        )

    def test_async_client_delegates_without_live_network(self) -> None:
        async def scenario() -> None:
            client = AsyncAgentClient(token="access-token", transport=Recorder([]))
            self.assertEqual(await client.universal_search("public", limit=1), [])
            self.assertEqual(await client.source_registry(), [])
            self.assertEqual(await client.benchmarks(limit=1), [])

        asyncio.run(scenario())

    def test_async_client_matches_the_sync_public_surface(self) -> None:
        sync_methods = {
            name
            for name, value in AgentClient.__dict__.items()
            if not name.startswith("_") and callable(value)
        }
        async_methods = {
            name
            for name, value in AsyncAgentClient.__dict__.items()
            if not name.startswith("_") and callable(value)
        }
        self.assertEqual(async_methods, sync_methods)


if __name__ == "__main__":
    unittest.main()
