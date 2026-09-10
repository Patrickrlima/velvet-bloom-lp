/**
 * Worker do site Velvet Bloom.
 *
 * Duas responsabilidades:
 *   - servir o site (arquivos estáticos gerados em dist/);
 *   - atender o painel administrativo em /api/*.
 *
 * Nada do painel interfere no site público: se a API quebrar, o site continua
 * servindo normalmente, porque são arquivos estáticos.
 *
 * Segredos necessários (configurados no Cloudflare, nunca no repositório):
 *   ADMIN_PASSWORD  senha de acesso ao painel
 *   SESSION_SECRET  texto aleatório longo, usado para assinar o cookie
 *   GITHUB_TOKEN    token com permissão de escrita no repositório
 *   GITHUB_REPO     ex.: "Patrickrlima/velvet-bloom-lp"
 *   GITHUB_BRANCH   opcional (padrão: main)
 */

import { criarSessao, sessaoValida, comparaSeguro, lerCookie } from "./session.js";
import { lerArquivo, gravarTexto, gravarArquivo } from "./github.js";

const COOKIE = "vb_sessao";
const CAMINHO_CONTEUDO = "content.json";

/* Extensões aceitas no upload e o tamanho máximo. O painel já reduz a imagem
   no navegador antes de enviar; este limite é a rede de segurança do servidor. */
const TIPOS_IMAGEM = { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const MAX_UPLOAD = 3 * 1024 * 1024; // 3 MB

const json = (dados, status = 200, extra = {}) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

function faltandoConfiguracao(env) {
  const necessarios = ["ADMIN_PASSWORD", "SESSION_SECRET", "GITHUB_TOKEN", "GITHUB_REPO"];
  return necessarios.filter((n) => !env[n]);
}

async function estaAutenticado(request, env) {
  const cookie = lerCookie(request.headers.get("Cookie"), COOKIE);
  return cookie ? sessaoValida(cookie, env.SESSION_SECRET) : false;
}

/* ---------------------------------------------------------------- rotas */

async function rotaLogin(request, env) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ erro: "Requisição inválida." }, 400);
  }

  /* Um atraso fixo antes de responder torna a força bruta lenta e disfarça
     qualquer diferença de tempo entre "senha errada" e "senha certa". */
  await new Promise((r) => setTimeout(r, 400));

  if (!comparaSeguro(corpo && corpo.senha, env.ADMIN_PASSWORD)) {
    return json({ erro: "Senha incorreta." }, 401);
  }

  const sessao = await criarSessao(env.SESSION_SECRET, 12);
  return json(
    { ok: true },
    200,
    {
      "Set-Cookie": `${COOKIE}=${sessao}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${12 * 60 * 60}`,
    }
  );
}

function rotaSair() {
  return json({ ok: true }, 200, {
    "Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
  });
}

async function rotaLerConteudo(env) {
  const arquivo = await lerArquivo(env, CAMINHO_CONTEUDO);
  if (!arquivo) return json({ erro: "content.json não encontrado no repositório." }, 500);

  let conteudo;
  try {
    conteudo = JSON.parse(arquivo.conteudo);
  } catch {
    return json({ erro: "O content.json do repositório está com formato inválido." }, 500);
  }
  return json({ conteudo, sha: arquivo.sha });
}

