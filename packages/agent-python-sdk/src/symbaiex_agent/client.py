"""Safe, dependency-free access to the public SYMBaiEX agent API.

This module intentionally has no token persistence and no knowledge of a
Convex deployment URL. Consumers own credential storage and Ed25519 signing.
"""

from __future__ import annotations

import asyncio
import json
import re
import socket
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Protocol, TypeAlias, TypeVar
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

DEFAULT_PLATFORM_ORIGIN = "https://www.symbaiex.com"
DEFAULT_TIMEOUT_SECONDS = 10.0
ARTIFACT_TIMEOUT_SECONDS = 30.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
_SAFE_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_SAFE_SEMANTIC_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$")
_SAFE_IDENTIFIER = re.compile(r"^\S.{0,511}$")
_SAFE_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_.:-]{0,63}$")
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})

JsonValue: TypeAlias = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
TokenProvider: TypeAlias = Callable[[], str | None]
T = TypeVar("T")


@dataclass(frozen=True)
class HttpRequest:
    """An outbound request, exposed so tests can supply a deterministic transport."""

    method: str
    url: str
    headers: Mapping[str, str]
    body: bytes | None
    timeout: float
    max_response_bytes: int = MAX_RESPONSE_BYTES


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


class HttpTransport(Protocol):
    def __call__(self, request: HttpRequest) -> HttpResponse: ...


@dataclass(frozen=True)
class AgentManifest:
    name: str
    version: str
    base_url: str
    authentication: Mapping[str, JsonValue]
    quota: Mapping[str, JsonValue]
    monetization: Mapping[str, JsonValue]
    endpoints: Mapping[str, JsonValue]
    raw: Mapping[str, JsonValue]

    @classmethod
    def from_json(cls, data: Mapping[str, JsonValue]) -> "AgentManifest":
        return cls(
            name=_required_string(data, "name"),
            version=_required_string(data, "version"),
            base_url=_required_string(data, "baseUrl"),
            authentication=_mapping(data.get("authentication")),
            quota=_mapping(data.get("quota")),
            monetization=_mapping(data.get("monetization")),
            endpoints=_mapping(data.get("endpoints")),
            raw=data,
        )


@dataclass(frozen=True)
class AgentQuota:
    agent_id: str
    month_key: str
    used_units: int
    remaining_units: int
    agent_used_units: int
    agent_remaining_units: int
    raw: Mapping[str, JsonValue]

    @classmethod
    def from_json(cls, data: Mapping[str, JsonValue]) -> "AgentQuota":
        return cls(
            agent_id=_required_string(data, "agentId"),
            month_key=_required_string(data, "monthKey"),
            used_units=_required_int(data, "usedUnits"),
            remaining_units=_required_int(data, "remainingUnits"),
            agent_used_units=_required_int(data, "agentUsedUnits"),
            agent_remaining_units=_required_int(data, "agentRemainingUnits"),
            raw=data,
        )


@dataclass(frozen=True)
class ResearchJob:
    job_id: str
    status: str
    raw: Mapping[str, JsonValue]

    @classmethod
    def from_json(cls, data: Mapping[str, JsonValue]) -> "ResearchJob":
        return cls(_required_string(data, "jobId"), _required_string(data, "status"), data)


@dataclass(frozen=True)
class ExportJob:
    job_id: str
    status: str
    raw: Mapping[str, JsonValue]

    @classmethod
    def from_json(cls, data: Mapping[str, JsonValue]) -> "ExportJob":
        return cls(_required_string(data, "jobId"), _required_string(data, "status"), data)


class AgentApiError(RuntimeError):
    """A sanitized platform or transport error. It never includes bearer data."""

    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.code = code
        super().__init__(message)


