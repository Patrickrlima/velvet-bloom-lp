# Velvet Bloom — site

Landing page da Velvet Bloom Flores & Presentes (Imbé, Litoral Norte do RS).

## Como funciona

O site é gerado a partir de duas peças:

- **`content.json`** — todo o conteúdo: textos, fotos, número de WhatsApp, depoimentos, SEO. É aqui que se altera o site no dia a dia.
- **`template.html`** — a estrutura e o design. Só se mexe aqui para mudar layout, não conteúdo.
- **`template-privacidade.html`** — a página de política de privacidade, gerada em `dist/privacidade.html`.

O `build.js` junta os dois e escreve o site pronto na pasta `dist/`.

```
node build.js
```

## Publicação automática (Cloudflare Pages)

O Cloudflare Pages está conectado a este repositório e roda o build sozinho a cada alteração:

| Configuração        | Valor          |
| ------------------- | -------------- |
| Comando de build    | `node build.js` |
| Pasta de saída      | `dist`         |

Ou seja: alterou o `content.json` e salvou → o site no ar se atualiza em cerca de 1 minuto. Não existe upload manual.

## Estrutura

```
content.json     conteúdo do site (é o que se edita)
template.html    estrutura + CSS + JS da página
template-privacidade.html   página da política de privacidade
render.js        motor que junta conteúdo e template
build.js         gera a pasta dist/
assets/          fotos e vídeos
  hero/          fotos que giram na tela inicial
  cat/           fotos das categorias
  card/          fotos da galeria
  essencia/      fotos da seção "A essência"
  testi/         prints de depoimentos
  vid/           vídeos
dist/            site gerado (não versionado — o Cloudflare cria)
```

## Alterando o conteúdo à mão

Abrir o `content.json`, mudar o texto entre aspas, salvar. Alguns cuidados:

- Manter as aspas e as vírgulas exatamente onde estão — é um arquivo JSON, um caractere fora do lugar quebra o build.
- Para trocar uma foto: suba o arquivo novo em `assets/` e ajuste o caminho no `content.json`.
- Fotos da tela inicial funcionam melhor em formato paisagem (2000×1333). As da galeria e da "essência" são quadradas (900×900).

## Motor de template

O `render.js` entende uma sintaxe mínima dentro do `template.html`:

| Sintaxe | O que faz |
| --- | --- |
| `{{caminho.do.valor}}` | insere o valor, com escape de HTML |
| `{{{caminho}}}` | insere sem escape (para textos com `<br>`) |
| `{{asset caminho}}` | resolve o endereço de uma foto/vídeo |
| `{{#each lista}}…{{/each}}` | repete um bloco (`{{this}}`, `{{this.campo}}`, `{{@index}}`) |
| `{{#if valor}}…{{/if}}` | mostra o bloco só se o valor existir |

Se sobrar algum marcador não resolvido, o build falha de propósito — melhor quebrar na hora do que publicar `{{titulo}}` no ar.

O `render.js` não usa nenhuma API do Node, para poder rodar também dentro de um Cloudflare Worker (é o que permite o painel administrativo gerar a prévia).
