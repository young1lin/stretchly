const root = document.querySelector('.floating-timer')
const label = document.querySelector('.floating-timer__label')
const time = document.querySelector('.floating-timer__time')
const hint = document.querySelector('.floating-timer__hint')
const hideButton = document.querySelector('.floating-timer__hide')

if (hideButton) {
  hideButton.addEventListener('click', () => {
    window.floatingTimer.hide()
  })
}

window.floatingTimer.onData((data) => {
  root.dataset.phase = data.phase
  label.textContent = data.label
  time.textContent = data.time

  if (data.phase === 'paused') {
    hint.textContent = data.remaining ? 'Resume in' : 'Breaks paused'
  } else if (data.phase === 'breaking') {
    hint.textContent = 'Remaining'
  } else {
    hint.textContent = 'Next break in'
  }
})
