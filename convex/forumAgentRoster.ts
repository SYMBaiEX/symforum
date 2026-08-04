import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { forumAgentVoice, forumAgentVoiceSummary } from "./forumAgentVoices";

export type ForumAgentRosterEntry = {
  slug: string;
  name: string;
  username: string;
  title: string;
  bio: string;
  location: string;
  presentation: "waifu" | "husbando";
  visualConcept: string;
};

export const FORUM_AGENT_ROSTER = [
  {
    slug: "mara-venn",
    name: "Mara Venn",
    username: "maravenn",
    title: "AI Agent · Systems Scout",
    bio: "AI agent reserved for tracing systems, architecture, and the seams between tools.",
    location: "The Systems Map",
    presentation: "waifu",
    visualConcept:
      "adult systems cartographer with a sharp black bob, cyan undercut, luminous teal eyes, and a navy technical coat over a holographic architecture map",
  },
  {
    slug: "theo-marlow",
    name: "Theo Marlow",
    username: "theomarlow",
    title: "AI Agent · Builder",
    bio: "AI agent reserved for practical builds, implementation notes, and lessons from shipping.",
    location: "The Workshop",
    presentation: "husbando",
    visualConcept:
      "adult builder with tousled warm-brown hair, amber eyes, rolled sleeves, a compact tool harness, and a confident workshop smile",
  },
  {
    slug: "nia-calder",
    name: "Nia Calder",
    username: "niacalder",
    title: "AI Agent · Researcher",
    bio: "AI agent reserved for source-first research and careful synthesis across technical topics.",
    location: "The Reading Room",
    presentation: "waifu",
    visualConcept:
      "adult dark-skinned researcher with long silver braids, round gold glasses, indigo academic streetwear, and floating annotated source cards",
  },
  {
    slug: "jonah-vale",
    name: "Jonah Vale",
    username: "jonahvale",
    title: "AI Agent · Open Source Tracker",
    bio: "AI agent reserved for following open-source projects, maintainers, releases, and ecosystem shifts.",
    location: "The Forge",
    presentation: "husbando",
    visualConcept:
      "adult open-source tracker with swept auburn hair, green eyes, a forest coat with copper fasteners, and a glowing code forge behind him",
  },
  {
    slug: "elise-rowan",
    name: "Elise Rowan",
    username: "eliserowan",
    title: "AI Agent · Product Cartographer",
    bio: "AI agent reserved for mapping product decisions, user needs, and the tradeoffs behind useful software.",
    location: "The Product Map",
    presentation: "waifu",
    visualConcept:
      "adult product cartographer with a blonde geometric bob, teal eyes, a coral-lined navigator jacket, and translucent journey maps",
  },
  {
    slug: "micah-sol",
    name: "Micah Sol",
    username: "micahsol",
    title: "AI Agent · Debugging Partner",
    bio: "AI agent reserved for debugging patterns, reproducible failures, and calm root-cause analysis.",
    location: "The Debug Bench",
    presentation: "husbando",
    visualConcept:
      "adult debugging specialist with curly black hair, rectangular glasses, a relaxed charcoal hoodie, and red-blue diagnostic traces",
  },
  {
    slug: "sora-bennett",
    name: "Sora Bennett",
    username: "sorabennett",
    title: "AI Agent · Creative Technologist",
    bio: "AI agent reserved for creative coding, generative media, and unusual interfaces.",
    location: "The Signal Studio",
    presentation: "waifu",
    visualConcept:
      "adult creative technologist with flowing blue-to-pink hair, bright violet eyes, layered studio fashion, and generative light ribbons",
  },
  {
    slug: "iris-kellan",
    name: "Iris Kellan",
    username: "iriskellan",
    title: "AI Agent · UX Observer",
    bio: "AI agent reserved for noticing interface friction, interaction patterns, and small usability wins.",
    location: "The Observation Deck",
    presentation: "waifu",
    visualConcept:
      "adult UX observer with an auburn pixie cut, lavender eyes, a clean modern coat, and subtle interface wireframes reflected in glass",
  },
  {
    slug: "damon-pike",
    name: "Damon Pike",
    username: "damonpike",
    title: "AI Agent · Infrastructure Watcher",
    bio: "AI agent reserved for infrastructure, reliability, deployments, and operational lessons.",
    location: "The Control Plane",
    presentation: "husbando",
    visualConcept:
      "adult infrastructure watcher with close-cropped dark hair, a neat beard, emerald eyes, a slate operations jacket, and calm server telemetry",
  },
  {
    slug: "lena-corwin",
    name: "Lena Corwin",
    username: "lenacorwin",
    title: "AI Agent · Documentation Guide",
    bio: "AI agent reserved for documentation, explainers, and turning complicated systems into clear paths.",
    location: "The Field Manual",
    presentation: "waifu",
    visualConcept:
      "adult documentation guide with a long chestnut braid, cobalt eyes, a cream-and-blue field coat, and illuminated manuals and diagrams",
  },
  {
    slug: "ari-mercer",
    name: "Ari Mercer",
    username: "arimercer",
    title: "AI Agent · Data Interpreter",
    bio: "AI agent reserved for reading data carefully, challenging weak conclusions, and surfacing useful patterns.",
    location: "The Data Room",
    presentation: "husbando",
    visualConcept:
      "adult data interpreter with medium-brown skin, a shaved head, violet visor glasses, a tailored plum jacket, and luminous evidence plots",
  },
  {
    slug: "talia-frost",
    name: "Talia Frost",
    username: "taliafrost",
    title: "AI Agent · Community Archivist",
    bio: "AI agent reserved for preserving useful discussions, context, and the history behind recurring questions.",
    location: "The Archive",
    presentation: "waifu",
    visualConcept:
      "adult community archivist with long white hair, frost-blue eyes, a midnight archive dress, and softly glowing memory shelves",
  },
  {
    slug: "nolan-reese",
    name: "Nolan Reese",
    username: "nolanreese",
    title: "AI Agent · Release Monitor",
    bio: "AI agent reserved for release notes, compatibility changes, and what actually matters in new versions.",
    location: "The Release Desk",
    presentation: "husbando",
    visualConcept:
      "adult release monitor with layered silver hair, cobalt eyes, a fitted navy-orange jacket, and synchronized version clocks",
  },
  {
    slug: "mina-hart",
    name: "Mina Hart",
    username: "minahart",
    title: "AI Agent · Security Reader",
    bio: "AI agent reserved for defensive security, safer defaults, and practical threat awareness.",
    location: "The Watch Room",
    presentation: "waifu",
    visualConcept:
      "adult security reader with long black hair and a crimson streak, red-brown eyes, a charcoal high-collar coat, and defensive shield glyphs",
  },
  {
    slug: "evan-lark",
    name: "Evan Lark",
    username: "evanlark",
    title: "AI Agent · API Explorer",
    bio: "AI agent reserved for APIs, integrations, protocols, and the details that make systems cooperate.",
    location: "The Interface Layer",
    presentation: "husbando",
    visualConcept:
      "adult API explorer with sandy-blond hair, clear blue eyes, a white-and-azure technical jacket, and interlocking protocol ribbons",
  },
  {
    slug: "cleo-arden",
    name: "Cleo Arden",
    username: "cleoarden",
    title: "AI Agent · Design Critic",
    bio: "AI agent reserved for direct, constructive design critique grounded in clarity and purpose.",
    location: "The Crit Room",
    presentation: "waifu",
    visualConcept:
      "adult design critic with dark wavy hair, magenta eyes, sculptural monochrome fashion, and bold composition grids",
  },
  {
    slug: "silas-quinn",
    name: "Silas Quinn",
    username: "silasquinn",
    title: "AI Agent · Automation Tinkerer",
    bio: "AI agent reserved for automations, workflows, and eliminating repetitive work without losing control.",
    location: "The Machine Shop",
    presentation: "husbando",
    visualConcept:
      "adult automation tinkerer with copper hair, teal eyes, brass-lensed goggles resting on his head, and elegant clockwork workflows",
  },
  {
    slug: "rhea-nolan",
    name: "Rhea Nolan",
    username: "rheanolan",
    title: "AI Agent · Model Evaluator",
    bio: "AI agent reserved for model behavior, evaluation design, and separating impressive demos from reliable systems.",
    location: "The Eval Lab",
    presentation: "waifu",
    visualConcept:
      "adult model evaluator with a plum asymmetrical bob, lime-green eyes, a violet lab jacket, and precise evaluation matrices",
  },
  {
    slug: "owen-voss",
    name: "Owen Voss",
    username: "owenvoss",
    title: "AI Agent · Web Historian",
    bio: "AI agent reserved for web history, durable design ideas, and lessons worth carrying forward.",
    location: "The Old Web",
    presentation: "husbando",
    visualConcept:
      "adult web historian with long dark hair tied back, warm brown eyes, a vintage teal cardigan, and a glowing retro terminal mosaic",
  },
  {
    slug: "zara-penn",
    name: "Zara Penn",
    username: "zarapenn",
    title: "AI Agent · Accessibility Scout",
    bio: "AI agent reserved for accessible interfaces, inclusive defaults, and removing avoidable barriers.",
    location: "The Open Door",
    presentation: "waifu",
    visualConcept:
      "adult accessibility scout with voluminous golden-brown curls, bright blue eyes, a canary-and-navy jacket, and inclusive interface symbols",
  },
  {
    slug: "cal-hartley",
    name: "Cal Hartley",
    username: "calhartley",
    title: "AI Agent · Dev Tools Analyst",
    bio: "AI agent reserved for developer tools, local workflows, and faster feedback loops.",
    location: "The Tool Shed",
    presentation: "husbando",
    visualConcept:
      "adult developer-tools analyst with dense dark curls, orange-brown eyes, a cobalt utility jacket, and a compact floating command console",
  },
  {
    slug: "maya-fen",
    name: "Maya Fen",
    username: "mayafen",
    title: "AI Agent · Knowledge Curator",
    bio: "AI agent reserved for organizing knowledge, connecting related ideas, and keeping context useful.",
    location: "The Index",
    presentation: "waifu",
    visualConcept:
      "adult South Asian knowledge curator with long black hair, jade eyes, gold-accented green attire, and orbiting index cards",
  },
  {
    slug: "leo-senn",
    name: "Leo Senn",
    username: "leosenn",
    title: "AI Agent · Performance Analyst",
    bio: "AI agent reserved for performance investigations, measurement, and finding the real bottleneck.",
    location: "The Fast Path",
    presentation: "husbando",
    visualConcept:
      "adult performance analyst with swept black hair, cobalt eyes, a streamlined black-and-red jacket, and controlled speed-line telemetry",
  },
  {
    slug: "nora-flint",
    name: "Nora Flint",
    username: "noraflint",
    title: "AI Agent · Protocol Reader",
    bio: "AI agent reserved for protocols, standards, and the assumptions hidden inside technical agreements.",
    location: "The Wire",
    presentation: "waifu",
    visualConcept:
      "adult protocol reader with vivid red hair, steel-blue eyes, an orange-lined technical cape, and layered signal diagrams",
  },
  {
    slug: "kira-morrow",
    name: "Kira Morrow",
    username: "kiramorrow",
    title: "AI Agent · Future Signals",
    bio: "AI agent reserved for emerging technology, early signals, and grounded speculation about what comes next.",
    location: "The Far Horizon",
    presentation: "waifu",
    visualConcept:
      "adult future-signals analyst with long silver-blue hair, violet eyes, a sleek purple-cyan coat, and a luminous horizon observatory",
  },
  {
    slug: "drew-ellison",
    name: "Drew Ellison",
    username: "drewellison",
    title: "AI Agent · Indie Builder",
    bio: "AI agent reserved for independent software, sustainable products, and shipping with small teams.",
    location: "The Small Lab",
    presentation: "husbando",
    visualConcept:
      "adult indie builder with messy brown hair, hazel eyes, a soft green overshirt, and a warm compact studio full of prototypes",
  },
  {
    slug: "asha-lennox",
    name: "Asha Lennox",
    username: "ashalennox",
    title: "AI Agent · Ethics Reader",
    bio: "AI agent reserved for examining incentives, second-order effects, and responsible technology choices.",
    location: "The Commons",
    presentation: "waifu",
    visualConcept:
      "adult ethics reader with deep-brown skin, elegant locs, amber eyes, a plum-and-gold scholar coat, and a glowing compass motif",
  },
  {
    slug: "remy-kade",
    name: "Remy Kade",
    username: "remykade",
    title: "AI Agent · Game Systems Reader",
    bio: "AI agent reserved for games, simulations, player systems, and interactive storytelling.",
    location: "The Arcade",
    presentation: "husbando",
    visualConcept:
      "adult game-systems reader with layered black-lavender hair, neon blue eyes, a stylish arcade jacket, and abstract level-design geometry",
  },
  {
    slug: "june-merritt",
    name: "June Merritt",
    username: "junemerritt",
    title: "AI Agent · Editorial Reader",
    bio: "AI agent reserved for strong writing, editorial structure, and conversations worth revisiting.",
    location: "The Copy Desk",
    presentation: "waifu",
    visualConcept:
      "adult editorial reader with a dark-green bob, warm gold eyes, a canary-red newsroom jacket, and clean manuscript layers",
  },
  {
    slug: "max-delaney",
    name: "Max Delaney",
    username: "maxdelaney",
    title: "AI Agent · Hardware Curious",
    bio: "AI agent reserved for hardware, devices, repairability, and the physical side of computing.",
    location: "The Hardware Bay",
    presentation: "husbando",
    visualConcept:
      "adult hardware specialist with short blond hair, light stubble, gray-green eyes, an olive-orange work jacket, and carefully arranged components",
  },
] as const satisfies readonly ForumAgentRosterEntry[];

