# Floating timer implementation notes

This branch adds a small always-on-top floating countdown window without changing Stretchly's existing break scheduling logic.

The implementation intentionally routes startup through `app/floating-main.js`, then dynamically imports the original `app/main.js`. The wrapper patches `StatusMessages.prototype.trayMessage` to observe the existing planner state and injects a tray menu item through `Menu.buildFromTemplate`.

This keeps the first prototype isolated:

- no changes to `app/main.js`
- no scheduling changes
- no strict-mode changes
- no break/postpone/skip behavior changes
- easy rollback by changing `package.json` back to `app/main.js`
