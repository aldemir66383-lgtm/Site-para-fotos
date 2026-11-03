import { useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useRemote } from "../../web/useRemote";
import { formatDate, Loading, money, RequestError } from "../../web/ui";
import { ordersSchema, type Order } from "./contracts";

const badges: Record<string, [string, string]> = {
  paid: ["Pago", "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"],
  pending: ["Pendente", "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"],
  expired: ["Expirado", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"],
  failed: ["Falhou", "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"],
  refunded: ["Reembolsado", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"],
  partially_refunded: ["Reembolso parcial", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"],
};
export function OrdersTable({ orders }: { orders: Order[] }) {
  return <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Pedidos com valor em reais, status e data</caption><thead className="muted border-y border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-800/40"><tr>{["Pedido", "Comprador", "Fotos", "Valor", "Status", "Data"].map((text) => <th scope="col" key={text} className="table-head">{text}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{orders.map((order) => { const [label, color] = badges[order.status] ?? [order.status, "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"]; return <tr key={order.id} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40"><th scope="row" title={order.id} className="table-cell font-mono font-medium">#{order.id.slice(0, 8)}</th><td className="table-cell max-w-52 truncate" title={order.buyer_subject ?? undefined}>{order.buyer_subject ?? "Não informado"}</td><td className="table-cell muted">{order.item_count}</td><td className="table-cell font-semibold">{money(order.total_cents)}</td><td className="table-cell"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>{label}</span></td><td className="table-cell muted">{formatDate(order.created_at)}</td></tr>; })}{orders.length === 0 && <tr><td colSpan={6} className="muted p-10 text-center text-sm">Nenhum pedido encontrado.</td></tr>}</tbody></table></div>;
}

export function AdminOrders() {
  const { data, loading, error, refresh } = useRemote("/api/admin/orders", ordersSchema);
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("");
  const filtered = data?.orders.filter((order) => (!status || order.status === status) && `${order.id} ${order.buyer_subject ?? ""}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <div className="space-y-6"><header className="flex flex-wrap justify-between gap-4"><div><p className="eyebrow">Acompanhe cada compra</p><h1 className="mt-2 text-3xl font-extrabold">Pedidos<span className="text-orange-500">.</span></h1></div><button className="secondary self-end" disabled={loading} onClick={refresh}><RefreshCw size={16} />Atualizar</button></header><section className="panel overflow-hidden"><div className="flex flex-wrap items-end gap-4 p-6"><label className="min-w-0 flex-1 text-sm font-semibold"><span className="flex items-center gap-2"><Search size={15} />Buscar pedido ou comprador</span><input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite um identificador" /></label><label className="text-sm font-semibold">Status<select className="field" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos os status</option>{Object.entries(badges).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}</select></label><p className="muted w-full text-xs">Filtros aplicados aos últimos 50 pedidos carregados.</p></div>{loading ? <Loading /> : error ? <RequestError message={error} retry={refresh} /> : <OrdersTable orders={filtered} />}</section></div>;
}
