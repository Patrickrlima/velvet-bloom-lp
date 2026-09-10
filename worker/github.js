/**
 * Gravação no GitHub.
 *
 * O painel não guarda o conteúdo em banco: ele grava direto no repositório.
 * Isso traz três vantagens grandes para um site de cliente:
 *   1. o site continua sendo arquivos estáticos (rápido e à prova de falha
 *      do painel — se a API cair, o site no ar não sente);
 *   2. cada alteração vira um commit, ou seja, histórico e possibilidade de
 *      voltar atrás se ela publicar algo errado;
 *   3. o próprio commit dispara a republicação automática. Salvar e publicar
 *      são a mesma ação.
 */

const API = "https://api.github.com";

function cabecalhos(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "velvet-bloom-admin",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function base(env) {
  return `${API}/repos/${env.GITHUB_REPO}`; // ex.: "Patrickrlima/velvet-bloom-lp"
}

const ramo = (env) => env.GITHUB_BRANCH || "main";

/** Converte bytes em base64 em blocos, para não estourar a pilha com arquivos grandes. */
export function paraBase64(bytes) {
  const arr = new Uint8Array(bytes);
  let binario = "";
  const BLOCO = 0x8000;
  for (let i = 0; i < arr.length; i += BLOCO) {
    binario += String.fromCharCode.apply(null, arr.subarray(i, i + BLOCO));
  }
  return btoa(binario);
}

/**
 * Lê um arquivo do repositório.
 * @returns {{conteudo: string, sha: string}} texto e o sha (necessário para sobrescrever)
 */
export async function lerArquivo(env, caminho) {
  const url = `${base(env)}/contents/${encodeURIComponent(caminho)}?ref=${ramo(env)}`;
  const resposta = await fetch(url, { headers: cabecalhos(env) });

  if (resposta.status === 404) return null;
  if (!resposta.ok) {
    throw new Error(`GitHub respondeu ${resposta.status} ao ler ${caminho}`);
  }

  const dados = await resposta.json();
  const binario = atob(dados.content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return { conteudo: new TextDecoder().decode(bytes), sha: dados.sha };
}

/**
 * Cria ou atualiza um arquivo. O `sha` deve ser o da versão atual quando o
 * arquivo já existe — é isso que impede sobrescrever cegamente uma alteração
 * feita por outra pessoa no meio do caminho.
 */
export async function gravarArquivo(env, caminho, conteudoBase64, mensagem, sha) {
  const corpo = {
    message: mensagem,
    content: conteudoBase64,
    branch: ramo(env),
  };
  if (sha) corpo.sha = sha;

  const resposta = await fetch(`${base(env)}/contents/${encodeURIComponent(caminho)}`, {
    method: "PUT",
    headers: { ...cabecalhos(env), "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(`GitHub respondeu ${resposta.status} ao gravar ${caminho}: ${detalhe.slice(0, 300)}`);
  }
  return resposta.json();
}

/** Grava texto (UTF-8) num arquivo do repositório. */
export async function gravarTexto(env, caminho, texto, mensagem, sha) {
  const bytes = new TextEncoder().encode(texto);
  return gravarArquivo(env, caminho, paraBase64(bytes), mensagem, sha);
}
