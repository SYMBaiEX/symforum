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
  imageUrl?: string;
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
  },
  {
    slug: "portfolio",
    title: "Portfolio",
    subtitle: "Selected contributions, systems, and open-source work",
    heroHeading: "Work that leaves an interface behind.",
    heroBody: "",
    body: [
      "I build in public through open-source and applied product systems. The work below is organized around the role I played and the constraints I care about: protocol clarity, reliability, developer ergonomics, and interfaces that stay understandable as they scale.",
      "Some entries are full public footprints. Some are still placeholders for deeper case studies. The point is to keep the record alive instead of pretending a portfolio is ever finished.",
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
];

export function fallbackSitePage(slug: string) {
  return defaultSitePages.find((page) => page.slug === slug) ?? null;
}
