'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fiscobotApp', {
  isElectron:  true,
  version:     () => ipcRenderer.invoke('app:version'),
  quit:        () => ipcRenderer.invoke('app:quit'),
  minimize:    () => ipcRenderer.invoke('app:minimize'),
  maximize:    () => ipcRenderer.invoke('app:maximize'),
  hide:        () => ipcRenderer.invoke('app:hide'),
  openDataDir: (dir) => ipcRenderer.invoke('app:openDataDir', dir),
});
