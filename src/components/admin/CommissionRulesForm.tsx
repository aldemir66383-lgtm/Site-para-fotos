import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { History, Info } from "lucide-react";
import { apiRequest } from "../auth/api";
import { useRemote } from "../../web/useRemote";
import { formatDate, Loading, money, RequestError } from "../../web/ui";
import { rulesSchema } from "./contracts";

export function CommissionRulesForm() {
  const { data, loading, error, refresh } = useRemote("/api/admin/commission-rules", rulesSchema);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (data) setSelected(data.rules[0]?.id ?? ""); }, [data]);
  const rule = data?.rules.find((item) => item.id === selected);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const fields = new FormData(event.currentTarget);
    const body = {
      name: String(fields.get("name")).trim(), platformFeePercent: Number(fields.get("platformFeePercent")),
      providerFeePercent: Number(fields.get("providerFeePercent")), fixedFeeCents: Math.round(Number(fields.get("fixedFee")) * 100),
      providerFeeBearer: String(fields.get("providerFeeBearer")), holdDays: Number(fields.get("holdDays")),
    };
    if (!body.name || !Number.isSafeInteger(body.fixedFeeCents) || body.fixedFeeCents < 0 || [body.platformFeePercent, body.providerFeePercent].some((value) => !Number.isFinite(value) || value < 0 || value > 100) || !Number.isInteger(body.holdDays)) {
      setFeedback({ error: true, message: "Confira o nome, as taxas e o prazo informados." }); return;
    }
    const controller = new AbortController(); request.current = controller; setBusy(true); setFeedback(null);
    try {
      await apiRequest("/api/admin/commission-rules", z.object({ success: z.literal(true), id: z.string() }), { method: "POST", body: JSON.stringify(body), signal: controller.signal });
      if (!controller.signal.aborted) { setFeedback({ error: false, message: "Nova versão salva. Será utilizada nos próximos pedidos; o histórico foi preservado." }); refresh(); }
    } catch (cause) { if (!controller.signal.aborted) setFeedback({ error: true, message: cause instanceof Error ? cause.message : "Não foi possível salvar." }); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <div className="space-y-6"><header><p className="eyebrow">Regras claras, histórico preservado</p><h1 className="mt-2 text-3xl font-extrabold">Comissões<span className="text-orange-500">.</span></h1><p className="muted mt-2 text-sm">Configure a comissão e os custos de pagamento dos próximos pedidos.</p></header>
    <div className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-orange-900 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200"><Info size={20} className="mt-0.5 shrink-0" /><p>Cada alteração cria uma nova versão, que passa a valer para novos pedidos. A retenção financeira disponível é um prazo em dias; o backend não implementa retenção percentual.</p></div>
    {loading ? <Loading /> : error ? <RequestError message={error} retry={refresh} /> : <section className="panel p-6"><div className="flex flex-wrap justify-between gap-4"><h2 className="text-lg font-bold">{rule ? `Regra vigente · versão ${data?.rules[0]?.version}` : "Primeira regra"}</h2><span className="muted text-xs">{data?.rules.length ?? 0} versões registradas</span></div>
      <label className="mt-6 block max-w-lg text-sm font-semibold">Usar como base<select className="field" value={selected} disabled={busy} onChange={(event) => { setSelected(event.target.value); setFeedback(null); }}><option value="">Nova configuração</option>{data?.rules.map((item, index) => <option key={item.id} value={item.id}>v{item.version} · {item.name}{index === 0 ? " (vigente)" : ""}</option>)}</select></label>
      <form key={selected} className="mt-6" onSubmit={save} aria-busy={busy}><fieldset disabled={busy} className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"><legend className="sr-only">Configurar nova versão da comissão</legend>
        <label className="text-sm font-semibold">Nome da regra<input name="name" className="field" defaultValue={rule?.name ?? ""} required maxLength={100} /></label>
        <label className="text-sm font-semibold">Comissão da plataforma (%)<input name="platformFeePercent" className="field" type="number" inputMode="decimal" min="0" max="100" step="0.01" required defaultValue={rule?.platform_fee_percent ?? 0} /></label>
        <label className="text-sm font-semibold">Taxa do provedor (%)<input name="providerFeePercent" className="field" type="number" inputMode="decimal" min="0" max="100" step="0.01" required defaultValue={rule?.provider_fee_percent ?? 0} /></label>
        <label className="text-sm font-semibold">Taxa fixa do provedor (R$)<input name="fixedFee" className="field" type="number" inputMode="decimal" min="0" max="10000000000" step="0.01" required defaultValue={((rule?.fixed_fee_cents ?? 0) / 100).toFixed(2)} /></label>
        <label className="text-sm font-semibold">Responsável pela taxa do provedor<select name="providerFeeBearer" className="field" defaultValue={rule?.provider_fee_bearer ?? "platform"}><option value="platform">Plataforma</option><option value="photographer">Fotógrafo</option></select></label>
        <label className="text-sm font-semibold">Prazo de retenção (dias)<input name="holdDays" className="field" type="number" min="0" max="365" step="1" required defaultValue={rule?.hold_days ?? 0} /></label>
        <div className="md:col-span-2 xl:col-span-3"><button className="primary" type="submit">{busy ? "Salvando…" : "Salvar e ativar nova versão"}</button></div>
      </fieldset></form></section>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`rounded-xl p-4 text-sm ${feedback.error ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}>{feedback.message}</p>}
    {data && data.rules.length > 0 && <section className="panel overflow-hidden"><h2 className="flex items-center gap-2 p-6 text-lg font-bold"><History size={19} />Histórico de versões</h2><div className="overflow-x-auto"><table className="w-full"><caption className="sr-only">Histórico imutável de regras de comissão</caption><thead className="muted bg-zinc-50 dark:bg-zinc-800/40"><tr>{["Versão", "Regra", "Comissão", "Provedor", "Taxa fixa", "Retenção", "Criada em"].map((text) => <th className="table-head" scope="col" key={text}>{text}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{data.rules.map((item) => <tr key={item.id}><th scope="row" className="table-cell text-left">v{item.version}</th><td className="table-cell">{item.name}</td><td className="table-cell">{item.platform_fee_percent}%</td><td className="table-cell">{item.provider_fee_percent}%</td><td className="table-cell">{money(item.fixed_fee_cents)}</td><td className="table-cell">{item.hold_days} dias</td><td className="table-cell muted">{formatDate(item.created_at)}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
