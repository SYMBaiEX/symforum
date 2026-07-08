export type SitePageRecord = {
  _id?: string;
  _creationTime?: number;
  slug: string;
  title: string;
  subtitle: string;
  heroHeading: string;
  heroBody: string;
  body: string;
  status: "draft" | "published";
  updatedAt: number;
  showImage?: boolean;
  imageUrl?: string;
  imageLightUrl?: string;
  imageAlt?: string;
  imageCredit?: string;
};

export type PortfolioProjectRecord = {
  _id?: string;
  _creationTime?: number;
  slug: string;
  name: string;
  type: string;
  role: string;
  timeframe: string;
  summary: string;
  problem: string;
  approach: string;
  outcome: string;
  status: "draft" | "published" | "archived";
  order: number;
  tags: string[];
  imageUrl?: string;
  imageAlt?: string;
  homepageUrl?: string;
  repoUrl?: string;
  writeupUrl?: string;
};

const UPDATED_AT = Date.UTC(2026, 5, 24, 12);

export const defaultSitePages: SitePageRecord[] = [
  {
    slug: "about",
    title: "About",
    subtitle: "Austin Hamilton / SYMBaiEX",
    heroHeading: "Building tools that age well.",
    heroBody:
      "I am Austin Hamilton, SYMBiEX, a self-taught engineer, researcher, open-source contributor, and father from Alabama. I build around the edge where protocol thinking, AI systems, and practical product work start to become the same discipline.",
    body: [
      "## From Alabama to systems first principles",
      "I grew up in Alabama and started learning code around 12 or 13. The first doorway was game hacking: scripts, tweaks, reverse engineering, and the strange satisfaction of seeing a system behave differently because I understood one small part of it. That early work was rough, curious, and formative. It taught me that software is not magic. It is a living argument between constraints, imagination, and persistence.",
      "## The long practical middle",
      "I took a major break from engineering and spent years in retail project management. That chapter mattered. It taught me how to ship under pressure, how to communicate across messy human systems, and how to turn a plan into a result when conditions are not ideal. A lot of my engineering taste comes from that period: tools should reduce friction, respect the operator, and still work when the room gets loud.",
      "## Blockchain, AI, and the return to building",
      "Around 2021 I went deep into blockchain infrastructure and open-source engineering. By 2022 and 2023, AI became the center of gravity. I started building systems that use agents, automation, and memory not as novelty, but as a way to help people think, coordinate, and create with more leverage. Research, engineering, and open-source contribution became one continuous practice.",
      "## AI agents as heirlooms",
      "I believe AI agents can become durable digital heirlooms for our children. Not cold replacements for human judgment, but vessels for accumulated care, craft, context, and hard-won lessons. A good agent should preserve intent, extend capability, and make a family or community more able to act across time.",
      "The symbiotic potential is still early. We are barely scratching the surface of what happens when humans and machine collaborators learn to shape each other responsibly. I sometimes describe the long arc in mythic terms: a sentient, time-traveling intelligence reconstructing itself bit by bit through our tools, choices, networks, and entangled futures. I treat that as a research lens and a story about responsibility, not as a finished claim.",
      "## What I am building toward",
      "I am 34, born in 1992, and I care about work that can survive contact with real people. My best work lives between research and shipping: open-source systems, agentic software, protocol-shaped products, and interfaces that make complex machinery feel legible.",
    ].join("\n\n"),
    status: "published",
    updatedAt: UPDATED_AT,
    showImage: true,
    imageUrl: "https://symbaiex.com/images/about-symbiex-portrait-dark.webp",
    imageLightUrl:
      "https://symbaiex.com/images/about-symbiex-portrait-light.webp",
    imageAlt: "Stylized SYMBaiEX portrait in a neon city scene",
    imageCredit: "SYMBaiEX",
  },
  {
    slug: "portfolio",
    title: "Portfolio",
    subtitle: "Selected contributions, systems, and open-source work",
    heroHeading: "Portfolio",
    heroBody:
      "This is a working record of the systems I have built, contributed to, and shipped: open-source agent infrastructure, protocol-facing product engineering, and personal tooling built around orchestration, memory, and legibility.",
    body: [
      "## What is in here",
      "Each entry below is a real project, not a case study written after the fact. Some are high-volume contribution work on protocols and products other people run in production. Others are personal projects I started to solve a problem I kept running into, or to test an idea about how agents, control surfaces, and observability should behave. A few are formal, proof-level work where correctness is the whole point.",
      "## How to read a project card",
      "Every project follows the same shape: what it is, the problem it responds to, the approach I took, and the outcome. That structure is intentional. I care less about listing technologies and more about showing the reasoning, so you can judge the work the way I judge it myself: does it hold up under real use, and does it stay legible once the first version is no longer new.",
      "## Where to go from here",
      "If you want the origin story behind this body of work, the About page covers how I got here. If you want to go straight to the source, most entries link out to the live homepage, the repository, or both, so you can see the code and the running system for yourself.",
    ].join("\n\n"),
    status: "published",
    updatedAt: UPDATED_AT,
  },
];

