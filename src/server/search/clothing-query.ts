/**
 * Interpretador determinístico de consultas em pt-BR sobre roupas e cores.
 * Compatível com busca de vestuário em eventos esportivos.
 */

export type Color =
  | "preto" | "branco" | "cinza" | "vermelho" | "laranja" | "amarelo"
  | "verde" | "azul" | "azul_marinho" | "roxo" | "rosa" | "marrom";

export type Region = "superior" | "inferior" | "corpo_inteiro" | "cabeca" | "bolsa" | "pes" | "qualquer";

export interface Item {
  type: string;
  region: Region;
  color?: Color;
}

export interface ClothingQuery {
  items: Item[];
  bib?: string;
  unrecognized: string[];
}

const GARMENTS: Record<string, [string, Region]> = {
  camisa: ["camisa", "superior"], camiseta: ["camiseta", "superior"], blusa: ["blusa", "superior"],
  regata: ["regata", "superior"], top: ["top", "superior"], jaqueta: ["jaqueta", "superior"],
  casaco: ["casaco", "superior"], moletom: ["moletom", "superior"], colete: ["colete", "superior"],
  uniforme: ["uniforme", "corpo_inteiro"], vestido: ["vestido", "corpo_inteiro"], macacao: ["macacao", "corpo_inteiro"],
  short: ["short", "inferior"], shorts: ["short", "inferior"], bermuda: ["bermuda", "inferior"],
  calca: ["calca", "inferior"], saia: ["saia", "inferior"], legging: ["legging", "inferior"],
  tenis: ["tenis", "pes"], roupa: ["roupa", "qualquer"],
  bone: ["bone", "cabeca"], chapeu: ["chapeu", "cabeca"], viseira: ["viseira", "cabeca"],
  bandana: ["bandana", "cabeca"], mochila: ["mochila", "bolsa"], pochete: ["pochete", "bolsa"],
  bolsa: ["bolsa", "bolsa"],
};

const COLOR_FORMS = new Map<string, Color>();
const inflected = (stem: string, c: Color) => ["o", "a", "os", "as"].forEach(s => COLOR_FORMS.set(stem + s, c));
const invariant = (word: string, c: Color) => { COLOR_FORMS.set(word, c); COLOR_FORMS.set(word + "s", c); };

inflected("pret", "preto"); inflected("branc", "branco"); inflected("vermelh", "vermelho");
inflected("amarel", "amarelo"); inflected("dourad", "amarelo"); inflected("rox", "roxo"); inflected("cinzent", "cinza");
invariant("cinza", "cinza"); invariant("prata", "cinza"); invariant("laranja", "laranja"); invariant("verde", "verde");
invariant("vinho", "vermelho"); invariant("bordo", "vermelho"); invariant("rosa", "rosa"); invariant("pink", "rosa");
invariant("bege", "marrom"); invariant("caramelo", "marrom"); invariant("lilas", "roxo"); invariant("violeta", "roxo");
invariant("celeste", "azul"); invariant("marinho", "azul_marinho");
COLOR_FORMS.set("marrom", "marrom"); COLOR_FORMS.set("marrons", "marrom");
COLOR_FORMS.set("azul", "azul"); COLOR_FORMS.set("azuis", "azul");

const STOPWORDS = new Set([
  "e", "com", "de", "da", "do", "um", "uma", "uns", "umas",
  "a", "o", "as", "os", "na", "no", "em", "cor", "claro", "clara", "escuro", "escura"
]);

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function parseClothingQuery(input: string): ClothingQuery {
  const q: ClothingQuery = { items: [], unrecognized: [] };
  const tokens = normalize(input.slice(0, 200)).replace(/[-_/]/g, " ").match(/#?[a-z0-9°º]+/g) ?? [];
  let current: Item | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const bibMatch = tok.match(/^#?(\d{1,6})$/);
    if (bibMatch) {
      q.bib = bibMatch[1];
      continue;
    }
    if (STOPWORDS.has(tok)) continue;

    if (tok in GARMENTS) {
      const [type, region] = GARMENTS[tok];
      current = { type, region };
      q.items.push(current);
      continue;
    }

    if (COLOR_FORMS.has(tok)) {
      const color = COLOR_FORMS.get(tok)!;
      if (current && !current.color) {
        current.color = color;
      } else {
        current = { type: "roupa", region: "qualquer", color };
        q.items.push(current);
      }
      continue;
    }

    q.unrecognized.push(tok);
  }

  return q;
}
