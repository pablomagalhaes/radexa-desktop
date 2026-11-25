"use strict";
/**
 * Radexa Desktop — processo principal.
 *
 * Duas janelas da sua conta do Radexa (mesma sessão):
 *  - principal: o Radexa completo (laudos, máscaras, configurações);
 *  - barra: pequena, sempre por cima, que NÃO rouba o foco do sistema em que o médico lauda
 *    (Clinux, RIS…). Dita, escreve na máscara e cola o laudo no programa em foco.
 */
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
} = require("electron");
const rules = require("./lib/rules");

const ORIGIN = rules.resolveBaseUrl();
const IS_MAC = process.platform === "darwin";
const ASSETS = path.join(__dirname, "..", "assets");
const ALLOWED_PERMISSIONS = new Set(["media", "clipboard-sanitized-write", "clipboard-read", "notifications", "fullscreen"]);

let mainWindow = null;
let barWindow = null;
let pickerWindow = null;
let tray = null;
let quitting = false;
let barExpanded = false; // aberta/recolhida (a altura vem do conteúdo)

// ------------------------------------------------------------------ config

const configFile = () => path.join(app.getPath("userData"), "config.json");
let config = rules.mergeConfig(null);

function loadConfig() {
  try {
    config = rules.mergeConfig(JSON.parse(fs.readFileSync(configFile(), "utf8")));
  } catch {
    config = rules.mergeConfig(null);
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("config_save_failed", err);
  }
}

// --------------------------------------------------------------- segurança

/** Todas as janelas: sem Node no conteúdo, isolamento de contexto e sandbox. */
function webPrefs(preload) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: true,
    webSecurity: true,
    backgroundThrottling: false, // o ditado continua com a barra atrás de outras janelas
  };
}

function guardNavigation(win) {
  // link para fora do Radexa abre no navegador; nada externo carrega dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (rules.isAllowedUrl(url, ORIGIN)) {
      showMain(new URL(url).pathname + new URL(url).search);
    } else if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!rules.isAllowedUrl(url, ORIGIN)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
}

function setupSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details.requestingUrl || wc.getURL();
    callback(rules.isAllowedUrl(origin, ORIGIN) && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return rules.isAllowedUrl(requestingOrigin, ORIGIN) && ALLOWED_PERMISSIONS.has(permission);
  });
  const ua = `${ses.getUserAgent()} RadexaDesktop/${app.getVersion()}`;
  ses.setUserAgent(ua);
}

// ----------------------------------------------------------------- janelas

function showMain(appPath = "/app") {
  const target = `${ORIGIN}${rules.safeAppPath(appPath)}`;
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      title: "Radexa",
      icon: path.join(ASSETS, "icon.png"),
      show: false,
      webPreferences: webPrefs(path.join(__dirname, "preload.js")),
    });
    guardNavigation(mainWindow);
    mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
    // fechar a janela só esconde: a barra e os atalhos continuam
    mainWindow.on("close", (e) => {
      if (!quitting) {
        e.preventDefault();
        mainWindow.hide();
      }
    });
    // entrou ou saiu da conta na janela principal: a barra recarrega com a sessão nova
    const onNav = (_e, url) => syncBarWithSession(url);
    mainWindow.webContents.on("did-navigate", onNav);
    mainWindow.webContents.on("did-navigate-in-page", onNav);
    void mainWindow.loadURL(target);
    return;
  }
  if (mainWindow.webContents.getURL() !== target) void mainWindow.loadURL(target);
  mainWindow.show();
  mainWindow.focus();
}

let lastMainArea = null;
/** "app" (logado) ou "fora" (login, cadastro, site). Mudou → recarrega a barra. */
function syncBarWithSession(url) {
  let area = "fora";
  try {
    area = new URL(url).pathname.startsWith("/app") ? "app" : "fora";
  } catch {
    return;
  }
  if (lastMainArea && lastMainArea !== area && barWindow && !barWindow.isDestroyed()) barWindow.reload();
  lastMainArea = area;
}

