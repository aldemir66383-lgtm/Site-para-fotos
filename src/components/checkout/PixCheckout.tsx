"use client";

import React, { useState, useEffect } from "react";

interface PixCheckoutProps {
  orderId: string;
  totalCents: number;
  qrCodeBase64: string;
  copyAndPaste: string;
  expiresAt: string;
  onPaid: () => void;
}

export function PixCheckout({
  orderId,
  totalCents,
  qrCodeBase64,
  copyAndPaste,
  expiresAt,
  onPaid,
}: PixCheckoutProps) {
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isChecking, setIsChecking] = useState(true);

  // Formatação de moeda BRL
  const formattedPrice = (totalCents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  // Temporizador de expiração
  useEffect(() => {
    const target = new Date(expiresAt).getTime();
    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((target - now) / 1000));
      setTimeLeft(diff);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // Polling em tempo real verificando confirmação do pagamento
  useEffect(() => {
    let active = true;
    const checkPayment = async () => {
      try {
        const res = await fetch(`/api/fotoviva/orders/${orderId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "paid" && active) {
          setIsChecking(false);
          onPaid();
        }
      } catch (err) {
        // Silencioso em caso de erro temporário
      }
    };

    const interval = setInterval(checkPayment, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [orderId, onPaid]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyAndPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback
    }
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className="max-w-md mx-auto p-6 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 text-center">
      <div className="mb-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full">
          Pagamento Instantâneo via Pix
        </span>
      </div>

      <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        {formattedPrice}
      </h2>
      <p className="text-sm text-zinc-500 mt-1">Pedido #{orderId.slice(0, 8)}</p>

      {/* Temporizador */}
      <div className="my-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Expira em: <strong className="font-mono">{formattedTime}</strong></span>
      </div>

      {/* QR Code */}
      <div className="flex justify-center my-4">
        <div className="p-3 bg-white rounded-xl shadow-md border border-zinc-100">
          <img
            src={`data:image/png;base64,${qrCodeBase64}`}
            alt="QR Code Pix"
            className="w-56 h-56 object-contain"
          />
        </div>
      </div>

      {/* Copia e Cola */}
      <div className="space-y-3">
        <button
          onClick={handleCopy}
          className="w-full py-3.5 px-4 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
        >
          {copied ? (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Código Pix Copiado!</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              <span>Copiar Código Pix</span>
            </>
          )}
        </button>

        {isChecking && (
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 pt-2 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Aguardando banco... Liberação imediata após o pagamento</span>
          </div>
        )}
      </div>

      {/* Instruções */}
      <div className="mt-6 pt-6 border-t border-zinc-100 dark:border-zinc-800 text-left text-xs text-zinc-500 space-y-1.5">
        <p>1. Abra o aplicativo do seu banco.</p>
        <p>2. Selecione a opção <strong>Pix Copia e Cola</strong> ou aponte a câmera para o QR Code.</p>
        <p>3. Suas fotos serão liberadas automaticamente nesta tela assim que o pagamento for concluído.</p>
      </div>
    </div>
  );
}
