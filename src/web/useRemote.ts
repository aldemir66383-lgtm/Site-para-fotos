import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import { apiRequest } from "../components/auth/api";

export function useRemote<T>(path: string, schema: z.ZodType<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    void apiRequest(path, schema, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setData(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, schema, revision]);
  return { data, loading, error, refresh };
}
