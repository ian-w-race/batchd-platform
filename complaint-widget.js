(function () {
  'use strict';

  // ── Config from script tag params ─────────────────────────
  var scriptEl = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var src = scriptEl ? scriptEl.src : '';
  var urlParams = {};
  try {
    var queryStr = src.split('?')[1] || '';
    queryStr.split('&').forEach(function (pair) {
      var parts = pair.split('=');
      if (parts[0]) urlParams[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '');
    });
  } catch (e) {}

  var ORG_ID    = urlParams['org']   || '';
  var ORG_NAME  = urlParams['name']  || '';
  var LANG      = urlParams['lang']  || 'en'; // 'en' | 'no'
  var TRIAGE_URL = 'https://www.batchdapp.com/.netlify/functions/triage-complaint';

  if (!ORG_ID) { console.warn('[Batch\'d] complaint-widget: org param is required.'); return; }

  // ── i18n ──────────────────────────────────────────────────
  var T = {
    en: {
      btn:          'Report a concern',
      title:        'Report a product concern',
      sub:          'Your report helps keep products safe. We take every concern seriously.',
      name:         'Your name',
      email:        'Email address',
      emailSub:     'We\'ll send you a follow-up reference',
      phone:        'Phone number (optional)',
      product:      'Product name',
      productPh:    'e.g. Grandiosa Original 485g',
      lot:          'Lot or batch number (if visible)',
      lotPh:        'e.g. L2024-0441',
      store:        'Where did you purchase it?',
      storePh:      'Store name or location',
      date:         'When did this happen?',
      details:      'What happened?',
      detailsPh:    'Please describe what you found or experienced, in as much detail as you can.',
      submit:       'Submit report',
      submitting:   'Submitting\u2026',
      required:     'Please describe what happened.',
      successTitle: 'Report received',
      successRef:   'Your reference number is',
      successSub:   'We\'ll review your report and be in touch if we need more information.',
      successFollowup: 'A follow-up email has been sent to',
      close:        'Close',
      another:      'Submit another',
      poweredBy:    'Powered by Batch\u2019d Triage',
    },
    no: {
      btn:          'Meld en bekymring',
      title:        'Meld en produktbekymring',
      sub:          'Tilbakemeldingen din bidrar til tryggere produkter. Vi tar alle henvendelser p\u00e5 alvor.',
      name:         'Navn',
      email:        'E-postadresse',
      emailSub:     'Vi sender deg en bekreftelse',
      phone:        'Telefonnummer (valgfritt)',
      product:      'Produktnavn',
      productPh:    'f.eks. Grandiosa Original 485g',
      lot:          'Partinummer (om synlig)',
      lotPh:        'f.eks. L2024-0441',
      store:        'Hvor kj\u00f8pte du produktet?',
      storePh:      'Butikknavn eller sted',
      date:         'N\u00e5r skjedde dette?',
      details:      'Hva skjedde?',
      detailsPh:    'Beskriv hva du oppdaget eller opplevde, s\u00e5 detaljert som mulig.',
      submit:       'Send inn',
      submitting:   'Sender\u2026',
      required:     'Beskriv hva som skjedde.',
      successTitle: 'Rapport mottatt',
      successRef:   'Referansenummeret ditt er',
      successSub:   'Vi gjennomg\u00e5r rapporten din og tar kontakt om vi trenger mer informasjon.',
      successFollowup: 'En oppf\u00f8lgings-e-post er sendt til',
      close:        'Lukk',
      another:      'Send inn en ny',
      poweredBy:    'Drevet av Batch\u2019d Triage',
    }
  };
  var t = T[LANG] || T.en;

  // ── Inject CSS ─────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#batchd-widget-btn{position:fixed;bottom:24px;right:24px;z-index:2147483646;',
    'background:#34d399;color:#065f46;border:none;border-radius:100px;',
    'padding:12px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(52,211,153,0.35);',
    'display:flex;align-items:center;gap:8px;transition:transform 0.15s,box-shadow 0.15s;}',
    '#batchd-widget-btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(52,211,153,0.4);}',
    '#batchd-widget-btn svg{flex-shrink:0;}',

    '#batchd-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);',
    'display:none;align-items:flex-end;justify-content:center;padding:0;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    '#batchd-overlay.open{display:flex;}',

    '@media(min-width:560px){#batchd-overlay{align-items:center;padding:24px;}}',

    '#batchd-modal{background:#0d1e1c;border-radius:16px 16px 0 0;width:100%;max-width:520px;',
    'max-height:92dvh;overflow-y:auto;padding:0;box-shadow:0 24px 64px rgba(0,0,0,0.5);',
    'animation:batchd-slide-up 0.22s ease;}',
    '@media(min-width:560px){#batchd-modal{border-radius:16px;max-height:88dvh;}}',

    '@keyframes batchd-slide-up{from{transform:translateY(40px);opacity:0;}to{transform:translateY(0);opacity:1;}}',

    '#batchd-modal-header{padding:20px 20px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}',
    '#batchd-modal-header-text{}',
    '#batchd-modal-title{font-size:16px;font-weight:700;color:#edfdf8;line-height:1.3;margin:0;}',
    '#batchd-modal-sub{font-size:12px;color:#6aaf9e;margin-top:4px;line-height:1.5;}',
    '#batchd-close-btn{background:rgba(255,255,255,0.07);border:none;border-radius:50%;',
    'width:28px;height:28px;cursor:pointer;color:#6aaf9e;flex-shrink:0;',
    'display:flex;align-items:center;justify-content:center;transition:background 0.15s;}',
    '#batchd-close-btn:hover{background:rgba(255,255,255,0.12);}',

    '#batchd-form{padding:16px 20px 20px;display:flex;flex-direction:column;gap:12px;}',

    '.batchd-field{display:flex;flex-direction:column;gap:5px;}',
    '.batchd-label{font-size:12px;color:#6aaf9e;font-weight:500;}',
    '.batchd-label-sub{font-size:11px;color:#6aaf9e;opacity:0.7;margin-top:1px;}',
    '.batchd-input{background:#0e2622;border:1px solid #12352f;border-radius:8px;',
    'padding:9px 11px;color:#edfdf8;font-size:13px;font-family:inherit;',
    'outline:none;transition:border-color 0.15s;width:100%;box-sizing:border-box;}',
    '.batchd-input:focus{border-color:#34d399;}',
    '.batchd-input::placeholder{color:#3d7a6b;}',
    'textarea.batchd-input{resize:vertical;min-height:90px;line-height:1.5;}',

    '#batchd-row-2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',

    '#batchd-submit{background:#34d399;color:#065f46;border:none;border-radius:8px;',
    'padding:11px;font-size:14px;font-weight:700;cursor:pointer;width:100%;',
    'font-family:inherit;transition:opacity 0.15s;margin-top:4px;}',
    '#batchd-submit:hover{opacity:0.9;}',
    '#batchd-submit:disabled{opacity:0.5;cursor:not-allowed;}',

    '#batchd-error{display:none;background:rgba(255,92,92,0.1);border:1px solid rgba(255,92,92,0.3);',
    'border-radius:8px;padding:10px 12px;font-size:12px;color:#ff5c5c;}',

    '#batchd-success{display:none;padding:28px 20px 24px;text-align:center;flex-direction:column;align-items:center;gap:12px;}',
    '#batchd-success.show{display:flex;}',
    '#batchd-success-icon{width:48px;height:48px;border-radius:50%;background:rgba(52,211,153,0.15);',
    'display:flex;align-items:center;justify-content:center;}',
    '#batchd-success-title{font-size:17px;font-weight:700;color:#edfdf8;}',
    '#batchd-success-ref{font-size:12px;font-family:"DM Mono",monospace,monospace;color:#34d399;',
    'background:rgba(52,211,153,0.08);padding:4px 12px;border-radius:20px;}',
    '#batchd-success-sub{font-size:12px;color:#6aaf9e;line-height:1.6;max-width:340px;}',
    '#batchd-success-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:4px;}',
    '.batchd-success-btn{border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;',
    'cursor:pointer;border:none;font-family:inherit;}',
    '.batchd-success-btn.primary{background:#34d399;color:#065f46;}',
    '.batchd-success-btn.secondary{background:rgba(255,255,255,0.07);color:#6aaf9e;}',

    '#batchd-footer{padding:10px 20px 14px;display:flex;justify-content:center;}',
    '#batchd-powered{font-size:10px;color:#3d7a6b;text-decoration:none;',
    'display:flex;align-items:center;gap:5px;transition:color 0.15s;}',
    '#batchd-powered:hover{color:#6aaf9e;}',
    '#batchd-powered svg{opacity:0.6;}',
  ].join('');
  document.head.appendChild(style);

  // ── Build DOM ──────────────────────────────────────────────
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // Floating button
  var btn = el('button', { id: 'batchd-widget-btn', 'aria-label': t.btn }, []);
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 19h20L12 2z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none"/></svg><span>' + t.btn + '</span>';

  // Overlay + modal
  var overlay = el('div', { id: 'batchd-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'batchd-modal-title' });

  var modal = el('div', { id: 'batchd-modal' });

  modal.innerHTML = [
    '<div id="batchd-modal-header">',
      '<div id="batchd-modal-header-text">',
        '<div id="batchd-modal-title">' + t.title + '</div>',
        '<div id="batchd-modal-sub">' + t.sub + '</div>',
      '</div>',
      '<button id="batchd-close-btn" aria-label="' + t.close + '">',
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      '</button>',
    '</div>',

    '<div id="batchd-form">',
      '<div class="batchd-field">',
        '<label class="batchd-label" for="batchd-name">' + t.name + '</label>',
        '<input class="batchd-input" id="batchd-name" type="text" autocomplete="name">',
      '</div>',

      '<div id="batchd-row-2">',
        '<div class="batchd-field">',
          '<label class="batchd-label" for="batchd-email">' + t.email + '</label>',
          '<div class="batchd-label-sub">' + t.emailSub + '</div>',
          '<input class="batchd-input" id="batchd-email" type="email" autocomplete="email">',
        '</div>',
        '<div class="batchd-field">',
          '<label class="batchd-label" for="batchd-phone">' + t.phone + '</label>',
          '<input class="batchd-input" id="batchd-phone" type="tel" autocomplete="tel">',
        '</div>',
      '</div>',

      '<div id="batchd-row-2b" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">',
        '<div class="batchd-field">',
          '<label class="batchd-label" for="batchd-product">' + t.product + '</label>',
          '<input class="batchd-input" id="batchd-product" type="text" placeholder="' + t.productPh + '">',
        '</div>',
        '<div class="batchd-field">',
          '<label class="batchd-label" for="batchd-lot">' + t.lot + '</label>',
          '<input class="batchd-input" id="batchd-lot" type="text" placeholder="' + t.lotPh + '" style="font-family:\'DM Mono\',monospace;">',
        '</div>',
      '</div>',

      '<div id="batchd-row-2c" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">',
        '<div class="batchd-field">',
          '<label class="batchd-label" for="batchd-store">' + t.store + '</label>',
          '<input class="batchd-input" id="batchd-store" type="text" placeholder="' + t.storePh + '">',
        '</div>',
        '<div class="batchd-field">',
          '<label class="batchd-label" for="batchd-date">' + t.date + '</label>',
          '<input class="batchd-input" id="batchd-date" type="date">',
        '</div>',
      '</div>',

      '<div class="batchd-field">',
        '<label class="batchd-label" for="batchd-details">' + t.details + ' <span style="color:#ff5c5c;">*</span></label>',
        '<textarea class="batchd-input" id="batchd-details" placeholder="' + t.detailsPh + '"></textarea>',
      '</div>',

      '<div id="batchd-error"></div>',

      '<button id="batchd-submit">' + t.submit + '</button>',
    '</div>',

    // Success state
    '<div id="batchd-success">',
      '<div id="batchd-success-icon">',
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      '</div>',
      '<div id="batchd-success-title">' + t.successTitle + '</div>',
      '<div id="batchd-success-ref"></div>',
      '<div id="batchd-success-sub">' + t.successSub + '</div>',
      '<div id="batchd-success-followup" style="display:none;font-size:12px;color:#6aaf9e;"></div>',
      '<div id="batchd-success-actions">',
        '<button class="batchd-success-btn secondary" id="batchd-close-success">' + t.close + '</button>',
        '<button class="batchd-success-btn primary" id="batchd-another">' + t.another + '</button>',
      '</div>',
    '</div>',

    '<div id="batchd-footer">',
      '<a id="batchd-powered" href="https://batchd.no" target="_blank" rel="noopener">',
        '<svg width="12" height="12" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="113" fill="#34D399"/><rect x="172" y="75" width="167" height="167" rx="24" fill="#055A46"/><rect x="75" y="270" width="167" height="167" rx="24" fill="#055A46"/><rect x="270" y="270" width="167" height="167" rx="24" fill="#055A46"/></svg>',
        t.poweredBy,
      '</a>',
    '</div>',
  ].join('');

  overlay.appendChild(modal);
  document.body.appendChild(btn);
  document.body.appendChild(overlay);

  // ── State ──────────────────────────────────────────────────
  var isOpen = false;
  var lastComplaintNumber = '';
  var lastEmail = '';

  function openWidget() {
    isOpen = true;
    overlay.classList.add('open');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    var firstInput = modal.querySelector('.batchd-input');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 100);
  }

  function closeWidget() {
    isOpen = false;
    overlay.classList.remove('open');
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  function resetForm() {
    modal.querySelectorAll('.batchd-input').forEach(function (i) { i.value = ''; });
    document.getElementById('batchd-error').style.display = 'none';
    document.getElementById('batchd-form').style.display = 'flex';
    document.getElementById('batchd-success').classList.remove('show');
    var submitBtn = document.getElementById('batchd-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = t.submit;
  }

  function showError(msg) {
    var errEl = document.getElementById('batchd-error');
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }

  // ── Events ─────────────────────────────────────────────────
  btn.addEventListener('click', openWidget);

  document.getElementById('batchd-close-btn').addEventListener('click', closeWidget);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeWidget();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) closeWidget();
  });

  document.getElementById('batchd-close-success').addEventListener('click', closeWidget);

  document.getElementById('batchd-another').addEventListener('click', function () {
    resetForm();
  });

  // ── Submit ─────────────────────────────────────────────────
  document.getElementById('batchd-submit').addEventListener('click', function () {
    var details = (document.getElementById('batchd-details').value || '').trim();
    if (!details) { showError(t.required); return; }

    document.getElementById('batchd-error').style.display = 'none';

    var submitBtn = document.getElementById('batchd-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = t.submitting;

    var email = (document.getElementById('batchd-email').value || '').trim();
    lastEmail = email;

    var payload = {
      source: 'widget',
      manufacturer_id: ORG_ID,
      org_name: ORG_NAME || null,
      product_name: (document.getElementById('batchd-product').value || '').trim() || null,
      lot_number: (document.getElementById('batchd-lot').value || '').trim() || null,
      complaint_text: details,
      customer_name: (document.getElementById('batchd-name').value || '').trim() || null,
      customer_email: email || null,
      customer_phone: (document.getElementById('batchd-phone').value || '').trim() || null,
      purchase_store: (document.getElementById('batchd-store').value || '').trim() || null,
      incident_date: document.getElementById('batchd-date').value || null,
      submitted_by_label: 'Customer (web widget)'
    };

    fetch(TRIAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.error) throw new Error(data.error);
      lastComplaintNumber = data.complaint_number || '';

      // Show success
      document.getElementById('batchd-form').style.display = 'none';
      var successEl = document.getElementById('batchd-success');
      successEl.classList.add('show');
      document.getElementById('batchd-success-ref').textContent = t.successRef + ': ' + lastComplaintNumber;

      if (lastEmail) {
        var followupEl = document.getElementById('batchd-success-followup');
        followupEl.textContent = t.successFollowup + ' ' + lastEmail + '.';
        followupEl.style.display = 'block';
      }
    })
    .catch(function (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = t.submit;
      showError(err.message || 'Something went wrong. Please try again.');
    });
  });

})();
