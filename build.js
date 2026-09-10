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

/* ---------- renderiza ---------- */
const corpo = render(template, conteudo, (rel) => "assets/" + rel);

/* O template é um fragmento; aqui ele vira um documento HTML completo. */
const fimHead = corpo.indexOf("</style>") + "</style>".length;
const documento =
  '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  corpo.slice(0, fimHead).trim() +
  "\n</head>\n<body>\n" +
  corpo.slice(fimHead).trim() +
  "\n</body>\n</html>\n";

/* ---------- escreve ---------- */
fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(DESTINO, { recursive: true });

fs.writeFileSync(path.join(DESTINO, "index.html"), documento, "utf8");
fs.writeFileSync(path.join(DESTINO, ".nojekyll"), "", "utf8");

const copiados = fs.existsSync(ORIGEM_ASSETS)
  ? copiarPasta(ORIGEM_ASSETS, path.join(DESTINO, "assets"))
  : 0;

/* A pasta admin, quando existir, vai junto para a saída. */
const ADMIN = path.join(RAIZ, "admin");
if (fs.existsSync(ADMIN)) copiarPasta(ADMIN, path.join(DESTINO, "admin"));

const kb = (fs.statSync(path.join(DESTINO, "index.html")).size / 1024).toFixed(1);
console.log(`Site gerado em dist/ — index.html ${kb} KB, ${copiados} assets.`);