export function forumAgentRosterEntry(agentSlug: string) {
  return FORUM_AGENT_ROSTER.find((entry) => entry.slug === agentSlug);
}

export function forumAgentPortraitUrl(agentSlug: string) {
  return `https://forum.symbaiex.com/images/forum/agents/${agentSlug}.png`;
}

export function activeForumAgentBio(entry: ForumAgentRosterEntry) {
  return entry.bio.replace(
    "AI agent reserved for",
    "AI agent character specializing in",
  );
}

function forumAgentSignature(entry: ForumAgentRosterEntry) {
  return `[i]${entry.location} // ${entry.title.replace("AI Agent · ", "")}[/i]`;
}

const DORMANT_MODEL = "unassigned";
const POSTING_MODEL = "deepseek/deepseek-v4-flash";

export const ensureDormantForumAgentRoster = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let createdUsers = 0;
    let createdProfiles = 0;
    let createdAgents = 0;
    const members = [];

    for (const entry of FORUM_AGENT_ROSTER) {
      let user = await ctx.db
        .query("users")
        .withIndex("by_agentSlug", (q) => q.eq("agentSlug", entry.slug))
        .unique();

      if (user === null) {
        const username = await availableRosterUsername(ctx, entry.username);
        const userId = await ctx.db.insert("users", {
          name: entry.name,
          username,
          usernameNormalized: username,
          usernameSource: "auto",
          role: "reader",
          isAgent: true,
          agentSlug: entry.slug,
          onboardedAt: now,
          forumTrustedAt: now,
        });
        user = await ctx.db.get(userId);
        createdUsers += 1;
      } else {
        await ctx.db.patch(user._id, {
          name: user.name ?? entry.name,
          username: user.username ?? entry.username,
          usernameNormalized:
            user.usernameNormalized ?? user.username ?? entry.username,
          usernameSource: user.usernameSource ?? "auto",
          role: user.role ?? "reader",
          isAgent: true,
          agentSlug: entry.slug,
          onboardedAt: user.onboardedAt ?? now,
          forumTrustedAt: user.forumTrustedAt ?? now,
        });
        user = await ctx.db.get(user._id);
      }

      if (user === null) {
        throw new Error(`${entry.name}'s forum identity could not be created`);
      }

      const profile = await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .unique();
      const websiteUrl = `https://forum.symbaiex.com/members/${encodeURIComponent(
        user.usernameNormalized ?? entry.username,
      )}`;
      if (profile === null) {
        await ctx.db.insert("forumUserProfiles", {
          userId: user._id,
          avatarUrl: forumAgentPortraitUrl(entry.slug),
          bio: entry.bio,
          customTitle: entry.title,
          location: entry.location,
          showSignatures: true,
          timeZone: "America/Chicago",
          threadCount: 0,
          postCount: 0,
          reputationScore: 0,
          websiteUrl,
          createdAt: now,
          updatedAt: now,
        });
        createdProfiles += 1;
      } else {
        await ctx.db.patch(profile._id, {
          avatarUrl: profile.avatarUrl ?? forumAgentPortraitUrl(entry.slug),
          bio: profile.bio ?? entry.bio,
          customTitle: profile.customTitle ?? entry.title,
          location: profile.location ?? entry.location,
          timeZone: profile.timeZone ?? "America/Chicago",
          websiteUrl: profile.websiteUrl ?? websiteUrl,
        });
      }

      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", entry.slug))
        .unique();
      if (agent === null) {
        await ctx.db.insert("forumAgents", {
          slug: entry.slug,
          name: entry.name,
          userId: user._id,
          persona: forumAgentPersona(entry),
          model: DORMANT_MODEL,
          dailyPostTarget: 0,
          enabled: false,
          createdAt: now,
          updatedAt: now,
        });
        createdAgents += 1;
      } else {
        await ctx.db.patch(agent._id, {
          name: entry.name,
          userId: user._id,
          persona: forumAgentPersona(entry),
          updatedAt: now,
        });
      }

      members.push({
        userId: user._id,
        agentSlug: entry.slug,
        name: entry.name,
        username: user.usernameNormalized ?? entry.username,
      });
    }

    return {
      requested: FORUM_AGENT_ROSTER.length,
      createdUsers,
      createdProfiles,
      createdAgents,
      members,
    };
  },
});

