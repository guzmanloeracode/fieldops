import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { storageState } from "./fixtures";

// The desktop sidebar collapses to an icon rail and expands again (button or Ctrl/⌘ B), and remembers the choice.

test.use({ storageState: storageState("dispatcher"), viewport: { width: 1280, height: 800 } });

test("the sidebar collapses to icons, stays usable and remembers the choice", async ({ page }) => {
  await page.goto("/jobs");
  const sidebar = page.getByTestId("app-sidebar");
  const toggle = sidebar.getByTestId("sidebar-toggle");
  const width = async () => (await sidebar.boundingBox())!.width;
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect(toggle).toHaveAccessibleName("Collapse sidebar");
  expect(await width()).toBeGreaterThan(200);

  await toggle.click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(toggle).toHaveAccessibleName("Expand sidebar");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(width).toBeLessThan(80);

  // Links keep their names, show a tooltip and still navigate; the approvals count stays announced.
  await expect(sidebar.getByRole("link", { name: /^Approvals, \d+ pending$/ })).toBeVisible();
  const board = sidebar.getByRole("link", { name: "Dispatch board" });
  await board.hover();
  await expect(page.getByRole("tooltip", { name: "Dispatch board" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await board.click();
  await expect(page).toHaveURL(/\/schedule/);

  // The choice survives a reload, and Ctrl+B expands the sidebar again.
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await page.keyboard.press("Control+b");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect.poll(width).toBeGreaterThan(200);
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
});
