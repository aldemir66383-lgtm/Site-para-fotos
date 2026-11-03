"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { apiRequest, userSchema, type AuthUser } from "./api";

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (user: AuthUser) => void;
  initialMode?: "login" | "register";
}

export function AuthModal({ isOpen, onClose, onAuthenticated, initialMode = "login" }: AuthModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const titleId = useId();
  const errorId = useId();
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode); setError(""); setBusy(false); setShowPassword(false);
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      request.current?.abort(); element?.close(); document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [isOpen, initialMode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    let user: AuthUser;
    try {
      const payload = {
        email: String(data.get("email")).trim(), password: String(data.get("password")),
        ...(mode === "register" ? { name: String(data.get("name")).trim(), role: data.get("role") } : {}),
      };
      const result = await apiRequest(`/api/auth/${mode}`, z.object({ user: userSchema }), {
        method: "POST", body: JSON.stringify(payload), signal: controller.signal,
      });
      user = result.user;
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Tente novamente.");
      return;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
    if (!controller.signal.aborted) { onAuthenticated(user); onClose(); }
  }

  if (!isOpen) return null;
  const registering = mode === "register";
  const input = "mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 shadow-xl backdrop:bg-zinc-950/70 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 sm:p-8">
      <div className="flex items-center justify-between"><span className="text-sm font-bold tracking-widest text-emerald-600 dark:text-emerald-400">AIRE PHOTOS</span><button type="button" onClick={onClose} aria-label="Fechar autenticação" className="rounded-lg px-3 py-2 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-zinc-800">✕</button></div>
      <h2 id={titleId} className="mt-6 text-2xl font-bold">{registering ? "Suas melhores memórias começam aqui" : "Bom ter você de volta"}</h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{registering ? "Crie sua conta para comprar ou vender fotografias." : "Entre para continuar sua experiência no Aire Photos."}</p>
      <div className="my-6 flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800" aria-label="Tipo de acesso">
        {(["login", "register"] as const).map((value) => <button key={value} type="button" disabled={busy} aria-pressed={mode === value} onClick={() => { setMode(value); setError(""); setShowPassword(false); }} className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 ${mode === value ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>{value === "login" ? "Entrar" : "Criar conta"}</button>)}
      </div>
      <form key={mode} onSubmit={submit} aria-busy={busy} aria-describedby={error ? errorId : undefined}>
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
          {registering && <label className="block text-sm font-medium">Nome<input autoFocus name="name" autoComplete="name" required minLength={2} maxLength={100} className={input} /></label>}
          <label className="block text-sm font-medium">E-mail<input autoFocus={!registering} name="email" type="email" autoComplete="email" required className={input} placeholder="voce@exemplo.com" /></label>
          <label className="block text-sm font-medium">Senha<input name="password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} required minLength={registering ? 6 : 1} maxLength={registering ? 100 : undefined} className={input} />{registering && <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">Use de 6 a 100 caracteres.</span>}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} className="accent-emerald-600" />Mostrar senha</label>
          {registering && <fieldset><legend className="mb-2 text-sm font-medium">Como você quer usar o Aire?</legend><div className="grid grid-cols-2 gap-3">{(["buyer", "photographer"] as const).map((role) => <label key={role} className="cursor-pointer rounded-xl border border-zinc-200 p-3 text-sm has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-500/10 dark:border-zinc-700"><input type="radio" name="role" value={role} defaultChecked={role === "buyer"} className="mr-2 accent-emerald-600" />{role === "buyer" ? "Comprador" : "Fotógrafo"}</label>)}</div></fieldset>}
          <button type="submit" className="w-full rounded-xl bg-emerald-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-wait">{busy ? "Aguarde…" : registering ? "Criar minha conta" : "Entrar na minha conta"}</button>
        </fieldset>
        {error && <p id={errorId} role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </form>
    </dialog>
  );
}