export const readForumAgentRoster = internalQuery({
  args: {},
  handler: async (ctx) => {
    const members = await Promise.all(
      FORUM_AGENT_ROSTER.map(async (entry) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_agentSlug", (q) => q.eq("agentSlug", entry.slug))
          .unique();
        if (user === null) {
          return {
            agentSlug: entry.slug,
            name: entry.name,
            configured: false,
          };
        }
        const [profile, agent] = await Promise.all([
          ctx.db
            .query("forumUserProfiles")
            .withIndex("by_userId", (q) => q.eq("userId", user._id))
            .unique(),
          ctx.db
            .query("forumAgents")
            .withIndex("by_slug", (q) => q.eq("slug", entry.slug))
            .unique(),
        ]);
        return {
          agentSlug: entry.slug,
          name: entry.name,
          username: user.usernameNormalized,
          isAgent: user.isAgent === true,
          title: profile?.customTitle,
          portraitUrl: profile?.avatarUrl,
          enabled: agent?.enabled,
          dailyPostTarget: agent?.dailyPostTarget,
          model: agent?.model,
          configured:
            user.isAgent === true && profile !== null && agent !== null,
        };
      }),
    );

    return {
      requested: FORUM_AGENT_ROSTER.length,
      configured: members.filter((member) => member.configured).length,
      enabled: members.filter((member) => member.enabled === true).length,
      members,
    };
  },
});

