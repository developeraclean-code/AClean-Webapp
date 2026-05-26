// Reusable login helpers untuk E2E tests.
// Kredensial dari env var (E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD, dll)
// untuk hindari hardcode di repo.

export async function loginAs(page, role = "owner") {
  const credentials = {
    owner: {
      email: process.env.E2E_OWNER_EMAIL,
      password: process.env.E2E_OWNER_PASSWORD,
    },
    admin: {
      email: process.env.E2E_ADMIN_EMAIL,
      password: process.env.E2E_ADMIN_PASSWORD,
    },
    teknisi: {
      email: process.env.E2E_TEKNISI_EMAIL,
      password: process.env.E2E_TEKNISI_PASSWORD,
    },
  };

  const cred = credentials[role];
  if (!cred?.email || !cred?.password) {
    throw new Error(
      `Missing E2E credentials untuk role "${role}". Set env: E2E_${role.toUpperCase()}_EMAIL, E2E_${role.toUpperCase()}_PASSWORD`
    );
  }

  await page.goto("/");
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', cred.email);
  await page.fill('input[type="password"]', cred.password);
  await page.click('button:has-text("Masuk")');

  // Tunggu redirect ke dashboard (atau menu navigation muncul)
  await page.waitForSelector("text=Dashboard", { timeout: 15000 });
}

export async function logout(page) {
  // Lokasi logout button bergantung pada UI; coba beberapa selector
  const logoutBtn = page.locator("button:has-text('Keluar'), button:has-text('Logout'), button[title*='Logout' i]").first();
  if (await logoutBtn.isVisible().catch(() => false)) {
    await logoutBtn.click();
  } else {
    // Fallback: clear localStorage + reload
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
}
