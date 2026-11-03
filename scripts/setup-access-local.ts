import { mkdir, readFile, writeFile, appendFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../src/server/auth/native-auth.js";

// Never targets Cloudflare remote data. Test accounts live only in the isolated local DB.
await mkdir(".wrangler/access-dev", { recursive: true });
const vars = await readFile(".dev.vars", "utf8").catch(() => "");
if (!/^NATIVE_AUTH_SECRET\s*=/m.test(vars)) await appendFile(".dev.vars", `\nNATIVE_AUTH_SECRET=${randomBytes(48).toString("hex")}\nPUBLIC_SITE_URL=http://localhost:5173\n`, { mode: 0o600 });
function wrangler(args: string[]) {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args, "--local", "--persist-to", ".wrangler/access-dev"], { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error("Preparação local falhou; confira a saída do Wrangler.");
}
wrangler(["d1", "migrations", "apply", "fotoviva"]);
if (process.argv.includes("--test-accounts")) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const accounts = [];
  for (const role of ["admin", "photographer", "buyer"] as const) {
    const id = randomUUID();
    const password = randomBytes(24).toString("base64url");
    const email = `${role}-${id.slice(0, 8)}@aire.local`;
    const { hash, salt } = await hashPassword(password);
    accounts.push({ id, email, password, role, name: `Teste local ${role}`, hash, salt });
  }
  const sqlPath = `.wrangler/access-dev/test-seed-${randomUUID()}.sql`;
  try {
    await writeFile(sqlPath, accounts.map((a) => `INSERT INTO users (id,email,name,password_hash,password_salt,role) VALUES (${[a.id, a.email, a.name, a.hash, a.salt, a.role].map(quote).join(",")});`).join("\n"));
    wrangler(["d1", "execute", "fotoviva", "--file", sqlPath]);
    await writeFile(".wrangler/access-dev/test-accounts.json", JSON.stringify(accounts.map(({ hash: _hash, salt: _salt, ...a }) => a), null, 2), { mode: 0o600 });
    console.log("Contas aleatórias de teste criadas no banco local. Credenciais em .wrangler/access-dev/test-accounts.json (ignorado pelo Git).");
  } finally { await unlink(sqlPath).catch(() => {}); }
}
console.log("Ambiente local preparado. Inicie npm run dev e npm run dev:web em terminais separados.");
