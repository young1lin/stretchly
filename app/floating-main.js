import { app, BrowserWindow, Menu, ipcMain, screen } from 'electron'
import Store from 'electron-store'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import BreaksPlanner from './breaksPlanner.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let floatingStore = null
let floatingTimerWin = null
let publishInterval = null
let capturedBreakPlanner = null

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
  publishFloatingTimerData()
}

function toggleFloatingTimer () {
  setFloatingTimerVisible(!isFloatingTimerVisible())
}

function captureBreakPlanner (planner) {
  if (planner) {
    capturedBreakPlanner = planner
  }
}

function patchBreaksPlanner () {
  const methods = [
    'nextBreak',
    'clear',
    'correctScheduler',
    'pause',
    'resume',
    'reset',
    'skipToMicrobreak',
    'skipToBreak',
    'postponeCurrentBreak',
    'nextBreakAfterNotification'
  ]

  for (const method of methods) {
    const original = BreaksPlanner.prototype[method]
    if (typeof original !== 'function') {
      continue
    }

    BreaksPlanner.prototype[method] = function (...args) {
      captureBreakPlanner(this)
      const result = original.apply(this, args)
      publishFloatingTimerData()
      return result
    }
  }
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

  const nextTemplate = [...template]
  const quitIndex = nextTemplate.findIndex(item => item && item.role === 'quit')
  const insertionIndex = quitIndex === -1 ? nextTemplate.length : Math.max(0, quitIndex - 1)

  nextTemplate.splice(insertionIndex, 0, {
    id: 'floating-timer-toggle',
    label: isFloatingTimerVisible() ? 'Hide Floating Timer' : 'Show Floating Timer',
    click: toggleFloatingTimer
  })

  return nextTemplate
}

function createFloatingTimerWindow () {
  if (!isFloatingTimerVisible()) {
    return
  }

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
  const planner = capturedBreakPlanner

  if (!planner || !planner.scheduler) {
    return {
      phase: 'waiting',
      label: 'Mini break',
      time: '--:--',
      remaining: null
    }
  }

  const reference = planner.scheduler.reference
  const isBreakRunning = reference === 'finishMicrobreak' || reference === 'finishBreak'
  const isPaused = planner.isPaused ||
    planner.dndManager?.isOnDnd ||
    planner.naturalBreaksManager?.isSchedulerCleared ||
    planner.appExclusionsManager?.isSchedulerCleared

  if (isBreakRunning) {
    return {
      phase: 'breaking',
      label: reference === 'finishMicrobreak' ? 'Mini break' : 'Long break',
      time: formatRemainingTime(planner.scheduler.timeLeft),
      remaining: planner.scheduler.timeLeft
    }
  }

  if (isPaused) {
    const remaining = planner.isPaused ? planner.scheduler.timeLeft : null
    return {
      phase: 'paused',
      label: 'Paused',
      time: formatRemainingTime(remaining),
      remaining
    }
  }

  return {
    phase: 'waiting',
    label: reference === 'startBreak' || reference === 'startBreakNotification' ? 'Long break' : 'Mini break',
    time: formatRemainingTime(planner.timeToNextBreak),
    remaining: planner.timeToNextBreak
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

  publishInterval = setInterval(() => {
    if (isFloatingTimerVisible()) {
      createFloatingTimerWindow()
      publishFloatingTimerData()
    }
  }, 1000)
}

patchBreaksPlanner()
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

app.on('will-quit', () => {
  if (publishInterval) {
    clearInterval(publishInterval)
    publishInterval = null
  }
  destroyFloatingTimerWindow()
})
