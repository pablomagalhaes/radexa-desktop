"use strict";
/**
 * Ponte window.radexaDesktop — só nas páginas do Radexa (a origem é conferida aqui e de novo
 * no processo principal). Nada de Node exposto para a página.
 */
const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("desktop:origin");
if (info && location.origin === info.origin) {
  const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
  contextBridge.exposeInMainWorld("radexaDesktop", {
    version: info.version,
    platform: info.platform,
    paste: call("desktop:paste"),
    copy: call("desktop:copy"),
    capture: call("desktop:capture"),
    chooseCaptureSource: call("desktop:choose-capture"),
    captureSourceName: call("desktop:capture-name"),
    openInMain: (path) => void ipcRenderer.invoke("desktop:open-main", path),
    setExpanded: (v) => void ipcRenderer.invoke("desktop:set-expanded", Boolean(v)),
    setHeight: (h) => void ipcRenderer.invoke("desktop:set-height", Number(h)),
    shortcuts: call("desktop:shortcuts"),
    onCommand: (cb) => {
      const listener = (_e, cmd) => cb(cmd);
      ipcRenderer.on("desktop:command", listener);
      return () => ipcRenderer.removeListener("desktop:command", listener);
    },
  });
}
