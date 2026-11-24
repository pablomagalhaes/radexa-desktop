"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("picker", {
  sources: () => ipcRenderer.invoke("picker:sources"),
  choose: (choice) => ipcRenderer.send("picker:choose", choice),
});
