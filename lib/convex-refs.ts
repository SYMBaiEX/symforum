import { makeFunctionReference } from "convex/server";

export const convexRefs = {
  comments: {
    list: makeFunctionReference<
      "query",
      { entityType: "post" | "hnStory"; entityId: string },
      Array<{
        _id: string;
        userId: string;
        entityType: "post" | "hnStory";
        entityId: string;
        body: string;
        createdAt: number;
        author: string;
      }>
    >("comments:list"),
    add: makeFunctionReference<
      "mutation",
      { entityType: "post" | "hnStory"; entityId: string; body: string },
      null
    >("comments:add"),
  },
  interactions: {
    summary: makeFunctionReference<
      "query",
      { entityType: "post" | "hnStory"; entityId: string },
      {
        score: number;
        saves: number;
        viewer: { vote: number; saved: boolean } | null;
      }
    >("interactions:summary"),
    set: makeFunctionReference<
      "mutation",
      {
        entityType: "post" | "hnStory";
        entityId: string;
        vote: -1 | 0 | 1;
        saved: boolean;
      },
      null
    >("interactions:set"),
  },
  news: {
    latest: makeFunctionReference<
      "query",
      Record<string, never>,
      {
        snapshot: { snapshotDate: string } | null;
        stories: Array<{
          hnItemId: number;
          rank: number;
          title: string;
          url?: string;
          host?: string;
          by?: string;
          score?: number;
          descendants?: number;
        }>;
      }
    >("news:latest"),
    getStory: makeFunctionReference<
      "query",
      { hnItemId: number },
      {
        hnItemId: number;
        snapshotDate: string;
        rank: number;
        title: string;
        url?: string;
        host?: string;
        by?: string;
        text?: string;
        score?: number;
        descendants?: number;
        timePosted?: number;
        fetchedAt: number;
      } | null
    >("news:getStory"),
  },
};
