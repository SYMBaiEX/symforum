import { expect, test } from "vitest";
import { forumReplyBranches } from "./forum-reply-branches";
test("context orders shallow branches without dropping or renumbering cross-page replies", () => {
  const posts = [
    { _id: "root", n: 1 },
    { _id: "a", n: 2 },
    { _id: "b", n: 3 },
    { _id: "c", parentPostId: "a", n: 4 },
    { _id: "d", parentPostId: "c", n: 5 },
    { _id: "e", parentPostId: "d", n: 6 },
    { _id: "off-page", parentPostId: "earlier", n: 7 },
  ];
  expect(
    forumReplyBranches(posts).map(({ post, depth }) => [
      post._id,
      post.n,
      depth,
    ]),
  ).toEqual([
    ["root", 1, 0],
    ["a", 2, 0],
    ["c", 4, 1],
    ["d", 5, 2],
    ["e", 6, 2],
    ["b", 3, 0],
    ["off-page", 7, 0],
  ]);
});
test("cycles never lose or infinitely repeat replies", () => {
  const posts = [
    { _id: "a", parentPostId: "b" },
    { _id: "b", parentPostId: "a" },
  ];
  expect(forumReplyBranches(posts)).toHaveLength(2);
});
