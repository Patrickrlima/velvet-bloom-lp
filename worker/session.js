/**
 * Sessão do painel administrativo.
 *
 * Não existe banco de sessões: o próprio cookie carrega a data de expiração
 * e uma assinatura HMAC-SHA256 feita com um segredo do servidor. Se alguém
 * mexer um caractere que seja no cookie, a assinatura deixa de bater e a
 * sessão é recusada. Simples, sem estado, e sem custo de armazenamento.
 */

const CODIFICADOR = new TextEncoder();

function paraBase64Url(bytes) {
  let binario = "";
  for (const b of new Uint8Array(bytes)) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto) {
  const normalizado = texto.replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(normalizado + "=".repeat((4 - (normalizado.length % 4)) % 4));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function chaveHmac(segredo) {
  return crypto.subtle.importKey(
    "raw",
    CODIFICADOR.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Compara dois textos em tempo constante, para não vazar informação pelo tempo de resposta. */
export function comparaSeguro(a, b) {
  const ba = CODIFICADOR.encode(String(a));
  const bb = CODIFICADOR.encode(String(b));
  // O tamanho pode vazar, mas o conteúdo não: percorre sempre o mesmo número de bytes.
  let diferenca = ba.length ^ bb.length;
  const maximo = Math.max(ba.length, bb.length);
  for (let i = 0; i < maximo; i++) {
    diferenca |= (ba[i] || 0) ^ (bb[i] || 0);
  }
  return diferenca === 0;
}

/**
 * Cria o valor do cookie de sessão.
 * @param {string} segredo   segredo do servidor (env.SESSION_SECRET)
 * @param {number} horas     validade
 */
export async function criarSessao(segredo, horas = 12) {
  const expiraEm = Date.now() + horas * 60 * 60 * 1000;
  const corpo = paraBase64Url(CODIFICADOR.encode(JSON.stringify({ exp: expiraEm })));
  const assinatura = await crypto.subtle.sign("HMAC", await chaveHmac(segredo), CODIFICADOR.encode(corpo));
  return `${corpo}.${paraBase64Url(assinatura)}`;
}

/**
 * Confere um cookie de sessão. Devolve true só se a assinatura bater E não
 * estiver vencido.
 */
export async function sessaoValida(valorCookie, segredo) {
  if (typeof valorCookie !== "string" || !valorCookie.includes(".")) return false;
  const [corpo, assinatura] = valorCookie.split(".");
  if (!corpo || !assinatura) return false;

  let confere;
  try {
    confere = await crypto.subtle.verify(
      "HMAC",
      await chaveHmac(segredo),
      deBase64Url(assinatura),
      CODIFICADOR.encode(corpo)
    );
  } catch {
    return false; // base64 inválido, por exemplo
  }
  if (!confere) return false;

  try {
    const dados = JSON.parse(new TextDecoder().decode(deBase64Url(corpo)));
    return typeof dados.exp === "number" && dados.exp > Date.now();
  } catch {
    return false;
  }
}

/** Lê um cookie específico do cabeçalho. */
export function lerCookie(cabecalho, nome) {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return resto.join("=");
  }
  return null;
}
