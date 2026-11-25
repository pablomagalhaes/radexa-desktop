"use strict";
/**
 * Regras puras do Radexa Desktop (sem Electron), para testar com node --test.
 */

// radexa.com.br redireciona para www — usar www direto (a ponte confere a origem exata)
const DEFAULT_URL = "https://www.radexa.com.br";

const DEFAULT_SHORTCUTS = Object.freeze({
  dictate: "CommandOrControl+Shift+Space",
  paste: "CommandOrControl+Shift+L",
  capture: "CommandOrControl+Shift+K",
});

/** URL do Radexa: RADEXA_URL (desenvolvimento) ou produção. Só http(s). */
function resolveBaseUrl(env = process.env) {
  const raw = (env.RADEXA_URL || DEFAULT_URL).trim().replace(/\/+$/, "");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("RADEXA_URL precisa ser http(s)");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("RADEXA_URL sem https só é aceito em localhost");
  }
  return url.origin;
}

/** Só as páginas do próprio Radexa abrem dentro do app (e recebem a ponte). */
function isAllowedUrl(target, origin) {
  try {
    const a = new URL(target);
    const b = new URL(origin);
    if (a.origin === b.origin) return true;
    // radexa.com.br ⇄ www.radexa.com.br: mesmo site (o servidor redireciona um para o outro)
    const bare = (h) => h.replace(/^www\./, "");
    return a.protocol === "https:" && b.protocol === "https:" && a.port === b.port && bare(a.hostname) === bare(b.hostname);
  } catch {
    return false;
  }
}

/** Caminho interno seguro para abrir na janela principal ("/app/laudos/123"). */
function safeAppPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return "/app";
  return path.replace(/[\r\n]/g, "");
}

/**
 * Comando que aperta "colar" no programa em foco. Antes, espera o médico soltar as teclas do
 * atalho (Ctrl/Cmd+Shift+L): com o Shift ainda apertado, o Ctrl+V vira Ctrl+Shift+V, que no
 * Word e em vários sistemas é outra coisa ("colar formatação", "colar sem formatação").
 */
const WIN_PASTE = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$t = [Diagnostics.Stopwatch]::StartNew()",
  "while ([System.Windows.Forms.Control]::ModifierKeys -ne [System.Windows.Forms.Keys]::None -and $t.ElapsedMilliseconds -lt 1500) { Start-Sleep -Milliseconds 25 }",
  "[System.Windows.Forms.SendKeys]::SendWait('^v')",
].join("; ");

const MAC_PASTE = [
  "ObjC.import('AppKit');",
  "var n = 0;",
  "while (($.NSEvent.modifierFlags & 0x1E0000) && n < 60) { delay(0.025); n++; }",
  "Application('System Events').keystroke('v', { using: 'command down' });",
].join(" ");

function pasteCommand(platform) {
  if (platform === "win32") {
    return {
      cmd: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", WIN_PASTE],
    };
  }
  if (platform === "darwin") {
    return { cmd: "osascript", args: ["-l", "JavaScript", "-e", MAC_PASTE] };
  }
  return { cmd: "xdotool", args: ["key", "--clearmodifiers", "ctrl+v"] };
}

/** A área de transferência tem mesmo o laudo? (o Windows devolve \r\n; espaços nas pontas não contam) */
function sameClipboardText(expected, actual) {
  const norm = (v) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
  return norm(expected) === norm(actual);
}

const COLLAPSED = { width: 460, height: 64 };
const EXPANDED = { width: 460, height: 560 };
const MIN_HEIGHT = 56;
const MAX_HEIGHT = 720;

/**
 * Barra embaixo, no centro da área útil (acima do Dock/barra de tarefas), crescendo para cima;
 * o médico arrasta para onde quiser e a posição fica salva. `height` pode ser
 * true/false (recolhida/aberta) ou a altura exata do conteúdo — sem sobra transparente
 * bloqueando cliques no programa de baixo.
 */
function barBounds(workArea, height, current) {
  const h =
    typeof height === "number"
      ? Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height, workArea.height)))
      : (height ? EXPANDED : COLLAPSED).height;
  const size = { width: COLLAPSED.width, height: h };
  const margin = 16;
  if (current) {
    // mantém a base onde o médico deixou a barra
    const bottom = current.y + current.height;
    const y = Math.max(workArea.y, Math.min(bottom - size.height, workArea.y + workArea.height - size.height));
    const x = Math.max(workArea.x, Math.min(current.x, workArea.x + workArea.width - size.width));
    return { x, y, ...size };
  }
  return {
    x: workArea.x + Math.round((workArea.width - size.width) / 2),
    y: workArea.y + workArea.height - size.height - margin,
    ...size,
  };
}

/**
 * Qual fonte capturar: a janela escolhida (pelo id; se o programa reabriu, pelo nome) ou,
 * sem escolha, a tela onde está o mouse.
 */
function pickCaptureSource(sources, saved, displayId) {
  const own = (s) => /^Radexa( —|$)/.test(s.name || "");
  if (saved) {
    const byId = sources.find((s) => s.id === saved.id);
    if (byId) return byId;
    const key = (saved.match || saved.name || "").toLowerCase();
    if (key) {
      const byName = sources.find((s) => !own(s) && s.id.startsWith("window:") && (s.name || "").toLowerCase().includes(key));
      if (byName) return byName;
    }
  }
  const screens = sources.filter((s) => s.id.startsWith("screen:"));
  return screens.find((s) => String(s.display_id) === String(displayId)) || screens[0] || null;
}

/** Palavra para reencontrar a janela quando o título muda ("Clinux - Paciente X" → "clinux"). */
function matchKeyFor(name) {
  const first = String(name || "")
    .split(/\s[-–—|:]\s/)[0]
    .trim();
  return first.slice(0, 40);
}

function mergeConfig(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  return {
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(s.shortcuts || {}) },
    captureSource: s.captureSource && s.captureSource.id ? s.captureSource : null,
    barBounds: s.barBounds && Number.isFinite(s.barBounds.x) ? s.barBounds : null,
    openAtLogin: Boolean(s.openAtLogin),
    showBarOnStart: s.showBarOnStart !== false,
    // modo discreto (barra fora de prints/compartilhamento de tela): desligado por padrão
    discreet: s.discreet === true,
    hideHintShown: s.hideHintShown === true,
  };
}

module.exports = {
  DEFAULT_URL,
  DEFAULT_SHORTCUTS,
  resolveBaseUrl,
  isAllowedUrl,
  safeAppPath,
  pasteCommand,
  sameClipboardText,
  barBounds,
  pickCaptureSource,
  matchKeyFor,
  mergeConfig,
  COLLAPSED,
  EXPANDED,
  MIN_HEIGHT,
  MAX_HEIGHT,
};
