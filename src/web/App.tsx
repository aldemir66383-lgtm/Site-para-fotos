import { useState } from "react";
import { ArrowRight, Camera, ShieldCheck } from "lucide-react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { AdminLogin } from "../components/auth/AdminLogin";
import { PhotographerLogin } from "../components/auth/PhotographerLogin";
import { PhotographerRegister } from "../components/auth/PhotographerRegister";
import { AuthModal } from "../components/auth/AuthModal";
import { useAuth } from "../components/auth/AuthProvider";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { AdminLayout } from "../components/admin/AdminLayout";
import { AdminDashboard } from "../components/admin/AdminDashboard";
import { AdminOrders } from "../components/admin/AdminOrders";
import { AdminUsers } from "../components/admin/AdminUsers";
import { CommissionRulesForm } from "../components/admin/CommissionRulesForm";
import { PhotographerLayout } from "../components/photographer/PhotographerLayout";
import { PhotographerAccount, PhotographerDashboard, PhotographerPhotos, PhotographerUnavailable } from "../components/photographer/PhotographerDashboard";
import { Brand, Loading } from "./ui";

function AccessHome() {
  return <main className="min-h-dvh bg-[#faf9f6] p-6 dark:bg-zinc-950"><header className="mx-auto flex max-w-5xl items-center justify-between py-5"><Brand /><a href="https://airephotos.com.br/" className="muted text-sm underline">Visitar o site</a></header><section className="mx-auto max-w-4xl py-16 sm:py-24"><p className="eyebrow">Cada olhar tem seu espaço</p><h1 className="mt-4 max-w-2xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">Bom ter você<br />por aqui<span className="text-orange-500">.</span></h1><p className="muted mt-6 max-w-lg leading-relaxed">Escolha a sua área para continuar no Aire Photos.</p><div className="mt-10 grid gap-5 sm:grid-cols-2">{[{ to: "/fotografo/login", title: "Sou fotógrafo", text: "Acesse seu espaço e suas fotografias.", Icon: Camera }, { to: "/admin/login", title: "Administração", text: "Gerencie a operação da plataforma.", Icon: ShieldCheck }].map(({ to, title, text, Icon }) => <Link key={to} to={to} className="panel group p-7 transition hover:border-orange-400"><Icon className="mb-6 text-orange-700 dark:text-orange-400" /><h2 className="text-xl font-bold">{title}</h2><p className="muted mt-3 text-sm">{text}</p><span className="mt-8 flex items-center gap-2 text-sm font-bold text-orange-700 dark:text-orange-400">Acessar<ArrowRight size={16} /></span></Link>)}</div><Link to="/conta" className="muted mt-8 inline-block text-sm underline">Sou comprador · Acessar minha conta</Link></section></main>;
}
function BuyerAccount() {
  const { user, checking, authenticated, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  if (checking) return <Loading full />;
  return <main className="mx-auto max-w-xl p-6 py-16"><Brand /><h1 className="mt-8 text-3xl font-extrabold">Sua conta</h1><p className="muted mt-4">{user ? `Você está conectado como ${user.name}.` : "Entre para acessar sua conta de comprador."}</p>{!user ? <button className="primary mt-6" onClick={() => setOpen(true)}>Entrar ou criar conta</button> : <button className="secondary mt-6" disabled={busy} onClick={() => { setBusy(true); void logout().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Não foi possível sair.")).finally(() => setBusy(false)); }}>{busy ? "Saindo…" : "Sair da conta"}</button>}{error && <p role="alert" className="mt-3 text-red-600">{error}</p>}<Link className="muted mt-6 block underline" to="/">Voltar ao início</Link><AuthModal isOpen={open} onClose={() => setOpen(false)} onAuthenticated={authenticated} /></main>;
}

export function App() {
  return <Routes><Route path="/" element={<AccessHome />} /><Route path="/conta" element={<BuyerAccount />} />
    <Route path="/admin/login" element={<AdminLogin />} />
    <Route path="/fotografo/login" element={<PhotographerLogin />} />
    <Route path="/fotografo/cadastro" element={<PhotographerRegister />} />
    <Route element={<ProtectedRoute role="admin" />}><Route path="/admin" element={<AdminLayout />}><Route index element={<AdminDashboard />} /><Route path="pedidos" element={<AdminOrders />} /><Route path="usuarios" element={<AdminUsers />} /><Route path="comissoes" element={<CommissionRulesForm />} /></Route></Route>
    <Route element={<ProtectedRoute role="photographer" />}><Route path="/fotografo" element={<PhotographerLayout />}><Route index element={<PhotographerDashboard />} /><Route path="fotos" element={<PhotographerPhotos />} /><Route path="enviar" element={<PhotographerUnavailable section="upload" />} /><Route path="vendas" element={<PhotographerUnavailable section="sales" />} /><Route path="conta" element={<PhotographerAccount />} /></Route></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
