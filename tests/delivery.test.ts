import { describe, expect, it } from "vitest";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { handleCommerceRequest } from "../src/server/delivery/handlers.js";
import { issueTicket } from "../src/server/delivery/tickets.js";
import { api, buyer, commerceEnvironment } from "./commerce-helpers.js";

async function issue(context: Awaited<ReturnType<typeof commerceEnvironment>>, photoId: string | null = context.photoIds[0]) {
  const response = await handleCommerceRequest(api(photoId ? `orders/order-1/photos/${photoId}/ticket` : "orders/order-1/download-all-zip/ticket", "POST"), context.env, undefined, buyer);
  expect(response?.status).toBe(201);
  const result = await response!.json() as { url: string; expiresAt: string };
  return result;
}
const download = (url: string, context: Awaited<ReturnType<typeof commerceEnvironment>>, authenticate = buyer) =>
  handleCommerceRequest(new Request(`https://fotoviva.test${url}`), context.env, undefined, authenticate);

describe("tickets seguros e download de originais", () => {
  it("entrega apenas ao titular, armazena somente hash e consome uma vez sob concorrência", async () => {
    const context = await commerceEnvironment();
    const ticket = await issue(context);
    const token = ticket.url.split("/").at(-1)!;
    const stored = context.sqlite.prepare("SELECT token_hash,used,expires_at FROM delivery_tickets").get()!;
    expect(stored.token_hash).not.toBe(token);
    expect(String(stored.token_hash)).toHaveLength(64);
    expect(Date.parse(ticket.expiresAt) - Date.now()).toBeLessThanOrEqual(60_000);
    expect((await download(ticket.url, context, async () => ({ id: "intruder", role: "buyer" })))?.status).toBe(404);
    expect(context.sqlite.prepare("SELECT used FROM delivery_tickets").get()?.used).toBe(0);
    const responses = await Promise.all([download(ticket.url, context), download(ticket.url, context)]);
    expect(responses.map(r => r?.status).sort()).toEqual([200,410]);
    const successful = responses.find(r => r?.status === 200)!;
    expect(successful.headers.get("Cache-Control")).toBe("private, no-store");
    expect(successful.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(successful.headers.get("Location")).toBeNull();
    expect(await successful.text()).toBe("synthetic-original-full-resolution-0");
    expect(context.sqlite.prepare("SELECT downloads_left FROM download_entitlements WHERE photo_id=?").get(context.photoIds[0])?.downloads_left).toBe(4);
    const outcomes = context.sqlite.prepare("SELECT outcome FROM delivery_log").all().map(row => row.outcome);
    expect(outcomes).toContain("issued"); expect(outcomes).toContain("reused"); expect(outcomes).toContain("served");
  });

  it("revalida revogação e estado de pagamento depois da emissão", async () => {
    const context = await commerceEnvironment();
    const ticket = await issue(context);
    context.sqlite.prepare("UPDATE download_entitlements SET status='revoked' WHERE photo_id=?").run(context.photoIds[0]);
    expect((await download(ticket.url, context))?.status).toBe(404);
    expect(context.bucket.get).not.toHaveBeenCalled();
    const other = await issue(context, context.photoIds[1]);
    context.sqlite.prepare("UPDATE orders SET status='refunded'").run();
    expect((await download(other.url, context))?.status).toBe(404);
    expect(context.sqlite.prepare("SELECT downloads_left FROM download_entitlements WHERE photo_id=?").get(context.photoIds[1])?.downloads_left).toBe(5);
  });

  it("recusa pedido alheio/não pago, ticket vencido e direito além dos 30 dias", async () => {
    const pending = await commerceEnvironment({ settle: false });
    expect((await handleCommerceRequest(api(`orders/order-1/photos/${pending.photoIds[0]}/ticket`, "POST"), pending.env, undefined, buyer))?.status).toBe(404);
    const context = await commerceEnvironment({ paidAt: Date.now() - 86_400_000 });
    expect((await handleCommerceRequest(api(`orders/order-1/photos/${context.photoIds[0]}/ticket`, "POST"), context.env, undefined, async () => ({ id: "intruder", role: "buyer" })))?.status).toBe(404);
    const old = await issueTicket(context.env, "buyer-1", "order-1", context.photoIds[0], Date.now() - 61_000);
    expect((await download((await old.json() as { url: string }).url, context))?.status).toBe(410);
    const expired = await commerceEnvironment({ paidAt: Date.now() - 31 * 86_400_000 });
    expect((await handleCommerceRequest(api(`orders/order-1/photos/${expired.photoIds[0]}/ticket`, "POST"), expired.env, undefined, buyer))?.status).toBe(404);
  });

  it("limita a 10 emissões por foto/hora e impede consumo com quota esgotada", async () => {
    const context = await commerceEnvironment();
    let lastUrl = "";
    for (let i = 0; i < 10; i++) lastUrl = (await issue(context)).url;
    expect((await handleCommerceRequest(api(`orders/order-1/photos/${context.photoIds[0]}/ticket`, "POST"), context.env, undefined, buyer))?.status).toBe(429);
    context.sqlite.prepare("UPDATE download_entitlements SET downloads_left=0 WHERE photo_id=?").run(context.photoIds[0]);
    expect((await download(lastUrl, context))?.status).toBe(409);
  });

  it("registra falha de R2 e não redireciona para URL reutilizável", async () => {
    const context = await commerceEnvironment();
    const ticket = await issue(context);
    context.objects.delete(`originals/${context.photoIds[0]}.jpg`);
    const response = await download(ticket.url, context);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Location")).toBeNull();
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM delivery_log WHERE outcome='storage_error'").get()?.n).toBe(1);
    expect((await download(ticket.url, context))?.status).toBe(410);
  });
});

describe("pacote ZIP completo por streaming", () => {
  it("produz ZIP64 íntegro com os bytes originais e cobra uma tentativa por foto", async () => {
    const context = await commerceEnvironment();
    const ticket = await issue(context, null);
    const response = await download(ticket.url, context);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Disposition")).toBe('attachment; filename="fotoviva-evento-order-1.zip"');
    const bytes = new Uint8Array(await response!.arrayBuffer());
    const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
    const entries = await reader.getEntries();
    expect(entries).toHaveLength(3);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.directory) throw new Error("Unexpected ZIP directory");
      expect(entry.filename).toMatch(/^fotoviva-\d{4}-[a-zA-Z0-9_-]+\.jpg$/);
      const data = await entry.getData!(new Uint8ArrayWriter(), { checkSignature: true, useWebWorkers: false });
      expect(new TextDecoder().decode(data)).toBe(`synthetic-original-full-resolution-${i}`);
    }
    await reader.close();
    expect(context.sqlite.prepare("SELECT downloads_left FROM download_entitlements").all().map(r => r.downloads_left)).toEqual([4,4,4]);
    expect(context.sqlite.prepare("SELECT outcome,bytes FROM delivery_log WHERE outcome='served'").get()).toMatchObject({ outcome: "served", bytes: bytes.length });
    expect((await download(ticket.url, context))?.status).toBe(410);
  });

  it("não mistura tickets individuais com ZIP nem tickets de outro pedido", async () => {
    const context = await commerceEnvironment();
    const single = await issue(context);
    const token = single.url.split("/").at(-1)!;
    expect((await handleCommerceRequest(api(`orders/order-1/download-all-zip?ticket=${token}`), context.env, undefined, buyer))?.status).toBe(404);
    const zip = await issue(context, null);
    expect((await download(zip.url.replace("order-1", "other-order"), context))?.status).toBe(404);
    expect(context.sqlite.prepare("SELECT used FROM delivery_tickets").all().map(r => r.used)).toEqual([0,0]);
  });

  it("recusa o pacote inteiro se uma foto tiver sido revogada, inclusive depois de emitir", async () => {
    const context = await commerceEnvironment();
    const zip = await issue(context, null);
    context.sqlite.prepare("UPDATE download_entitlements SET status='revoked' WHERE photo_id=?").run(context.photoIds[1]);
    expect((await download(zip.url, context))?.status).toBe(404);
    expect((await handleCommerceRequest(api("orders/order-1/download-all-zip/ticket", "POST"), context.env, undefined, buyer))?.status).toBe(404);
    expect(context.sqlite.prepare("SELECT downloads_left FROM download_entitlements").all().map(r => r.downloads_left)).toEqual([5,5,5]);
    expect(context.bucket.get).not.toHaveBeenCalled();
  });

  it("interrompe o stream e audita se um original desaparecer", async () => {
    const context = await commerceEnvironment();
    const zip = await issue(context, null);
    context.objects.delete(`originals/${context.photoIds[1]}.jpg`);
    const response = await download(zip.url, context);
    await expect(response!.arrayBuffer()).rejects.toThrow();
    // A auditoria pode concluir no microtask seguinte ao erro do stream.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(context.sqlite.prepare("SELECT count(*) AS n FROM delivery_log WHERE outcome='storage_error'").get()?.n).toBe(1);
    expect(context.bucket.get).toHaveBeenCalledTimes(2);
  });
});
