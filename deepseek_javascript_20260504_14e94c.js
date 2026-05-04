// Replace this:
document.addEventListener('DOMContentLoaded', function(){
  renderUI();
  setTimeout(function(){ buildPageCharts('overview'); }, 120);
  refreshKeyBadge();
  // ...
});

// With this (waits for multisheet.js to load registry first):
document.addEventListener('DOMContentLoaded', function(){
  loadRegistry();
  renderUI();
  setTimeout(function(){ buildPageCharts('overview'); }, 120);
  if(window.refreshKeyBadge) refreshKeyBadge();
});