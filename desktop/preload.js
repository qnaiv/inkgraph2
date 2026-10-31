// レンダラー（Web 版のコード）に渡す口。window.inkgraphDesktop があれば「デスクトップ版」として動く。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inkgraphDesktop', {
  isDesktop: true, platform: process.platform,
  getVideoDir: () => ipcRenderer.invoke('desktop:get-dir'),
  pickVideoDir: () => ipcRenderer.invoke('desktop:pick-dir'),
  openVideoDir: () => ipcRenderer.invoke('desktop:open-dir'),
  recOpen: () => ipcRenderer.invoke('rec:open'),
  recWrite: (id, buf) => ipcRenderer.invoke('rec:write', id, buf),
  recClose: (id, name, opts) => ipcRenderer.invoke('rec:close', id, name, opts),
  recDiscard: id => ipcRenderer.invoke('rec:discard', id),
  recRepair: file => ipcRenderer.invoke('rec:repair', file),
  packWrite: payload => ipcRenderer.invoke('pack:write', payload),
  onPackProgress: fn => { const h = (_e, p) => fn(p); ipcRenderer.on('pack:progress', h); return () => ipcRenderer.removeListener('pack:progress', h); },
  exportWrite: payload => ipcRenderer.invoke('export:write', payload),
  exportInfo: () => ipcRenderer.invoke('export:info'),
  exportOpenDir: () => ipcRenderer.invoke('export:open-dir'),
  windowCmd: cmd => ipcRenderer.invoke('desktop:window', cmd)
});
