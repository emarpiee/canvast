// Full (milestone) E2E suite: the same tests as playwright.config.ts with the
// long stress loops (thousands of input events). See docs/testing/README.md.
process.env["CANVAST_E2E_FULL"] = "1";
export { default } from "./playwright.config";