function createBar() {
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = rules.barBounds(area, false, config.barBounds || undefined);
  barWindow = new BrowserWindow({
    ...bounds,
    title: "Radexa — barra",
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    // não rouba o foco: o Clinux continua ativo e o "colar" cai nele
    focusable: false,
    ...(IS_MAC ? { type: "panel" } : {}),
    show: false,
    webPreferences: webPrefs(path.join(__dirname, "preload.js")),
  });
  barWindow.setAlwaysOnTop(true, "floating");
  if (IS_MAC) barWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // "modo discreto" (opcional, no menu do R): a barra some de capturas e de compartilhamento de tela
  barWindow.setContentProtection(Boolean(config.discreet));
  guardNavigation(barWindow);
  barWindow.once("ready-to-show", () => {
    if (config.showBarOnStart) barWindow.showInactive();
  });
  barWindow.on("moved", () => {
    config.barBounds = barWindow.getBounds();
    saveConfig();
  });
  // o título da página não substitui o da barra (é assim que ela se exclui das capturas)
  barWindow.on("page-title-updated", (e) => e.preventDefault());
  void barWindow.loadURL(`${ORIGIN}/desktop`);
}

function toggleBar(show) {
  if (!barWindow || barWindow.isDestroyed()) return createBar();
  const visible = barWindow.isVisible();
  if (show === true || (show === undefined && !visible)) barWindow.showInactive();
  else barWindow.hide();
  config.showBarOnStart = barWindow.isVisible();
  saveConfig();
  buildTrayMenu();
}

function setBarExpanded(expanded) {
  barExpanded = Boolean(expanded);
  return barExpanded;
}

/** A barra mede o próprio conteúdo e a janela acompanha (base fixa). */
function setBarHeight(height) {
  if (!barWindow || barWindow.isDestroyed() || !Number.isFinite(height)) return;
  const current = barWindow.getBounds();
  if (Math.abs(current.height - height) < 2) return;
  const area = screen.getDisplayMatching(current).workArea;
  barWindow.setBounds(rules.barBounds(area, height, current), false);
}

// ------------------------------------------------------------------- colar

function runPaste() {
  const { cmd, args } = rules.pasteCommand(process.platform);
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err) => resolve(!err));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pasteIntoFocusedApp(payload) {
  const text = String(payload?.text ?? "");
  const html = typeof payload?.html === "string" ? payload.html : undefined;
  if (!text.trim()) return { ok: false, reason: "empty" };
  clipboard.write(html ? { text, html } : { text });
  if (IS_MAC && !systemPreferences.isTrustedAccessibilityClient(false)) {
    // pede a permissão (abre o aviso do macOS); enquanto isso o laudo já está copiado
    systemPreferences.isTrustedAccessibilityClient(true);
    return { ok: false, reason: "accessibility" };
  }
  // se o médico estava numa janela do Radexa, devolve o foco ao programa anterior
  const ours = BrowserWindow.getFocusedWindow();
  if (ours) {
    if (IS_MAC) app.hide();
    else ours.blur();
    await wait(250);
  } else {
    await wait(60);
  }
  const ok = await runPaste();
  if (IS_MAC && ours && barWindow && !barWindow.isDestroyed()) barWindow.showInactive();
  return ok ? { ok: true } : { ok: false, reason: "paste-failed" };
}

// ---------------------------------------------------------------- captura

function screenPermission() {
  if (!IS_MAC) return "granted";
  return systemPreferences.getMediaAccessStatus("screen");
}

