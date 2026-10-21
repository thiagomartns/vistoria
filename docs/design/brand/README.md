# Avis — guia de marca (v0.1)

"Avis" é o nome exibido; "vistoria" continua o nome técnico (repo, pacotes, rotas) e o substantivo na UI ([ADR 0029](../../decisions/0029-marca-avis-nome-exibido-e-simbolo-d1.md)). Os componentes do Figma estão na Section "Marca Avis (#61)" da página Componentes novos.

Marca do app de vistoria de imóveis. Símbolo escolhido: **D1 · Anunciação**, uma janela em arco atravessada por um feixe de luz. A referência é a Anunciação do Retábulo de Gante (Van Eyck). A luz que entra pela janela e revela o cômodo é a metáfora da vistoria.

Construído sobre o Sanjou UI: Geist, escalas `gray` e `indigo`, tokens semânticos. Nenhuma cor nova foi criada.

## Arquivos

| Arquivo | Uso |
| --- | --- |
| `svg/avis-mark.svg` | Símbolo padrão, tema claro. Use a partir de 32 px. |
| `svg/avis-mark-dark.svg` | Símbolo padrão, tema escuro. |
| `svg/avis-mark-small.svg` | Versão reduzida (traço mais grosso, vão menor), abaixo de 32 px e até 16 px, tema claro. |
| `svg/avis-mark-small-dark.svg` | Versão reduzida, tema escuro. |
| `svg/avis-mark-mono.svg` | Monocromático `gray-12`, para impressão em uma cor. |
| `svg/avis-mark-white.svg` | Branco sobre cor ou foto. |
| `svg/favicon.svg` | Versão reduzida que troca de cor com `prefers-color-scheme`. É o `apps/web/src/app/icon.svg`. |
| `svg/app-icon.svg` | Ícone de app: fundo `gray-12`, raio de 14/64. Entra no manifest do PWA (M2). |

O feixe de luz já vem recortado como caminho fechado. Não há `clipPath`, `mask` nem `id` nos SVGs, então eles importam limpos no Figma e não colidem quando há várias instâncias numa mesma página React.

## Construção

- Grade de 64 unidades (u).
- Arco: 36u de largura, raio de 18u, traço de 4u, fechado embaixo por um peitoril.
- Feixe de luz: entra pelo alto à esquerda e se abre de 14u para 24u, recortado pelo vão interno (32u, raio de 16u).
- Versão reduzida: traço de 6u e feixe mais largo, para não sumir em 16 px.

## Cores (tokens Sanjou)

| Parte | Token | Claro | Escuro |
| --- | --- | --- | --- |
| Arco | `foreground` | `gray-12` #1E232D | `gray-12` dark #EBEDEF |
| Luz | `brand` no claro, `brand-text` no escuro | `indigo-9` #385DCA | `indigo-11` dark #9BB9FE |

Nenhum token novo: o Sanjou 0.2.0 não tem `logo-accent`, então a luz usa `brand` e troca para `brand-text` no escuro. No código, a marca lê os tokens por classe (`fill-brand dark:fill-brand-text`, `stroke-foreground`) e nunca hexadecimais, para acompanhar o tema sozinha. Os hexadecimais acima só aparecem nos SVGs estáticos (favicon, ícone), que não leem variáveis CSS do app. No Figma, `brand` vale o mesmo índigo nos dois modos; a troca para `brand-text` está na descrição do `Avis/Mark`.

Regras de cor:
- O índigo é só a luz. Nunca pinte o arco de índigo nem use o índigo como fundo da marca nas telas do produto. Isso segue o princípio do Sanjou de reservar o `brand` para momentos raros.
- Sobre fundo colorido ou foto, use `avis-mark-white.svg`.

## Nome e assinaturas

- **Nome:** `AVIS`, em caixa-alta, Geist 400, tracking de 0,14em. Em texto corrido, escreva "Avis".
- **Legenda:** "Vistoria de imóveis", em Geist 500, `text-xs` ou `text-sm`, na cor `muted-foreground`.
- **Lockup horizontal:** altura do símbolo = 1,4 × o corpo do nome; espaço entre eles = 0,4 × o corpo. Exemplo: nome em 20 px, símbolo de 28 px e espaço de 8 px (o da sidebar).
- **Lockup vertical:** símbolo = 2,1 × o corpo, centralizado, com 0,44 × o corpo de espaço. Com nome em 20 px: símbolo de 42 px e espaço de 9 px (o do login e do signup, com legenda).
- **Área de proteção:** metade da largura do símbolo, em volta do conjunto.
- **Tamanho mínimo:** símbolo padrão a partir de 32 px. Abaixo disso, inclusive nos 28 px do lockup horizontal, use a versão reduzida, que vai até 16 px.

## Não fazer

- Girar ou espelhar o feixe. A luz vem sempre do alto à esquerda.
- Aplicar sombra, gradiente ou contorno extra.
- Usar o feixe sozinho como ícone. Ele só funciona dentro do arco.
- Trocar a Geist do nome por outra fonte.

## No código

- `AvisMark` em [`apps/web/src/shared/components/avis-mark.tsx`](../../../apps/web/src/shared/components/avis-mark.tsx): SVG inline, versão reduzida abaixo de 32 px, `role="img"` com `aria-label` ou `decorative` ao lado do nome.
- `AvisLockup` em [`apps/web/src/shared/components/avis-lockup.tsx`](../../../apps/web/src/shared/components/avis-lockup.tsx): `layout` horizontal ou vertical e `caption` para a legenda. O nome é texto ("Avis" em caixa-alta pelo CSS) e o símbolo é decorativo.
- Ícone da aba: `apps/web/src/app/icon.svg`, cópia do `svg/favicon.svg`.