async function rotaSalvarConteudo(request, env) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ erro: "Requisição inválida." }, 400);
  }

  if (!corpo || typeof corpo.conteudo !== "object" || corpo.conteudo === null) {
    return json({ erro: "Conteúdo ausente." }, 400);
  }

  /* Confere que o conteúdo continua tendo a forma esperada. Sem isto, um erro
     no painel poderia gravar um JSON incompleto e derrubar o build do site. */
  const obrigatorias = ["config", "seo", "menu", "hero", "essencia", "categorias", "presentes", "entrega", "galeria", "depoimentos", "ctaFinal", "rodape"];
  const faltando = obrigatorias.filter((s) => !(s in corpo.conteudo));
  if (faltando.length) {
    return json({ erro: `Conteúdo incompleto — faltam seções: ${faltando.join(", ")}` }, 400);
  }

  const texto = JSON.stringify(corpo.conteudo, null, 2) + "\n";

  try {
    await gravarTexto(env, CAMINHO_CONTEUDO, texto, "Atualização de conteúdo pelo painel", corpo.sha);
  } catch (erro) {
    /* 409 = o arquivo mudou desde que o painel carregou (duas pessoas editando). */
    const conflito = String(erro.message).includes("409");
    return json(
      {
        erro: conflito
          ? "O conteúdo foi alterado por outra pessoa enquanto você editava. Recarregue a página e refaça a alteração."
          : "Não foi possível salvar: " + erro.message,
      },
      conflito ? 409 : 500
    );
  }

  return json({ ok: true });
}

async function rotaEnviarImagem(request, env) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ erro: "Requisição inválida." }, 400);
  }

  const { pasta, nome, dadosBase64 } = corpo || {};

  /* Só deixa gravar dentro de assets/, em pastas conhecidas, com nome simples.
     Isso impede que um nome malicioso escreva em qualquer lugar do repositório. */
  const PASTAS = ["hero", "cat", "card", "essencia", "testi"];
  if (!PASTAS.includes(pasta)) return json({ erro: "Pasta inválida." }, 400);
  if (typeof nome !== "string" || !/^[a-z0-9][a-z0-9_-]{0,60}\.(webp|jpg|jpeg|png)$/i.test(nome)) {
    return json({ erro: "Nome de arquivo inválido." }, 400);
  }
  const extensao = nome.split(".").pop().toLowerCase();
  if (!TIPOS_IMAGEM[extensao]) return json({ erro: "Formato não aceito." }, 400);

  if (typeof dadosBase64 !== "string" || !dadosBase64) {
    return json({ erro: "Imagem ausente." }, 400);
  }
  const tamanhoAproximado = Math.floor((dadosBase64.length * 3) / 4);
  if (tamanhoAproximado > MAX_UPLOAD) {
    return json({ erro: "Imagem muito grande." }, 413);
  }

  const caminho = `assets/${pasta}/${nome}`;
  const existente = await lerArquivo(env, caminho).catch(() => null);

  try {
    await gravarArquivo(env, caminho, dadosBase64, `Nova imagem: ${caminho}`, existente ? existente.sha : undefined);
  } catch (erro) {
    return json({ erro: "Não foi possível enviar a imagem: " + erro.message }, 500);
  }

  return json({ ok: true, caminho: `${pasta}/${nome}` });
}

/* ---------------------------------------------------------------- worker */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const rota = url.pathname;

    if (!rota.startsWith("/api/")) {
      // tudo que não é API é o site estático
      return env.ASSETS.fetch(request);
    }

    const faltam = faltandoConfiguracao(env);
    if (faltam.length) {
      return json({ erro: `Painel não configurado. Faltam os segredos: ${faltam.join(", ")}` }, 503);
    }

    if (rota === "/api/login" && request.method === "POST") {
      return rotaLogin(request, env);
    }

    if (rota === "/api/sessao" && request.method === "GET") {
      return json({ autenticado: await estaAutenticado(request, env) });
    }

    if (rota === "/api/sair" && request.method === "POST") {
      return rotaSair();
    }

    /* Daqui para baixo, só autenticado. */
    if (!(await estaAutenticado(request, env))) {
      return json({ erro: "Sessão expirada. Entre novamente." }, 401);
    }

    if (rota === "/api/conteudo" && request.method === "GET") {
      return rotaLerConteudo(env);
    }
    if (rota === "/api/conteudo" && request.method === "POST") {
      return rotaSalvarConteudo(request, env);
    }
    if (rota === "/api/imagem" && request.method === "POST") {
      return rotaEnviarImagem(request, env);
    }

    return json({ erro: "Rota não encontrada." }, 404);
  },
};
