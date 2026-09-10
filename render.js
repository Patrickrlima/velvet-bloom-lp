/**
 * Renderizador do site Velvet Bloom.
 *
 * Junta content.json + template.html e devolve o HTML final. Escrito sem
 * nenhuma dependência de Node (nada de fs/path aqui dentro) justamente para
 * que a MESMA função possa rodar depois dentro de um Cloudflare Worker,
 * quando o painel administrativo salvar uma alteração — sem reescrever nada.
 *
 * Sintaxe suportada no template:
 *   {{caminho.do.valor}}     valor com escape de HTML
 *   {{{caminho.do.valor}}}   valor cru (para textos que contêm <br>)
 *   {{#each lista}} ... {{/each}}
 *        dentro do laço: {{this}} para itens simples,
 *                        {{this.campo}} para objetos,
 *                        {{@index}} para a posição (começando em 0)
 *   {{#if caminho}} ... {{/if}}
 *
 * Imagens e vídeos são referenciados no content.json por caminho relativo
 * (ex.: "hero/tulips.webp"). O parâmetro `resolveAsset` decide como esse
 * caminho vira um endereço final — arquivo separado no modo web, data URI
 * no modo embutido (usado pelo preview em artifact).
 */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Lê "a.b.c" dentro de um objeto, aceitando `this` como o escopo atual. */
function lookup(path, scope, root) {
  const trimmed = path.trim();
  if (trimmed === "this") return scope;
  if (trimmed === "@index") return scope && scope.__index__;

  const fromScope = trimmed.startsWith("this.");
  const parts = (fromScope ? trimmed.slice(5) : trimmed).split(".");
  let current = fromScope ? scope : root;

  for (const part of parts) {
    if (current === null || current === undefined) return "";
    current = current[part];
  }
  return current === null || current === undefined ? "" : current;
}

/**
 * Resolve os blocos {{#each}} e {{#if}} de dentro para fora. Vai atrás do
 * bloco mais interno primeiro (regex sem aninhamento do mesmo tipo), o que
 * mantém o motor simples e previsível para a estrutura deste site.
 */
function renderBlocks(template, scope, root, resolveAsset) {
  let output = template;
  let guard = 0;

  const eachPattern = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/;
  const ifPattern = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/;

  /* Os laços vêm PRIMEIRO, todos eles, e só depois os condicionais.
     Sem isso, um {{#if}} escrito dentro de um {{#each}} seria avaliado no
     escopo de fora (onde `this` e `@index` não existem) antes de o laço
     rodar — e o bloco sumiria silenciosamente. Cada iteração do laço já
     resolve os condicionais internos na chamada recursiva abaixo. */
  while (eachPattern.test(output) && guard < 200) {
    guard += 1;

    output = output.replace(eachPattern, (_, path, body) => {
      const list = lookup(path, scope, root);
      if (!Array.isArray(list)) return "";
      return list
        .map((item, index) => {
          const itemScope =
            item !== null && typeof item === "object"
              ? Object.assign({}, item, { __index__: index })
              : item;
          // itens simples (strings) precisam do índice acessível de outra forma
          const body2 = body.replace(/\{\{@index\}\}/g, String(index));
          return renderInline(
            renderBlocks(body2, itemScope, root, resolveAsset),
            itemScope,
            root,
            resolveAsset
          );
        })
        .join("");
    });
  }

  while (ifPattern.test(output) && guard < 400) {
    guard += 1;
    output = output.replace(ifPattern, (_, path, body) => {
      const value = lookup(path, scope, root);
      const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
      return truthy ? body : "";
    });
  }

  return output;
}

/** Resolve os {{valores}} simples, já fora dos blocos. */
function renderInline(template, scope, root, resolveAsset) {
  return template
    // {{{cru}}} antes de {{escapado}}, senão as chaves se confundem
    .replace(/\{\{\{([^}]+)\}\}\}/g, (_, path) => String(lookup(path, scope, root)))
    .replace(/\{\{asset\s+([^}]+)\}\}/g, (_, path) =>
      escapeHtml(resolveAsset(String(lookup(path, scope, root))))
    )
    .replace(/\{\{([^}#/][^}]*)\}\}/g, (_, path) => escapeHtml(lookup(path, scope, root)));
}

/**
 * @param {string} template  HTML com os marcadores
 * @param {object} content   conteúdo (content.json já parseado)
 * @param {(caminho: string) => string} resolveAsset
 * @returns {string} HTML final
 */
function render(template, content, resolveAsset) {
  const resolver = resolveAsset || ((p) => "assets/" + p);
  const withBlocks = renderBlocks(template, content, content, resolver);
  const html = renderInline(withBlocks, content, content, resolver);

  const leftovers = html.match(/\{\{[^}]*\}\}/g);
  if (leftovers) {
    throw new Error(
      "Marcadores não resolvidos no template: " +
        Array.from(new Set(leftovers)).join(", ")
    );
  }
  return html;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { render, escapeHtml };
}
