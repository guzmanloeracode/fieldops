import { expect, test } from "@playwright/test";
import { storageState } from "./fixtures";

// "Try these 5 things" (DEM-06): a per-role checklist for demo visitors that remembers what was tried and stays
// hidden once dismissed (in this browser).

test.describe("as the demo owner", () => {
  test.use({ storageState: storageState("owner") });

  test("ticks off what was tried and stays hidden once dismissed", async ({ page }) => {
    await page.goto("/dashboard");
    const tour = page.getByTestId("demo-tour");
    await expect(tour.getByRole("heading", { name: "Try these 5 things" })).toBeVisible();
    await expect(tour).toContainText("0 of 5 tried");
    await tour.getByRole("link", { name: /audit log/ }).click();
    await expect(page).toHaveURL(/\/settings\/audit$/);

    await page.goto("/dashboard");
    await expect(tour).toContainText("1 of 5 tried");
    await expect(tour.getByRole("link", { name: /audit log \(Done\)/ })).toBeVisible();
    await tour.getByRole("button", { name: "Hide the tour" }).click();
    await expect(tour).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("demo-tour")).toHaveCount(0);
  });
});

test.describe("as the demo technician", () => {
  test.use({ storageState: storageState("technician") });

  test("shows the technician's own tour", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("demo-tour")).toContainText("See today's visits in My day");
  });
});
