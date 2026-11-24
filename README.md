# Radexa Desktop

Uma barra pequena do Radexa que fica **por cima do sistema em que o médico lauda** (Clinux,
RIS, aparelho de ultrassom) — sem trocar de programa:

1. **Ditar** — o Radexa escreve o laudo na máscara do médico (escolhe a máscara pelo exame
   falado ou pela que ele marcar).
2. **Capturar a tela** — lê as **medidas e o texto** que estão na tela e preenche o laudo.
   A IA **não interpreta a imagem do exame** (isso seria dispositivo médico, RDC 657/2022).
3. **Colar no sistema** — o laudo entra no campo do programa que está em foco, com a
   formatação (título centralizado, listas…).
4. **Corrigir pela voz** — dite a correção e o laudo é refeito.

Tudo também fica salvo como rascunho no Radexa (o médico assina pelo Radexa, como sempre).

## Atalhos (em qualquer programa)

| Ação | Windows | macOS |
| --- | --- | --- |
| Ditar / parar | `Ctrl+Shift+Espaço` | `⌘⇧Espaço` |
| Colar o laudo | `Ctrl+Shift+L` | `⌘⇧L` |
| Capturar a tela | `Ctrl+Shift+K` | `⌘⇧K` |

Para mudar: ícone do Radexa na bandeja/barra de menus › **Mudar atalhos…** (edita o
`config.json`; vale na hora).

## Como funciona por dentro

- **Duas janelas, uma sessão:** a principal é o Radexa completo (`/app`); a barra é a página
  `/desktop` do mesmo site. O médico entra uma vez.
- **A barra não pega o foco** (`focusable: false`; painel não ativador no macOS): o Clinux
  continua ativo, então o “colar” cai nele. A barra fica fora de capturas e de
  compartilhamento de tela (`setContentProtection`).
- **Colar:** o laudo vai para a área de transferência (texto + HTML) e o app aperta
  Ctrl+V (Windows: `WScript.Shell.SendKeys`) / ⌘V (macOS: System Events). Sem permissão,
  ele só copia e avisa.
- **Captura:** só quando o médico clica ou usa o atalho. Captura a janela escolhida
  (bandeja › *Escolher janela para capturar…*) ou a tela onde está o mouse. Não grava nada
  em disco.
- **Segurança:** o conteúdo não tem acesso a Node; a ponte `window.radexaDesktop` só existe
  nas páginas do Radexa (conferido no preload e no processo principal); links para fora
  abrem no navegador; microfone e área de transferência só para o Radexa.

## Rodar em desenvolvimento

```bash
npm install
npm start                      # usa https://radexa.com.br
npm run start:local            # usa http://localhost:8080 (app e API locais)
npm test                       # regras (URLs, colar, captura, posição da barra)
```

## Gerar os instaladores

**No GitHub (recomendado):** suba esta pasta como repositório e rode
*Actions › Instaladores do Radexa Desktop › Run workflow*. Saem:

- Windows: `Radexa-Setup.exe`
- macOS: `Radexa-arm64.dmg` (Apple Silicon) e `Radexa-x64.dmg` (Intel)

**Na sua máquina:** `npm run dist:mac` (num Mac) ou `npm run dist:win` (num Windows).

### Assinatura (para não aparecer aviso de segurança)

Sem assinatura o instalador funciona, mas:

- **Windows:** aparece “O Windows protegeu o computador” → *Mais informações* › *Executar assim mesmo*.
  Para tirar: certificado de assinatura de código (OV/EV) → secrets `WIN_CSC_LINK` e
  `WIN_CSC_KEY_PASSWORD`.
- **macOS:** “não pode ser aberto porque é de um desenvolvedor não identificado” → clique
  com o botão direito no app › *Abrir*. Para tirar: Apple Developer (US$ 99/ano), certificado
  *Developer ID Application* e notarização → secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

## Permissões no macOS (uma vez)

Ajustes do Sistema › Privacidade e Segurança:

- **Microfone** → Radexa (para ditar);
- **Gravação de Tela** → Radexa (para capturar; feche e abra o Radexa depois);
- **Acessibilidade** → Radexa (para colar sozinho; sem isso o laudo é copiado e você cola com ⌘V).

## Privacidade (LGPD)

- A captura só acontece com clique/atalho; nunca de forma contínua; não fica guardada.
- A imagem da tela vai para a IA só para ler medidas e texto; a IA é instruída a não copiar
  nome, CPF ou outro dado do paciente e a não interpretar a imagem diagnóstica.
- Informe isso no termo de uso do Radexa.

## Página de download no Radexa

O menu **Laudos › Radexa Desktop** (`/app/desktop`) detecta o computador e baixa direto de
`https://github.com/pablomagalhaes/radexa-desktop/releases/latest/download/<arquivo>`.
Por isso os nomes não levam versão (`Radexa-Setup.exe`, `Radexa-arm64.dmg`, `Radexa-x64.dmg`)
e **o repositório precisa ser público** (ou hospede os 3 arquivos noutro lugar e defina
`VITE_DESKTOP_DOWNLOAD_URL` no app). Para publicar uma versão: `git tag v1.0.1 && git push --tags`
— o GitHub Actions gera os instaladores e anexa na Release.
