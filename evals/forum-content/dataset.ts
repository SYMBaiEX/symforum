import rawDataset from "./cases.json";
import { forumContentDatasetSchema } from "./schema";

/** Only train cases may inform prompt revisions; holdout stays out of refinement context. */
export const forumContentDataset = forumContentDatasetSchema.parse(rawDataset);
export const forumContentTrainCases = forumContentDataset.cases.filter((item) => item.split === "train");
export const forumContentHoldoutCases = forumContentDataset.cases.filter((item) => item.split === "holdout");
