export type PortalRole = "admin" | "photographer";
export const portalPath = (role: string) => role === "admin" ? "/admin" : role === "photographer" ? "/fotografo" : "/conta";

export function safeReturnPath(value: string | null, role: PortalRole): string {
  const base = portalPath(role);
  if (!value || value.includes("\\") || /[\u0000-\u0020]/.test(value)) return base;
  try {
    const url = new URL(value, "https://airephotos.com.br");
    if (!value.startsWith("/") || value.startsWith("//") || url.origin !== "https://airephotos.com.br") return base;
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return base;
    if (url.pathname.endsWith("/login") || url.pathname.endsWith("/cadastro")) return base;
    return url.pathname + url.search;
  } catch { return base; }
}
