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

/** Vazio, zero, false, lista sem itens — tudo conta como "não tem". */
function temValor(v) {
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

/**
 * Acha o PRIMEIRO bloco do tipo pedido, casando a abertura com o fechamento
 * correto por contagem de profundidade.
 *
 * Expressão regular não dá conta disso: com `{{#if a}}…{{#if b}}…{{/if}}…{{/if}}`
 * ela casaria a abertura de fora com o fechamento de dentro, embaralhando o
 * documento. Contar profundidade é o jeito certo.
 */
function acharBloco(texto, tipo) {
  const abertura = new RegExp("\\{\\{#" + tipo + "\\s+([^}]+)\\}\\}");
  const achado = abertura.exec(texto);
  if (!achado) return null;

  const marcaAbre = "{{#" + tipo;
  const marcaFecha = "{{/" + tipo + "}}";
  const inicioCorpo = achado.index + achado[0].length;

  let profundidade = 1;
  let i = inicioCorpo;

  while (i < texto.length) {
    const proximaAbre = texto.indexOf(marcaAbre, i);
    const proximaFecha = texto.indexOf(marcaFecha, i);
    if (proximaFecha === -1) return null; // bloco sem fechamento

    if (proximaAbre !== -1 && proximaAbre < proximaFecha) {
      profundidade += 1;
      i = proximaAbre + marcaAbre.length;
    } else {
      profundidade -= 1;
      if (profundidade === 0) {
        return {
          inicio: achado.index,
          fim: proximaFecha + marcaFecha.length,
          caminho: achado[1],
          corpo: texto.slice(inicioCorpo, proximaFecha),
        };
      }
      i = proximaFecha + marcaFecha.length;
    }
  }
  return null;
}

/**
 * Resolve os blocos {{#each}}, {{#if}} e {{#unless}}, sempre do mais externo
 * para o mais interno.
 *
 * Essa ordem é obrigatória por causa do {{#each}}: um laço dentro de outro só
 * consegue ler `this` depois que o laço de fora definiu o escopo. Resolver de
 * dentro para fora faria o interno ser avaliado num escopo onde os dados dele
 * ainda não existem, e ele sumiria silenciosamente. O corpo de cada iteração
 * volta para esta mesma função (recursão), já com o escopo certo.
 */
function renderBlocks(template, scope, root, resolveAsset) {
  let output = template;
  let guard = 0;
  let bloco;

  /* Os laços primeiro: eles definem escopo, e os condicionais escritos dentro
     deles são resolvidos na recursão de cada iteração. */
  while ((bloco = acharBloco(output, "each")) && guard < 300) {
    guard += 1;
    const lista = lookup(bloco.caminho, scope, root);
    let resultado = "";

    if (Array.isArray(lista)) {
      resultado = lista
        .map((item, index) => {
          const itemScope =
            item !== null && typeof item === "object"
              ? Object.assign({}, item, { __index__: index })
              : item;
          // itens simples (textos) precisam do índice de outra forma
          const corpo = bloco.corpo.replace(/\{\{@index\}\}/g, String(index));
          return renderInline(
            renderBlocks(corpo, itemScope, root, resolveAsset),
            itemScope,
            root,
            resolveAsset
          );
        })
        .join("");
    }
    output = output.slice(0, bloco.inicio) + resultado + output.slice(bloco.fim);
  }

  while ((bloco = acharBloco(output, "if")) && guard < 600) {
    guard += 1;
    const manter = temValor(lookup(bloco.caminho, scope, root)) ? bloco.corpo : "";
    output = output.slice(0, bloco.inicio) + manter + output.slice(bloco.fim);
  }

  /* O contrário do #if — permite pares do tipo "mostra o preço, senão mostra
     'sob consulta'" sem precisar de um #else no motor. */
  while ((bloco = acharBloco(output, "unless")) && guard < 900) {
    guard += 1;
    const manter = temValor(lookup(bloco.caminho, scope, root)) ? "" : bloco.corpo;
    output = output.slice(0, bloco.inicio) + manter + output.slice(bloco.fim);
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