async function captureScreen() {
  if (screenPermission() === "denied") return { ok: false, reason: "permission" };
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const saved = config.captureSource;
  const size = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  try {
    const sources = await desktopCapturer.getSources({
      types: saved ? ["window", "screen"] : ["screen"],
      thumbnailSize: size,
      fetchWindowIcons: false,
    });
    const source = rules.pickCaptureSource(sources, saved, display.id);
    if (!source || source.thumbnail.isEmpty()) {
      return screenPermission() === "granted"
        ? { ok: false, reason: "no-source", message: "A janela escolhida não está aberta." }
        : { ok: false, reason: "permission" };
    }
    let img = source.thumbnail;
    const { width } = img.getSize();
    if (width > 1800) img = img.resize({ width: 1800, quality: "best" });
    const dataUrl = `data:image/jpeg;base64,${img.toJPEG(85).toString("base64")}`;
    return { ok: true, dataUrl, source: source.id.startsWith("screen:") ? "Tela" : source.name };
  } catch (err) {
    console.error("capture_failed", err);
    return { ok: false, reason: screenPermission() === "granted" ? "failed" : "permission" };
  }
}

/** Janela para escolher o que capturar (a do Clinux, por exemplo). */
function chooseCaptureSource() {
  return new Promise((resolve) => {
    if (pickerWindow && !pickerWindow.isDestroyed()) {
      pickerWindow.focus();
      return resolve(null);
    }
    pickerWindow = new BrowserWindow({
      width: 760,
      height: 560,
      title: "Radexa — escolher janela para capturar",
      icon: path.join(ASSETS, "icon.png"),
      alwaysOnTop: true,
      minimizable: false,
      maximizable: false,
      webPreferences: { ...webPrefs(path.join(__dirname, "picker-preload.js")) },
    });
    pickerWindow.setMenu(null);
    let chosen = null;
    const onChoose = (_e, choice) => {
      if (choice === "screen") {
        config.captureSource = null;
        chosen = { name: "Tela onde está o mouse" };
      } else if (choice && typeof choice.id === "string") {
        config.captureSource = { id: choice.id, name: String(choice.name || ""), match: rules.matchKeyFor(choice.name) };
        chosen = { name: config.captureSource.name };
      }
      saveConfig();
      buildTrayMenu();
      if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
    };
    ipcMain.once("picker:choose", onChoose);
    pickerWindow.on("closed", () => {
      ipcMain.removeListener("picker:choose", onChoose);
      pickerWindow = null;
      resolve(chosen);
    });
    void pickerWindow.loadFile(path.join(__dirname, "picker.html"));
  });
}

ipcMain.handle("picker:sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 320, height: 200 },
  });
  return {
    permission: screenPermission(),
    sources: sources
      .filter((s) => !/^Radexa( —|$)/.test(s.name))
      .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL(), screen: s.id.startsWith("screen:") })),
  };
});

// ------------------------------------------------------------- ponte (IPC)

/** Só aceita pedidos das páginas do Radexa. */
function fromRadexa(event) {
  const url = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
  return rules.isAllowedUrl(url, ORIGIN);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!fromRadexa(event)) throw new Error("origem não permitida");
    return fn(...args);
  });
}

ipcMain.on("desktop:origin", (event, href) => {
  event.returnValue = {
    allowed: rules.isAllowedUrl(String(href || ""), ORIGIN),
    version: app.getVersion(),
    platform: process.platform,
  };
});
handle("desktop:paste", (payload) => pasteIntoFocusedApp(payload));
handle("desktop:copy", (payload) => {
  const text = String(payload?.text ?? "");
  clipboard.write(typeof payload?.html === "string" ? { text, html: payload.html } : { text });
});
handle("desktop:capture", () => captureScreen());
handle("desktop:choose-capture", () => chooseCaptureSource());
handle("desktop:capture-name", () => (config.captureSource ? config.captureSource.name : null));
handle("desktop:open-main", (p) => showMain(p));
handle("desktop:set-expanded", (v) => setBarExpanded(v));
handle("desktop:set-height", (h) => setBarHeight(Number(h)));
handle("desktop:shortcuts", () => ({ ...config.shortcuts }));

// ---------------------------------------------------------------- atalhos

function sendToBar(cmd) {
  if (!barWindow || barWindow.isDestroyed()) return;
  if (!barWindow.isVisible()) barWindow.showInactive();
  barWindow.webContents.send("desktop:command", cmd);
}

