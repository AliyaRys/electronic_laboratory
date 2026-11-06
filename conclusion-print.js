(() => {
  const button = document.getElementById('print-conclusion');
  const image = document.querySelector('#print-sheet img');
  if (!button || !image) return;

  button.addEventListener('click', () => {
    const file = button.dataset.conclusionFile;
    if (!file || button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    const finish = () => {
      button.removeAttribute('aria-busy');
      image.onload = null;
      image.onerror = null;
    };
    const print = () => {
      finish();
      window.print();
    };
    image.onload = print;
    image.onerror = () => {
      finish();
      alert('Не удалось загрузить заключение для печати');
    };
    if (image.getAttribute('src') !== file) image.src = file;
    if (image.complete && image.naturalWidth) print();
  });
})();
