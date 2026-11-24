"use strict";
/**
 * Regras puras do Radexa Desktop (sem Electron), para testar com node --test.
 */

const DEFAULT_URL = "https://radexa.com.br";

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
    return new URL(target).origin === origin;
  } catch {
    return false;
  }
}

/** Caminho interno seguro para abrir na janela principal ("/app/laudos/123"). */
function safeAppPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return "/app";
  return path.replace(/[\r\n]/g, "");
}

/** Comando que aperta "colar" no programa em foco. */
function pasteCommand(platform) {
  if (platform === "win32") {
    return {
      cmd: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "(New-Object -ComObject WScript.Shell).SendKeys('^v')",
      ],
    };
  }
  if (platform === "darwin") {
    return {
      cmd: "osascript",
      args: ["-e", 'tell application "System Events" to keystroke "v" using command down'],
    };
  }
  return { cmd: "xdotool", args: ["key", "--clearmodifiers", "ctrl+v"] };
}

const COLLAPSED = { width: 440, height: 84 };
const EXPANDED = { width: 440, height: 560 };
const MIN_HEIGHT = 56;
const MAX_HEIGHT = 720;

/**
 * Barra no canto inferior direito da área útil, crescendo para cima. `height` pode ser
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
    x: workArea.x + workArea.width - size.width - margin,
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
  };
}

module.exports = {
  DEFAULT_URL,
  DEFAULT_SHORTCUTS,
  resolveBaseUrl,
  isAllowedUrl,
  safeAppPath,
  pasteCommand,
  barBounds,
  pickCaptureSource,
  matchKeyFor,
  mergeConfig,
  COLLAPSED,
  EXPANDED,
  MIN_HEIGHT,
  MAX_HEIGHT,
};
