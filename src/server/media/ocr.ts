import { GoogleAuth } from "google-auth-library";
import type { Bib } from "../photos/contracts.js";

type Vertex = { x?: number; y?: number };
interface Word {
  symbols?: { text?: string }[]; confidence?: number;
  boundingBox?: { vertices?: Vertex[] };
}
export interface VisionAnnotation {
  error?: { code?: number; message?: string };
  fullTextAnnotation?: { pages?: {
    width?: number; height?: number;
    blocks?: { paragraphs?: { words?: Word[] }[] }[];
  }[] };
  localizedObjectAnnotations?: {
    name?: string; score?: number; boundingPoly?: { normalizedVertices?: Vertex[] };
  }[];
}

function bounds(vertices: Vertex[]) {
  if (vertices.length !== 4) return null;
  const xs = vertices.map(v => v.x ?? 0);
  const ys = vertices.map(v => v.y ?? 0);
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  return { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

export function extractBibs(annotation: VisionAnnotation): Bib[] {
  if (annotation.error) throw new Error("Vision annotation failed");
  const regions = (annotation.localizedObjectAnnotations ?? []).flatMap(object => {
    if (!["Person", "Bicycle"].includes(object.name ?? "") || (object.score ?? 0) < 0.7) return [];
    const box = bounds(object.boundingPoly?.normalizedVertices ?? []);
    if (!box || box.right <= box.x || box.bottom <= box.y) return [];
    const w = box.right - box.x, h = box.bottom - box.y;
    // Heurística espacial: tronco/quadril para dorsal, região central para placa da bike.
    return [{ x: box.x + w * 0.1, right: box.right - w * 0.1,
      y: box.y + h * (object.name === "Person" ? 0.22 : 0.05),
      bottom: box.y + h * (object.name === "Person" ? 0.82 : 0.9), score: object.score! }];
  });
  const found = new Map<string, number>();
  for (const page of annotation.fullTextAnnotation?.pages ?? []) {
    if (!page.width || !page.height) continue;
    for (const block of page.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const word of paragraph.words ?? []) {
      const text = (word.symbols ?? []).map(symbol => symbol.text ?? "").join("");
      if (!/^\d{1,5}$/.test(text) || !Number.isFinite(word.confidence) || word.confidence! < 0.7) continue;
      const box = bounds(word.boundingBox?.vertices ?? []);
      if (!box) continue;
      const x = (box.x + box.right) / (2 * page.width), y = (box.y + box.bottom) / (2 * page.height);
      // Não indexar números do fundo (relógios, banners, datas).
      const region = regions.filter(r => x >= r.x && x <= r.right && y >= r.y && y <= r.bottom)
        .sort((a, b) => b.score - a.score)[0];
      if (!region) continue;
      const confidence = Math.min(word.confidence!, region.score);
      found.set(text, Math.max(found.get(text) ?? 0, confidence));
    }
  }
  return [...found].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([bibNumber, confidence]) => ({ bibNumber, confidence }));
}

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-vision"] });
export async function recognizeBibs(jpeg: Buffer): Promise<Bib[]> {
  const client = await auth.getClient();
  const response = await client.request<{ responses?: VisionAnnotation[] }>({
    url: "https://vision.googleapis.com/v1/images:annotate", method: "POST", timeout: 45_000,
    retry: false,
    data: { requests: [{
      image: { content: jpeg.toString("base64") },
      features: [{ type: "TEXT_DETECTION" }, { type: "OBJECT_LOCALIZATION", maxResults: 100 }],
      imageContext: { textDetectionParams: { enableTextDetectionConfidenceScore: true } },
    }] },
  });
  const annotation = response.data.responses?.[0];
  if (!annotation) throw new Error("Missing OCR response");
  return extractBibs(annotation);
}
