import { describe, expect, it, vi } from "vitest";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { streamOriginal, streamZip } from "../src/server/delivery/stream-zip.js";

describe("controle de fluxo do ZIP", () => {
  it("respeita backpressure e cancela a leitura de R2 ao desconectar", async () => {
    let produced = 0;
    const cancel = vi.fn();
    const report = vi.fn(async () => {});
    const second = vi.fn(async () => new Response("second").body!);
    const output = streamZip([
      { filename: "large.jpg", open: async () => new ReadableStream<Uint8Array>({
        pull(controller) { produced += 8192; controller.enqueue(new Uint8Array(8192)); }, cancel,
      }, { highWaterMark: 0 }) },
      { filename: "second.jpg", open: second },
    ], report);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(produced).toBeLessThan(1024 * 1024);
    expect(second).not.toHaveBeenCalled();
    const reader = output.stream.getReader();
    await reader.read();
    await reader.cancel("client disconnected");
    await output.completion;
    expect(report).toHaveBeenCalledWith("cancelled", expect.any(Number));
    expect(report).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it("inclui arquivo vazio e múltiplos chunks sem alterar bytes/CRC", async () => {
    const report = vi.fn(async () => {});
    const output = streamZip([
      { filename: "empty.jpg", open: async () => new Response(new Uint8Array()).body! },
      { filename: "chunked.jpg", open: async () => new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(new Uint8Array([1,2])); c.enqueue(new Uint8Array([3,4])); c.close(); },
      }) },
    ], report);
    const bytes = new Uint8Array(await new Response(output.stream).arrayBuffer());
    await output.completion;
    const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
    const entries = await reader.getEntries();
    const [empty, chunked] = entries;
    if (empty.directory || chunked.directory) throw new Error("Unexpected ZIP directory");
    expect(await empty.getData!(new Uint8ArrayWriter(), { checkSignature: true, useWebWorkers: false })).toEqual(new Uint8Array());
    expect(await chunked.getData!(new Uint8ArrayWriter(), { checkSignature: true, useWebWorkers: false })).toEqual(new Uint8Array([1,2,3,4]));
    await reader.close();
    expect(report).toHaveBeenCalledWith("served", bytes.length);
  });

  it("audita cancelamento e erro no stream individual", async () => {
    const report = vi.fn(async () => {});
    const output = streamOriginal(new ReadableStream({ pull() {}, cancel() {} }), report);
    await output.stream.cancel();
    await output.completion;
    expect(report).toHaveBeenCalledWith("cancelled", 0);
    const failed = streamOriginal(new ReadableStream({ start(c) { c.error(new Error("R2 connection lost")); } }), report);
    await expect(new Response(failed.stream).arrayBuffer()).rejects.toThrow("R2 connection lost");
    expect(report).toHaveBeenCalledWith("storage_error", 0);
  });
});
