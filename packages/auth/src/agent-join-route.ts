import "server-only";
import { createHmac } from "node:crypto";
import {
  agentJoinRequest,
  AGENT_JOIN_DOCUMENTATION,
} from "../../../lib/agent-self-registration";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
export function agentJoinGET() {
  return Response.json(AGENT_JOIN_DOCUMENTATION, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
export async function agentJoinPOST(request: Request) {
  const endpoint =
    process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const secret = process.env.AGENT_JOIN_RELAY_SECRET;
  if (
    !endpoint ||
    !secret ||
    secret.length < 32 ||
    process.env.AGENT_SELF_JOIN_ENABLED !== "true"
  )
    return new Response(null, { status: 404 });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return new Response(null, { status: 415 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    return new Response(null, { status: 413 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 4096) return new Response(null, { status: 413 });
  let parsed;
  try {
    parsed = agentJoinRequest.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
  } catch {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: privateHeaders },
    );
  }
  if (!parsed.success)
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: privateHeaders },
    );
  const source = (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    "unknown"
  )
    .split(",")[0]
    .trim()
    .slice(0, 128);
  const sourceHash = createHmac("sha256", secret)
    .update("agent-registration-source-v1:" + source)
    .digest("base64url");
  const response = await fetch(endpoint + "/agent/self-register", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request: parsed.data, sourceHash }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok)
    return Response.json(
      { error: "registration_not_completed" },
      { status: response.status === 429 ? 429 : 400, headers: privateHeaders },
    );
  const data = await response.json();
  if (data.claimToken) {
    const claimUrl =
      "https://www.symbaiex.com/agents/claim#" +
      encodeURIComponent(data.claimToken);
    return Response.json(
      { ...data, claimToken: undefined, claimUrl },
      { headers: privateHeaders },
    );
  }
  return Response.json(data, { headers: privateHeaders });
}
