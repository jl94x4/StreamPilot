/**
 * ThePosterDB → Poster Sets import helpers (bookmarklet + userscript).
 * TPDB blocks iframes; these run on theposterdb.com and open the portal.
 */

/** Named window so repeat imports reuse one portal tab (opens one if needed). */
export const TPDB_IMPORT_WINDOW_NAME = 'smp-poster-sets';

/** JSON.stringify + escape chars that can break out of bookmarklets / inline scripts. */
const jsStringLiteral = (value) => {
    const charMap = {
        '<': '\\u003C',
        '>': '\\u003E',
        '/': '\\u002F',
        '\b': '\\b',
        '\f': '\\f',
        '\n': '\\n',
        '\r': '\\r',
        '\t': '\\t',
        '\0': '\\0',
        '\u2028': '\\u2028',
        '\u2029': '\\u2029',
    };
    return JSON.stringify(value).replace(/[<>/\b\f\n\r\t\0\u2028\u2029]/g, (ch) => charMap[ch] || ch);
};

export const extractTpdbSetUrl = (href = '') => {
    let parsed;
    try {
        parsed = new URL(String(href || '').trim(), 'https://theposterdb.com');
    } catch {
        return null;
    }
    const host = String(parsed.hostname || '').replace(/^www\./i, '').toLowerCase();
    if (host !== 'theposterdb.com') return null;
    const path = String(parsed.pathname || '').replace(/\/+$/, '');
    const setMatch = path.match(/^\/(?:poster\/)?set\/(\d+)$/i);
    if (setMatch) return `https://theposterdb.com/set/${setMatch[1]}`;
    const posterMatch = path.match(/^\/poster\/(\d+)$/i);
    if (posterMatch) return `https://theposterdb.com/poster/${posterMatch[1]}`;
    return null;
};

export const posterSetsImportHash = (setUrl, { apply = false } = {}) => {
    const params = new URLSearchParams();
    params.set('url', String(setUrl || ''));
    if (apply) params.set('action', 'apply');
    return `#paste?${params.toString()}`;
};

export const posterSetsImportHref = (portalRoot, setUrl, { apply = false } = {}) => {
    const root = String(portalRoot || '').replace(/\/+$/, '');
    if (!root || !setUrl) return '';
    return `${root}/poster-sets${posterSetsImportHash(setUrl, { apply })}`;
};

export const buildTpdbImportBookmarklet = (portalRoot, { apply = false } = {}) => {
    const root = String(portalRoot || '').replace(/\/+$/, '');
    const extra = apply ? '&action=apply' : '';
    const src = `(function(){var h=location.href;var a=h.match(/theposterdb\\.com\\/(?:poster\\/)?set\\/(\\d+)/i);var b=a?null:h.match(/theposterdb\\.com\\/poster\\/(\\d+)/i);var url=a?("https://theposterdb.com/set/"+a[1]):(b?("https://theposterdb.com/poster/"+b[1]):null);if(!url){alert("Open a ThePosterDB set (or poster) page first.");return;}var w=window.open(${jsStringLiteral(root)}+"/poster-sets#paste?url="+encodeURIComponent(url)+${jsStringLiteral(extra)},${jsStringLiteral(TPDB_IMPORT_WINDOW_NAME)});if(w)try{w.focus()}catch(e){}})();`;
    return `javascript:${src}`;
};

