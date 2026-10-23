// devtools/devtools.js - Registers the APISmoke panel in Chrome DevTools
chrome.devtools.panels.create(
  "APISmoke",
  "", // panel icon
  "devtools/panel.html",
  function(panel) {
    // Panel created
  }
);
