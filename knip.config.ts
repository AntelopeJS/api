import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  ignoreDependencies: ["reflect-metadata", "@types/mocha"],
});
