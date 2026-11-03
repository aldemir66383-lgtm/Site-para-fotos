import { useEffect, useState } from "react";
import { Camera, ChevronRight, CircleUserRound, CreditCard, Home, Image, LayoutDashboard, LogOut, Menu, Moon, Settings2, ShieldCheck, Sun, Upload, Users, X, type LucideIcon } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../components/auth/AuthProvider";
import { Brand } from "./ui";
import type { PortalRole } from "../components/auth/routing";

const adminLinks: [string, string, LucideIcon][] = [["/admin", "Visão geral", LayoutDashboard], ["/admin/pedidos", "Pedidos", CreditCard], ["/admin/usuarios", "Usuários", Users], ["/admin/comissoes", "Comissões", Settings2]];
const photographerLinks: [string, string, LucideIcon][] = [["/fotografo", "Início", Home], ["/fotografo/fotos", "Minhas fotos", Image], ["/fotografo/enviar", "Enviar fotos", Upload], ["/fotografo/vendas", "Vendas", CreditCard], ["/fotografo/conta", "Minha conta", CircleUserRound]];

export function PortalLayout({ role }: { role: PortalRole }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const location = useLocation();
  const links = role === "admin" ? adminLinks : photographerLinks;
  const activeTitle = links.find(([path]) => path === location.pathname)?.[1] ?? "Aire Photos";
  useEffect(() => { document.title = `${activeTitle} · Aire Photos`; setOpen(false); }, [activeTitle, location.pathname]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [open]);
  function toggleTheme() {
    const next = !dark; setDark(next); document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("aire-theme", next ? "dark" : "light"); } catch { /* Theme works without storage. */ }
  }
  async function exit() { setBusy(true); setError(""); try { await logout(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível sair."); } finally { setBusy(false); } }
  return <div className="min-h-dvh bg-[#faf9f6] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <a href="#portal-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3 focus:text-black">Pular para o conteúdo</a>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-zinc-200 bg-white px-5 py-7 dark:border-zinc-800 dark:bg-zinc-900 lg:flex">
      <div className="px-3"><Brand /><p className="muted mt-3 flex items-center gap-2 text-xs">{role === "admin" ? <ShieldCheck size={14} /> : <Camera size={14} />}{role === "admin" ? "Administração" : "Espaço do fotógrafo"}</p></div>
      <p className="muted mb-3 mt-12 px-3 text-[10px] font-bold uppercase tracking-widest">Seu espaço</p>
      <nav aria-label="Navegação principal" className="space-y-1">{links.map(([path, label, Icon]) => <NavLink key={path} end to={path} className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${isActive ? "bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300" : "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}><Icon size={19} />{label}</NavLink>)}</nav>
      <div className="mt-auto rounded-2xl bg-[#f7f6f2] p-4 dark:bg-zinc-800"><p className="text-sm font-bold">Um olhar para cada detalhe.</p><p className="muted mt-2 text-xs leading-relaxed">{role === "admin" ? "Clareza para cuidar da sua operação." : "Seu trabalho, em um só lugar."}</p><Link to="/" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-orange-700 dark:text-orange-400">Voltar ao site<ChevronRight size={13} /></Link></div>
    </aside>
    <div className="lg:pl-64"><header className="sticky top-0 z-20 flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 sm:px-8">
      <div className="flex items-center gap-3"><button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Fechar menu" : "Abrir menu"} className="secondary px-3 lg:hidden">{open ? <X size={18} /> : <Menu size={18} />}</button><span className="hidden text-sm font-semibold sm:inline">{role === "admin" ? "Administração" : "Área do fotógrafo"}</span><ChevronRight size={14} className="muted hidden sm:block" /><span className="muted text-sm">{activeTitle}</span></div>
      <div className="flex items-center gap-2 sm:gap-4"><button className="secondary px-3" onClick={toggleTheme} aria-label={dark ? "Ativar tema claro" : "Ativar tema escuro"}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><div className="hidden text-right sm:block"><p className="max-w-44 truncate text-sm font-bold">{user?.name}</p><p className="muted text-xs">{role === "admin" ? "Administrador" : "Fotógrafo"}</p></div><button className="secondary" onClick={() => void exit()} disabled={busy}><LogOut size={16} /><span>{busy ? "Saindo…" : "Sair"}</span></button></div>
      {open && <nav id="mobile-nav" aria-label="Navegação móvel" className="w-full border-t border-zinc-200 pt-3 dark:border-zinc-800 lg:hidden">{links.map(([path, label, Icon]) => <NavLink key={path} to={path} end onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${isActive ? "bg-orange-50 font-bold text-orange-800 dark:bg-orange-950 dark:text-orange-300" : "muted"}`}><Icon size={18} />{label}</NavLink>)}</nav>}
    </header><main id="portal-content" className="mx-auto max-w-[1440px] p-4 sm:p-8">{error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}<Outlet /></main></div>
  </div>;
}
