(function () {
  function initNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;

    window.addEventListener('scroll', function () {
      nav.classList.toggle('scrolled', window.pageYOffset > 60);
    }, { passive: true });
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var href = this.getAttribute('href');
        if (href === '#') return;
        e.preventDefault();
        var target = document.querySelector(href);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function initHeroImg() {
    var img = document.querySelector('.hero-img');
    if (!img) return;

    if (img.complete) {
      img.classList.add('loaded');
    } else {
      img.addEventListener('load', function () {
        img.classList.add('loaded');
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initSmoothScroll();
    initHeroImg();
  });
})();
