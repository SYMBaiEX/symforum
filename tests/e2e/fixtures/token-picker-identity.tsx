import { createRoot } from "react-dom/client";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { TokenPicker } from "../../../components/swap/token-picker";
import {
  candidate,
  listed,
  mintA,
  mintB,
  state,
  wallet,
} from "./token-picker-identity-state";
const guest = new URLSearchParams(location.search).has("guest");
const tokens = guest ? [candidate(mintA), candidate(mintB)] : [listed];
if (new URLSearchParams(location.search).has("long")) {
  tokens[0] = { ...tokens[0], symbol: "W".repeat(24), name: "Name".repeat(25) };
}
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      data-surface="forum"
      className="forum-app-shell p-4"
      aria-label="Invented local token picker"
    >
      <TokenPicker
        token={tokens[0]}
        tokens={tokens}
        label="Choose fixture token"
        disabled={false}
        wallet={guest ? undefined : wallet}
        onSelect={(token) => state.selected.push(token)}
      />
      <button type="button">After token picker</button>
    </main>
  </SurfaceScope.Provider>,
);
