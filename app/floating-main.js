import { app, BrowserWindow, Menu, ipcMain, screen } from 'electron'
import Store from 'electron-store'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import StatusMessages from './utils/statusMessages.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let floatingStore = null
let floatingTimerWin = null
let publishInterval = null

const latestStatus = {
  phase: 'waiting',
  label: 'Mini break',
  remaining: null,
  capturedAt: Date.now()
}

function getFloatingStore () {
  if (!floatingStore) {
    floatingStore = new Store({
      defaults: {
        floatingTimer: true
      }
    })
  }
  return floatingStore
}

function isFloatingTimerVisible () {
  return getFloatingStore().get('floatingTimer') !== false
}

function setFloatingTimerVisible (visible) {
  getFloatingStore().set('floatingTimer', visible)
  if (visible) {
    createFloatingTimerWindow()
  } else {
    destroyFloatingTimerWindow()
  }
}

function toggleFloatingTimer () {
  setFloatingTimerVisible(!isFloatingTimerVisible())
}

function patchStatusMessages () {
  const descriptor = Object.getOwnPropertyDescriptor(StatusMessages.prototype, 'trayMessage')
  if (!descriptor || !descriptor.get) {
    return
  }

  Object.defineProperty(StatusMessages.prototype, 'trayMessage', {
    configurable: true,
    get () {
      captureFloatingTimerState(this)
      return descriptor.get.call(this)
    }
  })
}

function captureFloatingTimerState (status) {
  const isBreakRunning = status.reference === 'finishMicrobreak' || status.reference === 'finishBreak'
  const isPaused = status.isPaused || status.doNotDisturb || status.appExclusionPause

  if (isBreakRunning) {
    latestStatus.phase = 'breaking'
    latestStatus.label = status.reference === 'finishMicrobreak' ? 'Mini break' : 'Long break'
    latestStatus.remaining = status.timeLeft
  } else if (isPaused) {
    latestStatus.phase = 'paused'
    latestStatus.label = 'Paused'
    latestStatus.remaining = status.timeLeft || null
  } else {
    latestStatus.phase = 'waiting'
    latestStatus.label = (status.reference === 'startBreak' || status.reference === 'startBreakNotification')
      ? 'Long break'
      : 'Mini break'
    latestStatus.remaining = status.timeToNextBreak
  }

  latestStatus.capturedAt = Date.now()
  publishFloatingTimerData()
}

function patchTrayMenu () {
  const originalBuildFromTemplate = Menu.buildFromTemplate.bind(Menu)

  Menu.buildFromTemplate = (template) => {
    return originalBuildFromTemplate(injectFloatingTimerMenuItem(template))
  }
}

function injectFloatingTimerMenuItem (template) {
  if (!Array.isArray(template)) {
    return template
  }

  const alreadyInjected = template.some(item => item && item.id === 'floating-timer-toggle')
  if (alreadyInjected) {
    return template
  }

  const quitIndex = template.findIndex(item => item && item.role === 'quit')
  if (quitIndex === -1) {
    return template
  }

  const nextTemplate = [...template]
  const insertionIndex = Math.max(0, quitIndex - 1)
  nextTemplate.splice(insertionIndex, 0, {
    id: 'floating-timer-toggle',
    label: isFloatingTimerVisible() ? 'Hide Floating Timer' : 'Show Floating Timer',
    click: toggleFloatingTimer
  })

  return nextTemplate
}

function createFloatingTimerWindow () {
  if (floatingTimerWin && !floatingTimerWin.isDestroyed()) {
    return
  }

  const workArea = screen.getPrimaryDisplay().workArea
  const width = 180
  const height = 72
  const margin = 18

  floatingTimerWin = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - margin),
    y: Math.round(workArea.y + margin),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundThrottling: false,
    title: 'Stretchly Floating Timer',
    webPreferences: {
      preload: join(__dirname, './floating-timer-preload.mjs'),
      sandbox: false
    }
  })

  floatingTimerWin.loadFile(join(__dirname, './floating-timer.html'))
  floatingTimerWin.setAlwaysOnTop(true, 'floating')
  floatingTimerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  floatingTimerWin.once('ready-to-show', () => {
    if (floatingTimerWin && !floatingTimerWin.isDestroyed()) {
      floatingTimerWin.showInactive()
      publishFloatingTimerData()
    }
  })

  floatingTimerWin.on('closed', () => {
    floatingTimerWin = null
  })
}

function destroyFloatingTimerWindow () {
  if (!floatingTimerWin || floatingTimerWin.isDestroyed()) {
    floatingTimerWin = null
    return
  }

  floatingTimerWin.destroy()
  floatingTimerWin = null
}

function currentFloatingTimerData () {
  let remaining = latestStatus.remaining
  if (typeof remaining === 'number') {
    remaining = Math.max(0, remaining - (Date.now() - latestStatus.capturedAt))
  }

  return {
    phase: latestStatus.phase,
    label: latestStatus.label,
    time: formatRemainingTime(remaining),
    remaining
  }
}

function formatRemainingTime (milliseconds) {
  if (typeof milliseconds !== 'number') {
    return '--:--'
  }

  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`
  }

  return `${pad2(minutes)}:${pad2(seconds)}`
}

function pad2 (value) {
  return String(value).padStart(2, '0')
}

function publishFloatingTimerData () {
  if (!floatingTimerWin || floatingTimerWin.isDestroyed()) {
    return
  }

  floatingTimerWin.webContents.send('floating-timer-data', currentFloatingTimerData())
}

function startFloatingTimerPublisher () {
  if (publishInterval) {
    return
  }

  publishInterval = setInterval(publishFloatingTimerData, 1000)
}

patchStatusMessages()
patchTrayMenu()

ipcMain.on('hide-floating-timer', () => {
  setFloatingTimerVisible(false)
})

await import('./main.js')

app.whenReady().then(() => {
  if (isFloatingTimerVisible()) {
    createFloatingTimerWindow()
  }
  startFloatingTimerPublisher()
})

app.on('before-quit', () => {
  if (publishInterval) {
    clearInterval(publishInterval)
    publishInterval = null
  }
  destroyFloatingTimerWindow()
})
