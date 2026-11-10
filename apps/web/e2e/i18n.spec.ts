import { expect, test, type Page } from "@playwright/test";
import { storageState, uniq } from "./fixtures";

// SET-05: English and Bahasa Indonesia. Staff pick their language in the user menu; Acme Teknik's people read
// Indonesian by default; signed-out pages follow the browser; the customer portal follows the customer's business
// and has its own switcher.

// The live event stream keeps a request open; a 204 tells EventSource not to reconnect.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
});

// The user menu sits at the bottom of the sidebar; the keyboard opens it the same way in every build.
async function chooseLanguage(page: Page, name: "English" | "Bahasa Indonesia") {
  const menu = page.getByTestId("user-menu").first();
  await menu.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitemradio", { name }).click();
}

test.describe("the user menu", () => {
  test.use({ storageState: storageState("owner"), viewport: { width: 1280, height: 800 } });

  test("switches the app to Bahasa Indonesia, with Indonesian dates (demo accounts keep it per browser)", async ({
    page,
  }) => {
    await page.goto("/jobs?status=completed");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Jobs" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await chooseLanguage(page, "Bahasa Indonesia");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    const navId = page.getByRole("navigation", { name: "Utama" });
    await expect(navId.getByRole("link", { name: "Pekerjaan" })).toBeVisible();
    await expect(navId.getByRole("link", { name: "Pelanggan" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Pekerjaan" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Selesai" }).first()).toBeVisible();
    await expect(page).toHaveTitle(/^Pekerjaan · FieldOps$/);

    // A job page: day-first dates and a 24-hour clock (14.30).
    await page
      .getByRole("link", { name: /^JOB-\d+$/ })
      .first()
      .click();
    await expect(page.getByText("Dibuat", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4} · \d{2}\.\d{2}/);

    // The language stays after a reload and on other pages.
    await page.goto("/customers");
    await expect(page.getByRole("heading", { level: 1, name: "Pelanggan" })).toBeVisible();

    await chooseLanguage(page, "English");
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test("a new account starts in the browser's language and keeps the language it picks", async ({
  browser,
  baseURL,
}) => {
  // Signed up from an Indonesian browser: the pages, the confirmation email and the starter data are Indonesian.
  const context = await browser.newContext({
    baseURL,
    locale: "id-ID",
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await context.newPage();
    await page.route("**/api/v1/stream", (route) => route.fulfill({ status: 204 }));
    const id = uniq();
    await page.goto("/sign-up");
    await page.getByLabel("Nama Anda").fill("Penguji Bahasa");
    await page.getByLabel("Email").fill(`e2e+id${id}@example.com`);
    await page.getByLabel("Kata sandi").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Buat akun" }).click();
    await expect(page.getByText("Periksa email Anda")).toBeVisible();
    await page.getByRole("link", { name: "Buka kotak masuk demo" }).click();
    await expect(page.getByText("Konfirmasi email Anda untuk FieldOps").first()).toBeVisible();
    await page.getByRole("link", { name: "Konfirmasi email" }).first().click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByLabel("Nama usaha").fill(`Servis Bahasa ${id}`);
    await page.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await page.goto("/settings/service-types");
    await expect(page.getByText("Inspeksi", { exact: true })).toBeVisible();

    // The user menu saves the choice to the account, so it holds without this browser's cookie.
    await chooseLanguage(page, "English");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await context.clearCookies({ name: "fieldops_locale" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test.describe("Acme Teknik", () => {
  test.use({ storageState: storageState("otherOrgOwner") });

  test("Siti, the owner, sees Bahasa Indonesia by default", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(
      page.getByRole("navigation", { name: "Utama" }).getByRole("link", { name: "Beranda" }),
    ).toBeVisible();
    await expect(page.getByText("Pemilik · Acme Teknik Nusantara").first()).toBeVisible();

    await page.goto("/settings/organization");
    await expect(page.getByLabel("Bahasa untuk pelanggan")).toHaveValue("id");

    // Visit windows in the jobs list use the 24-hour clock.
    await page.goto("/jobs?status=scheduled");
    await expect(page.locator("main")).toContainText(/\d{2}\.\d{2} – \d{2}\.\d{2}/);
  });
});

test.describe("signed-out pages", () => {
  test("follow the browser's language, and the switcher overrides it", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: "id-ID" });
    try {
      const page = await context.newPage();
      await page.goto("/sign-in");
      await expect(page.locator("html")).toHaveAttribute("lang", "id");
      await expect(page.getByText("Lupa kata sandi?")).toBeVisible();
      await expect(page.getByLabel("Kata sandi")).toBeVisible();

      await page.getByTestId("language-switcher").selectOption("en");
      await expect(page.getByText("Forgot password?")).toBeVisible();
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    } finally {
      await context.close();
    }
  });
});

test.describe("customer portal", () => {
  test("follows the business's language and has its own switcher", async ({ page }) => {
    await page.goto("/portal/acme-teknik/sign-in");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page.getByRole("button", { name: "Kirim tautan masuk" })).toBeVisible();

    await page.goto("/portal/acme-air/sign-in");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByTestId("language-switcher").selectOption("id");
    await expect(page.getByRole("button", { name: "Kirim tautan masuk" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "id");

    // The visitor's choice holds for the signed-in pages too.
    await page.getByTestId("portal-demo-sign-in").click();
    await expect(page).toHaveURL(/\/portal\/acme-air$/, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
    await page.getByTestId("language-switcher").selectOption("en");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});
