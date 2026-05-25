// Copy-to-clipboard for .copy-btn buttons inside codeblock / copy-block / prompt-block.
document.querySelectorAll('.copy-btn').forEach(function (btn) {
  btn.addEventListener('click', async function () {
    var container = btn.closest('.codeblock, .prompt-block, .copy-block') || btn.parentElement;
    var node =
      container.querySelector('.copy-block__value') ||
      container.querySelector('.prompt-block__body') ||
      container.querySelector('code');
    if (!node) return;
    var text = node.innerText;
    try {
      await navigator.clipboard.writeText(text);
      var orig = btn.textContent;
      btn.setAttribute('data-copied', 'true');
      btn.textContent = '✓ Скопировано';
      setTimeout(function () {
        btn.textContent = orig;
        btn.removeAttribute('data-copied');
      }, 2000);
    } catch (e) {
      btn.textContent = '✗ Не получилось';
      setTimeout(function () { btn.textContent = '📋 Скопировать'; }, 2000);
    }
  });
});
