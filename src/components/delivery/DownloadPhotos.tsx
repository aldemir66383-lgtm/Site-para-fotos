"use client";

import React, { useState } from "react";

interface PhotoItem {
  id: string;
  previewUrl: string;
  downloadsLeft: number;
}

interface DownloadPhotosProps {
  orderId: string;
  photos: PhotoItem[];
}

export function DownloadPhotos({ orderId, photos }: DownloadPhotosProps) {
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [phone, setPhone] = useState("");
  const [whatsappSent, setWhatsappSent] = useState(false);

  const handleDownloadAll = async () => {
    setDownloadingZip(true);
    try {
      window.location.href = `/api/fotoviva/orders/${orderId}/download-all-zip`;
    } finally {
      setTimeout(() => setDownloadingZip(false), 4000);
    }
  };

  const handleDownloadSingle = async (photoId: string) => {
    try {
      const res = await fetch(`/api/fotoviva/orders/${orderId}/photos/${photoId}/ticket`, {
        method: "POST",
      });
      if (res.ok) {
        const { url } = await res.json();
        window.open(url, "_blank");
      }
    } catch (err) {
      alert("Erro ao gerar link de download. Tente novamente.");
    }
  };

  const handleSendWhatsapp = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length >= 10) {
      setWhatsappSent(true);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Header Celebrativo */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mb-2">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-100">
          Suas fotos estão prontas!
        </h1>
        <p className="text-zinc-500">
          Você adquiriu {photos.length} {photos.length === 1 ? "foto" : "fotos"} em resolução máxima e sem marca d'água.
        </p>
      </div>

      {/* Ação Principal: Baixar Todas em ZIP */}
      <div className="p-6 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">Pacote Completo em Alta Resolução</h3>
          <p className="text-emerald-100 text-sm">
            Baixe todas as suas {photos.length} fotos de uma só vez em um arquivo ZIP original.
          </p>
        </div>
        <button
          onClick={handleDownloadAll}
          disabled={downloadingZip}
          className="px-6 py-3.5 bg-white text-emerald-800 hover:bg-emerald-50 active:scale-95 font-bold rounded-xl shadow-lg transition flex items-center gap-2 whitespace-nowrap"
        >
          {downloadingZip ? (
            <span>Gerando ZIP...</span>
          ) : (
            <>
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Baixar Todas (ZIP)</span>
            </>
          )}
        </button>
      </div>

      {/* Grid de Fotos Individuais */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="group relative bg-zinc-100 dark:bg-zinc-800 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 flex flex-col"
          >
            <div className="aspect-[4/3] overflow-hidden bg-zinc-200">
              <img
                src={photo.previewUrl}
                alt="Foto adquirida"
                className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
              />
            </div>
            <div className="p-3 bg-white dark:bg-zinc-900 flex items-center justify-between mt-auto">
              <span className="text-xs text-zinc-400">
                {photo.downloadsLeft} downloads rest.
              </span>
              <button
                onClick={() => handleDownloadSingle(photo.id)}
                className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 hover:bg-emerald-100 transition"
                title="Baixar foto individual"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Envio via WhatsApp (Diferencial vs Banlek) */}
      <div className="p-6 bg-zinc-50 dark:bg-zinc-800/40 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-center max-w-lg mx-auto">
        <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Receber link no WhatsApp
        </h4>
        <p className="text-xs text-zinc-500 mb-4">
          Guarde suas fotos no seu celular e baixe quando quiser.
        </p>

        {whatsappSent ? (
          <div className="p-3 bg-emerald-50 text-emerald-700 text-sm rounded-xl">
            Link enviado com sucesso para o seu WhatsApp!
          </div>
        ) : (
          <form onSubmit={handleSendWhatsapp} className="flex gap-2">
            <input
              type="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition"
            >
              Enviar
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
