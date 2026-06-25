import { getInitSnippet } from "@openpanel/web";
import Script from "next/script";

export function OpenPanelProvider({ nonce }: { nonce?: string }) {
  const clientId = process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID;
  if (!clientId) {
    return null;
  }

  const options = {
    clientId,
    apiUrl: "/api/op",
    trackScreenViews: true,
    trackOutgoingLinks: true,
    trackAttributes: true,
    sdk: "nextjs",
    sdkVersion: "1.5.1",
  };

  return (
    <>
      <Script
        async
        defer
        nonce={nonce}
        src="/api/op/op1.js?v=1.5.1"
        strategy="afterInteractive"
      />
      <Script
        id="openpanel-init"
        nonce={nonce}
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `${getInitSnippet()}\nwindow.op('init', ${JSON.stringify(options)});`,
        }}
      />
    </>
  );
}
