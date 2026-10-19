import { resolve } from "node:path";

/**
 * The build the tests open: the snapshot `npm run test:snap` made (CANVAST_BUILD_DIR). Never `dist/`: that is the owner's build, in development, and a rebuild
 * in the middle of a run would mix two versions in one result.
 */
export function buildDir(): string {
  const dir = process.env["CANVAST_BUILD_DIR"];
  if (!dir) throw new Error("No test build: run the tests with `npm run test:snap -- <args>` (or `npm test`), which builds a snapshot of its own. dist/ is not used by tests.");
  return resolve(dir);
}
