import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("a signed-in user can customize, reopen and delete a swarm preset", async ({
  page,
}, testInfo) => {
  await signup(page, `swarm-${Date.now()}@example.test`, "password12", "Swarm QA");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Swarm Studio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Swarm Studio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^QA / })).toBeVisible();
  await captureScreenshot(page, testInfo, "swarm-studio");

  await page.getByRole("button", { name: "New preset" }).click();
  const dialog = page.getByRole("dialog", { name: "New preset" });
  await dialog.getByLabel("Name", { exact: true }).fill("Release check");
  await dialog.getByLabel("Instructions").fill("Walk through checkout on each device.");
  await dialog.getByRole("button", { name: "More workers" }).click();
  await dialog.getByLabel("Filesystem").selectOption("private");
  await dialog.getByText("Worker tools and roles").click();
  await dialog.getByLabel("Live browser").check();
  await dialog.getByLabel("Roles").fill("Desktop\nMobile\nKeyboard\nStress");
  await dialog.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.getByRole("button", { name: /^Release check / }).click();
  const saved = page.getByRole("dialog", { name: "Edit preset" });
  await expect(saved.getByLabel("Worker count")).toHaveText("4");
  await expect(saved.getByLabel("Filesystem")).toHaveValue("private");
  await saved.getByText("Worker tools and roles").click();
  await expect(saved.getByLabel("Live browser")).toBeChecked();
  await expect(saved.getByLabel("Roles")).toHaveValue("Desktop\nMobile\nKeyboard\nStress");
  await saved.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete preset" }).click();
  await expect(page.getByRole("button", { name: /^Release check / })).toBeHidden();
});
