// レンダラー（Web 版のコード）に渡す口。window.inkgraphDesktop があれば「デスクトップ版」として動く。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inkgraphDesktop', {
  isDesktop: true, platform: process.platform,
  getVideoDir: () => ipcRenderer.invoke('desktop:get-dir'),
  pickVideoDir: () => ipcRenderer.invoke('desktop:pick-dir'),
  openVideoDir: () => ipcRenderer.invoke('desktop:open-dir'),
  recOpen: () => ipcRenderer.invoke('rec:open'),
  recWrite: (id, buf) => ipcRenderer.invoke('rec:write', id, buf),
  recClose: (id, name) => ipcRenderer.invoke('rec:close', id, name),
  recDiscard: id => ipcRenderer.invoke('rec:discard', id),
  windowCmd: cmd => ipcRenderer.invoke('desktop:window', cmd),
  onPickSource: cb => ipcRenderer.on('desktop:pick-source', (_e, list) => cb(list)),
  replyPickSource: id => ipcRenderer.send('desktop:pick-source-reply', id)
});