const failedShortcuts = [];
function registerShortcuts() {
  globalShortcut.unregisterAll();
  failedShortcuts.length = 0;
  const map = { dictate: "toggle-dictation", paste: "paste", capture: "capture" };
  for (const [key, cmd] of Object.entries(map)) {
    const acc = config.shortcuts[key];
    try {
      if (!globalShortcut.register(acc, () => sendToBar(cmd))) failedShortcuts.push(acc);
    } catch {
      failedShortcuts.push(acc);
    }
  }
}

// ---------------------------------------------------------------- bandeja

function buildTrayMenu() {
  if (!tray) return;
  const pretty = (acc) => acc.replace("CommandOrControl", IS_MAC ? "Cmd" : "Ctrl");
  const items = [
    { label: "Abrir o Radexa", click: () => showMain("/app") },
    {
      label: barWindow && barWindow.isVisible() ? "Esconder a barra" : "Mostrar a barra",
      click: () => toggleBar(),
    },
    { type: "separator" },
    {
      label: config.captureSource ? `Capturar: ${config.captureSource.name.slice(0, 40)}` : "Capturar: tela do mouse",
      enabled: false,
    },
    { label: "Escolher janela para capturar…", click: () => void chooseCaptureSource() },
    { type: "separator" },
    { label: `Ditar: ${pretty(config.shortcuts.dictate)}`, enabled: false },
    { label: `Colar laudo: ${pretty(config.shortcuts.paste)}`, enabled: false },
    { label: `Capturar tela: ${pretty(config.shortcuts.capture)}`, enabled: false },
    ...(failedShortcuts.length
      ? [{ label: `Atalho em uso por outro programa: ${failedShortcuts.map(pretty).join(", ")}`, enabled: false }]
      : []),
    { label: "Mudar atalhos…", click: () => shell.openPath(configFile()) },
    { type: "separator" },
    {
      label: "Modo discreto (barra não aparece em prints)",
      type: "checkbox",
      checked: Boolean(config.discreet),
      click: (item) => {
        config.discreet = item.checked;
        if (barWindow && !barWindow.isDestroyed()) barWindow.setContentProtection(item.checked);
        saveConfig();
      },
    },
    {
      label: "Abrir ao ligar o computador",
      type: "checkbox",
      checked: config.openAtLogin,
      click: (item) => {
        config.openAtLogin = item.checked;
        app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
        saveConfig();
      },
    },
    { type: "separator" },
    {
      label: "Sair do Radexa",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  const icon = IS_MAC
    ? nativeImage.createFromPath(path.join(ASSETS, "trayTemplate.png"))
    : nativeImage.createFromPath(path.join(ASSETS, "tray.png"));
  if (IS_MAC) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Radexa");
  if (!IS_MAC) tray.on("click", () => toggleBar());
  buildTrayMenu();
}

// ----------------------------------------------------------- ciclo de vida

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());
  app.setAppUserModelId("br.com.radexa.desktop");

  app.whenReady().then(async () => {
    loadConfig();
    setupSession();
    if (IS_MAC && systemPreferences.getMediaAccessStatus("microphone") !== "granted") {
      await systemPreferences.askForMediaAccess("microphone").catch(() => false);
    }
    createTray();
    createBar();
    registerShortcuts();
    buildTrayMenu();
    const startedHidden = app.getLoginItemSettings().wasOpenedAsHidden || process.argv.includes("--hidden");
    if (!startedHidden) showMain("/app");
    saveConfig();
    // config.json editado à mão: atalhos novos valem na hora
    try {
      fs.watch(configFile(), { persistent: false }, () => {
        loadConfig();
        registerShortcuts();
        buildTrayMenu();
      });
    } catch {
      /* sem acesso à pasta de configuração */
    }
  });

  app.on("activate", () => showMain());
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  // fica na bandeja mesmo sem janelas
  app.on("window-all-closed", () => undefined);
}