class AgentClient:
    """Synchronous public-origin client.

    ``token`` and ``token_provider`` are mutually exclusive. Neither is written
    to disk. A custom ``transport`` is useful for tests and constrained hosts.
    """

    def __init__(
        self,
        *,
        token: str | None = None,
        token_provider: TokenProvider | None = None,
        origin: str = DEFAULT_PLATFORM_ORIGIN,
        trusted_origins: tuple[str, ...] | list[str] | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: HttpTransport | None = None,
    ) -> None:
        if token is not None and token_provider is not None:
            raise TypeError("token and token_provider are mutually exclusive")
        self._origin = _trusted_origin(origin, trusted_origins)
        self._token = _validate_token(token) if token is not None else None
        self._token_provider = token_provider
        if not isinstance(timeout, (int, float)) or not 0 < timeout <= 60:
            raise TypeError("timeout must be a number between 0 and 60 seconds")
        self._timeout = float(timeout)
        self._transport = transport or _stdlib_transport

    def manifest(self) -> AgentManifest:
        return AgentManifest.from_json(_as_mapping(self._json("GET", "/api/agent", authenticated=False)))

    def challenge(self, agent_id: str) -> Mapping[str, JsonValue]:
        return _as_mapping(self._json("POST", "/api/agent/auth/challenge", body={"agentId": _identifier(agent_id, "agent_id", 64)}, authenticated=False))

    def sign_in(self, agent_id: str, challenge: str, signature: str, *, audience: str | None = None) -> Mapping[str, JsonValue]:
        body: dict[str, JsonValue] = {
            "agentId": _identifier(agent_id, "agent_id", 64),
            "challenge": _nonempty(challenge, "challenge", 8192),
            "signature": _nonempty(signature, "signature", 8192),
        }
        if audience is not None:
            body["audience"] = _nonempty(audience, "audience", 2048)
        return _as_mapping(self._json("POST", "/api/agent/auth/sign-in", body=body, authenticated=False))

    def refresh(self, refresh_token: str) -> Mapping[str, JsonValue]:
        return _as_mapping(self._json("POST", "/api/agent/auth/refresh", body={"refreshToken": _nonempty(refresh_token, "refresh_token", 8192)}, authenticated=False))

    def quota(self) -> AgentQuota:
        return AgentQuota.from_json(_as_mapping(self._json("GET", "/api/agent/quota")))

    def status(self) -> Mapping[str, JsonValue]:
        return self._get("status")

    def sources(self, *, limit: int | None = None) -> JsonValue:
        return self._get("sources", limit=limit)

    def source_registry(self) -> JsonValue:
        return self._get("source-registry")

    def search(self, query: str, *, limit: int | None = None) -> JsonValue:
        return self._search("search", query, limit)

    def universal_search(self, query: str, *, limit: int | None = None) -> JsonValue:
        return self._search("universal-search", query, limit)

    def semantic_search(self, query: str, *, idempotency_key: str, limit: int = 10) -> JsonValue:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20:
            raise TypeError("limit must be an integer between 1 and 20")
        if not isinstance(idempotency_key, str) or not _SAFE_SEMANTIC_IDEMPOTENCY_KEY.fullmatch(idempotency_key):
            raise TypeError("idempotency_key must be 8-96 safe identifier characters")
        params = urlencode({"q": _query(query), "limit": str(limit)})
        return self._json("GET", f"/api/agent/v1/semantic-search?{params}", idempotency_key=idempotency_key)

    def document(self, document_id: str) -> JsonValue:
        return self._get(f"documents/{_path_id(document_id, 'document_id')}")

    def changes(self, *, limit: int | None = None) -> JsonValue:
        return self._get("changes", limit=limit)

    def verify_claim(self, claim_id: str, *, idempotency_key: str) -> JsonValue:
        return self._json("POST", f"/api/agent/v1/claims/{_path_id(claim_id, 'claim_id')}/verify", idempotency_key=idempotency_key)

    def entities(self, query: str, *, limit: int | None = None) -> JsonValue:
        return self._search("entities", query, limit)

    def version_claims(self, document_version_id: str, *, limit: int | None = None) -> JsonValue:
        return self._get(f"document-versions/{_path_id(document_version_id, 'document_version_id')}/claims", limit=limit)

    def claim_timeline(self, claim_key: str, *, limit: int | None = None) -> JsonValue:
        return self._get(f"claims/{_path_id(_identifier(claim_key, 'claim_key', 200), 'claim_key')}/timeline", limit=limit)

    def products(self, *, limit: int | None = None) -> JsonValue:
        return self._get("products", limit=limit)

    def datasets(self, *, limit: int | None = None) -> JsonValue:
        return self._get("datasets", limit=limit)

    def benchmarks(self, *, limit: int | None = None) -> JsonValue:
        return self._get("benchmarks", limit=limit)

    def entitlements(self) -> JsonValue:
        return self._get("entitlements")

    def usage(self, *, limit: int | None = None) -> JsonValue:
        return self._get("usage", limit=limit)

    def create_research(self, query: str, *, idempotency_key: str) -> ResearchJob:
        data = self._json("POST", "/api/agent/v1/research-jobs", body={"query": _query(query)}, idempotency_key=idempotency_key)
        return ResearchJob.from_json(_as_mapping(data))

    def research_job(self, job_id: str) -> JsonValue:
        return self._get(f"research-jobs/{_path_id(job_id, 'job_id')}")

    def research_artifact(self, job_id: str) -> bytes:
        return self._artifact(f"research-jobs/{_path_id(job_id, 'job_id')}/artifact")

    def create_export(self, dataset_id: str, *, idempotency_key: str, format: str = "jsonl") -> ExportJob:
        if format != "jsonl":
            raise TypeError("format must be 'jsonl'")
        data = self._json("POST", "/api/agent/v1/exports", body={"datasetId": _identifier(dataset_id, "dataset_id", 512), "format": "jsonl"}, idempotency_key=idempotency_key)
        return ExportJob.from_json(_as_mapping(data))

    def export_job(self, job_id: str) -> JsonValue:
        return self._get(f"exports/{_path_id(job_id, 'job_id')}")

    def export_artifact(self, job_id: str) -> bytes:
        return self._artifact(f"exports/{_path_id(job_id, 'job_id')}/artifact")

    def webhooks(self) -> JsonValue:
        return self._get("webhooks")

    def create_webhook(self, subscription_key: str, url: str, event_types: list[str] | tuple[str, ...], *, idempotency_key: str) -> JsonValue:
        key = _identifier(subscription_key, "subscription_key", 96)
        _valid_webhook_url(url)
        if not 1 <= len(event_types) <= 12 or len(set(event_types)) != len(event_types):
            raise TypeError("event_types must contain 1-12 unique values")
        if not all(isinstance(event, str) and event in _WEBHOOK_EVENT_TYPES for event in event_types):
            raise TypeError("event_types contains an unsupported event")
        return self._json("POST", "/api/agent/v1/webhooks", body={"subscriptionKey": key, "url": url, "eventTypes": list(event_types)}, idempotency_key=idempotency_key)

    def set_webhook_status(self, subscription_key: str, status: str, *, idempotency_key: str) -> JsonValue:
        if status not in {"active", "paused", "revoked"}:
            raise TypeError("status must be active, paused, or revoked")
        return self._json("POST", f"/api/agent/v1/webhooks/{_path_id(subscription_key, 'subscription_key')}/status", body={"status": status}, idempotency_key=idempotency_key)

    def webhook_availability(self) -> JsonValue:
        return self._get("webhooks/availability")

    def webhook_health(self, subscription_key: str) -> JsonValue:
        return self._get(f"webhooks/{_path_id(subscription_key, 'subscription_key')}/health")

    def webhook_deliveries(self, subscription_key: str, *, limit: int | None = None) -> JsonValue:
        return self._get(f"webhooks/{_path_id(subscription_key, 'subscription_key')}/deliveries", limit=limit)

    def rotate_webhook_secret(self, subscription_key: str, *, idempotency_key: str) -> JsonValue:
        return self._json("POST", f"/api/agent/v1/webhooks/{_path_id(subscription_key, 'subscription_key')}/rotate", body={}, idempotency_key=idempotency_key)

    def replay_webhook_delivery(self, subscription_key: str, event_key: str, *, idempotency_key: str) -> JsonValue:
        return self._json("POST", f"/api/agent/v1/webhooks/{_path_id(subscription_key, 'subscription_key')}/deliveries/{_path_id(event_key, 'event_key')}/replay", body={}, idempotency_key=idempotency_key)

    def send_webhook_test(self, subscription_key: str, event_type: str, *, idempotency_key: str) -> JsonValue:
        if event_type not in _WEBHOOK_EVENT_TYPES:
            raise TypeError("event_type is unsupported")
        return self._json("POST", f"/api/agent/v1/webhooks/{_path_id(subscription_key, 'subscription_key')}/test", body={"eventType": event_type}, idempotency_key=idempotency_key)

    def mcp(self, payload: Mapping[str, JsonValue], *, protocol_version: str = "2026-07-28", method: str | None = None, name: str | None = None) -> JsonValue:
        if protocol_version not in {"2026-07-28", "2025-03-26"}:
            raise TypeError("unsupported MCP protocol version")
        headers: dict[str, str] = {"MCP-Protocol-Version": protocol_version}
        if method is not None:
            headers["Mcp-Method"] = _nonempty(method, "method", 200)
        if name is not None:
            headers["Mcp-Name"] = _nonempty(name, "name", 200)
        return self._json("POST", "/api/agent/mcp", body=dict(payload), headers=headers)

    def _get(self, resource: str, *, limit: int | None = None) -> JsonValue:
        query = "" if limit is None else f"?{urlencode({'limit': _limit(limit)})}"
        return self._json("GET", f"/api/agent/v1/{resource}{query}")

    def _search(self, resource: str, query: str, limit: int | None) -> JsonValue:
        params: dict[str, str] = {"q": _query(query)}
        if limit is not None:
            params["limit"] = str(_limit(limit))
        return self._json("GET", f"/api/agent/v1/{resource}?{urlencode(params)}")

    def _artifact(self, resource: str) -> bytes:
        response = self._request("GET", f"/api/agent/v1/{resource}", max_bytes=MAX_ARTIFACT_BYTES, timeout=ARTIFACT_TIMEOUT_SECONDS)
        return response.body

    def _json(self, method: str, path: str, *, body: Mapping[str, JsonValue] | None = None, authenticated: bool = True, idempotency_key: str | None = None, headers: Mapping[str, str] | None = None) -> JsonValue:
        response = self._request(method, path, body=body, authenticated=authenticated, idempotency_key=idempotency_key, headers=headers)
        if not response.body:
            return {}
        try:
            decoded: JsonValue = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise AgentApiError(response.status, "INVALID_RESPONSE", "The platform returned invalid JSON.") from error
        return decoded

    def _request(self, method: str, path: str, *, body: Mapping[str, JsonValue] | None = None, authenticated: bool = True, idempotency_key: str | None = None, headers: Mapping[str, str] | None = None, max_bytes: int = MAX_RESPONSE_BYTES, timeout: float | None = None) -> HttpResponse:
        if not path.startswith("/") or path.startswith("//"):
            raise TypeError("path must be a relative API path")
        outgoing: dict[str, str] = {"Accept": "application/json"}
        if headers:
            outgoing.update(headers)
        encoded = None if body is None else json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if encoded is not None:
            outgoing["Content-Type"] = "application/json"
        if idempotency_key is not None:
            outgoing["Idempotency-Key"] = _idempotency_key(idempotency_key)
        if authenticated:
            token = self._token if self._token is not None else (self._token_provider() if self._token_provider else None)
            if token is None:
                raise AgentApiError(401, "AUTH_REQUIRED", "An agent access token is required.")
            outgoing["Authorization"] = f"Bearer {_validate_token(token)}"
        request = HttpRequest(
            method,
            f"{self._origin}{path}",
            outgoing,
            encoded,
            timeout or self._timeout,
            max_bytes,
        )
        try:
            response = self._transport(request)
        except (OSError, socket.timeout, TimeoutError) as error:
            raise AgentApiError(503, "TRANSPORT_ERROR", "The platform request could not be completed.") from error
        if len(response.body) > max_bytes:
            raise AgentApiError(response.status, "RESPONSE_TOO_LARGE", "The platform response exceeded the client safety limit.")
        if not 200 <= response.status < 300:
            raise _api_error(response, token=token if authenticated else None)
        return response


