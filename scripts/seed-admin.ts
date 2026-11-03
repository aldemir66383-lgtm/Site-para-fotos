import { mkdir, writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../src/server/auth/native-auth.js";

// Explicit, local-only provisioning. Credentials are supplied via environment variables.
const email = process.env.AIRE_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.AIRE_ADMIN_PASSWORD;
const name = process.env.AIRE_ADMIN_NAME?.trim();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 6 || password.length > 100 || !name || name.length < 2) {
  throw new Error("Defina AIRE_ADMIN_EMAIL, AIRE_ADMIN_NAME e AIRE_ADMIN_PASSWORD (6–100 caracteres). Nenhuma conta foi criada.");
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const { hash, salt } = await hashPassword(password);
await mkdir(".wrangler/access-dev", { recursive: true });
const path = `.wrangler/access-dev/seed-${randomUUID()}.sql`;
try {
  await writeFile(path, `INSERT INTO users (id,email,name,password_hash,password_salt,role) VALUES (${[randomUUID(), email, name, hash, salt, "admin"].map(quote).join(",")});`, { mode: 0o600 });
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "fotoviva", "--local", "--persist-to", ".wrangler/access-dev", "--file", path], { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error("Não foi possível criar a conta administrativa local.");
  console.log("Administrador criado somente no banco local. A senha não foi exibida nem salva em texto.");
} finally { await unlink(path).catch(() => {}); }
