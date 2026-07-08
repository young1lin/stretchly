# Floating timer implementation notes

This branch adds a small always-on-top floating countdown window without changing Stretchly's existing break scheduling decisions.

The current implementation routes startup through `app/floating-main.js`, dynamically imports the original `app/main.js`, and captures the live `BreaksPlanner` instance by wrapping planner lifecycle methods before `main.js` creates the planner.

The floating timer now reads state directly from the planner instead of deriving state from tray tooltip text:

- scheduler reference and `scheduler.timeLeft`
- `timeToNextBreak`
- manual pause state
- DND state
- natural-break scheduler-cleared state
- app-exclusion scheduler-cleared state

The tray toggle is still injected at menu build time for this prototype, but it no longer depends on a `quit` item and is available even when the strict-mode tray menu is reduced.

Known remaining architectural limitation: the ideal upstreamable version should move this code into `app/main.js` and Preferences instead of using a startup wrapper. This version is intended to make the feature behaviorally correct while keeping the existing main process file untouched for easy review.
