import { ArrowUpRight, Banknote, Camera, ShoppingBag, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useRemote } from "../../web/useRemote";
import { Loading, money, RequestError } from "../../web/ui";
import { overviewSchema, ordersSchema } from "./contracts";
import { OrdersTable } from "./AdminOrders";

export function AdminDashboard() {
  const overview = useRemote("/api/admin/overview", overviewSchema);
  const recent = useRemote("/api/admin/orders", ordersSchema);
  const stats = overview.data?.stats;
  return <div className="space-y-7"><header><p className="eyebrow">Tudo em perspectiva</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight">Visão geral<span className="text-orange-500">.</span></h1><p className="muted mt-2 text-sm">Um retrato da sua operação, em tempo real de consulta.</p></header>
    {overview.loading && <Loading label="Carregando indicadores…" />}{overview.error && <RequestError message={overview.error} retry={overview.refresh} />}
    {stats && <section aria-label="Métricas da plataforma" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      { title: "Faturamento total Pix", value: stats.orders ? money(stats.orders.paid_cents) : "Indisponível", hint: "Pagamentos confirmados", Icon: Banknote },
      { title: "Total de pedidos", value: stats.orders?.total_orders.toLocaleString("pt-BR") ?? "Indisponível", hint: "Todos os status", Icon: ShoppingBag },
      { title: "Fotos ativas", value: stats.photos.toLocaleString("pt-BR"), hint: "Prévias verificadas e aprovadas", Icon: Camera },
      { title: "Pessoas na plataforma", value: stats.users?.total_users.toLocaleString("pt-BR") ?? "Indisponível", hint: "Compradores e equipe", Icon: Users },
    ].map(({ title, value, hint, Icon }) => <article key={title} className="panel p-5 sm:p-6"><div className="flex items-center justify-between gap-2"><h2 className="muted text-xs font-semibold">{title}</h2><span className="rounded-lg bg-orange-50 p-2 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"><Icon size={18} /></span></div><p className="mt-5 text-3xl font-extrabold tracking-tight">{value}</p><p className="muted mt-2 text-xs">{hint}</p></article>)}</section>}
    <section className="panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 p-6"><div><h2 className="text-lg font-bold">Últimos pedidos</h2><p className="muted mt-1 text-xs">Os cinco pedidos mais recentes.</p></div><Link className="secondary" to="/admin/pedidos">Ver pedidos<ArrowUpRight size={15} /></Link></div>{recent.loading ? <Loading /> : recent.error ? <RequestError message={recent.error} retry={recent.refresh} /> : <OrdersTable orders={recent.data?.orders.slice(0, 5) ?? []} />}</section>
    <section className="grid gap-4 md:grid-cols-2"><Link to="/admin/usuarios" className="panel flex items-center justify-between gap-4 p-6 hover:border-orange-300"><div><p className="font-bold">Quem faz parte do Aire</p><p className="muted mt-2 text-sm">Consulte perfis e contas cadastradas.</p></div><Users className="shrink-0 text-orange-700 dark:text-orange-400" /></Link><Link to="/admin/comissoes" className="panel flex items-center justify-between gap-4 p-6 hover:border-orange-300"><div><p className="font-bold">Regras com histórico</p><p className="muted mt-2 text-sm">Configure comissões para os próximos pedidos.</p></div><ArrowUpRight className="shrink-0 text-orange-700 dark:text-orange-400" /></Link></section>
  </div>;
}
