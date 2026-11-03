import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

export function Brand({ light = false }: { light?: boolean }) {
  return <Link to="/" aria-label="Aire Photos, início" className={`inline-flex items-baseline gap-1 font-display text-2xl font-extrabold tracking-tight ${light ? "text-white" : "text-zinc-900 dark:text-white"}`}>aire<span className="font-normal">photos</span><span className="text-orange-500">.</span></Link>;
}
export function Loading({ label = "Carregando…", full = false }: { label?: string; full?: boolean }) {
  return <div role="status" className={`flex items-center justify-center gap-3 p-10 text-sm ${full ? "min-h-dvh" : ""}`}><LoaderCircle className="size-5 animate-spin text-orange-600" />{label}</div>;
}
export function RequestError({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" className="panel p-6"><TriangleAlert className="mb-3 size-6 text-orange-600" /><p>{message}</p>{retry && <button className="secondary mt-4" onClick={retry}><RefreshCw size={16} />Tentar novamente</button>}</div>;
}
export const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function formatDate(value: string) {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value);
  return Number.isNaN(parsed.getTime()) ? "Data indisponível" : parsed.toLocaleString("pt-BR");
}
