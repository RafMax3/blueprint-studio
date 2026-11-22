/* Pont entre l'interface et le noyau Rust (Tauri) : c'est le seul fournisseur de
   l'API `window.desktop`. app.js reste utilisable dans un simple navigateur (où
   le pont est absent) pour prévisualiser l'interface. Les deux dialogues à
   plusieurs choix (modifications non enregistrées, récupération du brouillon)
   sont dessinés dans la page pour garder des libellés français et le thème de
   l'application. */
(function () {
  'use strict';

  if (window.desktop || !window.__TAURI__) return;

  const invoke = window.__TAURI__.core.invoke;
  const listen = window.__TAURI__.event.listen;

  /* Un graphique ouvert depuis l'explorateur (ou une seconde instance) peut
     arriver pendant l'initialisation, avant qu'app.js n'écoute. On le garde
     en attente et on le rejoue après le chargement de l'exemple par défaut. */
  const pendingOpen = [];
  let openHandler = null;
  listen('app:open-path', function (event) {
    if (openHandler) openHandler(event.payload);
    else pendingOpen.push(event.payload);
  });

  /* ------------------------------------------------------------- dialogues */

  const MODAL_CSS = `
  .bp-modal { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center;
    justify-content: center; background: rgba(4, 7, 12, .62); backdrop-filter: blur(2px);
    font-family: inherit; animation: bp-fade .12s ease-out; }
  .bp-modal[hidden] { display: none; }
  .bp-modal-card { width: min(480px, calc(100vw - 48px)); background: #161b22;
    border: 1px solid #30363d; border-radius: 10px; padding: 22px 24px 18px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, .55); color: #e6edf3; }
  .bp-modal-title { margin: 0 0 10px; font-size: 17px; font-weight: 600; }
  .bp-modal-message { margin: 0 0 8px; font-size: 14px; line-height: 1.5; color: #e6edf3; }
  .bp-modal-detail { margin: 0 0 18px; font-size: 13px; line-height: 1.55; color: #9aa7b4;
    white-space: pre-line; }
  .bp-modal-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  .bp-modal-button { font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 6px;
    border: 1px solid #30363d; background: #1f2630; color: #e6edf3; cursor: pointer; }
  .bp-modal-button:hover { background: #283040; }
  .bp-modal-button:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
  .bp-modal-button.primary { background: #2f81f7; border-color: #2f81f7; color: #fff; }
  .bp-modal-button.primary:hover { background: #4c94ff; }
  @keyframes bp-fade { from { opacity: 0 } to { opacity: 1 } }
  @media (prefers-reduced-motion: reduce) { .bp-modal { animation: none } }
  `;

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    const style = document.createElement('style');
    style.textContent = MODAL_CSS;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  /* Affiche un dialogue modal et renvoie la clé du bouton choisi (ou `cancelKey`). */
  function modal(options) {
    injectStyles();
    return new Promise(function (resolve) {
      const previousFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.className = 'bp-modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const card = document.createElement('div');
      card.className = 'bp-modal-card';

      const title = document.createElement('h2');
      title.className = 'bp-modal-title';
      title.textContent = options.title;
      card.appendChild(title);

      const message = document.createElement('p');
      message.className = 'bp-modal-message';
      message.textContent = options.message;
      card.appendChild(message);

      if (options.detail) {
        const detail = document.createElement('p');
        detail.className = 'bp-modal-detail';
        detail.textContent = options.detail;
        card.appendChild(detail);
      }

      const actions = document.createElement('div');
      actions.className = 'bp-modal-actions';
      let primary = null;

      function close(key) {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        resolve(key);
      }

      function onKey(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(options.cancelKey || 'cancel');
        } else if (event.key === 'Enter' && primary) {
          event.preventDefault();
          event.stopPropagation();
          close(primary.dataset.key);
        }
      }

      options.buttons.forEach(function (button) {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'bp-modal-button' + (button.primary ? ' primary' : '');
        element.dataset.key = button.key;
        element.textContent = button.label;
        element.addEventListener('click', function () { close(button.key); });
        if (button.primary) primary = element;
        actions.appendChild(element);
      });

      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKey, true);
      if (primary) primary.focus();
    });
  }

  /* ---------------------------------------------------------------- IPC */

  async function call(command, args, fallback) {
    try {
      return await invoke(command, args || {});
    } catch (error) {
      console.error('[desktop] ' + command, error);
      return fallback;
    }
  }

  const failure = { error: 'Opération impossible : le noyau Rust n\'a pas répondu.' };

  window.desktop = {
    isDesktop: true,
    engine: 'rust',

    openFile: function () {
      return call('file_open', {}, failure);
    },
    readFile: function (filePath) {
      return call('file_read', { path: filePath }, failure);
    },
    saveFile: function (payload) {
      return call('file_save', { payload: payload }, failure);
    },
    saveFileAs: function (payload) {
      return call('file_save_as', { payload: payload }, failure);
    },
    exportCode: function (payload) {
      return call('file_export', { payload: payload }, failure);
    },

    confirmUnsaved: function () {
      return modal({
        title: 'Modifications non enregistrées',
        message: 'Le graphique contient des modifications non enregistrées.',
        detail: 'Voulez-vous les enregistrer avant de continuer ?',
        cancelKey: 'cancel',
        buttons: [
          { key: 'save', label: 'Enregistrer', primary: true },
          { key: 'discard', label: 'Ne pas enregistrer' },
          { key: 'cancel', label: 'Annuler' }
        ]
      });
    },

    saveDraft: function (payload) {
      return call('draft_save', { payload: payload }, false);
    },
    readDraft: function () {
      return call('draft_read', {}, null);
    },
    clearDraft: function () {
      return call('draft_clear', {}, false);
    },
    promptRecovery: function (savedAt) {
      let when = '';
      if (Number.isFinite(savedAt)) {
        const date = new Date(savedAt);
        when = ' le ' + date.toLocaleDateString('fr-FR', { dateStyle: 'long' }) +
          ' à ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      }
      return modal({
        title: 'Travail non enregistré',
        message: 'Blueprint Studio a retrouvé un graphique non enregistré' + when + '.',
        detail: 'Il a été conservé automatiquement (fermeture inattendue).\n' +
          'Le récupérer remplace le graphique affiché ; il restera à enregistrer.',
        cancelKey: 'ignore',
        buttons: [
          { key: 'recover', label: 'Récupérer', primary: true },
          { key: 'ignore', label: 'Ignorer' }
        ]
      }).then(function (key) { return key === 'recover'; });
    },

    setTitle: function (title) {
      return call('win_set_title', { title: title }, null);
    },
    close: function () {
      return call('win_close', {}, null);
    },

    onMenu: function (callback) {
      listen('menu', function (event) { callback(event.payload); });
    },
    onCloseRequest: function (callback) {
      listen('app:close-request', function () { callback(); });
    },
    onOpenPath: function (callback) {
      openHandler = callback;
      if (!pendingOpen.length) return;
      const queue = pendingOpen.splice(0, pendingOpen.length);
      setTimeout(function () {
        queue.forEach(function (path) { callback(path); });
      }, 0);
    }
  };
})();
