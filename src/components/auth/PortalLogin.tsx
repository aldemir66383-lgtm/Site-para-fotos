import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Camera, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { apiRequest, userSchema } from "./api";
import { useAuth } from "./AuthProvider";
import { AccessMismatch } from "./AccessMismatch";
import { safeReturnPath, type PortalRole } from "./routing";
import { Brand, Loading } from "../../web/ui";

export function PortalLogin({ role, register = false }: { role: PortalRole; register?: boolean }) {
  const admin = role === "admin";
  const { user, checking, authenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const request = useRef<AbortController | null>(null);
  const destination = safeReturnPath(params.get("retorno"), role);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (!checking && user?.role === role) void navigate(destination, { replace: true }); }, [checking, user, role, navigate, destination]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const email = String(form.get("email")).trim();
      const password = String(form.get("password"));
      const body = register ? { email, password, name: String(form.get("name")).trim(), role: "photographer" } : { email, password };
      if (register && String(form.get("name")).trim().length < 2) { setError("Informe seu nome com pelo menos dois caracteres."); return; }
      const result = await apiRequest(`/api/auth/${register ? "register" : "login"}`, z.object({ user: userSchema }), { method: "POST", body: JSON.stringify(body), signal: controller.signal });
      if (!controller.signal.aborted) authenticated(result.user);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível entrar. Tente novamente.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  if (checking || user?.role === role) return <Loading label="Verificando seu acesso…" full />;
  if (user) return <AccessMismatch expected={role} />;
  return <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#202521] p-12 text-white lg:flex xl:p-16" aria-label={admin ? "Portal administrativo" : "Espaço do fotógrafo"}>
      <div className="absolute -right-36 top-36 size-[38rem] rounded-full border border-white/10" /><div className="absolute -right-24 top-48 size-[32rem] rounded-full border border-white/10" />
      <Brand light />
      <div className="relative my-16 max-w-lg">
        <span className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-xs font-medium text-white/80">{admin ? <ShieldCheck size={15} /> : <Camera size={15} />}{admin ? "CONTROLE E CLAREZA" : "FEITO PARA QUEM FOTOGRAFA"}</span>
        <div className="relative border-l-2 border-orange-500 pl-7"><h2 className="text-5xl font-extrabold leading-[1.12] tracking-tight xl:text-6xl">{admin ? <>Um olhar sobre<br />toda a operação<span className="text-orange-500">.</span></> : <>Seu olhar.<br />Novas histórias<span className="text-orange-500">.</span></>}</h2></div>
        <p className="mt-7 max-w-sm text-base leading-relaxed text-zinc-300">{admin ? "Pedidos, pessoas e comissões. Um espaço reservado para cuidar de cada detalhe do Aire Photos." : "Um espaço para acessar suas fotografias e acompanhar seu trabalho no Aire Photos."}</p>
        <div className="mt-10 grid grid-cols-3 gap-4 border-t border-white/15 pt-6">{(admin ? ["Visão da operação", "Acesso restrito", "Histórico preservado"] : ["Suas fotografias", "Seu espaço", "Sua identidade"]).map((text) => <div key={text} className="text-xs leading-relaxed text-zinc-300"><Check size={16} className="mb-2 text-orange-400" />{text}</div>)}</div>
      </div>
      <p className="relative text-xs text-zinc-400">Você viveu. Está aqui.</p>
    </aside>
    <section className="flex flex-col bg-[#faf9f6] px-6 py-8 dark:bg-zinc-950 sm:px-12 lg:px-16">
      <div className="flex items-center justify-between gap-4"><span className="lg:hidden"><Brand /></span><Link to="/" className="muted ml-auto text-sm hover:underline">← Voltar ao site</Link></div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
        <span className="mb-6 grid size-12 place-items-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-400">{admin ? <LockKeyhole size={23} /> : <Camera size={23} />}</span>
        <p className="eyebrow">{admin ? "Administração Aire Photos" : "Área do fotógrafo"}</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{register ? "Um novo olhar começa aqui." : "Bom ter você de volta."}</h1>
        <p className="muted mt-3 text-sm leading-relaxed">{register ? "Crie sua conta de fotógrafo para acessar seu espaço." : admin ? "Entre com sua conta administrativa para continuar." : "Entre para acessar sua área de trabalho."}</p>
        <form className="mt-8 space-y-5" onSubmit={submit} aria-busy={busy} aria-describedby={error ? "login-error" : undefined}>
          <fieldset disabled={busy} className="space-y-5">
            {register && <label className="block text-sm font-semibold">Seu nome<input name="name" autoComplete="name" autoFocus required minLength={2} maxLength={100} className="field" placeholder="Como podemos chamar você?" /></label>}
            <label className="block text-sm font-semibold">E-mail<input name="email" type="email" autoComplete="email" autoFocus={!register} required maxLength={254} className="field" placeholder="voce@exemplo.com" /></label>
            <div><label htmlFor="portal-password" className="block text-sm font-semibold">Senha</label><div className="relative"><input id="portal-password" name="password" type={visible ? "text" : "password"} autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 6 : 1} maxLength={100} className="field pr-14" placeholder={register ? "Pelo menos 6 caracteres" : "Sua senha"} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={visible} className="muted absolute inset-y-0 right-0 flex w-12 items-center justify-center">{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
            {error && <p id="login-error" role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
            <button type="submit" className="primary w-full">{busy ? "Aguarde…" : register ? "Criar conta de fotógrafo" : admin ? "Entrar na administração" : "Entrar como fotógrafo"}{!busy && <ArrowRight size={17} />}</button>
          </fieldset>
        </form>
        {!admin && <p className="muted mt-6 text-center text-sm">{register ? "Já tem uma conta?" : "Ainda não tem conta?"} <Link className="font-bold text-orange-700 hover:underline dark:text-orange-400" to={register ? "/fotografo/login" : "/fotografo/cadastro"}>{register ? "Entrar" : "Cadastre-se"}</Link></p>}
        {admin && <p className="muted mt-6 flex items-start gap-2 text-xs leading-relaxed"><ShieldCheck size={16} className="shrink-0" />Acesso exclusivo para administradores autorizados. Contas administrativas não são criadas por cadastro público.</p>}
        <div className="mt-9 border-t border-zinc-200 pt-5 dark:border-zinc-800"><Link className="muted text-xs hover:underline" to={admin ? "/fotografo/login" : "/admin/login"}>{admin ? "Sou fotógrafo →" : "Acesso da administração →"}</Link></div>
      </div>
      <footer className="muted text-center text-xs">© {new Date().getFullYear()} Aire Photos · Cada instante importa.</footer>
    </section>
  </main>;
}
