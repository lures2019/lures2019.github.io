const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('studyDesktop', {
  onSources(listener) {
    ipcRenderer.on('study-capture-list', (_event, data) => listener(data))
  },
  chooseSource(token, source) {
    ipcRenderer.send('study-capture-choice', token, source)
  }
})