export const buildTpdbImportUserscript = ({
    portalRoot,
    scriptUrl,
    apply = false,
} = {}) => {
    const root = String(portalRoot || '').replace(/\/+$/, '');
    const updateUrl = String(scriptUrl || `${root}/api/poster-sets/tpdb-import.user.js`);
    const applyFlag = apply ? 'true' : 'false';
    return `// ==UserScript==
// @name         StreamPilot — Import to Poster Sets
// @namespace    server-manager-portal
// @version      1.1.0
// @description  Open ThePosterDB sets in StreamPilot Paste / Import (reuses one portal tab).
// @author       StreamPilot
// @match        https://theposterdb.com/*
// @match        https://www.theposterdb.com/*
// @icon         https://theposterdb.com/favicon.ico
// @grant        none
// @downloadURL  ${updateUrl}
// @updateURL    ${updateUrl}
// ==/UserScript==

(function () {
  'use strict';
  var PORTAL = ${jsStringLiteral(root)};
  var APPLY = ${applyFlag};
  var PORTAL_WINDOW = ${jsStringLiteral(TPDB_IMPORT_WINDOW_NAME)};

  function extractSetUrl(href) {
    try {
      var parsed = new URL(String(href || '').trim(), 'https://theposterdb.com');
    } catch (e) { return null; }
    var host = String(parsed.hostname || '').replace(/^www\\./i, '').toLowerCase();
    if (host !== 'theposterdb.com') return null;
    var path = String(parsed.pathname || '').replace(/\\/+$/, '');
    var setMatch = path.match(/^\\/(?:poster\\/)?set\\/(\\d+)$/i);
    if (setMatch) return 'https://theposterdb.com/set/' + setMatch[1];
    var posterMatch = path.match(/^\\/poster\\/(\\d+)$/i);
    if (posterMatch) return 'https://theposterdb.com/poster/' + posterMatch[1];
    return null;
  }

  function importHref(setUrl) {
    var params = new URLSearchParams();
    params.set('url', setUrl);
    if (APPLY) params.set('action', 'apply');
    return PORTAL + '/poster-sets#paste?' + params.toString();
  }

  function openImport(setUrl) {
    if (!setUrl) return;
    var win = window.open(importHref(setUrl), PORTAL_WINDOW);
    if (win) try { win.focus(); } catch (e) {}
  }

  function attrTitle(el) {
    return (el && (el.getAttribute('data-original-title') || el.getAttribute('title'))) || '';
  }

  function makeIconButton(setUrl, title) {
    var btn = document.createElement('a');
    btn.className = 'btn text-white white_orange_link smp-tpdb-import';
    btn.href = importHref(setUrl);
    btn.target = PORTAL_WINDOW;
    btn.setAttribute('data-smp-url', setUrl);
    btn.setAttribute('title', title || 'Import to Poster Sets');
    btn.setAttribute('data-toggle', 'tooltip');
    btn.setAttribute('data-placement', 'top');
    btn.innerHTML = '<i class="fas fa-file-import h4 mb-0"></i>';
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openImport(event.currentTarget.getAttribute('data-smp-url'));
    });
    return btn;
  }

  function addPageBar() {
    var setUrl = extractSetUrl(location.href);
    if (!setUrl) return;
    if (document.querySelector('.smp-tpdb-import-page')) return;
    var nodes = document.querySelectorAll('a.white_orange_link, a.btn.text-white');
    var host = null;
    for (var i = 0; i < nodes.length; i++) {
      var title = attrTitle(nodes[i]);
      if (title === 'Download Set Posters' || title === 'Download Poster' || title === 'Share!') {
        host = nodes[i].parentElement;
        break;
      }
    }
    var btn = makeIconButton(setUrl, 'Import to Poster Sets');
    btn.classList.add('smp-tpdb-import-page');
    if (host) {
      host.appendChild(btn);
      return;
    }
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:72px;right:16px;z-index:1040;';
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  function decorateOverlays(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var overlays = [];
    if (scope.classList && scope.classList.contains('overlay')) overlays.push(scope);
    var found = scope.querySelectorAll ? scope.querySelectorAll('.overlay') : [];
    for (var i = 0; i < found.length; i++) overlays.push(found[i]);
    for (var o = 0; o < overlays.length; o++) {
      var overlay = overlays[o];
      if (overlay.dataset.smpTpdbDecorated === '1') continue;
      var setLink = overlay.querySelector('a.set_poster_count, a[href*="/set/"]');
      var setUrl = setLink ? extractSetUrl(setLink.href) : null;
      if (!setUrl) continue;
      if (extractSetUrl(location.href) === setUrl) continue;
      var row = overlay.querySelector('.d-flex.flex-row.justify-content-between');
      if (!row) continue;
      overlay.dataset.smpTpdbDecorated = '1';
      var insertAfter = null;
      var actions = row.querySelectorAll('a');
      for (var a = 0; a < actions.length; a++) {
        if (/download/i.test(attrTitle(actions[a]))) insertAfter = actions[a];
      }
      var btn = makeIconButton(setUrl, 'Import set to Poster Sets');
      if (insertAfter && insertAfter.nextSibling) {
        row.insertBefore(btn, insertAfter.nextSibling);
      } else {
        row.appendChild(btn);
      }
    }
  }

  function boot() {
    addPageBar();
    decorateOverlays(document);
    var observer = new MutationObserver(function (mutations) {
      addPageBar();
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          if (nodes[j].nodeType === 1) decorateOverlays(nodes[j]);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;
};
