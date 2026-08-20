/* Asociación Justicia Poética. JavaScript mínimo, sin dependencias.
   Nada de lo esencial depende de este archivo: si no carga, la web sigue
   siendo navegable y los formularios siguen enviándose. */
(function () {
  'use strict';

  /* Marca que hay JavaScript. El CSS solo oculta lo que va a poder mostrar. */
  document.documentElement.classList.add('js');

  /* --- Menú en móvil --------------------------------------------------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav-principal');

  if (toggle && nav) {
    var mq = window.matchMedia('(max-width: 940px)');

    var sync = function () {
      if (mq.matches) {
        nav.hidden = toggle.getAttribute('aria-expanded') !== 'true';
      } else {
        nav.hidden = false;
        toggle.setAttribute('aria-expanded', 'false');
      }
    };

    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      sync();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        toggle.setAttribute('aria-expanded', 'false');
        sync();
        toggle.focus();
      }
    });

    mq.addEventListener('change', sync);
    sync();
  }

  /* --- Salida rápida ----------------------------------------------------
     Sustituye la página actual para que no quede en el historial de "atrás"
     y devuelve al usuario a un sitio neutro. No borra el historial completo:
     eso el navegador no lo permite, y por eso la página lo advierte. */
  var exitButtons = document.querySelectorAll('[data-exit]');
  var leave = function () {
    try { window.location.replace('https://www.eltiempo.es/'); }
    catch (err) { window.location.href = 'https://www.eltiempo.es/'; }
  };

  Array.prototype.forEach.call(exitButtons, function (btn) {
    btn.addEventListener('click', leave);
  });

  if (exitButtons.length) {
    var escapes = 0;
    var escTimer = null;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      escapes += 1;
      clearTimeout(escTimer);
      escTimer = setTimeout(function () { escapes = 0; }, 1200);
      if (escapes >= 3) leave();
    });
  }

  /* --- Entrada suave de secciones --------------------------------------- */
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealables = document.querySelectorAll('.reveal');

  if (!reduced && 'IntersectionObserver' in window && revealables.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

    Array.prototype.forEach.call(revealables, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(revealables, function (el) { el.classList.add('is-in'); });
  }

  /* --- Validación de formularios ---------------------------------------
     El navegador ya valida. Esto solo mejora el mensaje: agrupa el error
     arriba, lo anuncia a los lectores de pantalla y lleva el foco al primer
     campo que falla. */
  var forms = document.querySelectorAll('form[data-validate]');

  Array.prototype.forEach.call(forms, function (form) {
    var box = form.querySelector('.form-error');

    /* Sin esto el navegador bloquea el evento submit en un formulario
       invalido y el resumen de errores de abajo nunca llegaria a mostrarse.
       Se desactiva desde JavaScript, no en el HTML: si el JS no carga,
       la validacion nativa del navegador sigue protegiendo el formulario. */
    form.noValidate = true;

    var clear = function (field) {
      field.removeAttribute('aria-invalid');
      var msg = form.querySelector('[data-error-for="' + field.name + '"]');
      if (msg) msg.textContent = '';
    };

    Array.prototype.forEach.call(form.elements, function (field) {
      if (!field.name) return;
      field.addEventListener('input', function () { clear(field); });
      field.addEventListener('change', function () { clear(field); });
    });

    form.addEventListener('submit', function (e) {
      var invalid = [];

      Array.prototype.forEach.call(form.elements, function (field) {
        if (!field.name || field.disabled || field.type === 'hidden') return;
        if (field.checkValidity()) { clear(field); return; }

        invalid.push(field);
        field.setAttribute('aria-invalid', 'true');
        var msg = form.querySelector('[data-error-for="' + field.name + '"]');
        if (msg) {
          msg.textContent = field.validity.valueMissing
            ? 'Falta rellenar este campo.'
            : (field.validationMessage || 'Revisa este campo.');
        }
      });

      if (!invalid.length) return;

      /* Un grupo de botones de radio son varios elementos pero una sola
         pregunta. Se cuentan por nombre para no decir "faltan 8 campos"
         cuando en realidad faltan 6. */
      var nombres = [];
      invalid.forEach(function (field) {
        if (nombres.indexOf(field.name) === -1) nombres.push(field.name);
      });

      e.preventDefault();
      if (box) {
        box.textContent = nombres.length === 1
          ? 'Falta un campo por rellenar. Lo hemos marcado más abajo.'
          : 'Faltan ' + nombres.length + ' campos por rellenar. Los hemos marcado más abajo.';
        box.setAttribute('data-visible', 'true');
      }
      invalid[0].focus();
      invalid[0].scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    });
  });

})();
