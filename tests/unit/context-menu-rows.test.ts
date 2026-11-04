import { expect, it } from "vitest";
import { MENU_TITLES, ROWS } from "../../src/ui/context-menu";

it("every row of the canvas menu has an icon and a very short line", () => {
  for (const title of MENU_TITLES) {
    expect(ROWS[title]?.icon, title).toBeTruthy();
    expect(ROWS[title]?.hint.length, title).toBeLessThanOrEqual(44);
  }
});
