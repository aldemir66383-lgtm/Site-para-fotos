import { ZipWriter } from "@zip.js/zip.js";
import { ApiError } from "../photos/contracts.js";
import type { DeliveryOutcome } from "./tickets.js";

export interface ZipSource { filename: string; open: () => Promise<ReadableStream<Uint8Array>> }
type Report = (outcome: DeliveryOutcome, bytes: number) => Promise<void>;

/** Sequential STORE/ZIP64, bounded by Web Streams backpressure; no Blob, disk, or whole-image buffers. */
export function streamZip(sources: ZipSource[], report: Report) {
  const bridge = new TransformStream<Uint8Array, Uint8Array>();
  const reader = bridge.readable.getReader();
  const abort = new AbortController();
  const zip = new ZipWriter(bridge.writable, {
    level: 0, compressionMethod: 0, bufferedWrite: false, dataDescriptor: true,
    zip64: true, useWebWorkers: false, useCompressionStream: false, signal: abort.signal,
  });
  let bytes = 0, cancelled = false, reported = false;
  let activeSource: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let resolveCompletion!: () => void;
  const completion = new Promise<void>(resolve => { resolveCompletion = resolve; });
  const finish = async (outcome: DeliveryOutcome) => {
    if (reported) return;
    reported = true;
    try { await report(outcome, bytes); } finally { resolveCompletion(); }
  };
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    async pull(c) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { await finish("served"); c.close(); }
        else { bytes += chunk.value.byteLength; c.enqueue(chunk.value); }
      } catch (error) {
        await finish(cancelled ? "cancelled" : "storage_error");
        if (!cancelled) c.error(error);
      }
    },
    async cancel(reason) {
      cancelled = true;
      abort.abort(reason);
      await activeSource?.cancel(reason).catch(() => {});
      await reader.cancel(reason).catch(() => {});
      await finish("cancelled");
    },
  }, { highWaterMark: 0 });
  void (async () => {
    try {
      for (const source of sources) {
        abort.signal.throwIfAborted();
        const input = await source.open();
        if (abort.signal.aborted) { await input.cancel(); abort.signal.throwIfAborted(); }
        const sourceReader = input.getReader();
        activeSource = sourceReader;
        const cancellable = new ReadableStream<Uint8Array>({
          async pull(c) {
            try {
              const next = await sourceReader.read();
              if (next.done) c.close(); else c.enqueue(next.value);
            } catch (error) { c.error(error); }
          },
          cancel: reason => sourceReader.cancel(reason),
        }, { highWaterMark: 0 });
        try { await zip.add(source.filename, cancellable, { signal: abort.signal }); }
        finally {
          await sourceReader.cancel().catch(() => {});
          sourceReader.releaseLock();
          activeSource = null;
        }
      }
      await zip.close();
    } catch (error) {
      abort.abort(error);
      if (!cancelled) {
        controller.error(error);
        await finish(error instanceof ApiError && error.code === "right_revoked" ? "revoked" : "storage_error");
      }
      await reader.cancel(error).catch(() => {});
    }
  })().catch(() => { console.error("delivery_audit_failed"); });
  return { stream, completion };
}

export function streamOriginal(input: ReadableStream<Uint8Array>, report: Report) {
  const reader = input.getReader();
  let bytes = 0, reported = false;
  let resolveCompletion!: () => void;
  const completion = new Promise<void>(resolve => { resolveCompletion = resolve; });
  const finish = async (outcome: DeliveryOutcome) => {
    if (reported) return;
    reported = true;
    try { await report(outcome, bytes); } finally { resolveCompletion(); }
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { await finish("served"); controller.close(); }
        else { bytes += next.value.byteLength; controller.enqueue(next.value); }
      } catch (error) { await finish("storage_error"); controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); await finish("cancelled"); },
  }, { highWaterMark: 0 });
  return { stream, completion };
}
