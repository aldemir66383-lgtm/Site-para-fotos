import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

interface Account { email: string; password: string; role: "admin" | "photographer" | "buyer"; name: string }
const accounts = JSON.parse(readFileSync(".wrangler/access-dev/test-accounts.json", "utf8")) as Account[];
const account = (role: Account["role"]) => {
  const found = accounts.find((value) => value.role === role);
  if (!found) throw new Error("Execute npm run setup:local -- --test-accounts antes dos testes.");
  return found;
};
async function login(page: Page, role: "admin" | "photographer", user = account(role)) {
  await page.goto(role === "admin" ? "/admin/login" : "/fotografo/login");
  await page.getByLabel("E-mail", { exact: true }).fill(user.email);
  await page.getByLabel("Senha", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: role === "admin" ? "Entrar na administração" : "Entrar como fotógrafo" }).click();
}

test("direct protected routes preserve a safe return path", async ({ page }) => {
  await page.goto("/admin/pedidos");
  await expect(page).toHaveURL(/\/admin\/login\?retorno=/);
  await expect(page.getByRole("heading", { name: "Bom ter você de volta." })).toBeVisible();
  await page.getByLabel("E-mail", { exact: true }).fill(account("admin").email);
  await page.getByLabel("Senha", { exact: true }).fill(account("admin").password);
  await page.getByRole("button", { name: "Entrar na administração" }).click();
  await expect(page).toHaveURL(/\/admin\/pedidos$/);
  await expect(page.getByRole("heading", { name: "Pedidos.", exact: true })).toBeVisible();
});

test("admin login, real data, commission persistence and revoked logout", async ({ page }) => {
  await page.goto("/admin/login");
  await page.screenshot({ path: ".wrangler/access-dev/admin-login.png", fullPage: true });
  await page.getByLabel("E-mail", { exact: true }).fill(account("admin").email);
  await page.getByLabel("Senha", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Entrar na administração" }).click();
  await expect(page.getByRole("alert")).toContainText("E-mail ou senha incorretos");
  await page.getByLabel("Senha", { exact: true }).fill(account("admin").password);
  await page.getByRole("button", { name: "Entrar na administração" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Faturamento total Pix", { exact: true })).toBeVisible();
  await expect(page.getByText("R$", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: ".wrangler/access-dev/admin-dashboard.png", fullPage: true });
  await page.getByRole("link", { name: "Usuários", exact: true }).click();
  await expect(page.getByRole("cell", { name: account("admin").email, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Comissões", exact: true }).click();
  const name = `Regra local ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Nome da regra", { exact: true }).fill(name);
  await page.getByLabel("Comissão da plataforma (%)", { exact: true }).fill("18.25");
  await page.getByLabel("Taxa do provedor (%)", { exact: true }).fill("0.99");
  await page.getByLabel("Taxa fixa do provedor (R$)", { exact: true }).fill("1.25");
  await page.getByLabel("Prazo de retenção (dias)", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Salvar e ativar nova versão" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nova versão salva" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Nome da regra", { exact: true })).toHaveValue(name);
  await expect(page.getByLabel("Taxa fixa do provedor (R$)", { exact: true })).toHaveValue("1.25");
  const cookie = (await page.context().cookies()).find((value) => value.name === "fv_session");
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.secure).toBe(true);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  const replay = await page.request.get("/api/admin/overview", { headers: { Authorization: `Bearer ${cookie!.value}` } });
  expect(replay.status()).toBe(401);
});

test("photographer has a separate portal and cannot access admin data", async ({ page }) => {
  await login(page, "photographer");
  await expect(page).toHaveURL(/\/fotografo$/);
  await page.getByRole("link", { name: "Minhas fotos", exact: true }).click();
  await expect(page.getByText("Ainda não há fotografias vinculadas à sua conta.")).toBeVisible();
  expect((await page.request.get("/api/admin/overview")).status()).toBe(403);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Esta área tem outro acesso." })).toBeVisible();
  await expect(page.getByText("Faturamento total Pix", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Ir para minha área" }).click();
  await expect(page).toHaveURL(/\/fotografo$/);
});

test("buyer cannot enter either restricted portal", async ({ page }) => {
  await login(page, "admin", account("buyer"));
  await expect(page.getByRole("heading", { name: "Esta área tem outro acesso." })).toBeVisible();
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
  expect((await page.request.get("/api/photographer/photos")).status()).toBe(403);
  await page.goto("/fotografo");
  await expect(page.getByRole("heading", { name: "Esta área tem outro acesso." })).toBeVisible();
});

test("photographer registration creates the right role and handles expired sessions", async ({ page }) => {
  await page.goto("/fotografo/cadastro");
  await page.getByLabel("Seu nome", { exact: true }).fill("Fotógrafo navegador");
  await page.getByLabel("E-mail", { exact: true }).fill(`foto-${randomUUID()}@aire.local`);
  await page.getByLabel("Senha", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Criar conta de fotógrafo" }).click();
  await expect(page).toHaveURL(/\/fotografo$/);
  const me = await page.request.get("/api/auth/me");
  expect(await me.json()).toMatchObject({ user: { role: "photographer" } });
  await page.context().clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/fotografo\/login/);
});

test("mobile navigation, theme and layouts stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fotografo/login");
  await expect(page.getByRole("button", { name: "Entrar como fotógrafo" })).toBeVisible();
  await page.screenshot({ path: ".wrangler/access-dev/photographer-login-mobile.png", fullPage: true });
  await login(page, "admin");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Usuários", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Usuários.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ativar tema escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("cell", { name: account("admin").email, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: ".wrangler/access-dev/admin-users-mobile-dark.png", fullPage: true });
});
