/* Crédit Boutique — gestion des crédits clients (Burkina Faso)
 * Données stockées localement sur l'appareil (localStorage). Aucun serveur requis.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'credit-boutique-v1';
  var COUNTRY_CODE = '226';

  var DEFAULT_TEMPLATE =
    'Bonjour {client}, ici {boutique}. ' +
    'Nous vous rappelons gentiment que votre reliquat (crédit restant) est de {montant}. ' +
    'Échéance : {echeance}. ' +
    'Merci de passer régler ou de payer par Orange Money / Moov Money au {telephone}. ' +
    'Merci pour votre confiance !';

  // ---------- État ----------
  var state = load();

  function defaultState() {
    return {
      settings: {
        shopName: 'Ma Boutique',
        ownerName: '',
        phone: '',
        defaultDays: 7,
        template: DEFAULT_TEMPLATE
      },
      clients: [],
      txs: []
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var data = JSON.parse(raw);
      var base = defaultState();
      return {
        settings: Object.assign(base.settings, data.settings || {}),
        clients: Array.isArray(data.clients) ? data.clients : [],
        txs: Array.isArray(data.txs) ? data.txs : []
      };
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Impossible d\'enregistrer sur cet appareil');
    }
  }

  // ---------- Utilitaires ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    var v = Math.round(Number(n) || 0);
    var s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (v < 0 ? '-' : '') + s + ' FCFA';
  }
  function parseAmount(s) {
    return Math.round(Number(String(s).replace(/[^\d]/g, '')) || 0);
  }
  function today() { return isoDate(new Date()); }
  function isoDate(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + Number(n || 0));
    return isoDate(d);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var p = iso.slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  // Normalise un numéro burkinabè : "70 12 34 56" -> "22670123456"
  function normalizePhone(p) {
    var d = String(p || '').replace(/[^\d+]/g, '');
    if (d.indexOf('+') === 0) d = d.slice(1);
    else if (d.indexOf('00') === 0) d = d.slice(2);
    d = d.replace(/\D/g, '');
    if (d.length === 8) d = COUNTRY_CODE + d;
    return d;
  }
  function displayPhone(p) {
    var n = normalizePhone(p);
    if (n.length === 11 && n.indexOf(COUNTRY_CODE) === 0) {
      var l = n.slice(3);
      return '+226 ' + l.replace(/(\d{2})(?=\d)/g, '$1 ');
    }
    return p || '';
  }

  // ---------- Calculs ----------
  function clientById(id) {
    for (var i = 0; i < state.clients.length; i++) if (state.clients[i].id === id) return state.clients[i];
    return null;
  }
  function txsOf(clientId) {
    return state.txs.filter(function (t) { return t.clientId === clientId; })
      .sort(function (a, b) { return (b.date + b.createdAt).localeCompare(a.date + a.createdAt); });
  }
  // Résumé d'un client : total pris, total payé, reliquat, échéance la plus ancienne non couverte
  function summary(clientId) {
    var list = state.txs.filter(function (t) { return t.clientId === clientId; })
      .sort(function (a, b) { return (a.date + a.createdAt).localeCompare(b.date + b.createdAt); });
    var credit = 0, paid = 0;
    list.forEach(function (t) { if (t.type === 'credit') credit += t.amount; else paid += t.amount; });
    var balance = credit - paid;

    // Les paiements soldent d'abord les crédits les plus anciens (FIFO)
    var remainingPaid = paid, dueDate = null;
    list.forEach(function (t) {
      if (t.type !== 'credit') return;
      if (remainingPaid >= t.amount) { remainingPaid -= t.amount; return; }
      remainingPaid = 0;
      var due = t.dueDate || t.date;
      if (!dueDate || due < dueDate) dueDate = due;
    });
    var late = balance > 0 && dueDate && dueDate < today();
    var lastTx = list.length ? list[list.length - 1] : null;
    return { credit: credit, paid: paid, balance: balance, dueDate: balance > 0 ? dueDate : null, late: !!late, lastTx: lastTx };
  }

  // ---------- Messages WhatsApp / SMS ----------
  function buildMessage(client, s, tpl) {
    var st = state.settings;
    return (tpl || st.template || DEFAULT_TEMPLATE)
      .replace(/\{client\}/g, client.name)
      .replace(/\{montant\}/g, money(s.balance))
      .replace(/\{boutique\}/g, st.shopName || 'la boutique')
      .replace(/\{echeance\}/g, s.dueDate ? fmtDate(s.dueDate) : 'dès que possible')
      .replace(/\{telephone\}/g, st.phone ? displayPhone(st.phone) : '')
      .replace(/\{gerant\}/g, st.ownerName || '');
  }
  function whatsappUrl(phone, text) {
    return 'https://wa.me/' + normalizePhone(phone) + '?text=' + encodeURIComponent(text);
  }
  function smsUrl(phone, text) {
    var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return 'sms:+' + normalizePhone(phone) + (iOS ? '&' : '?') + 'body=' + encodeURIComponent(text);
  }
  function receiptText(client, tx, s) {
    var st = state.settings;
    var kind = tx.type === 'credit' ? 'Crédit enregistré' : 'Paiement reçu';
    return st.shopName + ' — ' + kind + '\n' +
      'Client : ' + client.name + '\n' +
      'Date : ' + fmtDate(tx.date) + '\n' +
      (tx.label ? 'Détail : ' + tx.label + '\n' : '') +
      'Montant : ' + money(tx.amount) + '\n' +
      'Reliquat restant : ' + money(s.balance) +
      (s.balance <= 0 ? '\nCompte soldé. Merci !' : '') +
      (tx.type === 'credit' && tx.dueDate ? '\nÀ régler avant le : ' + fmtDate(tx.dueDate) : '');
  }

  // ---------- Rendu ----------
  var currentView = 'dashboard';

  function render() {
    $('#shopTitle').textContent = state.settings.shopName || 'Crédit Boutique';
    renderDashboard();
    renderClients();
    renderReminders();
  }

  function clientRow(c, s) {
    var badge = s.late ? '<span class="badge">En retard</span>' : (s.balance <= 0 && s.credit > 0 ? '<span class="badge ok">Soldé</span>' : '');
    var sub = (c.phone ? displayPhone(c.phone) : 'Pas de numéro') + (s.dueDate ? ' · échéance ' + fmtDate(s.dueDate) : '');
    return '<li class="item clickable" data-client="' + c.id + '">' +
      '<div class="avatar">' + esc(initials(c.name)) + '</div>' +
      '<div class="item-main"><b>' + esc(c.name) + badge + '</b><small>' + esc(sub) + '</small></div>' +
      '<div class="amount ' + (s.balance > 0 ? 'debt' : 'paid') + '">' + money(s.balance) + '</div>' +
      '</li>';
  }

  function renderDashboard() {
    var total = 0, debtors = 0, late = 0, month = 0, ym = today().slice(0, 7);
    var rows = state.clients.map(function (c) {
      var s = summary(c.id);
      if (s.balance > 0) { total += s.balance; debtors++; }
      if (s.late) late++;
      return { c: c, s: s };
    });
    state.txs.forEach(function (t) { if (t.type === 'payment' && t.date.slice(0, 7) === ym) month += t.amount; });

    $('#statTotal').textContent = money(total);
    $('#statDebtors').textContent = debtors;
    $('#statLate').textContent = late;
    $('#statMonth').textContent = money(month);

    var top = rows.filter(function (r) { return r.s.balance > 0; })
      .sort(function (a, b) { return b.s.balance - a.s.balance; }).slice(0, 5);
    $('#topDebtors').innerHTML = top.length ? top.map(function (r) { return clientRow(r.c, r.s); }).join('')
      : '<li class="empty">Aucun crédit en cours. 👍</li>';

    var recent = state.txs.slice().sort(function (a, b) { return (b.date + b.createdAt).localeCompare(a.date + a.createdAt); }).slice(0, 8);
    $('#recentTx').innerHTML = recent.length ? recent.map(function (t) {
      var c = clientById(t.clientId) || { name: '(client supprimé)' };
      return '<li class="item clickable" data-client="' + t.clientId + '">' +
        '<div class="item-main"><b>' + esc(c.name) + '</b><small><span class="tx-type ' + t.type + '">' +
        (t.type === 'credit' ? 'Crédit' : 'Paiement') + '</span> · ' + fmtDate(t.date) + (t.label ? ' · ' + esc(t.label) : '') + '</small></div>' +
        '<div class="amount ' + (t.type === 'credit' ? 'debt' : 'paid') + '">' + (t.type === 'credit' ? '+' : '−') + money(t.amount) + '</div></li>';
    }).join('') : '<li class="empty">Aucune opération. Commencez par « Nouveau crédit ».</li>';
  }

  function renderClients() {
    var q = ($('#clientSearch').value || '').trim().toLowerCase();
    var qDigits = q.replace(/\D/g, '');
    var f = $('#clientFilter').value;
    var rows = state.clients.map(function (c) { return { c: c, s: summary(c.id) }; })
      .filter(function (r) {
        if (q) {
          var inName = r.c.name.toLowerCase().indexOf(q) !== -1;
          var inPhone = qDigits && normalizePhone(r.c.phone).indexOf(qDigits) !== -1;
          var inAddr = (r.c.address || '').toLowerCase().indexOf(q) !== -1;
          if (!inName && !inPhone && !inAddr) return false;
        }
        if (f === 'debt') return r.s.balance > 0;
        if (f === 'late') return r.s.late;
        if (f === 'clear') return r.s.balance <= 0;
        return true;
      })
      .sort(function (a, b) { return a.c.name.localeCompare(b.c.name, 'fr'); });
    $('#clientList').innerHTML = rows.length ? rows.map(function (r) { return clientRow(r.c, r.s); }).join('')
      : '<li class="empty">' + (state.clients.length ? 'Aucun client trouvé.' : 'Aucun client. Ajoutez votre premier client.') + '</li>';
  }

  function renderReminders() {
    var rows = state.clients.map(function (c) { return { c: c, s: summary(c.id) }; })
      .filter(function (r) { return r.s.balance > 0; })
      .sort(function (a, b) {
        if (a.s.late !== b.s.late) return a.s.late ? -1 : 1;
        return (a.s.dueDate || '').localeCompare(b.s.dueDate || '');
      });
    var lateCount = rows.filter(function (r) { return r.s.late; }).length;
    var badge = $('#reminderBadge');
    badge.hidden = !lateCount;
    badge.textContent = lateCount;

    $('#reminderList').innerHTML = rows.length ? rows.map(function (r) {
      var c = r.c, s = r.s;
      var last = c.lastReminderAt ? 'Dernier rappel : ' + fmtDate(c.lastReminderAt) : 'Jamais relancé';
      var actions = c.phone
        ? '<a class="btn whatsapp small" data-remind="whatsapp" data-id="' + c.id + '" href="' + esc(whatsappUrl(c.phone, buildMessage(c, s))) + '" target="_blank" rel="noopener">WhatsApp</a>' +
          '<a class="btn sms small" data-remind="sms" data-id="' + c.id + '" href="' + esc(smsUrl(c.phone, buildMessage(c, s))) + '">SMS</a>' +
          '<button class="btn small" data-action="copy-msg" data-id="' + c.id + '">Copier</button>'
        : '<button class="btn small" data-action="edit-client" data-id="' + c.id + '">Ajouter un numéro</button>';
      return '<li class="item reminder">' +
        '<div class="avatar">' + esc(initials(c.name)) + '</div>' +
        '<div class="item-main clickable" data-client="' + c.id + '"><b>' + esc(c.name) + (s.late ? '<span class="badge">En retard</span>' : '') + '</b>' +
        '<small>Échéance ' + fmtDate(s.dueDate) + ' · ' + last + '</small></div>' +
        '<div class="amount debt">' + money(s.balance) + '</div>' +
        '<div class="actions">' + actions + '</div></li>';
    }).join('') : '<li class="empty">Personne à relancer. Tous les comptes sont à jour. 🎉</li>';
  }

  function renderSettings() {
    var f = $('#settingsForm');
    var st = state.settings;
    f.shopName.value = st.shopName || '';
    f.ownerName.value = st.ownerName || '';
    f.phone.value = st.phone || '';
    f.defaultDays.value = st.defaultDays;
    f.template.value = st.template || DEFAULT_TEMPLATE;
  }

  function showView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  // ---------- Modales ----------
  function openModal(html) {
    $('#modalContent').innerHTML = html;
    $('#modal').hidden = false;
    var first = $('#modalContent input:not([type=hidden]), #modalContent select');
    if (first && window.matchMedia('(min-width: 760px)').matches) first.focus();
  }
  function closeModal() { $('#modal').hidden = true; $('#modalContent').innerHTML = ''; }

  function clientForm(c) {
    c = c || {};
    openModal(
      '<h2>' + (c.id ? 'Modifier le client' : 'Nouveau client') + '</h2>' +
      '<form class="form" id="clientForm">' +
      '<input type="hidden" name="id" value="' + esc(c.id || '') + '">' +
      '<label>Nom complet<input name="name" required value="' + esc(c.name || '') + '" placeholder="Ex : Ouédraogo Aminata"></label>' +
      '<label>Téléphone (WhatsApp / SMS)<input name="phone" type="tel" inputmode="tel" value="' + esc(c.phone || '') + '" placeholder="Ex : 70 12 34 56"></label>' +
      '<label>Quartier / adresse<input name="address" value="' + esc(c.address || '') + '" placeholder="Ex : Secteur 15, Ouaga"></label>' +
      '<label>Note<input name="note" value="' + esc(c.note || '') + '" placeholder="Facultatif"></label>' +
      '<button class="btn primary block" type="submit">Enregistrer</button>' +
      '</form>'
    );
  }

  function clientOptions(selectedId) {
    return state.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); })
      .map(function (c) {
        var s = summary(c.id);
        return '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' +
          esc(c.name) + (s.balance > 0 ? ' — doit ' + money(s.balance) : '') + '</option>';
      }).join('');
  }

  function txForm(type, clientId, tx) {
    tx = tx || {};
    var isCredit = type === 'credit';
    var noClients = !state.clients.length;
    var clientField = clientId
      ? '<input type="hidden" name="clientId" value="' + esc(clientId) + '"><p><b>' + esc((clientById(clientId) || {}).name) + '</b></p>'
      : '<label>Client<select name="clientId" required>' +
        (noClients ? '' : '<option value="">— Choisir —</option>' + clientOptions()) +
        '<option value="__new">+ Nouveau client…</option></select></label>' +
        '<div id="newClientFields" hidden>' +
        '<label>Nom du nouveau client<input name="newName" placeholder="Ex : Sawadogo Issa"></label>' +
        '<label>Téléphone<input name="newPhone" type="tel" inputmode="tel" placeholder="Ex : 76 00 00 00"></label></div>';
    var date = tx.date || today();
    openModal(
      '<h2>' + (tx.id ? 'Modifier l\'opération' : (isCredit ? 'Nouveau crédit (le client prend à crédit)' : 'Encaissement (le client rembourse)')) + '</h2>' +
      '<form class="form" id="txForm">' +
      '<input type="hidden" name="type" value="' + type + '">' +
      '<input type="hidden" name="id" value="' + esc(tx.id || '') + '">' +
      clientField +
      '<label>Montant (FCFA)<input name="amount" required inputmode="numeric" pattern="[0-9 ]*" value="' + (tx.amount ? esc(tx.amount) : '') + '" placeholder="Ex : 5000"></label>' +
      '<label>' + (isCredit ? 'Articles pris' : 'Mode de paiement / détail') +
      '<input name="label" value="' + esc(tx.label || '') + '" placeholder="' + (isCredit ? 'Ex : 2 sacs de riz, 1 bidon d\'huile' : 'Ex : Espèces, Orange Money, Moov Money') + '"></label>' +
      '<div class="row"><label>Date<input name="date" type="date" required value="' + date + '"></label>' +
      (isCredit ? '<label>À payer avant le<input name="dueDate" type="date" value="' + (tx.dueDate || addDays(date, state.settings.defaultDays)) + '"></label>' : '<span></span>') +
      '</div>' +
      '<button class="btn ' + (isCredit ? 'credit' : 'success') + ' block" type="submit">Enregistrer</button>' +
      '</form>'
    );
    var sel = $('#txForm select[name=clientId]');
    if (sel) {
      var toggle = function () {
        var isNew = sel.value === '__new';
        $('#newClientFields').hidden = !isNew;
        $('#txForm [name=newName]').required = isNew;
      };
      sel.addEventListener('change', toggle);
      if (noClients) { sel.value = '__new'; }
      toggle();
    }
  }

  function clientDetail(id) {
    var c = clientById(id);
    if (!c) return;
    var s = summary(id);
    var list = txsOf(id);
    var msg = buildMessage(c, s);
    var contact = c.phone
      ? '<a class="btn whatsapp" data-remind="whatsapp" data-id="' + c.id + '" href="' + esc(whatsappUrl(c.phone, msg)) + '" target="_blank" rel="noopener">Rappel WhatsApp</a>' +
        '<a class="btn sms" data-remind="sms" data-id="' + c.id + '" href="' + esc(smsUrl(c.phone, msg)) + '">Rappel SMS</a>' +
        '<button class="btn" style="grid-column:1/-1" data-action="copy-msg" data-id="' + c.id + '">Copier le message de rappel</button>'
      : '<button class="btn block" style="grid-column:1/-1" data-action="edit-client" data-id="' + c.id + '">Ajouter un numéro pour les rappels</button>';
    openModal(
      '<div class="client-head">' +
      '<div class="avatar">' + esc(initials(c.name)) + '</div>' +
      '<h2 style="padding:0">' + esc(c.name) + '</h2>' +
      '<small class="hint">' + esc([displayPhone(c.phone), c.address].filter(Boolean).join(' · ')) + '</small>' +
      '<div class="balance ' + (s.balance > 0 ? 'amount debt' : 'amount paid') + '" style="text-align:center">' + money(s.balance) + '</div>' +
      '<small class="hint">Reliquat · Pris ' + money(s.credit) + ' · Payé ' + money(s.paid) +
      (s.dueDate ? '<br>Échéance : ' + fmtDate(s.dueDate) + (s.late ? ' <span class="badge">En retard</span>' : '') : '') + '</small>' +
      (c.note ? '<p class="hint">' + esc(c.note) + '</p>' : '') +
      '</div>' +
      '<div class="grid-actions">' +
      '<button class="btn credit" data-action="new-credit" data-id="' + c.id + '">+ Crédit</button>' +
      '<button class="btn success" data-action="new-payment" data-id="' + c.id + '">+ Paiement</button>' +
      (s.balance > 0 ? contact : '') +
      '</div>' +
      '<h2>Historique</h2>' +
      '<ul class="list">' + (list.length ? list.map(function (t) {
        return '<li class="item"><div class="item-main"><b><span class="tx-type ' + t.type + '">' + (t.type === 'credit' ? 'Crédit' : 'Paiement') + '</span> · ' + fmtDate(t.date) + '</b>' +
          '<small>' + esc(t.label || '') + (t.type === 'credit' && t.dueDate ? (t.label ? ' · ' : '') + 'à payer avant le ' + fmtDate(t.dueDate) : '') + '</small></div>' +
          '<div class="amount ' + (t.type === 'credit' ? 'debt' : 'paid') + '">' + (t.type === 'credit' ? '+' : '−') + money(t.amount) + '</div>' +
          (c.phone ? '<a class="icon-btn" title="Envoyer le reçu sur WhatsApp" href="' + esc(whatsappUrl(c.phone, receiptText(c, t, s))) + '" target="_blank" rel="noopener">🧾</a>' : '') +
          '<button class="icon-btn" title="Modifier" data-action="edit-tx" data-id="' + t.id + '">✏️</button>' +
          '<button class="icon-btn" title="Supprimer" data-action="delete-tx" data-id="' + t.id + '">🗑️</button></li>';
      }).join('') : '<li class="empty">Aucune opération.</li>') + '</ul>' +
      '<div class="grid-actions">' +
      '<button class="btn" data-action="edit-client" data-id="' + c.id + '">Modifier le client</button>' +
      '<button class="btn danger" data-action="delete-client" data-id="' + c.id + '">Supprimer</button>' +
      '</div>'
    );
  }

  // ---------- Actions ----------
  function upsertClient(data) {
    var name = String(data.name || '').trim();
    if (!name) return null;
    var c = data.id ? clientById(data.id) : null;
    if (!c) {
      c = { id: uid(), createdAt: new Date().toISOString() };
      state.clients.push(c);
    }
    c.name = name;
    c.phone = String(data.phone || '').trim();
    c.address = String(data.address || '').trim();
    c.note = String(data.note || '').trim();
    return c;
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // Fenêtre de confirmation intégrée (remplace confirm(), bloqué dans certains navigateurs)
  function askConfirm(msg, yesLabel, onYes) {
    var box = $('#confirmBox');
    $('#confirmMsg').textContent = msg;
    var yes = $('#confirmYes');
    yes.textContent = yesLabel || 'Confirmer';
    box.hidden = false;
    yes.onclick = function () { box.hidden = true; onYes(); };
  }
  function closeConfirm() { $('#confirmBox').hidden = true; }

  function copyText(text, el) {
    var done = function () { toast('Copié ✔'); };
    var fallback = function () { if (el) { el.focus(); el.select(); } toast('Sélectionnez le texte puis copiez-le'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  // Propose un fichier : téléchargement + texte à copier (si le téléchargement est bloqué)
  function offerFile(name, content, type, title) {
    try {
      var blob = new Blob([content], { type: type });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { /* téléchargement impossible : le texte reste disponible ci-dessous */ }
    openModal(
      '<h2>' + esc(title) + '</h2>' +
      '<p class="hint">Si le fichier « ' + esc(name) + ' » ne s\'est pas téléchargé, copiez ce texte et gardez-le (par exemple en vous l\'envoyant sur WhatsApp).</p>' +
      '<textarea id="exportText" rows="10" readonly>' + esc(content.replace(/^﻿/, '')) + '</textarea>' +
      '<button class="btn primary block" data-action="copy-export">Copier le texte</button>'
    );
  }

  function restoreFrom(text) {
    var data;
    try {
      data = JSON.parse(text);
      if (!data || !Array.isArray(data.clients) || !Array.isArray(data.txs)) throw new Error('format');
    } catch (err) {
      toast('Sauvegarde invalide');
      return;
    }
    askConfirm('Remplacer les données actuelles par cette sauvegarde (' + data.clients.length + ' clients) ?', 'Restaurer', function () {
      state = { settings: Object.assign(defaultState().settings, data.settings || {}), clients: data.clients, txs: data.txs };
      save(); render(); renderSettings(); closeModal(); toast('Sauvegarde restaurée');
    });
  }

  function exportCsv() {
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var lines = [['Client', 'Téléphone', 'Quartier', 'Total pris', 'Total payé', 'Reliquat', 'Échéance', 'En retard'].map(q).join(';')];
    state.clients.forEach(function (c) {
      var s = summary(c.id);
      lines.push([c.name, displayPhone(c.phone), c.address, s.credit, s.paid, s.balance, s.dueDate ? fmtDate(s.dueDate) : '', s.late ? 'Oui' : 'Non'].map(q).join(';'));
    });
    lines.push('');
    lines.push(['Date', 'Client', 'Type', 'Montant', 'Détail', 'Échéance'].map(q).join(';'));
    state.txs.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (t) {
      var c = clientById(t.clientId) || { name: '' };
      lines.push([fmtDate(t.date), c.name, t.type === 'credit' ? 'Crédit' : 'Paiement', t.amount, t.label, t.dueDate ? fmtDate(t.dueDate) : ''].map(q).join(';'));
    });
    offerFile('credits-' + today() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8', 'Export Excel (CSV)');
  }

  document.addEventListener('click', function (e) {
    var remind = e.target.closest('[data-remind]');
    if (remind) {
      var rc = clientById(remind.dataset.id);
      if (rc) { rc.lastReminderAt = today(); save(); setTimeout(render, 300); }
      return; // laisser le lien s'ouvrir (WhatsApp / SMS)
    }

    var tab = e.target.closest('.tab');
    if (tab) { showView(tab.dataset.view); return; }

    var el = e.target.closest('[data-action]');
    if (el) {
      var a = el.dataset.action, id = el.dataset.id;
      if (a === 'close-modal') closeModal();
      else if (a === 'close-confirm') closeConfirm();
      else if (a === 'copy-export') copyText($('#exportText').value, $('#exportText'));
      else if (a === 'copy-msg') {
        var mc = clientById(id);
        if (mc) { copyText(buildMessage(mc, summary(id))); mc.lastReminderAt = today(); save(); render(); }
      } else if (a === 'paste-backup') {
        openModal('<h2>Coller une sauvegarde</h2><p class="hint">Collez ici le texte de sauvegarde copié auparavant.</p>' +
          '<textarea id="pasteText" rows="10"></textarea><button class="btn primary block" data-action="restore-paste">Restaurer</button>');
      } else if (a === 'restore-paste') restoreFrom($('#pasteText').value);
      else if (a === 'new-client') clientForm();
      else if (a === 'edit-client') clientForm(clientById(id));
      else if (a === 'new-credit') txForm('credit', id);
      else if (a === 'new-payment') txForm('payment', id);
      else if (a === 'edit-tx') {
        var tx = state.txs.filter(function (t) { return t.id === id; })[0];
        if (tx) txForm(tx.type, tx.clientId, tx);
      } else if (a === 'delete-tx') {
        var t0 = state.txs.filter(function (t) { return t.id === id; })[0];
        if (t0) askConfirm('Supprimer cette opération de ' + money(t0.amount) + ' ?', 'Supprimer', function () {
          state.txs = state.txs.filter(function (t) { return t.id !== id; });
          save(); render(); clientDetail(t0.clientId); toast('Opération supprimée');
        });
      } else if (a === 'delete-client') {
        var dc = clientById(id);
        if (dc) askConfirm('Supprimer ' + dc.name + ' et tout son historique ?', 'Supprimer', function () {
          state.clients = state.clients.filter(function (c) { return c.id !== id; });
          state.txs = state.txs.filter(function (t) { return t.clientId !== id; });
          save(); render(); closeModal(); toast('Client supprimé');
        });
      } else if (a === 'export') {
        offerFile('sauvegarde-credit-boutique-' + today() + '.json', JSON.stringify(state), 'application/json', 'Sauvegarde');
      } else if (a === 'export-csv') exportCsv();
      else if (a === 'reset') {
        askConfirm('Effacer TOUTES les données (clients, crédits, paiements) ? Faites d\'abord une sauvegarde. Cette action est définitive.', 'Tout effacer', function () {
          state = defaultState(); save(); render(); renderSettings(); toast('Données effacées');
        });
      }
      return;
    }

    var row = e.target.closest('[data-client]');
    if (row) clientDetail(row.dataset.client);
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    var formId = f.getAttribute('id');
    e.preventDefault();
    var data = Object.fromEntries(new FormData(f).entries());

    if (formId === 'clientForm') {
      var c = upsertClient(data);
      if (!c) return;
      save(); render(); clientDetail(c.id);
      toast('Client enregistré');
    } else if (formId === 'txForm') {
      var amount = parseAmount(data.amount);
      if (amount <= 0) { toast('Montant invalide'); return; }
      var clientId = data.clientId;
      if (clientId === '__new') {
        var nc = upsertClient({ name: data.newName, phone: data.newPhone });
        if (!nc) { toast('Nom du client obligatoire'); return; }
        clientId = nc.id;
      }
      if (!clientById(clientId)) { toast('Choisissez un client'); return; }
      var commit = function () {
        var tx = data.id ? state.txs.filter(function (t) { return t.id === data.id; })[0] : null;
        if (!tx) { tx = { id: uid(), createdAt: new Date().toISOString() }; state.txs.push(tx); }
        tx.clientId = clientId;
        tx.type = data.type;
        tx.amount = amount;
        tx.label = String(data.label || '').trim();
        tx.date = data.date || today();
        tx.dueDate = data.type === 'credit' ? (data.dueDate || '') : '';
        save(); render(); clientDetail(clientId);
        toast(data.type === 'credit' ? 'Crédit enregistré' : 'Paiement enregistré');
      };
      var bal = summary(clientId).balance;
      if (data.type === 'payment' && !data.id && amount > bal) {
        save(); render(); // le nouveau client éventuel est déjà créé
        askConfirm('Ce paiement (' + money(amount) + ') dépasse le reliquat (' + money(bal) + '). Enregistrer quand même ?', 'Enregistrer', commit);
        return;
      }
      commit();
    } else if (formId === 'settingsForm') {
      state.settings.shopName = data.shopName.trim();
      state.settings.ownerName = data.ownerName.trim();
      state.settings.phone = data.phone.trim();
      state.settings.defaultDays = Math.max(0, parseInt(data.defaultDays, 10) || 0);
      state.settings.template = data.template.trim() || DEFAULT_TEMPLATE;
      save(); render(); toast('Réglages enregistrés');
    }
  });

  $('#clientSearch').addEventListener('input', renderClients);
  $('#clientFilter').addEventListener('change', renderClients);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#confirmBox').hidden) closeConfirm(); else closeModal();
  });

  $('#importFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      e.target.value = '';
      restoreFrom(reader.result);
    };
    reader.readAsText(file);
  });

  // Mode hors-ligne (installation sur l'écran d'accueil)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  render();
})();