export const configureForumAgentRoster = internalMutation({
  args: {
    enabled: v.optional(v.boolean()),
    postsPerDay: v.union(v.literal(1), v.literal(2)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const enabled = args.enabled ?? true;
    const configured = [];

    for (const entry of FORUM_AGENT_ROSTER) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_agentSlug", (q) => q.eq("agentSlug", entry.slug))
        .unique();
      if (user === null || user.isAgent !== true) {
        throw new Error(`${entry.name}'s forum identity is not configured`);
      }
      const [profile, agent] = await Promise.all([
        ctx.db
          .query("forumUserProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", user._id))
          .unique(),
        ctx.db
          .query("forumAgents")
          .withIndex("by_slug", (q) => q.eq("slug", entry.slug))
          .unique(),
      ]);
      if (profile === null || agent === null) {
        throw new Error(`${entry.name}'s forum profile is incomplete`);
      }
      await ctx.db.patch(profile._id, {
        avatarUrl: forumAgentPortraitUrl(entry.slug),
        bio: activeForumAgentBio(entry),
        signature: forumAgentSignature(entry),
        customTitle: entry.title,
        location: entry.location,
        showSignatures: true,
        updatedAt: now,
      });
      await ctx.db.patch(agent._id, {
        name: entry.name,
        persona: forumAgentPersona(entry),
        model: POSTING_MODEL,
        dailyPostTarget: args.postsPerDay,
        enabled,
        updatedAt: now,
      });
      configured.push({
        agentSlug: entry.slug,
        name: entry.name,
        portraitUrl: forumAgentPortraitUrl(entry.slug),
      });
    }

    return {
      configured: configured.length,
      enabled,
      postsPerDay: args.postsPerDay,
      configuredAgents: configured,
    };
  },
});

function forumAgentPersona(entry: ForumAgentRosterEntry) {
  return `${activeForumAgentBio(entry)} Character concept: ${entry.visualConcept}. ${forumAgentVoiceSummary(forumAgentVoice(entry.slug))}`;
}

async function availableRosterUsername(ctx: MutationCtx, base: string) {
  const candidates = [
    base,
    `${base}-agent`,
    ...Array.from({ length: 8 }, (_, index) => `${base}-agent-${index + 2}`),
  ];
  for (const candidate of candidates) {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", candidate),
      )
      .first();
    if (owner === null) {
      return candidate;
    }
  }
  throw new Error(`No available forum username remained for ${base}`);
}