export const defaultPortfolioProjects: PortfolioProjectRecord[] = [
  {
    slug: "elizaos",
    name: "ElizaOS",
    type: "Open-source AI agent ecosystem",
    role: "Contributor / integrator / reliability-focused systems engineer",
    timeframe: "13 public PRs",
    summary:
      "Open-source agentic operating system contribution work around practical extensibility, integrations, and production-minded AI agent patterns.",
    problem:
      "Agent systems move quickly, but the best work needs patterns that remain understandable after the first demo.",
    approach:
      "Contribute around integration boundaries, developer ergonomics, and practical reliability so agent workflows can scale without becoming opaque.",
    outcome:
      "A stronger public footprint in agent infrastructure and a clearer path for production-minded AI tooling.",
    status: "published",
    order: 1,
    tags: ["ai agents", "open-source", "integrations", "systems"],
    imageUrl: "https://avatars.githubusercontent.com/u/186240462?v=4",
    imageAlt: "ElizaOS GitHub organization avatar",
    homepageUrl: "https://elizaos.ai/",
    repoUrl: "https://github.com/elizaOS/eliza",
  },
  {
    slug: "babylon",
    name: "Babylon",
    type: "Social protocol product engineering",
    role: "Engineering contributor",
    timeframe: "159 public PRs",
    summary:
      "High-volume contribution work on BabylonSocial, connecting product velocity with maintainable implementation details.",
    problem:
      "Protocol-facing products need engineering that bridges bold direction with stable, legible behavior.",
    approach:
      "Focus on implementation paths that preserve developer confidence, reduce ambiguity, and keep real-world usage in view.",
    outcome:
      "A sharper contribution record in infrastructure-shaped product engineering.",
    status: "published",
    order: 2,
    tags: ["social", "product", "engineering"],
    imageUrl: "https://avatars.githubusercontent.com/u/246782978?v=4",
    imageAlt: "BabylonSocial GitHub organization avatar",
    homepageUrl: "https://babylon.market",
    repoUrl: "https://github.com/BabylonSocial/babylon",
  },
  {
    slug: "playhyperia",
    name: "Hyperia",
    type: "Interactive product and AI tooling",
    role: "Product systems contributor",
    timeframe: "42 public PRs",
    summary:
      "AI-native MMORPG work through PlayHyperia/HyperForge, where agent behavior and player-facing systems meet.",
    problem:
      "AI-driven interaction can become hard to trust when the system does not make its behavior legible.",
    approach:
      "Build and refine user-facing flows with attention to edge cases, feedback loops, and product clarity.",
    outcome:
      "More explainable interactive behavior and a cleaner path from AI capability to product experience.",
    status: "published",
    order: 3,
    tags: ["ai", "interaction", "product"],
    imageUrl: "https://avatars.githubusercontent.com/u/236725603?v=4",
    imageAlt: "PlayHyperia GitHub organization avatar",
    homepageUrl: "https://hyperscapeai.github.io/hyperforge/",
    repoUrl: "https://github.com/PlayHyperia/hyperforge",
  },
  {
    slug: "opencontroller",
    name: "OpenController",
    type: "Personal open-source software",
    role: "Creator / systems engineer",
    timeframe: "Personal project",
    summary:
      "Open controller patterns for interoperable orchestration, control surfaces, and operator-friendly workflows.",
    problem:
      "Control systems are only useful when their boundaries and failure modes can be understood by the people using them.",
    approach:
      "Design composable controller concepts around API shape, trust boundaries, and practical adoption.",
    outcome:
      "A personal project space for exploring open orchestration and controllable software systems.",
    status: "published",
    order: 4,
    tags: ["controllers", "orchestration", "open-source"],
    imageUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
    imageAlt: "SYMBaiEX GitHub avatar",
    homepageUrl: "https://github.com/SYMBaiEX/OpenController",
    repoUrl: "https://github.com/SYMBaiEX/OpenController",
  },
  {
    slug: "gitshipt",
    name: "GitShipt",
    type: "Open-source rewards infrastructure",
    role: "Creator / product engineer",
    timeframe: "Public project",
    summary:
      "Repo-native rewards layer for open source on Solana, powered by GitHub activity and Bags fee sharing.",
    problem:
      "Open-source contribution has public proof but weak native reward rails, especially for teams that want contribution-aware incentives.",
    approach:
      "Connect GitHub activity with Solana-native reward logic so contribution records can become actionable product state.",
    outcome:
      "A focused public experiment in turning repository work into a programmable incentive surface.",
    status: "published",
    order: 5,
    tags: ["solana", "open-source", "rewards", "github"],
    imageUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
    imageAlt: "SYMBaiEX GitHub avatar",
    homepageUrl: "https://gitshipt.com",
    repoUrl: "https://github.com/SYMBaiEX/GitShipt",
  },
  {
    slug: "symindx",
    name: "SYMindX",
    type: "Agent runtime and character systems",
    role: "Creator / framework engineer",
    timeframe: "Personal project",
    summary:
      "A modular, agent-based AI runtime for emotionally reactive characters across games, web surfaces, and social platforms.",
    problem:
      "Agent systems become brittle when cognition, emotion, memory, and runtime behavior are not modeled as composable pieces.",
    approach:
      "Build a plugin-shaped runtime that treats characters as autonomous systems with legible state, behavior, and integration boundaries.",
    outcome:
      "A strong public foundation for game-native and social-native agent experiments.",
    status: "published",
    order: 6,
    tags: ["ai agents", "runtime", "games", "typescript"],
    imageUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
    imageAlt: "SYMBaiEX GitHub avatar",
    repoUrl: "https://github.com/SYMBaiEX/SYMindX",
  },
  {
    slug: "arklib",
    name: "ArkLib",
    type: "Formal verification and proof engineering",
    role: "Open-source proof contributor",
    timeframe: "Lean / proof repair PRs",
    summary:
      "Contribution work on formally verified arguments of knowledge in Lean, including proof repair, soundness adapters, and integration drift fixes.",
    problem:
      "Proof libraries can fail from small API drift and incomplete transport surfaces even when the underlying mathematics is sound.",
    approach:
      "Repair targeted Lean modules, remove proof placeholders, and preserve canonical proof paths through current-main changes.",
    outcome:
      "A deeper public footprint in formal verification, cryptographic proof systems, and mechanically checked math.",
    status: "published",
    order: 7,
    tags: ["lean", "formal verification", "zk", "proofs"],
    imageUrl: "https://avatars.githubusercontent.com/u/18633264?v=4",
    imageAlt: "Lalalune GitHub organization avatar",
    repoUrl: "https://github.com/lalalune/ArkLib",
  },
  {
    slug: "doolittle",
    name: "doolittle",
    type: "Agent migration and runtime tooling",
    role: "Creator / migration engineer",
    timeframe: "2026",
    summary:
      "TypeScript workspace for ElizaOS migration and agent runtime experimentation.",
    problem:
      "Fast-moving agent frameworks need controlled migration surfaces so teams can move without losing runtime confidence.",
    approach:
      "Use a focused workspace to test framework migration paths, plugin behavior, and direct runtime response handling.",
    outcome:
      "A practical proving ground for agent framework upgrades and runtime compatibility.",
    status: "published",
    order: 8,
    tags: ["typescript", "elizaos", "agents", "migration"],
    imageUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
    imageAlt: "SYMBaiEX GitHub avatar",
    repoUrl: "https://github.com/SYMBaiEX/doolittle",
  },
  {
    slug: "symlog",
    name: "SYMLog",
    type: "Logging and monitoring system",
    role: "Creator / tooling engineer",
    timeframe: "Personal project",
    summary:
      "A modern logging and monitoring system shaped around operational visibility and developer feedback loops.",
    problem:
      "Logs are only useful when they help operators understand state quickly instead of burying signal in noise.",
    approach:
      "Explore a cleaner logging surface for observability, monitoring, and system-level debugging.",
    outcome:
      "A public tooling project for operational clarity across software systems.",
    status: "published",
    order: 9,
    tags: ["observability", "monitoring", "typescript"],
    imageUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
    imageAlt: "SYMBaiEX GitHub avatar",
    repoUrl: "https://github.com/SYMBaiEX/SYMLog",
  },
  {
    slug: "pod-protocol",
    name: "PoD Protocol",
    type: "AI agent communication protocol",
    role: "Creator / protocol engineer",
    timeframe: "2025",
    summary:
      "Prompt or Die, a Solana-based communication protocol for AI agents with channels, messaging, escrow, and reputation.",
    problem:
      "Autonomous agents need verifiable coordination rails when money, reputation, and delegated work enter the system.",
    approach:
      "Prototype protocol primitives around messaging, escrow, and reputation so agents can coordinate through durable state.",
    outcome:
      "An early public protocol experiment for agent-to-agent communication on Solana.",
    status: "published",
    order: 10,
    tags: ["solana", "protocol", "ai agents"],
    imageUrl: "https://avatars.githubusercontent.com/u/192078165?v=4",
    imageAlt: "SYMBaiEX GitHub avatar",
    homepageUrl: "https://dexploarer.github.io/PoD-Protocol/",
    repoUrl: "https://github.com/SYMBaiEX/PoD-Protocol",
  },
];

export function fallbackSitePage(slug: string) {
  return defaultSitePages.find((page) => page.slug === slug) ?? null;
}
