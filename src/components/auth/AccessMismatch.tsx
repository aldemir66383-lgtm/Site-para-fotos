import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { portalPath, type PortalRole } from "./routing";

export function AccessMismatch({ expected }: { expected: PortalRole }) {
  const { user, logout } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function switchAccount() {
    setBusy(true); setError("");
    try { await logout(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível sair."); } finally { setBusy(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-[#faf9f6] p-6 dark:bg-zinc-950"><section className="panel w-full max-w-lg p-8"><ShieldAlert className="mb-5 size-10 text-orange-600" /><p className="eyebrow">Acesso por perfil</p><h1 className="mt-3 text-2xl font-bold">Esta área tem outro acesso.</h1><p className="muted mt-3 leading-relaxed">Você está conectado como {user?.role === "photographer" ? "fotógrafo" : user?.role === "admin" ? "administrador" : "comprador"}. Esta página é exclusiva para {expected === "admin" ? "administradores" : "fotógrafos"}.</p><div className="mt-6 flex flex-wrap gap-3"><Link className="primary" to={portalPath(user?.role ?? "buyer")}>Ir para minha área</Link><button className="secondary" disabled={busy} onClick={() => void switchAccount()}>{busy ? "Saindo…" : "Usar outra conta"}</button></div>{error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}<Link to="/" className="muted mt-6 inline-block text-sm underline">Voltar ao início</Link></section></main>;
}
