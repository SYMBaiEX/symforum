// Dedicated registry-publishing public key. The private key stays outside the repository.
export const dynamic = "force-static";

export function GET() {
  return new Response(
    "v=MCPv1; k=ed25519; p=/f6D6zjt0CrJ+2XfOnv4NWv+cjuboDKqeBnfQnbluHY=\n",
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export function HEAD() {
  return new Response(null, { headers: GET().headers });
}
