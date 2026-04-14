(function () {
  'use strict';

  var scriptEl = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  var urlParams = {};
  try {
    var qs = (scriptEl.src.split('?')[1] || '');
    qs.split('&').forEach(function(p) {
      var kv = p.split('=');
      if (kv[0]) urlParams[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
  } catch(e) {}

  var ORG_ID    = urlParams['org']   || '';
  var ORG_NAME  = urlParams['name']  || '';
  var LANG      = urlParams['lang']  || (navigator.language || '').startsWith('nb') || (navigator.language || '').startsWith('nn') ? 'no' : 'en';
  var TRIAGE_URL = 'https://www.batchdapp.com/.netlify/functions/triage-complaint';

  if (!ORG_ID) { console.warn("[Batch'd] complaint-widget: org param required"); return; }

  // ── Country data ───────────────────────────────────────────
  var COUNTRIES = [
    ['NO','Norway'],['SE','Sweden'],['DK','Denmark'],['FI','Finland'],
    ['DE','Germany'],['NL','Netherlands'],['BE','Belgium'],['FR','France'],
    ['IT','Italy'],['ES','Spain'],['PT','Portugal'],['CH','Switzerland'],
    ['AT','Austria'],['PL','Poland'],['GB','United Kingdom'],
    ['US','United States'],['CA','Canada'],['AU','Australia'],['NZ','New Zealand'],
    ['--','────────────────'],
    ['AF','Afghanistan'],['AL','Albania'],['DZ','Algeria'],['AR','Argentina'],
    ['AM','Armenia'],['AZ','Azerbaijan'],['BH','Bahrain'],['BD','Bangladesh'],
    ['BY','Belarus'],['BZ','Belize'],['BJ','Benin'],['BT','Bhutan'],
    ['BO','Bolivia'],['BA','Bosnia and Herzegovina'],['BW','Botswana'],['BR','Brazil'],
    ['BN','Brunei'],['BG','Bulgaria'],['BF','Burkina Faso'],['BI','Burundi'],
    ['KH','Cambodia'],['CM','Cameroon'],['CV','Cape Verde'],['CF','Central African Republic'],
    ['TD','Chad'],['CL','Chile'],['CN','China'],['CO','Colombia'],
    ['KM','Comoros'],['CG','Congo'],['CR','Costa Rica'],['HR','Croatia'],
    ['CU','Cuba'],['CY','Cyprus'],['CZ','Czech Republic'],['DJ','Djibouti'],
    ['DO','Dominican Republic'],['EC','Ecuador'],['EG','Egypt'],['SV','El Salvador'],
    ['GQ','Equatorial Guinea'],['ER','Eritrea'],['EE','Estonia'],['ET','Ethiopia'],
    ['FJ','Fiji'],['GA','Gabon'],['GM','Gambia'],['GE','Georgia'],
    ['GH','Ghana'],['GR','Greece'],['GT','Guatemala'],['GN','Guinea'],
    ['GW','Guinea-Bissau'],['GY','Guyana'],['HT','Haiti'],['HN','Honduras'],
    ['HU','Hungary'],['IS','Iceland'],['IN','India'],['ID','Indonesia'],
    ['IR','Iran'],['IQ','Iraq'],['IE','Ireland'],['IL','Israel'],
    ['JM','Jamaica'],['JP','Japan'],['JO','Jordan'],['KZ','Kazakhstan'],
    ['KE','Kenya'],['KP','North Korea'],['KR','South Korea'],['KW','Kuwait'],
    ['KG','Kyrgyzstan'],['LA','Laos'],['LV','Latvia'],['LB','Lebanon'],
    ['LS','Lesotho'],['LR','Liberia'],['LY','Libya'],['LI','Liechtenstein'],
    ['LT','Lithuania'],['LU','Luxembourg'],['MK','North Macedonia'],['MG','Madagascar'],
    ['MW','Malawi'],['MY','Malaysia'],['MV','Maldives'],['ML','Mali'],
    ['MT','Malta'],['MR','Mauritania'],['MU','Mauritius'],['MX','Mexico'],
    ['MD','Moldova'],['MC','Monaco'],['MN','Mongolia'],['ME','Montenegro'],
    ['MA','Morocco'],['MZ','Mozambique'],['MM','Myanmar'],['NA','Namibia'],
    ['NP','Nepal'],['NI','Nicaragua'],['NE','Niger'],['NG','Nigeria'],
    ['NO2','Norway (alt)'],['OM','Oman'],['PK','Pakistan'],['PA','Panama'],
    ['PG','Papua New Guinea'],['PY','Paraguay'],['PE','Peru'],['PH','Philippines'],
    ['PL2','Poland (alt)'],['QA','Qatar'],['RO','Romania'],['RU','Russia'],
    ['RW','Rwanda'],['SA','Saudi Arabia'],['SN','Senegal'],['RS','Serbia'],
    ['SL','Sierra Leone'],['SG','Singapore'],['SK','Slovakia'],['SI','Slovenia'],
    ['SO','Somalia'],['ZA','South Africa'],['SS','South Sudan'],['LK','Sri Lanka'],
    ['SD','Sudan'],['SR','Suriname'],['SZ','Eswatini'],['SY','Syria'],
    ['TW','Taiwan'],['TJ','Tajikistan'],['TZ','Tanzania'],['TH','Thailand'],
    ['TL','Timor-Leste'],['TG','Togo'],['TT','Trinidad and Tobago'],['TN','Tunisia'],
    ['TR','Turkey'],['TM','Turkmenistan'],['UG','Uganda'],['UA','Ukraine'],
    ['AE','United Arab Emirates'],['UY','Uruguay'],['UZ','Uzbekistan'],
    ['VE','Venezuela'],['VN','Vietnam'],['YE','Yemen'],['ZM','Zambia'],['ZW','Zimbabwe']
  ];

  var REGIONS = {
    US: { label: 'State', required: true, opts: ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia'] },
    CA: { label: 'Province', required: true, opts: ['Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador','Northwest Territories','Nova Scotia','Nunavut','Ontario','Prince Edward Island','Quebec','Saskatchewan','Yukon'] },
    AU: { label: 'State', required: true, opts: ['Australian Capital Territory','New South Wales','Northern Territory','Queensland','South Australia','Tasmania','Victoria','Western Australia'] },
    DE: { label: 'State (Bundesland)', required: false, opts: ['Baden-Württemberg','Bavaria','Berlin','Brandenburg','Bremen','Hamburg','Hesse','Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia','Rhineland-Palatinate','Saarland','Saxony','Saxony-Anhalt','Schleswig-Holstein','Thuringia'] },
    NO: { label: LANG === 'no' ? 'Fylke' : 'County (Fylke)', required: false, opts: ['Agder','Innlandet','Møre og Romsdal','Nordland','Oslo','Rogaland','Troms og Finnmark','Trøndelag','Vestfold og Telemark','Vestland','Viken'] },
    SE: { label: LANG === 'no' ? 'Län' : 'County (Län)', required: false, opts: ['Blekinge','Dalarna','Gävleborg','Gotland','Halland','Jämtland','Jönköping','Kalmar','Kronoberg','Norrbotten','Örebro','Östergötland','Skåne','Södermanland','Stockholm','Uppsala','Värmland','Västerbotten','Västernorrland','Västmanland','Västra Götaland'] },
    GB: { label: 'Nation / Region', required: false, opts: ['England','Scotland','Wales','Northern Ireland'] },
    FR: { label: 'Région', required: false, opts: ['Auvergne-Rhône-Alpes','Bourgogne-Franche-Comté','Bretagne','Centre-Val de Loire','Corse','Grand Est','Hauts-de-France','Île-de-France','Normandie','Nouvelle-Aquitaine','Occitanie','Pays de la Loire','Provence-Alpes-Côte d\'Azur'] },
    IT: { label: 'Region', required: false, opts: ['Abruzzo','Aosta Valley','Apulia','Basilicata','Calabria','Campania','Emilia-Romagna','Friuli-Venezia Giulia','Lazio','Liguria','Lombardy','Marche','Molise','Piedmont','Sardinia','Sicily','Trentino-South Tyrol','Tuscany','Umbria','Veneto'] },
    ES: { label: 'Region', required: false, opts: ['Andalusia','Aragon','Asturias','Balearic Islands','Basque Country','Canary Islands','Cantabria','Castile and León','Castile-La Mancha','Catalonia','Extremadura','Galicia','La Rioja','Madrid','Murcia','Navarre','Valencia'] },
    MX: { label: 'State', required: false, opts: ['Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua','Coahuila','Colima','Durango','Guanajuato','Guerrero','Hidalgo','Jalisco','Mexico City','Michoacán','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas','State of Mexico'] },
    BR: { label: 'State', required: false, opts: ['Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Distrito Federal','Espírito Santo','Goiás','Maranhão','Mato Grosso','Mato Grosso do Sul','Minas Gerais','Pará','Paraíba','Paraná','Pernambuco','Piauí','Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul','Rondônia','Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins'] }
  };

  // ── i18n ───────────────────────────────────────────────────
  var T = {
    en: {
      btn:'Report a product concern',
      title:'Report a product concern',
      sub:'Your report helps keep products safe. All reports are reviewed by our food safety team.',
      emergency:'If this is a medical emergency, call emergency services immediately.',
      secContact:'Contact information',
      name:'Full name',namePh:'Your full name',
      email:'Email address',emailSub:'A reference number will be sent to this address',
      phone:'Phone number (optional)',phonePh:'Include country code, e.g. +47 123 45 678',
      secProduct:'Product information',
      product:'Product name',productPh:'Name as shown on packaging',
      barcode:'Barcode / EAN / UPC (optional)',barcodePh:'Numbers beneath the barcode',
      lot:'Lot or batch number (optional)',lotPh:'Usually printed near the best before date',
      bestBefore:'Best before / use by date (optional)',
      purchaseDate:'Approximate purchase date (optional)',
      secLocation:'Purchase location',
      country:'Country *',countryDef:'Select country',
      store:'Store / retailer name',storePh:'Name of the shop',
      city:'City / town',cityPh:'City or town where you purchased it',
      state:'State / region',statePh:'Select region',
      secDetails:'What happened?',
      details:'Description *',detailsPh:'Please describe what you found or experienced. The more detail you provide, the better we can investigate.',
      secHealth:'Health and safety',
      affected:'Anyone affected?',
      affectedOpts:['Just me','Two or more people','No illness — product defect only'],
      medical:'Medical attention sought?',
      medicalOpts:['No','Yes — saw a doctor or clinic','Yes — went to emergency room / hospital'],
      hasProduct:'Do you still have the product?',
      hasProductOpts:['Yes, unopened','Yes, partially consumed','No — discarded','No — given to authorities'],
      storage:'How was the product stored?',
      storageOpts:['Refrigerated (fridge)','Frozen (freezer)','Room temperature','Unknown / not applicable'],
      submit:'Submit report',
      submitting:'Submitting…',
      required:'Please describe what happened.',
      countryRequired:'Please select a country.',
      successTitle:'Report received',
      successRef:'Your reference number',
      successSub:'We have received your report and will review it promptly. If you provided an email address, a follow-up confirmation has been sent.',
      close:'Close',another:'Submit another report',
      powered:'Powered by Batch\'d Triage',
      optLabel:'Optional',
    },
    no: {
      btn:'Meld en produktbekymring',
      title:'Meld en produktbekymring',
      sub:'Rapporten din bidrar til tryggere produkter. Alle rapporter gjennomgås av mattrygghetsteamet vårt.',
      emergency:'Hvis dette er en medisinsk nødsituasjon, ring nødetatene umiddelbart.',
      secContact:'Kontaktinformasjon',
      name:'Fullt navn',namePh:'Ditt fulle navn',
      email:'E-postadresse',emailSub:'Et referansenummer sendes til denne adressen',
      phone:'Telefonnummer (valgfritt)',phonePh:'Inkluder landkode, f.eks. +47 123 45 678',
      secProduct:'Produktinformasjon',
      product:'Produktnavn',productPh:'Navn slik det står på emballasjen',
      barcode:'Strekkode / EAN / UPC (valgfritt)',barcodePh:'Tallene under strekkoden',
      lot:'Partinummer / batchnummer (valgfritt)',lotPh:'Vanligvis trykket nær best-før-datoen',
      bestBefore:'Best-før / siste forbruksdato (valgfritt)',
      purchaseDate:'Omtrentlig kjøpsdato (valgfritt)',
      secLocation:'Kjøpssted',
      country:'Land *',countryDef:'Velg land',
      store:'Butikk / forhandlernavn',storePh:'Navn på butikken',
      city:'By / tettsted',cityPh:'By eller tettsted der du kjøpte det',
      state:'Fylke / region',statePh:'Velg region',
      secDetails:'Hva skjedde?',
      details:'Beskrivelse *',detailsPh:'Beskriv hva du fant eller opplevde. Jo mer detaljer du oppgir, jo bedre kan vi etterforske.',
      secHealth:'Helse og sikkerhet',
      affected:'Noen berørt?',
      affectedOpts:['Bare meg','To eller flere personer','Ingen sykdom — kun produktfeil'],
      medical:'Medisinsk hjelp oppsøkt?',
      medicalOpts:['Nei','Ja — oppsøkte lege eller klinikk','Ja — ble innlagt på sykehus / legevakt'],
      hasProduct:'Har du fortsatt produktet?',
      hasProductOpts:['Ja, uåpnet','Ja, delvis brukt','Nei — kastet','Nei — overlevert til myndigheter'],
      storage:'Hvordan ble produktet oppbevart?',
      storageOpts:['Kjølt (kjøleskap)','Fryst (fryser)','Romtemperatur','Ukjent / ikke relevant'],
      submit:'Send inn rapport',
      submitting:'Sender…',
      required:'Beskriv hva som skjedde.',
      countryRequired:'Velg et land.',
      successTitle:'Rapport mottatt',
      successRef:'Ditt referansenummer',
      successSub:'Vi har mottatt rapporten din og vil gjennomgå den snarest. Hvis du oppga e-postadresse, er en oppfølgingsbekreftelse sendt.',
      close:'Lukk',another:'Send inn en ny rapport',
      powered:'Drevet av Batch\'d Triage',
      optLabel:'Valgfritt',
    }
  };
  var t = T[LANG] || T.en;

  // ── CSS ────────────────────────────────────────────────────
  var css = `
#bwd-btn{position:fixed;bottom:24px;right:24px;z-index:2147483646;background:#34d399;color:#065f46;border:none;border-radius:100px;padding:11px 18px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(52,211,153,0.35);display:flex;align-items:center;gap:7px;transition:transform 0.15s,box-shadow 0.15s;}
#bwd-btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(52,211,153,0.4);}
#bwd-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.6);display:none;align-items:flex-end;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
#bwd-overlay.open{display:flex;}
@media(min-width:580px){#bwd-overlay{align-items:center;padding:20px;}}
#bwd-modal{background:#091918;border-radius:16px 16px 0 0;width:100%;max-width:540px;max-height:94dvh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.6);animation:bwd-up 0.2s ease;}
@media(min-width:580px){#bwd-modal{border-radius:16px;max-height:90dvh;}}
@keyframes bwd-up{from{transform:translateY(36px);opacity:0;}to{transform:none;opacity:1;}}
#bwd-header{padding:18px 18px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
#bwd-title{font-size:15px;font-weight:700;color:#edfdf8;line-height:1.3;}
#bwd-sub{font-size:11px;color:#6aaf9e;margin-top:3px;line-height:1.5;}
#bwd-close{background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;color:#6aaf9e;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:background 0.15s;}
#bwd-close:hover{background:rgba(255,255,255,0.14);}
#bwd-emergency{margin:12px 18px 0;background:rgba(255,92,92,0.1);border:1px solid rgba(255,92,92,0.25);border-radius:8px;padding:9px 12px;font-size:11px;color:#ff5c5c;line-height:1.5;}
#bwd-form{padding:14px 18px 18px;display:flex;flex-direction:column;gap:14px;}
.bwd-section{font-size:10px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#3d7a6b;padding-bottom:6px;border-bottom:1px solid #0e2622;margin-bottom:2px;}
.bwd-field{display:flex;flex-direction:column;gap:4px;}
.bwd-label{font-size:11px;color:#6aaf9e;font-weight:500;display:flex;align-items:center;gap:5px;}
.bwd-opt{font-size:10px;color:#3d7a6b;font-style:italic;}
.bwd-sub{font-size:10px;color:#3d7a6b;line-height:1.4;}
.bwd-input{background:#0e2622;border:1px solid #12352f;border-radius:7px;padding:8px 10px;color:#edfdf8;font-size:12px;font-family:inherit;outline:none;transition:border-color 0.15s;width:100%;box-sizing:border-box;}
.bwd-input:focus{border-color:#34d399;}
.bwd-input::placeholder{color:#2d6657;}
.bwd-input option{background:#091918;}
textarea.bwd-input{resize:vertical;min-height:80px;line-height:1.5;}
.bwd-mono{font-family:"DM Mono",monospace,monospace;}
.bwd-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.bwd-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
@media(max-width:400px){.bwd-row,.bwd-row3{grid-template-columns:1fr;}}
#bwd-state-row{display:none;}
#bwd-submit{background:#34d399;color:#065f46;border:none;border-radius:7px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;width:100%;font-family:inherit;transition:opacity 0.15s;margin-top:2px;}
#bwd-submit:hover{opacity:0.9;}
#bwd-submit:disabled{opacity:0.5;cursor:not-allowed;}
#bwd-error{display:none;background:rgba(255,92,92,0.1);border:1px solid rgba(255,92,92,0.25);border-radius:7px;padding:9px 12px;font-size:11px;color:#ff5c5c;line-height:1.5;}
#bwd-success{display:none;flex-direction:column;align-items:center;text-align:center;padding:28px 20px 20px;gap:12px;}
#bwd-success.show{display:flex;}
#bwd-s-icon{width:48px;height:48px;border-radius:50%;background:rgba(52,211,153,0.12);display:flex;align-items:center;justify-content:center;}
#bwd-s-title{font-size:16px;font-weight:700;color:#edfdf8;}
#bwd-s-ref{font-size:11px;color:#34d399;background:rgba(52,211,153,0.08);padding:4px 12px;border-radius:20px;font-family:monospace;}
#bwd-s-sub{font-size:12px;color:#6aaf9e;line-height:1.6;max-width:360px;}
#bwd-s-actions{display:flex;gap:8px;margin-top:4px;}
.bwd-s-btn{border-radius:7px;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;border:none;font-family:inherit;}
.bwd-s-btn.p{background:#34d399;color:#065f46;}
.bwd-s-btn.s{background:rgba(255,255,255,0.07);color:#6aaf9e;}
#bwd-footer{padding:8px 18px 14px;display:flex;justify-content:center;}
#bwd-powered{font-size:10px;color:#2d6657;text-decoration:none;display:flex;align-items:center;gap:4px;}
#bwd-powered:hover{color:#6aaf9e;}
`;

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Helpers ────────────────────────────────────────────────
  function h(tag, attrs, html) {
    var n = document.createElement(tag);
    Object.keys(attrs||{}).forEach(function(k){ n.setAttribute(k, attrs[k]); });
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function field(id, label, inputHTML, subText, isOpt) {
    return '<div class="bwd-field">'
      + '<label class="bwd-label" for="' + id + '">' + label + (isOpt ? ' <span class="bwd-opt">(' + t.optLabel + ')</span>' : '') + '</label>'
      + (subText ? '<div class="bwd-sub">' + subText + '</div>' : '')
      + inputHTML
      + '</div>';
  }

  function inp(id, type, ph, extra) {
    return '<input class="bwd-input' + (extra||'') + '" id="' + id + '" type="' + type + '" placeholder="' + (ph||'') + '">';
  }

  function sel(id, opts, defLabel) {
    return '<select class="bwd-input" id="' + id + '"><option value="">' + defLabel + '</option>'
      + opts.map(function(o){ return '<option value="' + o + '">' + o + '</option>'; }).join('')
      + '</select>';
  }

  function countrySelect() {
    var html = '<select class="bwd-input" id="bwd-country"><option value="">' + t.countryDef + '</option>';
    COUNTRIES.forEach(function(c) {
      if (c[0] === '--') html += '<option disabled>──────────────</option>';
      else html += '<option value="' + c[0] + '">' + c[1] + '</option>';
    });
    html += '</select>';
    return html;
  }

  // ── Build modal HTML ───────────────────────────────────────
  var modalHTML = [
    '<div id="bwd-header">',
      '<div><div id="bwd-title">' + t.title + '</div><div id="bwd-sub">' + t.sub + '</div></div>',
      '<button id="bwd-close" aria-label="' + t.close + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>',
    '</div>',
    '<div id="bwd-emergency">' + t.emergency + '</div>',
    '<div id="bwd-form">',

    // Contact
    '<div class="bwd-section">' + t.secContact + '</div>',
    '<div class="bwd-row">',
      field('bwd-name', t.name, inp('bwd-name','text',t.namePh)),
      field('bwd-email', t.email, inp('bwd-email','email','you@email.com'), t.emailSub),
    '</div>',
    field('bwd-phone', t.phone, inp('bwd-phone','tel',t.phonePh), null, true),

    // Product
    '<div class="bwd-section">' + t.secProduct + '</div>',
    '<div class="bwd-row">',
      field('bwd-product', t.product, inp('bwd-product','text',t.productPh)),
      field('bwd-barcode', t.barcode, inp('bwd-barcode','text',t.barcodePh,' bwd-mono'), null, true),
    '</div>',
    '<div class="bwd-row">',
      field('bwd-lot', t.lot, inp('bwd-lot','text',t.lotPh,' bwd-mono'), null, true),
      field('bwd-bestbefore', t.bestBefore, inp('bwd-bestbefore','date',''), null, true),
    '</div>',
    field('bwd-purchdate', t.purchaseDate, inp('bwd-purchdate','date',''), null, true),

    // Location
    '<div class="bwd-section">' + t.secLocation + '</div>',
    field('bwd-country', t.country, countrySelect()),
    '<div class="bwd-row">',
      field('bwd-store', t.store, inp('bwd-store','text',t.storePh)),
      field('bwd-city', t.city, inp('bwd-city','text',t.cityPh)),
    '</div>',
    '<div id="bwd-state-row">',
      '<div class="bwd-field"><label class="bwd-label" id="bwd-state-label">' + t.state + '</label>',
      '<select class="bwd-input" id="bwd-state"><option value="">' + t.statePh + '</option></select></div>',
    '</div>',

    // Details
    '<div class="bwd-section">' + t.secDetails + '</div>',
    field('bwd-details', t.details, '<textarea class="bwd-input" id="bwd-details" placeholder="' + t.detailsPh + '"></textarea>'),

    // Health signals
    '<div class="bwd-section">' + t.secHealth + '</div>',
    '<div class="bwd-row">',
      '<div class="bwd-field"><label class="bwd-label" for="bwd-affected">' + t.affected + '</label>'
        + '<select class="bwd-input" id="bwd-affected"><option value="">' + t.affectedOpts[0] + '</option>'
        + t.affectedOpts.map(function(o){ return '<option value="' + o + '">' + o + '</option>'; }).join('')
        + '</select></div>',
      '<div class="bwd-field"><label class="bwd-label" for="bwd-medical">' + t.medical + '</label>'
        + '<select class="bwd-input" id="bwd-medical"><option value=""></option>'
        + t.medicalOpts.map(function(o){ return '<option value="' + o + '">' + o + '</option>'; }).join('')
        + '</select></div>',
    '</div>',
    '<div class="bwd-row">',
      '<div class="bwd-field"><label class="bwd-label" for="bwd-hasproduct">' + t.hasProduct + '</label>'
        + '<select class="bwd-input" id="bwd-hasproduct"><option value=""></option>'
        + t.hasProductOpts.map(function(o){ return '<option value="' + o + '">' + o + '</option>'; }).join('')
        + '</select></div>',
      '<div class="bwd-field"><label class="bwd-label" for="bwd-storage">' + t.storage + '</label>'
        + '<select class="bwd-input" id="bwd-storage"><option value=""></option>'
        + t.storageOpts.map(function(o){ return '<option value="' + o + '">' + o + '</option>'; }).join('')
        + '</select></div>',
    '</div>',

    '<div id="bwd-error"></div>',
    '<button id="bwd-submit">' + t.submit + '</button>',
    '</div>',

    // Success
    '<div id="bwd-success">',
      '<div id="bwd-s-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>',
      '<div id="bwd-s-title">' + t.successTitle + '</div>',
      '<div id="bwd-s-ref"></div>',
      '<div id="bwd-s-sub">' + t.successSub + '</div>',
      '<div id="bwd-s-actions">',
        '<button class="bwd-s-btn s" id="bwd-close-s">' + t.close + '</button>',
        '<button class="bwd-s-btn p" id="bwd-another">' + t.another + '</button>',
      '</div>',
    '</div>',

    '<div id="bwd-footer"><a id="bwd-powered" href="https://batchd.no" target="_blank" rel="noopener">',
      '<svg width="11" height="11" viewBox="0 0 512 512" fill="none"><rect width="512" height="512" rx="113" fill="#34D399"/><rect x="172" y="75" width="167" height="167" rx="24" fill="#055A46"/><rect x="75" y="270" width="167" height="167" rx="24" fill="#055A46"/><rect x="270" y="270" width="167" height="167" rx="24" fill="#055A46"/></svg>',
      t.powered,
    '</a></div>',
  ].join('');

  // ── DOM ────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.id = 'bwd-btn';
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 19h20L12 2z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/></svg> ' + t.btn;

  var overlay = document.createElement('div');
  overlay.id = 'bwd-overlay';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');

  var modal = document.createElement('div');
  modal.id = 'bwd-modal';
  modal.innerHTML = modalHTML;
  overlay.appendChild(modal);

  document.body.appendChild(btn);
  document.body.appendChild(overlay);

  // ── Country → state/region ─────────────────────────────────
  function updateStateField(countryCode) {
    var row = document.getElementById('bwd-state-row');
    var stateEl = document.getElementById('bwd-state');
    var stateLabel = document.getElementById('bwd-state-label');
    var region = REGIONS[countryCode];
    if (!region) { row.style.display = 'none'; stateEl.innerHTML = ''; return; }
    row.style.display = 'block';
    stateLabel.textContent = region.label + (region.required ? ' *' : ' (' + t.optLabel + ')');
    stateEl.innerHTML = '<option value="">' + t.statePh + '</option>'
      + region.opts.map(function(o){ return '<option value="' + o + '">' + o + '</option>'; }).join('');
  }

  document.getElementById('bwd-country').addEventListener('change', function() {
    updateStateField(this.value);
  });

  // ── Open / close ───────────────────────────────────────────
  var isOpen = false;

  function openWidget() {
    isOpen = true;
    overlay.style.display = 'flex';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    var first = modal.querySelector('.bwd-input');
    if (first) setTimeout(function(){ first.focus(); }, 80);
  }

  function closeWidget() {
    isOpen = false;
    overlay.classList.remove('open');
    setTimeout(function(){ overlay.style.display = 'none'; }, 200);
    document.body.style.overflow = '';
  }

  function resetForm() {
    modal.querySelectorAll('input,textarea').forEach(function(i){ i.value=''; });
    modal.querySelectorAll('select').forEach(function(s){ s.selectedIndex=0; });
    document.getElementById('bwd-state-row').style.display = 'none';
    document.getElementById('bwd-error').style.display = 'none';
    document.getElementById('bwd-form').style.display = 'flex';
    document.getElementById('bwd-success').classList.remove('show');
    var sb = document.getElementById('bwd-submit');
    sb.disabled = false; sb.textContent = t.submit;
  }

  btn.addEventListener('click', openWidget);
  document.getElementById('bwd-close').addEventListener('click', closeWidget);
  document.getElementById('bwd-close-s').addEventListener('click', closeWidget);
  document.getElementById('bwd-another').addEventListener('click', resetForm);
  overlay.addEventListener('click', function(e){ if (e.target === overlay) closeWidget(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && isOpen) closeWidget(); });

  // ── Submit ─────────────────────────────────────────────────
  document.getElementById('bwd-submit').addEventListener('click', function() {
    var details = (document.getElementById('bwd-details').value || '').trim();
    var country = document.getElementById('bwd-country').value;
    var errEl = document.getElementById('bwd-error');
    errEl.style.display = 'none';

    if (!details) { errEl.textContent = t.required; errEl.style.display = 'block'; return; }
    if (!country) { errEl.textContent = t.countryRequired; errEl.style.display = 'block'; return; }

    var submitBtn = document.getElementById('bwd-submit');
    submitBtn.disabled = true; submitBtn.textContent = t.submitting;

    var hasProductVal = document.getElementById('bwd-hasproduct').value;
    var countryName = (COUNTRIES.find(function(c){ return c[0] === country; }) || ['',''])[1];

    var payload = {
      source: 'widget',
      manufacturer_id: ORG_ID,
      org_name: ORG_NAME || null,
      lang: LANG,
      product_name: (document.getElementById('bwd-product').value||'').trim()||null,
      barcode: (document.getElementById('bwd-barcode').value||'').trim()||null,
      lot_number: (document.getElementById('bwd-lot').value||'').trim()||null,
      best_before_date: document.getElementById('bwd-bestbefore').value||null,
      purchase_date: document.getElementById('bwd-purchdate').value||null,
      complaint_text: details,
      customer_name: (document.getElementById('bwd-name').value||'').trim()||null,
      customer_email: (document.getElementById('bwd-email').value||'').trim()||null,
      customer_phone: (document.getElementById('bwd-phone').value||'').trim()||null,
      country: countryName || country,
      store_name: (document.getElementById('bwd-store').value||'').trim()||null,
      purchase_city: (document.getElementById('bwd-city').value||'').trim()||null,
      purchase_state: (document.getElementById('bwd-state').value||'')||null,
      people_affected: document.getElementById('bwd-affected').value||null,
      medical_attention: document.getElementById('bwd-medical').value||null,
      still_has_product: hasProductVal ? hasProductVal.startsWith('Yes') : null,
      storage_method: document.getElementById('bwd-storage').value||null,
      submitted_by_label: 'Customer (web widget)'
    };

    fetch(TRIAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (data.error) throw new Error(data.error);
      document.getElementById('bwd-form').style.display = 'none';
      document.getElementById('bwd-success').classList.add('show');
      document.getElementById('bwd-s-ref').textContent = t.successRef + ': ' + (data.complaint_number || '');
    })
    .catch(function(e) {
      submitBtn.disabled = false; submitBtn.textContent = t.submit;
      errEl.textContent = e.message || 'Something went wrong. Please try again.';
      errEl.style.display = 'block';
    });
  });

})();
