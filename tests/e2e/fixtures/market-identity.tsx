import { createRoot } from "react-dom/client";
import {
  TokenLogo,
  type MarketChoice,
} from "../../../components/trading/market-identity";

declare global {
  interface Window {
    renderMarketIdentity(token: MarketChoice): void;
  }
}

const root = createRoot(document.getElementById("root")!);
window.renderMarketIdentity = (token) => {
  root.render(
    <div data-testid="token-logo">
      <TokenLogo token={token} />
    </div>,
  );
};
const query = new URLSearchParams(window.location.search);
window.renderMarketIdentity({
  mint: "11111111111111111111111111111111",
  symbol: "AAA",
  name: "Fixture token",
  imageUrl: query.has("src")
    ? query.get("src")
    : "https://images.example.test/logo-a.png",
});
