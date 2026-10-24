"use client";

import React, { useState } from "react";

interface SuperSearchProps {
  albumId: string;
  onSearch: (filters: { bib?: string; query?: string; selfieBlob?: Blob }) => void;
}

export function SuperSearch({ albumId, onSearch }: SuperSearchProps) {
  const [activeTab, setActiveTab] = useState<"bib" | "selfie" | "clothing">("bib");
  const [bib, setBib] = useState("");
  const [clothingText, setClothingText] = useState("");
  const [consent, setConsent] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleBibSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (bib.trim()) onSearch({ bib: bib.trim() });
  };

  const handleClothingSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (clothingText.trim()) onSearch({ query: clothingText.trim() });
  };

  const handleSelfieSearch = () => {
    if (selectedFile && consent) {
      onSearch({ selfieBlob: selectedFile });
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-5">
      {/* Abas */}
      <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl mb-6">
        <button
          onClick={() => setActiveTab("bib")}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition ${
            activeTab === "bib"
              ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-800"
          }`}
        >
          Número de Peito
        </button>
        <button
          onClick={() => setActiveTab("selfie")}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition ${
            activeTab === "selfie"
              ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-800"
          }`}
        >
          Buscar por Selfie
        </button>
        <button
          onClick={() => setActiveTab("clothing")}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition ${
            activeTab === "clothing"
              ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-800"
          }`}
        >
          Cor da Roupa
        </button>
      </div>

      {/* Conteúdo Aba: Número de Peito */}
      {activeTab === "bib" && (
        <form onSubmit={handleBibSearch} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Digite seu número de inscrição ou dorsal
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Ex: 1420"
                value={bib}
                onChange={(e) => setBib(e.target.value)}
                className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition shadow-md shadow-emerald-600/20"
              >
                Buscar
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-400">
            Dica: Se o seu número estava coberto, use a busca por roupa ou selfie.
          </p>
        </form>
      )}

      {/* Conteúdo Aba: Selfie */}
      {activeTab === "selfie" && (
        <div className="space-y-4">
          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-center">
            <input
              type="file"
              accept="image/*"
              capture="user"
              id="selfie-input"
              className="hidden"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="selfie-input" className="cursor-pointer block">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center mb-2">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {selectedFile ? selectedFile.name : "Tire uma selfie ou envie do celular"}
              </span>
              <p className="text-xs text-zinc-400 mt-1">Envie uma foto recente com boa iluminação</p>
            </label>
          </div>

          {/* Consentimento LGPD */}
          <div className="flex items-start gap-2.5 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              id="consent"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
            />
            <label htmlFor="consent" className="cursor-pointer">
              Declaro que tenho mais de 18 anos e autorizo o processamento temporário da minha imagem apenas para localizar minhas fotos neste evento. A foto não será armazenada.
            </label>
          </div>

          <button
            onClick={handleSelfieSearch}
            disabled={!selectedFile || !consent}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold rounded-xl transition"
          >
            Buscar Minhas Fotos
          </button>
        </div>
      )}

      {/* Conteúdo Aba: Roupas */}
      {activeTab === "clothing" && (
        <form onSubmit={handleClothingSearch} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Descreva as roupas e cores que usava
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ex: camisa azul e short preto"
                value={clothingText}
                onChange={(e) => setClothingText(e.target.value)}
                className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition shadow-md shadow-emerald-600/20"
              >
                Buscar
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="text-zinc-400 py-1">Sugestões rápidas:</span>
            {["camisa vermelha", "regata preta", "viseira branca", "camisa amarela"].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setClothingText(chip)}
                className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-zinc-600 dark:text-zinc-300 transition"
              >
                {chip}
              </button>
            ))}
          </div>
        </form>
      )}
    </div>
  );
}
