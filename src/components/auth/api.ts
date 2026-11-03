import { z } from "zod";

export const userSchema = z.object({
  id: z.string(), email: z.string(), name: z.string(),
  role: z.enum(["buyer", "photographer", "admin"]),
});
export type AuthUser = z.infer<typeof userSchema>;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Uses the HttpOnly session cookie; tokens are never persisted in browser storage. */
export async function apiRequest<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store", credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Não foi possível conectar. Confira sua conexão e tente novamente.");
  }
  if (!response.ok) {
    if (response.status === 403 && typeof window !== "undefined") window.dispatchEvent(new Event("aire:access-changed"));
    if (response.status === 401 && !path.includes("/auth/login") && !path.includes("/auth/me") && typeof window !== "undefined") window.dispatchEvent(new Event("aire:unauthenticated"));
    const messages: Record<number, string> = {
      400: "Confira os dados informados e tente novamente.",
      401: path.includes("login") ? "E-mail ou senha incorretos." : "Sua sessão expirou. Entre novamente.",
      403: "Seu perfil não tem permissão para esta ação.",
      409: "Este e-mail já está cadastrado. Acesse sua conta.",
      429: "Muitas tentativas. Aguarde um pouco e tente novamente.",
      503: "O acesso está temporariamente indisponível. Tente novamente em instantes.",
    };
    throw new ApiError(response.status, messages[response.status] ?? "Não foi possível concluir a solicitação. Tente novamente.");
  }
  const result = schema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new Error("O servidor retornou dados inesperados. Tente novamente.");
  return result.data;
}
