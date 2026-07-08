import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('floatingTimer', {
  onData: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('floating-timer-data', listener)
    return () => ipcRenderer.removeListener('floating-timer-data', listener)
  },
  hide: () => ipcRenderer.send('hide-floating-timer')
})
