const signalMoth = document.querySelector(".signal-moth-track");

if (signalMoth instanceof HTMLButtonElement) {
  const actions = ["waving", "jumping", "waiting", "review", "failed"];
  const durations = {
    waving: 1400,
    jumping: 1680,
    failed: 2440,
    waiting: 2020,
    review: 2060,
  };
  let actionTimeout = 0;
  let lastAction = "";

  const clearAction = () => {
    signalMoth.classList.remove(
      "is-acting",
      "action-waving",
      "action-jumping",
      "action-waiting",
      "action-review",
      "action-failed",
    );
  };

  const playAction = () => {
    signalMoth.classList.add("is-ready");
    window.clearTimeout(actionTimeout);
    clearAction();

    const pool = actions.filter((action) => action !== lastAction);
    const nextAction =
      pool[Math.floor(Math.random() * pool.length)] ?? "waving";
    lastAction = nextAction;
    signalMoth.classList.add("is-acting", `action-${nextAction}`);

    actionTimeout = window.setTimeout(() => {
      clearAction();
      actionTimeout = 0;
    }, durations[nextAction]);
  };

  signalMoth.addEventListener("click", playAction);
  window.addEventListener(
    "pagehide",
    () => {
      window.clearTimeout(actionTimeout);
    },
    { once: true },
  );
}
