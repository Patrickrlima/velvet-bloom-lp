/**
 * Build do site Velvet Bloom.
 *
 * Roda tanto aqui quanto dentro do Cloudflare Pages, que executa este mesmo
 * comando a cada alteração no repositório:
 *
 *     comando de build:      node build.js
 *     pasta de saída:        dist
 *
 * Lê content.json + template.html e escreve dist/ com o site pronto.
 * Todos os caminhos são relativos a este arquivo — nada preso a uma máquina.
 */
const fs = require("fs");
const path = require("path");
const { render } = require("./render.js");

const RAIZ = __dirname;
const ORIGEM_ASSETS = path.join(RAIZ, "assets");
const DESTINO = path.join(RAIZ, "dist");

const conteudo = JSON.parse(fs.readFileSync(path.join(RAIZ, "content.json"), "utf8"));
const template = fs.readFileSync(path.join(RAIZ, "template.html"), "utf8");

/* Endereço final do site, usado em canonical, og:url e sitemap. Vem do painel
   e começa vazio: enquanto não houver domínio próprio, é melhor não declarar
   endereço nenhum do que declarar um errado. A barra do fim é removida para
   não gerar "site.com.br//pagina". */
let SITE = String((conteudo.config && conteudo.config.siteUrl) || "").trim().replace(/\/+$/, "");
/* Se digitarem só "velvetbloom.com.br", vira endereço completo: sem isso o
   canonical sairia quebrado e o Google ignoraria a página. */
if (SITE && !/^https?:\/\//i.test(SITE)) SITE = "https://" + SITE;
/* O template lê o mesmo valor já normalizado — assim canonical, og:url e
   sitemap nunca discordam entre si. */
if (conteudo.config) conteudo.config.siteUrl = SITE;

/** Copia uma pasta inteira, recursivamente. */
function copiarPasta(de, para) {
  fs.mkdirSync(para, { recursive: true });
  let total = 0;
  for (const item of fs.readdirSync(de, { withFileTypes: true })) {
    const origem = path.join(de, item.name);
    const destino = path.join(para, item.name);
    if (item.isDirectory()) {
      total += copiarPasta(origem, destino);
    } else {
      fs.copyFileSync(origem, destino);
      total += 1;
    }
  }
  return total;
}

/* ---------- renderiza ----------
   Os templates são fragmentos: o <head> vai até o </style> e o resto é corpo.
   Esta função monta o documento completo em volta, e vale para qualquer
   página nova que apareça depois. */
function montarPagina(fragmento) {
  const corpo = render(fragmento, conteudo, (rel) => "assets/" + rel);
  const fimHead = corpo.indexOf("</style>") + "</style>".length;
  return (
    '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    corpo.slice(0, fimHead).trim() +
    "\n</head>\n<body>\n" +
    corpo.slice(fimHead).trim() +
    "\n</body>\n</html>\n"
  );
}

const documento = montarPagina(template);

/* ---------- escreve ---------- */
/* Limpa a saída anterior. Escrito sem depender de fs.rmSync (que só existe a
   partir do Node 14.14) para o build funcionar em qualquer versão do Node que
   o servidor de build tiver — assim não é preciso fixar versão em lugar nenhum. */
function apagarPasta(alvo) {
  if (!fs.existsSync(alvo)) return;
  for (const item of fs.readdirSync(alvo)) {
    const caminho = path.join(alvo, item);
    if (fs.statSync(caminho).isDirectory()) apagarPasta(caminho);
    else fs.unlinkSync(caminho);
  }
  fs.rmdirSync(alvo);
}
apagarPasta(DESTINO);
fs.mkdirSync(DESTINO, { recursive: true });

fs.writeFileSync(path.join(DESTINO, "index.html"), documento, "utf8");
fs.writeFileSync(path.join(DESTINO, ".nojekyll"), "", "utf8");

/* ---------- política de privacidade ---------- */
const TPL_PRIVACIDADE = path.join(RAIZ, "template-privacidade.html");
const temPrivacidade = fs.existsSync(TPL_PRIVACIDADE);
if (temPrivacidade) {
  fs.writeFileSync(
    path.join(DESTINO, "privacidade.html"),
    montarPagina(fs.readFileSync(TPL_PRIVACIDADE, "utf8")),
    "utf8"
  );
}

/* ---------- robots.txt e sitemap.xml ----------
   O painel administrativo fica fora do índice de propósito: ele já manda
   noindex no próprio HTML, mas o robots evita até a visita.
   O sitemap só é gerado quando existe endereço: um sitemap com URL errada
   atrapalha mais do que sitemap nenhum. */
const robots = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /admin/",
  SITE ? "\nSitemap: " + SITE + "/sitemap.xml" : "",
].join("\n").trim() + "\n";
fs.writeFileSync(path.join(DESTINO, "robots.txt"), robots, "utf8");

let sitemapInfo = "sem sitemap (endereço do site em branco)";
if (SITE) {
  const hoje = new Date().toISOString().slice(0, 10);
  const paginas = [{ caminho: "/", prioridade: "1.0" }];
  if (temPrivacidade) paginas.push({ caminho: "/privacidade.html", prioridade: "0.3" });

  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paginas
      .map(
        (p) =>
          "  <url>\n" +
          "    <loc>" + SITE + p.caminho + "</loc>\n" +
          "    <lastmod>" + hoje + "</lastmod>\n" +
          "    <priority>" + p.prioridade + "</priority>\n" +
          "  </url>\n"
      )
      .join("") +
    "</urlset>\n";
  fs.writeFileSync(path.join(DESTINO, "sitemap.xml"), sitemap, "utf8");
  sitemapInfo = "sitemap com " + paginas.length + " páginas";
}

const copiados = fs.existsSync(ORIGEM_ASSETS)
  ? copiarPasta(ORIGEM_ASSETS, path.join(DESTINO, "assets"))
  : 0;

/* A pasta admin, quando existir, vai junto para a saída. */
const ADMIN = path.join(RAIZ, "admin");
if (fs.existsSync(ADMIN)) copiarPasta(ADMIN, path.join(DESTINO, "admin"));

const kb = (fs.statSync(path.join(DESTINO, "index.html")).size / 1024).toFixed(1);
console.log(
  `Site gerado em dist/ — index.html ${kb} KB, ${copiados} assets, ` +
  `${temPrivacidade ? "privacidade.html" : "sem privacidade"}, robots.txt, ${sitemapInfo}.`
);
