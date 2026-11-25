"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../src/lib/rules");

test("URL do Radexa: produção por padrão, http só em localhost", () => {
  assert.equal(r.resolveBaseUrl({}), "https://www.radexa.com.br");
  assert.equal(r.resolveBaseUrl({ RADEXA_URL: "http://localhost:8080/" }), "http://localhost:8080");
  assert.throws(() => r.resolveBaseUrl({ RADEXA_URL: "http://radexa.evil.com" }));
  assert.throws(() => r.resolveBaseUrl({ RADEXA_URL: "file:///etc/passwd" }));
});

test("só páginas do Radexa ficam dentro do app", () => {
  const o = "https://radexa.com.br";
  assert.equal(r.isAllowedUrl("https://radexa.com.br/app/laudos", o), true);
  assert.equal(r.isAllowedUrl("https://radexa.com.br.evil.com/", o), false);
  assert.equal(r.isAllowedUrl("https://evil.com/?https://radexa.com.br", o), false);
  assert.equal(r.isAllowedUrl("javascript:alert(1)", o), false);
  // com e sem www é o mesmo site; outro subdomínio não
  assert.equal(r.isAllowedUrl("https://www.radexa.com.br/desktop", "https://radexa.com.br"), true);
  assert.equal(r.isAllowedUrl("https://radexa.com.br/desktop", "https://www.radexa.com.br"), true);
  assert.equal(r.isAllowedUrl("https://evil.radexa.com.br/", "https://www.radexa.com.br"), false);
  assert.equal(r.isAllowedUrl("http://www.radexa.com.br/", "https://radexa.com.br"), false);
});

test("caminho interno seguro", () => {
  assert.equal(r.safeAppPath("/app/laudos/1"), "/app/laudos/1");
  assert.equal(r.safeAppPath("//evil.com"), "/app");
  assert.equal(r.safeAppPath("https://evil.com"), "/app");
  assert.equal(r.safeAppPath(undefined), "/app");
});

test("colar: comando por sistema", () => {
  assert.equal(r.pasteCommand("win32").cmd, "powershell.exe");
  assert.match(r.pasteCommand("win32").args.at(-1), /SendKeys\('\^v'\)/);
  assert.equal(r.pasteCommand("darwin").cmd, "osascript");
  assert.match(r.pasteCommand("darwin").args[1], /command down/);
});

test("barra embaixo no centro e cresce para cima", () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const c = r.barBounds(wa, false);
  const W = r.COLLAPSED.width;
  const H = r.COLLAPSED.height;
  assert.deepEqual(c, { x: (1920 - W) / 2, y: 1040 - H - 16, width: W, height: H });
  const e = r.barBounds(wa, true, c);
  assert.equal(e.y + e.height, c.y + c.height, "a base não mexe");
  assert.equal(e.height, 560);
  // não sai da tela
  const exact = r.barBounds(wa, 213.4, c);
  assert.equal(exact.height, 213);
  assert.equal(exact.y + exact.height, c.y + c.height);
  assert.equal(r.barBounds(wa, 5, c).height, r.MIN_HEIGHT);
  assert.equal(r.barBounds(wa, 9999, c).height, r.MAX_HEIGHT);
  const top = r.barBounds(wa, true, { x: 5000, y: -400, width: 440, height: 84 });
  assert.ok(top.y >= 0 && top.x + top.width <= 1920);
});

test("captura: janela escolhida, reaberta pelo nome, ou tela do mouse", () => {
  const sources = [
    { id: "screen:0:0", name: "Tela 1", display_id: "1" },
    { id: "screen:1:0", name: "Tela 2", display_id: "2" },
    { id: "window:111:0", name: "Clinux - Paciente Fulano" },
    { id: "window:222:0", name: "Radexa — barra" },
  ];
  assert.equal(r.pickCaptureSource(sources, null, "2").id, "screen:1:0");
  assert.equal(r.pickCaptureSource(sources, { id: "window:111:0", name: "x" }, "1").id, "window:111:0");
  const reopened = r.pickCaptureSource(sources, { id: "window:999:0", name: "Clinux - Outro", match: "Clinux" }, "1");
  assert.equal(reopened.id, "window:111:0");
  assert.equal(r.pickCaptureSource(sources, { id: "window:999:0", match: "Radexa" }, "1").id, "screen:0:0", "nunca a própria barra");
  assert.equal(r.matchKeyFor("Clinux - Paciente Fulano"), "Clinux");
});

test("configuração: padrões e valores salvos", () => {
  const c = r.mergeConfig({ shortcuts: { paste: "Alt+Shift+V" }, openAtLogin: 1 });
  assert.equal(c.shortcuts.paste, "Alt+Shift+V");
  assert.equal(c.shortcuts.dictate, r.DEFAULT_SHORTCUTS.dictate);
  assert.equal(c.openAtLogin, true);
  assert.equal(c.captureSource, null);
  assert.equal(r.mergeConfig(null).showBarOnStart, true);
  assert.equal(r.mergeConfig(null).discreet, false, "modo discreto desligado por padrão");
  assert.equal(r.mergeConfig({ discreet: true }).discreet, true);
});