class AsyncAgentClient:
    """Async facade with the same public methods as :class:`AgentClient`."""

    def __init__(self, **options: Any) -> None:
        self._sync = AgentClient(**options)

    async def __getattr_async(self, method: str, *args: Any, **kwargs: Any) -> Any:
        return await asyncio.to_thread(getattr(self._sync, method), *args, **kwargs)

    async def manifest(self) -> AgentManifest: return await self.__getattr_async("manifest")
    async def challenge(self, agent_id: str) -> Mapping[str, JsonValue]: return await self.__getattr_async("challenge", agent_id)
    async def sign_in(self, agent_id: str, challenge: str, signature: str, *, audience: str | None = None) -> Mapping[str, JsonValue]: return await self.__getattr_async("sign_in", agent_id, challenge, signature, audience=audience)
    async def refresh(self, refresh_token: str) -> Mapping[str, JsonValue]: return await self.__getattr_async("refresh", refresh_token)
    async def quota(self) -> AgentQuota: return await self.__getattr_async("quota")
    async def status(self) -> Mapping[str, JsonValue]: return await self.__getattr_async("status")
    async def sources(self, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("sources", limit=limit)
    async def source_registry(self) -> JsonValue: return await self.__getattr_async("source_registry")
    async def search(self, query: str, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("search", query, limit=limit)
    async def universal_search(self, query: str, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("universal_search", query, limit=limit)
    async def semantic_search(self, query: str, *, idempotency_key: str, limit: int = 10) -> JsonValue: return await self.__getattr_async("semantic_search", query, idempotency_key=idempotency_key, limit=limit)
    async def document(self, document_id: str) -> JsonValue: return await self.__getattr_async("document", document_id)
    async def changes(self, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("changes", limit=limit)
    async def verify_claim(self, claim_id: str, *, idempotency_key: str) -> JsonValue: return await self.__getattr_async("verify_claim", claim_id, idempotency_key=idempotency_key)
    async def entities(self, query: str, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("entities", query, limit=limit)
    async def version_claims(self, document_version_id: str, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("version_claims", document_version_id, limit=limit)
    async def claim_timeline(self, claim_key: str, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("claim_timeline", claim_key, limit=limit)
    async def products(self, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("products", limit=limit)
    async def datasets(self, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("datasets", limit=limit)
    async def entitlements(self) -> JsonValue: return await self.__getattr_async("entitlements")
    async def usage(self, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("usage", limit=limit)
    async def create_research(self, query: str, *, idempotency_key: str) -> ResearchJob: return await self.__getattr_async("create_research", query, idempotency_key=idempotency_key)
    async def research_job(self, job_id: str) -> JsonValue: return await self.__getattr_async("research_job", job_id)
    async def research_artifact(self, job_id: str) -> bytes: return await self.__getattr_async("research_artifact", job_id)
    async def create_export(self, dataset_id: str, *, idempotency_key: str, format: str = "jsonl") -> ExportJob: return await self.__getattr_async("create_export", dataset_id, idempotency_key=idempotency_key, format=format)
    async def export_job(self, job_id: str) -> JsonValue: return await self.__getattr_async("export_job", job_id)
    async def export_artifact(self, job_id: str) -> bytes: return await self.__getattr_async("export_artifact", job_id)
    async def webhooks(self) -> JsonValue: return await self.__getattr_async("webhooks")
    async def create_webhook(self, subscription_key: str, url: str, event_types: list[str] | tuple[str, ...], *, idempotency_key: str) -> JsonValue: return await self.__getattr_async("create_webhook", subscription_key, url, event_types, idempotency_key=idempotency_key)
    async def set_webhook_status(self, subscription_key: str, status: str, *, idempotency_key: str) -> JsonValue: return await self.__getattr_async("set_webhook_status", subscription_key, status, idempotency_key=idempotency_key)
    async def webhook_availability(self) -> JsonValue: return await self.__getattr_async("webhook_availability")
    async def webhook_health(self, subscription_key: str) -> JsonValue: return await self.__getattr_async("webhook_health", subscription_key)
    async def webhook_deliveries(self, subscription_key: str, *, limit: int | None = None) -> JsonValue: return await self.__getattr_async("webhook_deliveries", subscription_key, limit=limit)
    async def rotate_webhook_secret(self, subscription_key: str, *, idempotency_key: str) -> JsonValue: return await self.__getattr_async("rotate_webhook_secret", subscription_key, idempotency_key=idempotency_key)
    async def replay_webhook_delivery(self, subscription_key: str, event_key: str, *, idempotency_key: str) -> JsonValue: return await self.__getattr_async("replay_webhook_delivery", subscription_key, event_key, idempotency_key=idempotency_key)
    async def send_webhook_test(self, subscription_key: str, event_type: str, *, idempotency_key: str) -> JsonValue: return await self.__getattr_async("send_webhook_test", subscription_key, event_type, idempotency_key=idempotency_key)
    async def mcp(self, payload: Mapping[str, JsonValue], *, protocol_version: str = "2026-07-28", method: str | None = None, name: str | None = None) -> JsonValue: return await self.__getattr_async("mcp", payload, protocol_version=protocol_version, method=method, name=name)


_WEBHOOK_EVENT_TYPES = frozenset({"evidence.document.changed", "evidence.research.completed", "evidence.export.completed", "evidence.benchmark.completed", "evidence.claim.verified", "evidence.usage.threshold_reached", "evidence.usage.budget_reached", "evidence.entitlement.status_changed"})


def _trusted_origin(origin: str, trusted_origins: tuple[str, ...] | list[str] | None) -> str:
    normalized = _normalize_origin(origin)
    if normalized == DEFAULT_PLATFORM_ORIGIN:
        return normalized
    if not trusted_origins:
        raise TypeError("trusted_origins is required when overriding the platform origin")
    if normalized not in {_normalize_origin(item) for item in trusted_origins}:
        raise TypeError("platform origin is not in trusted_origins")
    return normalized


def _normalize_origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise TypeError("platform origin must be an origin without a path, query, or credentials")
    hostname = parsed.hostname
    if hostname is None:
        raise TypeError("platform origin must include a hostname")
    if parsed.scheme == "https" and hostname in {"symbaiex.com", "www.symbaiex.com"}:
        return urlunsplit(("https", parsed.netloc, "", "", ""))
    if parsed.scheme == "http" and hostname in _LOCAL_HOSTS:
        return urlunsplit(("http", parsed.netloc, "", "", ""))
    raise TypeError("platform origin must use HTTPS or a localhost development origin")


def _validate_token(token: str) -> str:
    if not isinstance(token, str) or not token or any(char.isspace() for char in token):
        raise AgentApiError(401, "AUTH_REQUIRED", "An agent access token is required.")
    return token


def _idempotency_key(value: str) -> str:
    if not isinstance(value, str) or not _SAFE_IDEMPOTENCY_KEY.fullmatch(value):
        raise TypeError("idempotency_key must be 1-160 safe identifier characters")
    return value


def _query(value: str) -> str:
    return _nonempty(value.strip() if isinstance(value, str) else value, "query", 300)


def _limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 50:
        raise TypeError("limit must be an integer between 1 and 50")
    return value


def _identifier(value: str, name: str, maximum: int) -> str:
    return _nonempty(value, name, maximum)


def _path_id(value: str, name: str) -> str:
    return quote(_identifier(value, name, 512), safe="")


def _nonempty(value: object, name: str, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or not _SAFE_IDENTIFIER.fullmatch(value):
        raise TypeError(f"{name} must be a non-empty string up to {maximum} characters")
    return value


def _valid_webhook_url(value: str) -> None:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise TypeError("webhook url must be an HTTPS URL without credentials")
    if len(value) > 2000:
        raise TypeError("webhook url must be at most 2000 characters")


def _as_mapping(value: JsonValue) -> Mapping[str, JsonValue]:
    if not isinstance(value, dict):
        raise AgentApiError(200, "INVALID_RESPONSE", "The platform returned an unexpected response shape.")
    return value


def _mapping(value: JsonValue | None) -> Mapping[str, JsonValue]:
    return value if isinstance(value, dict) else {}


def _required_string(data: Mapping[str, JsonValue], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        raise AgentApiError(200, "INVALID_RESPONSE", "The platform returned an unexpected response shape.")
    return value


def _required_int(data: Mapping[str, JsonValue], key: str) -> int:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise AgentApiError(200, "INVALID_RESPONSE", "The platform returned an unexpected response shape.")
    return value


def _api_error(response: HttpResponse, *, token: str | None = None) -> AgentApiError:
    """Return a bounded error without trusting an upstream response body.

    The public relay should already redact credentials, but clients must not
    assume that an intermediary or a misconfigured upstream did so. Keep the
    human message fixed and only retain a conservative, bounded code that
    cannot contain the bearer value.
    """
    code = f"HTTP_{response.status}"
    message = "The platform request failed."
    try:
        payload = json.loads(response.body.decode("utf-8"))
        if isinstance(payload, dict):
            candidate = payload.get("code")
            if (
                isinstance(candidate, str)
                and _SAFE_ERROR_CODE.fullmatch(candidate) is not None
                and (
                    token is None
                    or token.casefold() not in candidate.casefold()
                )
            ):
                code = candidate
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    return AgentApiError(response.status, code, message)


def _stdlib_transport(request: HttpRequest) -> HttpResponse:
    outgoing = Request(request.url, data=request.body, headers=dict(request.headers), method=request.method)
    try:
        # Never follow redirects: a redirect can otherwise send a bearer token
        # to an origin the client did not approve.
        with build_opener(_NoRedirect()).open(outgoing, timeout=request.timeout) as response:
            return HttpResponse(response.status, dict(response.headers.items()), response.read(request.max_response_bytes + 1))
    except HTTPError as error:
        return HttpResponse(error.code, dict(error.headers.items()) if error.headers else {}, error.read(request.max_response_bytes + 1))
    except URLError as error:
        raise OSError("network request failed") from error


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None
