function hideWelcome() {
  var el = document.getElementById('welcome');
  if (!el) return;
  el.classList.add('fading');
  setTimeout(function() { el.style.display = 'none'; el.classList.remove('fading'); }, 800);
}
function showWelcome() {
  var el = document.getElementById('welcome');
  if (!el) return;
  el.style.display = 'flex';
  void el.offsetWidth;
  el.classList.remove('fading');
}
