import { serviceAuthRelay } from "@/lib/agent-service-auth-relay";
import {
  serviceAuthMetadata,
  serviceAuthResponse,
} from "@/lib/agent-service-auth-config";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const ready = await serviceAuthRelay(request, "jwks");
  if (!ready.ok) return ready;
  const response = serviceAuthResponse(serviceAuthMetadata());
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
export async function HEAD(request: Request) {
  const response = await GET(request);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
