"use client";

import React, { useState } from "react";

interface UploadFileItem {
  id: string;
  file: File;
  previewUrl: string;
  status: "queued" | "uploading" | "success" | "error";
  progress: number;
}

export function MassUpload({ albumId }: { albumId: string }) {
  const [items, setItems] = useState<UploadFileItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [singlePrice, setSinglePrice] = useState("15,00");
  const [comboAllPrice, setComboAllPrice] = useState("59,90");

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const newItems: UploadFileItem[] = Array.from(files).map((f) => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      previewUrl: URL.createObjectURL(f),
      status: "queued",
      progress: 0,
    }));
    setItems((prev) => [...prev, ...newItems]);
  };

  const startUpload = async () => {
    setIsUploading(true);
    // Simulação do pipeline concorrente de Direct Upload R2
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "success") continue;

      setItems((prev) =>
        prev.map((item, idx) =>
          idx === i ? { ...item, status: "uploading", progress: 50 } : item
        )
      );

      // Simula finalização do upload
      await new Promise((r) => setTimeout(r, 150));

      setItems((prev) =>
        prev.map((item, idx) =>
          idx === i ? { ...item, status: "success", progress: 100 } : item
        )
      );
    }
    setIsUploading(false);
  };

  const totalFiles = items.length;
  const uploadedFiles = items.filter((i) => i.status === "success").length;
  const progressPercent = totalFiles > 0 ? Math.round((uploadedFiles / totalFiles) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Upload Massivo de Fotos
          </h2>
          <p className="text-sm text-zinc-500">
            Envie dezenas ou centenas de fotos do seu evento esportivo com marca d'água automática.
          </p>
        </div>

        {totalFiles > 0 && (
          <button
            onClick={startUpload}
            disabled={isUploading || uploadedFiles === totalFiles}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/20 transition"
          >
            {isUploading ? `Enviando (${progressPercent}%)` : "Iniciar Upload do Lote"}
          </button>
        )}
      </div>

      {/* Configuração de Preço e Combos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-700">
        <div>
          <label className="block text-xs font-semibold uppercase text-zinc-500 mb-1">
            Preço individual por foto (R$)
          </label>
          <input
            type="text"
            value={singlePrice}
            onChange={(e) => setSinglePrice(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-semibold"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase text-zinc-500 mb-1">
            Combo "Todas as Fotos do Atleta" (R$)
          </label>
          <input
            type="text"
            value={comboAllPrice}
            onChange={(e) => setComboAllPrice(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-semibold"
          />
        </div>
      </div>

      {/* Área Drag and Drop */}
      <div className="p-8 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl text-center bg-zinc-50 dark:bg-zinc-900/40 hover:bg-zinc-100/50 transition cursor-pointer">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png"
          id="mass-upload-input"
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
        <label htmlFor="mass-upload-input" className="cursor-pointer block">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <span className="text-base font-bold text-zinc-800 dark:text-zinc-200">
            Arraste suas fotos aqui ou clique para selecionar
          </span>
          <p className="text-xs text-zinc-400 mt-1">
            Formatos JPEG até 20 MB por arquivo. Processamento com extração automática de EXIF e número de peito.
          </p>
        </label>
      </div>

      {/* Barra de Progresso Geral */}
      {totalFiles > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-zinc-500 font-semibold">
            <span>{uploadedFiles} de {totalFiles} fotos processadas</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full h-2.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Miniaturas */}
      {totalFiles > 0 && (
        <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
          {items.slice(0, 24).map((item) => (
            <div
              key={item.id}
              className="relative aspect-square rounded-lg overflow-hidden border border-zinc-200 bg-zinc-100 dark:bg-zinc-800"
            >
              <img src={item.previewUrl} alt="Thumbnail" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                {item.status === "success" && (
                  <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs">
                    ✓
                  </span>
                )}
                {item.status === "uploading" && (
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
