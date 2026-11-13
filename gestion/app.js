/* Caisse & Crédit — caisse, stock (réserve + frigo), production (glace), crédits clients
 * avec rappels WhatsApp/SMS, dépenses (adaptées à la source d'énergie) et bénéfices.
 * Données stockées localement sur l'appareil (localStorage). Aucun serveur requis.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'caisse-credit-v1';
  const OLD_BUVETTE_KEY = 'ma-buvette-v1';
  const OLD_CREDIT_KEY = 'credit-boutique-v1';
  const COUNTRY_CODE = '226';
  const PAY = { cash: 'Espèces', om: 'Orange Money', moov: 'Moov Money', credit: 'Crédit' };
  const ENERGY = { solaire: 'Solaire', sonabel: 'Réseau SONABEL', groupe: 'Groupe électrogène', mixte: 'Solaire + SONABEL' };

  const DEFAULT_TEMPLATE =
    'Bonjour {client}, ici {boutique}. Nous vous rappelons gentiment que votre crédit restant est de {montant}. ' +
    'Échéance : {echeance}. Vous pouvez passer régler ou payer par Orange Money / Moov Money au {telephone}. Merci pour votre confiance !';

  // Liste de départ : noms, casiers et prix modifiables par le commerçant.
  const DEFAULT_PRODUCTS = [
    ['Brakina 65 cl', 'biere', 12], ['Brakina 33 cl', 'biere', 24], ['So.b.bra', 'biere', 12],
    ['Castel', 'biere', 12], ['Flag', 'biere', 12], ['Guinness', 'biere', 24], ['Beaufort', 'biere', 24],
    ['Coca-Cola', 'sucrerie', 24], ['Fanta', 'sucrerie', 24], ['Sprite', 'sucrerie', 24], ['Eau minérale', 'eau', 12]
  ];
  const ICE_PRODUCT = { id: 'glace', name: 'Glace (sachet)', cat: 'glace', source: 'fabrication', unit: 'sachet', perCrate: 1, buy: 0, sell: 0, alert: 0 };

  // ---------- État ----------
  let fresh = false;
  let state = load();
  let cart = {};
  let payMode = 'cash';
  let period = 'today';
  let currentView = 'sell';

  function defaultSettings() {
    return {
      name: 'Ma Buvette', phone: '', energy: 'solaire',
      solarCost: 0, solarMonths: 0, solarSaved: 0,
      defaultDays: 7, extraCats: '', template: DEFAULT_TEMPLATE
    };
  }
  function defaultState() {
    return {
      settings: defaultSettings(),
      products: DEFAULT_PRODUCTS.map(([name, cat, perCrate], i) => ({
        id: 'p' + i, name, cat, source: 'achat', unit: 'btl', perCrate, buy: 0, sell: 0, alert: perCrate
      })).concat([Object.assign({}, ICE_PRODUCT)]),
      clients: [],
      moves: []
    };
  }
  function normalize(d) {
    const st = {
      settings: Object.assign(defaultSettings(), d.settings || {}),
      products: Array.isArray(d.products) ? d.products : [],
      clients: Array.isArray(d.clients) ? d.clients : [],
      moves: Array.isArray(d.moves) ? d.moves : []
    };
    st.products.forEach(p => { p.source = p.source || 'achat'; p.unit = p.unit || 'btl'; p.perCrate = p.perCrate || 1; });
    return st;
  }
  function readJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  // Récupère automatiquement les données des anciennes applications « Ma Buvette » et « Crédit Boutique ».
  function load() {
    const cur = readJSON(STORAGE_KEY);
    if (cur) return normalize(cur);
    const buv = readJSON(OLD_BUVETTE_KEY), cred = readJSON(OLD_CREDIT_KEY);
    if (!buv && !cred) { fresh = true; return defaultState(); }
    const st = defaultState();
    if (buv) {
      st.products = (buv.products || []).map(p => Object.assign({ source: 'achat', unit: 'btl' }, p));
      st.moves = buv.moves || [];
      if (buv.settings && buv.settings.name) st.settings.name = buv.settings.name;
    }
    if (cred) {
      const cs = cred.settings || {};
      if (!buv && cs.shopName) st.settings.name = cs.shopName;
      if (cs.phone) st.settings.phone = cs.phone;
      if (cs.defaultDays != null) st.settings.defaultDays = cs.defaultDays;
      st.clients = cred.clients || [];
      (cred.txs || []).forEach(t => st.moves.push(t.type === 'credit'
        ? { id: t.id, type: 'credit', clientId: t.clientId, amount: t.amount, label: t.label, dueDate: t.dueDate, date: t.date, time: '', createdAt: t.createdAt }
        : { id: t.id, type: 'reglement', clientId: t.clientId, amount: t.amount, payMode: guessPay(t.label), note: t.label, date: t.date, time: '', createdAt: t.createdAt }));
    }
    return normalize(st);
  }
  function guessPay(label) {
    const l = String(label || '').toLowerCase();
    if (l.indexOf('orange') !== -1) return 'om';
    if (l.indexOf('moov') !== -1) return 'moov';
    return 'cash';
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Impossible d\'enregistrer sur cet appareil'); }
  }

  // ---------- Utilitaires ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = s => Math.max(0, Math.round(Number(String(s == null ? '' : s).replace(/[^\d.,]/g, '').replace(',', '.')) || 0));
  function money(n) {
    const v = Math.round(Number(n) || 0);
    return (v < 0 ? '−' : '') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' F';
  }
  const pad = n => (n < 10 ? '0' : '') + n;
  const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => isoDate(new Date());
  const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtDate = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
  function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + Number(n || 0)); return isoDate(d); }
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5) + 1;
  const product = id => state.products.find(p => p.id === id);
  const pname = id => (product(id) || { name: '(produit supprimé)' }).name;
  const client = id => state.clients.find(c => c.id === id);
  const cname = id => (client(id) || { name: '(client supprimé)' }).name;
  const isMade = p => p && p.source === 'fabrication';
  const unitOf = p => (p && p.unit) || 'btl';
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  function fmtQty(n, p) {
    n = Math.round(n);
    const neg = n < 0, a = Math.abs(n), pc = p ? p.perCrate : 1, u = unitOf(p);
    if (!pc || pc <= 1 || a < pc) return (neg ? '−' : '') + a + ' ' + u;
    const c = Math.floor(a / pc), b = a % pc;
    return (neg ? '−' : '') + c + ' cs' + (b ? ' + ' + b + ' ' + u : '');
  }

  // Téléphones burkinabè : "70 12 34 56" -> "22670123456"
  function normalizePhone(p) {
    let d = String(p || '').replace(/[^\d+]/g, '');
    if (d.indexOf('+') === 0) d = d.slice(1); else if (d.indexOf('00') === 0) d = d.slice(2);
    d = d.replace(/\D/g, '');
    if (d.length === 8) d = COUNTRY_CODE + d;
    return d;
  }
  function displayPhone(p) {
    const n = normalizePhone(p);
    return n.length === 11 && n.indexOf(COUNTRY_CODE) === 0 ? '+226 ' + n.slice(3).replace(/(\d{2})(?=\d)/g, '$1 ') : (p || '');
  }
  const whatsappUrl = (phone, text) => 'https://wa.me/' + normalizePhone(phone) + '?text=' + encodeURIComponent(text);
  const smsUrl = (phone, text) => 'sms:+' + normalizePhone(phone) + (/iPad|iPhone|iPod/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(text);

  // ---------- Dépenses selon l'énergie ----------
  function expenseCategories() {
    const e = state.settings.energy;
    const cats = [];
    if (e === 'solaire' || e === 'mixte') cats.push('Entretien solaire', 'Batterie / panneau / onduleur');
    if (e === 'sonabel' || e === 'mixte') cats.push('Électricité SONABEL');
    if (e === 'groupe') cats.push('Carburant groupe', 'Entretien groupe');
    cats.push('Eau (ONEA / forage)', 'Sachets / emballages', 'Achat glace', 'Loyer', 'Salaire serveur', 'Transport', 'Gaz / charbon', 'Taxes / mairie');
    String(state.settings.extraCats || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => { if (cats.indexOf(s) === -1) cats.push(s); });
    cats.push('Autre');
    return cats;
  }
  const hasSolar = () => state.settings.energy === 'solaire' || state.settings.energy === 'mixte';

  // ---------- Stock ----------
  function computeStocks() {
    const s = {};
    state.products.forEach(p => { s[p.id] = { reserve: 0, fridge: 0 }; });
    state.moves.forEach(m => {
      const t = s[m.productId];
      if (m.type === 'achat' && t) t.reserve += m.qty;
      else if (m.type === 'production' && t) t.fridge += m.qty;
      else if (m.type === 'frigo' && t) { t.reserve -= m.qty; t.fridge += m.qty; }
      else if (m.type === 'perte' && t) t[m.loc === 'reserve' ? 'reserve' : 'fridge'] -= m.qty;
      else if (m.type === 'inventaire' && t) { t.reserve += m.reserveDelta || 0; t.fridge += m.fridgeDelta || 0; }
      else if (m.type === 'vente') m.lines.forEach(l => { const x = s[l.productId]; if (x) { x.fridge -= l.fromFridge; x.reserve -= l.fromReserve; } });
    });
    return s;
  }
  const isLow = (p, st) => p.sell > 0 && p.alert > 0 && (st.reserve + st.fridge) <= p.alert;

  // ---------- Crédits ----------
  function clientSummary(id) {
    const debts = [], ms = state.moves.filter(m => m.clientId === id)
      .sort((a, b) => (a.date + (a.time || '') + a.createdAt).localeCompare(b.date + (b.time || '') + b.createdAt));
    let credit = 0, paid = 0;
    ms.forEach(m => {
      if (m.type === 'vente' && m.payMode === 'credit') { credit += m.total; debts.push({ amount: m.total, due: m.dueDate || m.date }); }
      else if (m.type === 'credit') { credit += m.amount; debts.push({ amount: m.amount, due: m.dueDate || m.date }); }
      else if (m.type === 'reglement') paid += m.amount;
    });
    let rest = paid, dueDate = null;
    debts.forEach(d => {
      if (rest >= d.amount) { rest -= d.amount; return; }
      rest = 0; if (!dueDate || d.due < dueDate) dueDate = d.due;
    });
    const balance = credit - paid;
    return { credit, paid, balance, dueDate: balance > 0 ? dueDate : null, late: balance > 0 && !!dueDate && dueDate < today(), moves: ms };
  }
  function buildMessage(c, s) {
    const st = state.settings;
    return (st.template || DEFAULT_TEMPLATE)
      .replace(/\{client\}/g, c.name)
      .replace(/\{montant\}/g, money(s.balance).replace(' F', ' FCFA'))
      .replace(/\{boutique\}/g, st.name || 'la buvette')
      .replace(/\{echeance\}/g, s.dueDate ? fmtDate(s.dueDate) : 'dès que possible')
      .replace(/\{telephone\}/g, st.phone ? displayPhone(st.phone) : '')
      .replace(/\{gerant\}/g, '');
  }

  // ---------- Bilan ----------
  function rangeFor(key) {
    const t = today();
    if (key === 'today') return [t, t];
    if (key === 'yesterday') { const y = addDays(t, -1); return [y, y]; }
    if (key === 'week') return [addDays(t, -6), t];
    if (key === 'month') return [t.slice(0, 8) + '01', t];
    if (key === 'lastmonth') { const d = new Date(t.slice(0, 8) + '01T12:00:00'); d.setDate(0); const e = isoDate(d); return [e.slice(0, 8) + '01', e]; }
    const f = $('#rangeFrom').value || t, to = $('#rangeTo').value || t;
    return f <= to ? [f, to] : [to, f];
  }

  function report(from, to) {
    const z = () => ({ cash: 0, om: 0, moov: 0 });
    const r = { ca: 0, cogs: 0, sales: 0, creditSales: 0, dep: 0, pertes: 0, ecart: 0, achats: 0, manualCredits: 0,
      inBy: z(), collectBy: z(), outBy: z(), depBy: {}, prod: {}, moves: [] };
    state.moves.forEach(m => {
      if (m.date < from || m.date > to) return;
      r.moves.push(m);
      if (m.type === 'vente') {
        r.sales++; r.ca += m.total;
        if (m.payMode === 'credit') r.creditSales += m.total; else r.inBy[m.payMode] += m.total;
        m.lines.forEach(l => {
          const c = l.qty * l.cost; r.cogs += c;
          const p = r.prod[l.productId] || (r.prod[l.productId] = { qty: 0, ca: 0, profit: 0 });
          p.qty += l.qty; p.ca += l.qty * l.price; p.profit += l.qty * l.price - c;
        });
      } else if (m.type === 'reglement') r.collectBy[m.payMode] += m.amount;
      else if (m.type === 'credit') r.manualCredits += m.amount;
      else if (m.type === 'depense') { r.dep += m.amount; r.outBy[m.payMode] += m.amount; r.depBy[m.category] = (r.depBy[m.category] || 0) + m.amount; }
      else if (m.type === 'achat') { const v = m.qty * m.unitCost; r.achats += v; r.outBy[m.payMode] += v; }
      else if (m.type === 'perte') r.pertes += m.qty * m.cost;
      else if (m.type === 'inventaire' && !m.initial) r.ecart += -((m.reserveDelta || 0) + (m.fridgeDelta || 0)) * (m.cost || 0);
    });
    const st = state.settings, days = daysBetween(from, to);
    r.days = days;
    r.amort = hasSolar() && st.solarCost > 0 && st.solarMonths > 0 ? st.solarCost / st.solarMonths * days / 30.4375 : 0;
    r.saved = hasSolar() && st.solarSaved > 0 ? st.solarSaved * days / 30.4375 : 0;
    r.brut = r.ca - r.cogs;
    r.net = r.brut - r.dep - r.pertes - r.ecart - r.amort;
    r.collected = ['cash', 'om', 'moov'].reduce((t, k) => t + r.inBy[k] + r.collectBy[k], 0);
    r.moves.sort((a, b) => (b.date + (b.time || '') + b.createdAt).localeCompare(a.date + (a.time || '') + a.createdAt));
    return r;
  }

  function moveText(m) {
    const p = product(m.productId);
    switch (m.type) {
      case 'vente': return { t: 'Vente' + (m.payMode === 'credit' ? ' à crédit · ' + cname(m.clientId) : ''), d: m.lines.map(l => l.qty + ' ' + pname(l.productId)).join(', '), a: m.total, pay: m.payMode };
      case 'achat': return { t: 'Approvisionnement', d: pname(m.productId) + ' · ' + fmtQty(m.qty, p) + (m.note ? ' · ' + m.note : ''), a: -m.qty * m.unitCost, pay: m.payMode };
      case 'production': return { t: 'Production', d: pname(m.productId) + ' · ' + fmtQty(m.qty, p) };
      case 'frigo': return { t: 'Chargement frigo', d: pname(m.productId) + ' · ' + fmtQty(m.qty, p) };
      case 'perte': return { t: m.reason || 'Casse / perte', d: pname(m.productId) + ' · ' + m.qty + ' ' + unitOf(p) + (m.note ? ' · ' + m.note : ''), a: m.cost ? -m.qty * m.cost : null };
      case 'inventaire': {
        const parts = [];
        if (m.reserveDelta) parts.push('réserve ' + (m.reserveDelta > 0 ? '+' : '') + m.reserveDelta);
        if (m.fridgeDelta) parts.push('frigo ' + (m.fridgeDelta > 0 ? '+' : '') + m.fridgeDelta);
        return { t: m.initial ? 'Stock de départ' : 'Inventaire', d: pname(m.productId) + ' · ' + parts.join(', ') };
      }
      case 'depense': return { t: 'Dépense', d: m.category + (m.label ? ' · ' + m.label : ''), a: -m.amount, pay: m.payMode };
      case 'credit': return { t: 'Crédit (hors caisse) · ' + cname(m.clientId), d: money(m.amount) + (m.label ? ' · ' + m.label : '') };
      case 'reglement': return { t: 'Paiement de crédit · ' + cname(m.clientId), d: m.note || '', a: m.amount, pay: m.payMode };
    }
    return { t: m.type, d: '' };
  }
  function moveRow(m, showDate) {
    const x = moveText(m);
    return '<li class="item"><div class="item-main"><b>' + esc(x.t) + (x.pay ? ' <span class="tag ' + x.pay + '">' + PAY[x.pay] + '</span>' : '') + '</b>' +
      (x.d ? '<small>' + esc(x.d) + '</small>' : '') + '<small>' + (showDate ? fmtDate(m.date) + ' ' : '') + esc(m.time || '') + '</small></div>' +
      (x.a != null ? '<div class="amount ' + (x.a >= 0 ? 'pos' : 'neg') + '">' + (x.a > 0 ? '+' : '') + money(x.a) + '</div>' : '') +
      '<button class="icon-btn" title="Annuler cette opération" aria-label="Annuler cette opération" data-action="delete-move" data-id="' + m.id + '">🗑️</button></li>';
  }

  // ---------- Rendu ----------
  function render() {
    $('#barTitle').textContent = state.settings.name || 'Ma Buvette';
    $('#barSub').textContent = 'Caisse · Stock · Crédits · ' + ENERGY[state.settings.energy];
    const st = computeStocks();
    renderSell(st); renderStock(st); renderCredits(); renderExpenses(); renderReport();
    const low = state.products.filter(p => isLow(p, st[p.id])).length;
    $('#stockBadge').hidden = !low; $('#stockBadge').textContent = low;
  }

  function renderSell(st) {
    const r = report(today(), today());
    $('#todaySales').textContent = money(r.ca);
    $('#todayProfit').textContent = money(r.brut);
    $('#todayMobile').textContent = money(r.inBy.om + r.inBy.moov + r.collectBy.om + r.collectBy.moov);
    $('#productGrid').innerHTML = state.products.map(p => {
      const s = st[p.id], q = cart[p.id] || 0, fr = s.fridge;
      return '<button class="pbtn' + (q ? ' in-cart' : '') + (p.sell ? '' : ' noprice') + '" data-add="' + p.id + '">' +
        (q ? '<span class="qty">' + q + '</span>' : '') + '<b>' + esc(p.name) + '</b>' +
        '<span class="price">' + (p.sell ? money(p.sell) : 'Prix ?') + '</span>' +
        '<small class="' + (fr <= 0 ? 'low' : '') + '">' + (fr <= 0 ? (isMade(p) ? 'Plus en stock' : 'Frigo vide') : (isMade(p) ? '🧊 ' : '❄ ') + fr) + '</small></button>';
    }).join('') || '<p class="empty">Aucun produit. Ajoutez-en dans l\'onglet Stock.</p>';
    const sales = r.moves.filter(m => m.type === 'vente');
    $('#todayList').innerHTML = sales.length ? sales.map(m => moveRow(m)).join('') : '<li class="empty">Aucune vente aujourd\'hui.</li>';
    renderCart();
  }

  function renderCart() {
    const ids = Object.keys(cart).filter(id => cart[id] > 0 && product(id));
    const show = ids.length > 0 && currentView === 'sell';
    $('#cart').hidden = !show;
    document.body.classList.toggle('has-cart', show);
    let total = 0;
    $('#cartLines').innerHTML = ids.map(id => {
      const p = product(id), t = p.sell * cart[id]; total += t;
      return '<li><button class="step" data-dec="' + id + '" aria-label="Retirer">−</button><b>' + cart[id] + '</b>' +
        '<button class="step" data-add="' + id + '" aria-label="Ajouter">+</button>' +
        '<span class="n">' + esc(p.name) + '</span><span class="t">' + money(t) + '</span></li>';
    }).join('');
    $('#cartTotal').textContent = money(total);
    $('[data-action=checkout]').firstChild.textContent = payMode === 'credit' ? 'Vendre à crédit ' : 'Encaisser ';
    $$('.pm').forEach(b => b.classList.toggle('active', b.dataset.pay === payMode));
  }

  function renderStock(st) {
    let value = 0, margin = 0;
    $('#stockList').innerHTML = state.products.map(p => {
      const s = st[p.id], tot = s.reserve + s.fridge;
      value += Math.max(0, tot) * p.buy; margin += Math.max(0, tot) * (p.sell - p.buy);
      const missing = !p.sell || (!isMade(p) && !p.buy);
      const locs = isMade(p)
        ? '<span class="loc fridge">Fabriqué sur place · en stock : ' + fmtQty(s.fridge, p) + '</span>'
        : '<span class="loc">Réserve : ' + fmtQty(s.reserve, p) + '</span><span class="loc fridge">Frigo : ' + s.fridge + ' ' + unitOf(p) + '</span>';
      return '<li class="item clickable" data-product="' + p.id + '"><div class="item-main"><b>' + esc(p.name) +
        (isLow(p, s) ? '<span class="badge">Stock bas</span>' : '') + (missing ? '<span class="badge warn">Prix à remplir</span>' : '') + '</b>' +
        '<div class="locs">' + locs + '</div></div>' +
        '<div class="amount">' + fmtQty(tot, p) + '</div></li>';
    }).join('') || '<li class="empty">Aucun produit.</li>';
    $('#stockValue').textContent = money(value);
    $('#stockMargin').textContent = money(margin);
    $('#produceBtn').hidden = !state.products.some(isMade);
  }

  function clientRow(c, s) {
    const badge = s.late ? '<span class="badge">En retard</span>' : (s.balance <= 0 && s.credit > 0 ? '<span class="badge ok">Soldé</span>' : '');
    const sub = (c.phone ? displayPhone(c.phone) : 'Pas de numéro') + (s.dueDate ? ' · échéance ' + fmtDate(s.dueDate) : '') +
      (s.balance > 0 ? ' · ' + (c.lastReminderAt ? 'relancé le ' + fmtDate(c.lastReminderAt) : 'jamais relancé') : '');
    const actions = s.balance > 0 ? '<div class="actions">' + (c.phone
      ? '<a class="btn whatsapp small" data-remind="' + c.id + '" href="' + esc(whatsappUrl(c.phone, buildMessage(c, s))) + '" target="_blank" rel="noopener">WhatsApp</a>' +
        '<a class="btn sms small" data-remind="' + c.id + '" href="' + esc(smsUrl(c.phone, buildMessage(c, s))) + '">SMS</a>' +
        '<button class="btn small" data-action="copy-msg" data-id="' + c.id + '">Copier</button>'
      : '<button class="btn small" data-action="edit-client" data-id="' + c.id + '">Ajouter un numéro pour relancer</button>') + '</div>' : '';
    return '<li class="item client"><div class="avatar">' + esc(initials(c.name)) + '</div>' +
      '<div class="item-main clickable" data-client="' + c.id + '"><b>' + esc(c.name) + badge + '</b><small>' + esc(sub) + '</small></div>' +
      '<div class="amount ' + (s.balance > 0 ? 'neg' : 'pos') + '">' + money(s.balance) + '</div>' + actions + '</li>';
  }

  function renderCredits() {
    let total = 0, debtors = 0, late = 0;
    const rows = state.clients.map(c => { const s = clientSummary(c.id); if (s.balance > 0) { total += s.balance; debtors++; } if (s.late) late++; return { c, s }; });
    $('#crTotal').textContent = money(total); $('#crDebtors').textContent = debtors; $('#crLate').textContent = late;
    $('#creditBadge').hidden = !late; $('#creditBadge').textContent = late;
    const q = ($('#clientSearch').value || '').trim().toLowerCase(), qd = q.replace(/\D/g, ''), f = $('#clientFilter').value;
    const list = rows.filter(({ c, s }) => {
      if (q && c.name.toLowerCase().indexOf(q) === -1 && !(qd && normalizePhone(c.phone).indexOf(qd) !== -1)) return false;
      if (f === 'debt') return s.balance > 0;
      if (f === 'late') return s.late;
      if (f === 'clear') return s.balance <= 0;
      return true;
    }).sort((a, b) => (f === 'debt' || f === 'late')
      ? (a.s.late !== b.s.late ? (a.s.late ? -1 : 1) : b.s.balance - a.s.balance)
      : a.c.name.localeCompare(b.c.name, 'fr'));
    $('#clientList').innerHTML = list.length ? list.map(({ c, s }) => clientRow(c, s)).join('')
      : '<li class="empty">' + (state.clients.length ? (f === 'debt' ? 'Aucun crédit en cours. 👍' : 'Aucun client trouvé.') : 'Aucun client. Choisissez « Crédit » dans la caisse ou ajoutez un client.') + '</li>';
  }

  function renderExpenses() {
    if (!$('#expDate').value) $('#expDate').value = today();
    const sel = $('#expCategory'), cur = sel.value;
    sel.innerHTML = expenseCategories().map(c => '<option' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
    $('#energyHint').textContent = state.settings.energy === 'solaire'
      ? 'Énergie : solaire. Pas de facture d\'électricité ; notez l\'entretien des panneaux et le remplacement des batteries quand il y en a.'
      : 'Énergie : ' + ENERGY[state.settings.energy] + '. Vous pouvez changer cela dans les réglages (⚙️).';
    const ym = today().slice(0, 7);
    const list = state.moves.filter(m => m.type === 'depense' && m.date.slice(0, 7) === ym).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    $('#expMonthTotal').textContent = list.length ? '· ' + money(list.reduce((s, m) => s + m.amount, 0)) : '';
    $('#expenseList').innerHTML = list.length ? list.map(m => moveRow(m, true)).join('') : '<li class="empty">Aucune dépense ce mois-ci.</li>';
  }

  function renderReport() {
    const [from, to] = rangeFor(period);
    const r = report(from, to);
    const row = (label, v, cls) => '<div class="pl-row ' + (cls || '') + '"><span>' + label + '</span><span class="' + (v < 0 ? 'neg' : '') + '">' + money(v) + '</span></div>';
    const prodRows = Object.keys(r.prod).map(id => Object.assign({ id }, r.prod[id])).sort((a, b) => b.qty - a.qty);
    const depRows = Object.keys(r.depBy).sort((a, b) => r.depBy[b] - r.depBy[a]);
    const label = from === to ? fmtDate(from) : fmtDate(from) + ' → ' + fmtDate(to);
    const collected = r.collectBy.cash + r.collectBy.om + r.collectBy.moov;
    let crTotal = 0; state.clients.forEach(c => { const b = clientSummary(c.id).balance; if (b > 0) crTotal += b; });

    $('#report').innerHTML =
      '<p class="hint">Période : <b>' + label + '</b> · ' + r.sales + ' vente(s)</p>' +
      '<div class="pl"><h3>Résultat</h3>' +
        row('Ventes (chiffre d\'affaires)', r.ca) +
        row('− Coût d\'achat des produits vendus', -r.cogs) +
        row('= Bénéfice sur les ventes', r.brut) +
        row('− Dépenses', -r.dep) +
        (r.pertes ? row('− Casse / pertes', -r.pertes) : '') +
        (r.ecart ? row(r.ecart > 0 ? '− Manquants à l\'inventaire' : '+ Surplus à l\'inventaire', -r.ecart) : '') +
        (r.amort ? row('− Part de l\'installation solaire', -r.amort) : '') +
        '<div class="pl-row total"><span>Bénéfice net</span><span class="' + (r.net < 0 ? 'neg' : 'pos') + '">' + money(r.net) + '</span></div>' +
        (r.saved ? '<p class="info">☀️ Facture SONABEL évitée grâce au solaire sur la période : environ ' + money(r.saved) + '.</p>' : '') +
        (r.creditSales ? '<p class="info">Dont ' + money(r.creditSales) + ' vendus à crédit (suivi dans l\'onglet Crédits).</p>' : '') +
      '</div>' +
      '<div class="pl"><h3>Argent encaissé</h3>' +
        ['cash', 'om', 'moov'].map(k => row(PAY[k], r.inBy[k] + r.collectBy[k])).join('') +
        '<div class="pl-row total"><span>Total encaissé</span><span>' + money(r.collected) + '</span></div>' +
        '<p class="info">Ventes payées comptant : ' + money(r.ca - r.creditSales) + ' · Crédits remboursés : ' + money(collected) + '</p></div>' +
      '<div class="pl"><h3>Crédits clients</h3>' +
        row('Vendu à crédit sur la période', r.creditSales) +
        (r.manualCredits ? row('Autres crédits accordés', r.manualCredits) : '') +
        row('Crédits remboursés sur la période', collected) +
        '<div class="pl-row total"><span>Total restant à encaisser (tous clients)</span><span>' + money(crTotal) + '</span></div></div>' +
      '<div class="pl"><h3>Caisse : entrées − sorties (achats + dépenses)</h3>' +
        ['cash', 'om', 'moov'].map(k => row(PAY[k] + ' : ' + money(r.inBy[k] + r.collectBy[k]) + ' − ' + money(r.outBy[k]), r.inBy[k] + r.collectBy[k] - r.outBy[k])).join('') +
        '<p class="info">Achats de boissons sur la période : ' + money(r.achats) + '</p></div>' +
      '<div class="pl"><h3>Produits vendus</h3>' + (prodRows.length
        ? '<div class="table-wrap"><table><thead><tr><th>Produit</th><th>Qté</th><th>Ventes</th><th>Bénéfice</th></tr></thead><tbody>' +
          prodRows.map(p => '<tr><td>' + esc(pname(p.id)) + '</td><td>' + p.qty + '</td><td>' + money(p.ca) + '</td><td class="' + (p.profit < 0 ? 'neg' : 'pos') + '">' + money(p.profit) + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<p class="hint">Aucune vente sur la période.</p>') + '</div>' +
      (depRows.length ? '<div class="pl"><h3>Dépenses par type</h3>' + depRows.map(k => row(esc(k), r.depBy[k])).join('') + '</div>' : '') +
      '<button class="btn block" data-action="share-report">Envoyer ce bilan sur WhatsApp</button>' +
      '<h2>Journal de la période</h2><ul class="list">' +
        (r.moves.length ? r.moves.map(m => moveRow(m, from !== to)).join('') : '<li class="empty">Aucune opération.</li>') + '</ul>';
  }

  function reportText() {
    const [from, to] = rangeFor(period), r = report(from, to);
    const prod = Object.keys(r.prod).sort((a, b) => r.prod[b].qty - r.prod[a].qty).map(id => '• ' + pname(id) + ' : ' + r.prod[id].qty).join('\n');
    return '*' + (state.settings.name || 'Buvette') + ' — Bilan ' + (from === to ? fmtDate(from) : fmtDate(from) + ' au ' + fmtDate(to)) + '*\n' +
      'Ventes : ' + money(r.ca) + ' (' + r.sales + ' ventes)\nCoût des produits : ' + money(r.cogs) + '\nDépenses : ' + money(r.dep) + '\n' +
      (r.pertes ? 'Casse / pertes : ' + money(r.pertes) + '\n' : '') + (r.ecart ? 'Écart inventaire : ' + money(-r.ecart) + '\n' : '') +
      (r.amort ? 'Part installation solaire : ' + money(r.amort) + '\n' : '') +
      '*Bénéfice net : ' + money(r.net) + '*\n\n' +
      'Encaissé — Espèces : ' + money(r.inBy.cash + r.collectBy.cash) + ' · Orange Money : ' + money(r.inBy.om + r.collectBy.om) + ' · Moov Money : ' + money(r.inBy.moov + r.collectBy.moov) +
      (r.creditSales ? '\nVendu à crédit : ' + money(r.creditSales) : '') + (prod ? '\n\nProduits vendus :\n' + prod : '');
  }

  function renderSettings() {
    const st = state.settings;
    $('#setName').value = st.name || ''; $('#setPhone').value = st.phone || ''; $('#setEnergy').value = st.energy;
    $('#setSolarCost').value = st.solarCost || ''; $('#setSolarMonths').value = st.solarMonths || ''; $('#setSolarSaved').value = st.solarSaved || '';
    $('#setDays').value = st.defaultDays; $('#setExtraCats').value = st.extraCats || ''; $('#setTemplate').value = st.template || DEFAULT_TEMPLATE;
    toggleSolar();
  }
  function toggleSolar() { const e = $('#setEnergy').value; $('#solarFields').hidden = !(e === 'solaire' || e === 'mixte'); }

  function showView(name) {
    currentView = name;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    if (name === 'settings') renderSettings();
    renderCart();
    window.scrollTo(0, 0);
  }

  // ---------- Fenêtres ----------
  function openModal(html) { $('#modalContent').innerHTML = html; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; $('#modalContent').innerHTML = ''; }
  function askConfirm(msg, yesLabel, onYes) {
    $('#confirmMsg').textContent = msg;
    const yes = $('#confirmYes'); yes.textContent = yesLabel || 'Confirmer';
    $('#confirmBox').hidden = false;
    yes.onclick = () => { $('#confirmBox').hidden = true; onYes(); };
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function copyText(text, el) {
    const fallback = () => { if (el) { el.focus(); el.select(); } toast('Sélectionnez le texte puis copiez-le'); };
    try { navigator.clipboard.writeText(text).then(() => toast('Copié ✔'), fallback); } catch (e) { fallback(); }
  }
  function offerFile(name, content, type, title) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type }));
      a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { /* téléchargement bloqué : le texte reste disponible */ }
    openModal('<h2>' + esc(title) + '</h2><p class="hint">Si le fichier « ' + esc(name) + ' » ne s\'est pas téléchargé, copiez ce texte et gardez-le (par exemple en vous l\'envoyant sur WhatsApp).</p>' +
      '<textarea id="exportText" class="mono" rows="10" readonly>' + esc(content.replace(/^﻿/, '')) + '</textarea>' +
      '<button class="btn primary block" data-action="copy-export">Copier le texte</button>');
  }
  function openLink(url) {
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  const payOptions = (withCredit) => Object.keys(PAY).filter(k => withCredit || k !== 'credit').map(k => '<option value="' + k + '">' + PAY[k] + '</option>').join('');
  const productOptions = (sel, filter) => state.products.filter(filter || (() => true)).map(p => '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  const clientOptions = sel => state.clients.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(c => {
    const b = clientSummary(c.id).balance;
    return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name) + (b > 0 ? ' — doit ' + money(b) : '') + '</option>';
  }).join('');
  const qtyFields = (prefix, p) => (p.perCrate > 1
    ? '<div class="row"><label>Casiers (de ' + p.perCrate + ')<input name="' + prefix + 'Crates" inputmode="numeric" placeholder="0"></label>' +
      '<label>' + unitOf(p) + ' en plus<input name="' + prefix + 'Bottles" inputmode="numeric" placeholder="0"></label></div>'
    : '<label>Quantité (' + unitOf(p) + ')<input name="' + prefix + 'Bottles" inputmode="numeric" placeholder="0"></label>');
  const clientPicker = sel => '<label>Client<select name="clientId" id="clientPick" required>' +
    (state.clients.length ? '<option value="">— Choisir —</option>' + clientOptions(sel) : '') + '<option value="__new">+ Nouveau client…</option></select></label>' +
    '<div id="newClientFields" hidden><label>Nom du client<input name="newName" placeholder="Ex : Ouédraogo Issa"></label>' +
    '<label>Téléphone (pour les rappels)<input name="newPhone" type="tel" inputmode="tel" placeholder="Ex : 76 00 00 00"></label></div>';
  function wireClientPicker() {
    const sel = $('#clientPick'); if (!sel) return;
    const t = () => { const n = sel.value === '__new'; $('#newClientFields').hidden = !n; $('[name=newName]').required = n; };
    if (!state.clients.length) sel.value = '__new';
    sel.addEventListener('change', t); t();
  }
  function resolveClient(d) {
    if (d.clientId !== '__new') return client(d.clientId);
    const name = String(d.newName || '').trim(); if (!name) return null;
    const c = { id: uid(), name, phone: String(d.newPhone || '').trim(), address: '', note: '', createdAt: new Date().toISOString() };
    state.clients.push(c); return c;
  }

  // ---------- Formulaires : produits & stock ----------
  function productForm(p) {
    const isNew = !p;
    p = p || { name: '', cat: 'biere', source: 'achat', unit: 'btl', perCrate: 12, buy: 0, sell: 0, alert: 12 };
    openModal('<h2>' + (isNew ? 'Nouveau produit' : 'Modifier ' + esc(p.name)) + '</h2><form class="form" id="productForm">' +
      '<input type="hidden" name="id" value="' + esc(p.id || '') + '">' +
      '<label>Nom<input name="name" required value="' + esc(p.name) + '" placeholder="Ex : Brakina 65 cl"></label>' +
      '<label>Provenance<select name="source" id="pfSource">' +
        '<option value="achat"' + (isMade(p) ? '' : ' selected') + '>Acheté (casiers, cartons)</option>' +
        '<option value="fabrication"' + (isMade(p) ? ' selected' : '') + '>Fabriqué sur place (glace, jus, eau…)</option></select></label>' +
      '<div class="row"><label>Catégorie<select name="cat">' +
        [['biere', 'Bière'], ['sucrerie', 'Sucrerie'], ['eau', 'Eau'], ['glace', 'Glace'], ['autre', 'Autre']].map(([v, l]) => '<option value="' + v + '"' + (p.cat === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      '</select></label><label>Unité<input name="unit" value="' + esc(unitOf(p)) + '" placeholder="btl, sachet…"></label></div>' +
      '<div class="only-achat row"><label>Unités par casier<input name="perCrate" inputmode="numeric" value="' + p.perCrate + '"></label>' +
        '<label>Prix d\'achat du casier (F)<input name="crateCost" inputmode="numeric" value="' + (p.buy ? Math.round(p.buy * p.perCrate) : '') + '" placeholder="Ex : 7200"></label></div>' +
      '<p class="hint only-made">Les frais de fabrication (eau, sachets…) se notent dans Dépenses : ils sont déduits du bénéfice.</p>' +
      '<div class="row"><label>Prix de vente unitaire (F)<input name="sell" inputmode="numeric" value="' + (p.sell || '') + '" placeholder="Ex : 700"></label>' +
        '<label>Alerte stock bas (unités)<input name="alert" inputmode="numeric" value="' + p.alert + '"></label></div>' +
      (isNew ? '<p class="hint">Stock que vous avez déjà :</p><div class="row"><label class="only-achat">Réserve (unités)<input name="initReserve" inputmode="numeric" placeholder="0"></label><label>Frigo (unités)<input name="initFridge" inputmode="numeric" placeholder="0"></label></div>' : '') +
      '<button class="btn primary block" type="submit">Enregistrer</button>' +
      (isNew ? '' : '<button class="btn danger block" type="button" data-action="delete-product" data-id="' + p.id + '">Supprimer ce produit</button>') + '</form>');
    const src = $('#pfSource');
    const t = () => { const made = src.value === 'fabrication'; $$('.only-achat').forEach(e => { e.hidden = made; }); $$('.only-made').forEach(e => { e.hidden = !made; }); };
    src.addEventListener('change', () => { t(); const u = $('[name=unit]'); if (src.value === 'fabrication' && u.value === 'btl') u.value = 'sachet'; });
    t();
  }

  function productDetail(id) {
    const p = product(id); if (!p) return;
    const s = computeStocks()[id], made = isMade(p);
    const moves = state.moves.filter(m => m.productId === id || (m.type === 'vente' && m.lines.some(l => l.productId === id)))
      .sort((a, b) => (b.date + b.time + b.createdAt).localeCompare(a.date + a.time + a.createdAt)).slice(0, 15);
    openModal('<h2>' + esc(p.name) + '</h2>' +
      '<div class="stats">' + (made
        ? '<div class="stat"><span>En stock</span><strong>' + fmtQty(s.fridge, p) + '</strong></div><div class="stat"><span>Prix de vente</span><strong>' + money(p.sell) + '</strong></div>'
        : '<div class="stat"><span>Réserve</span><strong>' + fmtQty(s.reserve, p) + '</strong></div><div class="stat"><span>Frigo</span><strong>' + s.fridge + ' ' + unitOf(p) + '</strong></div>' +
          '<div class="stat"><span>Achat / unité</span><strong>' + money(p.buy) + '</strong></div><div class="stat"><span>Vente / unité</span><strong>' + money(p.sell) + '</strong></div>') + '</div>' +
      '<p class="hint">' + (made ? 'Fabriqué sur place.' : 'Bénéfice par unité : <b class="' + (p.sell - p.buy < 0 ? 'neg' : 'pos') + '">' + money(p.sell - p.buy) + '</b> · casier de ' + p.perCrate) + '</p>' +
      '<div class="row">' + (made
        ? '<button class="btn ice" data-action="produce" data-id="' + id + '">🧊 Production</button>'
        : '<button class="btn primary" data-action="restock" data-id="' + id + '">+ Approvisionner</button><button class="btn cold" data-action="load-fridge" data-id="' + id + '">❄ Charger frigo</button>') +
      '<button class="btn" data-action="loss" data-id="' + id + '">Perte / usage</button>' +
      '<button class="btn" data-action="edit-product" data-id="' + id + '">Modifier / prix</button></div>' +
      '<h2>Derniers mouvements</h2><ul class="list">' + (moves.length ? moves.map(m => moveRow(m, true)).join('') : '<li class="empty">Aucun mouvement.</li>') + '</ul>');
  }

  function restockForm(id) {
    const bought = state.products.filter(x => !isMade(x));
    const p = (product(id) && !isMade(product(id))) ? product(id) : bought[0];
    if (!p) { toast('Ajoutez d\'abord un produit acheté'); return; }
    openModal('<h2>Approvisionnement (achat)</h2><form class="form" id="restockForm">' +
      '<label>Produit<select name="productId" id="restockProduct">' + productOptions(p.id, x => !isMade(x)) + '</select></label>' +
      '<div id="restockQty">' + qtyFields('q', p) + '</div>' +
      '<div class="row"><label>Prix d\'achat du casier (F)<input name="crateCost" id="restockCost" inputmode="numeric" value="' + (p.buy ? Math.round(p.buy * p.perCrate) : '') + '" required></label>' +
      '<label>Prix de vente unitaire (F)<input name="sell" id="restockSell" inputmode="numeric" value="' + (p.sell || '') + '"></label></div>' +
      '<div class="row"><label>Payé par<select name="payMode">' + payOptions(false) + '</select></label>' +
      '<label>Date<input type="date" name="date" value="' + today() + '" required></label></div>' +
      '<label>Fournisseur / note<input name="note" placeholder="Ex : dépôt du quartier"></label>' +
      '<p class="hint" id="restockTotal"></p><button class="btn primary block" type="submit">Enregistrer l\'achat</button></form>');
    const sel = $('#restockProduct');
    const upd = () => {
      const f = $('#restockForm'), q = product(sel.value);
      const qty = num(f.qCrates && f.qCrates.value) * q.perCrate + num(f.qBottles.value);
      $('#restockTotal').textContent = qty ? qty + ' ' + unitOf(q) + ' · total ' + money(qty * num(f.crateCost.value) / q.perCrate) : '';
    };
    sel.addEventListener('change', () => {
      const q = product(sel.value);
      $('#restockQty').innerHTML = qtyFields('q', q);
      $('#restockCost').value = q.buy ? Math.round(q.buy * q.perCrate) : ''; $('#restockSell').value = q.sell || '';
      upd();
    });
    $('#restockForm').addEventListener('input', upd);
  }

  function produceForm(id) {
    const made = state.products.filter(isMade);
    if (!made.length) { toast('Ajoutez d\'abord un produit fabriqué (ex. glace)'); return; }
    const p = isMade(product(id)) ? product(id) : made[0];
    openModal('<h2>🧊 Production</h2><p class="hint">Ce que vous venez de fabriquer (sachets de glace, etc.). Les frais (eau, sachets) se notent dans Dépenses.</p>' +
      '<form class="form" id="produceForm"><label>Produit<select name="productId">' + productOptions(p.id, isMade) + '</select></label>' +
      '<div class="row"><label>Quantité fabriquée<input name="qty" inputmode="numeric" required placeholder="Ex : 40"></label>' +
      '<label>Date<input type="date" name="date" value="' + today() + '" required></label></div>' +
      '<button class="btn ice block" type="submit">Enregistrer la production</button></form>');
  }

  function fridgeForm(onlyId) {
    const st = computeStocks();
    const list = onlyId ? [product(onlyId)] : state.products.filter(p => !isMade(p));
    openModal('<h2>❄ Charger le frigo</h2><p class="hint">Indiquez ce que vous sortez de la réserve pour mettre au frigo.</p>' +
      '<form class="form" id="fridgeForm"><div class="load-head"><span>Produit</span><span>Casiers</span><span>Unités</span></div>' +
      list.map(p => '<div class="load-row"><div><b>' + esc(p.name) + '</b><small>Réserve ' + fmtQty(st[p.id].reserve, p) + ' · frigo ' + st[p.id].fridge + '</small></div>' +
        '<input name="c_' + p.id + '" inputmode="numeric" placeholder="0" aria-label="Casiers ' + esc(p.name) + '">' +
        '<input name="b_' + p.id + '" inputmode="numeric" placeholder="0" aria-label="Unités ' + esc(p.name) + '"></div>').join('') +
      '<button class="btn cold block" type="submit">Enregistrer le chargement</button></form>');
  }

  function inventoryForm() {
    const st = computeStocks();
    openModal('<h2>Inventaire (comptage réel)</h2><p class="hint">Comptez et corrigez si besoin. Les différences apparaissent dans le bilan (manquants ou surplus).</p>' +
      '<form class="form" id="inventoryForm"><div class="load-head"><span>Produit</span><span>Réserve</span><span>Frigo</span></div>' +
      state.products.map(p => '<div class="load-row"><div><b>' + esc(p.name) + '</b><small>en ' + unitOf(p) + '</small></div>' +
        (isMade(p) ? '<span class="muted" style="text-align:center">—</span>' : '<input name="r_' + p.id + '" inputmode="numeric" value="' + st[p.id].reserve + '" aria-label="Réserve ' + esc(p.name) + '">') +
        '<input name="f_' + p.id + '" inputmode="numeric" value="' + st[p.id].fridge + '" aria-label="Frigo ' + esc(p.name) + '"></div>').join('') +
      '<button class="btn primary block" type="submit">Valider l\'inventaire</button></form>');
  }

  function lossForm(id) {
    openModal('<h2>Perte / usage interne</h2><form class="form" id="lossForm">' +
      '<label>Produit<select name="productId">' + productOptions(id) + '</select></label>' +
      '<div class="row"><label>Quantité<input name="qty" inputmode="numeric" required placeholder="1"></label>' +
      '<label>Où ?<select name="loc"><option value="fridge">Frigo / congélateur</option><option value="reserve">Réserve</option></select></label></div>' +
      '<label>Raison<select name="reason"><option>Casse</option><option>Périmé / abîmé</option><option>Offert</option><option>Usage à la buvette</option><option>Fondu (glace)</option><option>Autre perte</option></select></label>' +
      '<label>Note<input name="note" placeholder="Facultatif"></label>' +
      '<button class="btn danger block" type="submit">Enregistrer</button></form>');
  }

  // ---------- Formulaires : crédits ----------
  function clientForm(c) {
    c = c || {};
    openModal('<h2>' + (c.id ? 'Modifier le client' : 'Nouveau client') + '</h2><form class="form" id="clientForm">' +
      '<input type="hidden" name="id" value="' + esc(c.id || '') + '">' +
      '<label>Nom complet<input name="name" required value="' + esc(c.name || '') + '" placeholder="Ex : Ouédraogo Aminata"></label>' +
      '<label>Téléphone (WhatsApp / SMS)<input name="phone" type="tel" inputmode="tel" value="' + esc(c.phone || '') + '" placeholder="Ex : 70 12 34 56"></label>' +
      '<label>Quartier / adresse<input name="address" value="' + esc(c.address || '') + '" placeholder="Facultatif"></label>' +
      '<label>Note<input name="note" value="' + esc(c.note || '') + '" placeholder="Facultatif"></label>' +
      '<button class="btn primary block" type="submit">Enregistrer</button></form>');
  }

  function clientDetail(id) {
    const c = client(id); if (!c) return;
    const s = clientSummary(id), msg = buildMessage(c, s);
    const hist = s.moves.slice().reverse();
    openModal('<div class="client-head"><h2 style="padding:0">' + esc(c.name) + '</h2>' +
      '<small class="hint">' + esc([displayPhone(c.phone), c.address].filter(Boolean).join(' · ')) + '</small>' +
      '<div class="big ' + (s.balance > 0 ? 'neg' : 'pos') + '">' + money(s.balance) + '</div>' +
      '<small class="hint">Reste à payer · pris ' + money(s.credit) + ' · payé ' + money(s.paid) +
      (s.dueDate ? '<br>Échéance : ' + fmtDate(s.dueDate) + (s.late ? ' <span class="badge">En retard</span>' : '') : '') + '</small></div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn success" data-action="new-payment" data-id="' + id + '">+ Paiement reçu</button>' +
      '<button class="btn" data-action="new-manual-credit" data-id="' + id + '">+ Crédit</button>' +
      (s.balance > 0 && c.phone
        ? '<a class="btn whatsapp" data-remind="' + id + '" href="' + esc(whatsappUrl(c.phone, msg)) + '" target="_blank" rel="noopener">Rappel WhatsApp</a>' +
          '<a class="btn sms" data-remind="' + id + '" href="' + esc(smsUrl(c.phone, msg)) + '">Rappel SMS</a>' +
          '<button class="btn" style="grid-column:1/-1" data-action="copy-msg" data-id="' + id + '">Copier le message de rappel</button>'
        : '') + '</div>' +
      '<h2>Historique</h2><ul class="list">' + (hist.length ? hist.map(m => moveRow(m, true)).join('') : '<li class="empty">Aucune opération.</li>') + '</ul>' +
      '<div class="row" style="margin-top:12px"><button class="btn" data-action="edit-client" data-id="' + id + '">Modifier</button>' +
      '<button class="btn danger" data-action="delete-client" data-id="' + id + '">Supprimer</button></div>');
  }

  function paymentForm(clientId) {
    if (!state.clients.length) { toast('Aucun client pour le moment'); return; }
    openModal('<h2>Paiement reçu (remboursement de crédit)</h2><form class="form" id="paymentForm">' + clientPicker(clientId) +
      '<div class="row"><label>Montant (F)<input name="amount" inputmode="numeric" required placeholder="Ex : 2000"></label>' +
      '<label>Payé par<select name="payMode">' + payOptions(false) + '</select></label></div>' +
      '<div class="row"><label>Date<input type="date" name="date" value="' + today() + '" required></label><label>Note<input name="note" placeholder="Facultatif"></label></div>' +
      '<button class="btn success block" type="submit">Enregistrer le paiement</button></form>');
    wireClientPicker();
  }

  function manualCreditForm(clientId) {
    openModal('<h2>Crédit hors caisse</h2><p class="hint">Pour un crédit qui ne passe pas par la caisse (ancienne dette, marchandise de la boutique, prêt…). Les ventes de boissons à crédit se font directement dans la caisse avec le bouton « Crédit ».</p>' +
      '<form class="form" id="manualCreditForm">' + clientPicker(clientId) +
      '<label>Montant (F)<input name="amount" inputmode="numeric" required placeholder="Ex : 5000"></label>' +
      '<label>Détail<input name="label" placeholder="Ex : ancienne dette, 1 sac de riz"></label>' +
      '<div class="row"><label>Date<input type="date" name="date" value="' + today() + '" required></label>' +
      '<label>À payer avant le<input type="date" name="dueDate" value="' + addDays(today(), state.settings.defaultDays) + '"></label></div>' +
      '<button class="btn primary block" type="submit">Enregistrer le crédit</button></form>');
    wireClientPicker();
  }

  // ---------- Caisse ----------
  let pendingSale = null;
  function addMove(m) {
    m.id = uid(); m.createdAt = new Date().toISOString();
    m.date = m.date || today(); m.time = m.time || nowTime();
    state.moves.push(m);
    return m;
  }
  function checkout() {
    const ids = Object.keys(cart).filter(id => cart[id] > 0 && product(id));
    if (!ids.length) return;
    const st = computeStocks(), short = [];
    const lines = ids.map(id => {
      const p = product(id), q = cart[id], s = st[id];
      const fromFridge = Math.min(q, Math.max(0, s.fridge)), fromReserve = isMade(p) ? 0 : q - fromFridge;
      const fridgeTake = isMade(p) ? q : fromFridge;
      if (q > Math.max(0, s.fridge) + (isMade(p) ? 0 : Math.max(0, s.reserve))) short.push(p.name + ' (reste ' + Math.max(0, s.fridge + (isMade(p) ? 0 : s.reserve)) + ')');
      return { productId: id, qty: q, price: p.sell, cost: isMade(p) ? 0 : p.buy, fromFridge: fridgeTake, fromReserve };
    });
    const go = () => {
      if (payMode === 'credit') {
        pendingSale = lines;
        const total = lines.reduce((t, l) => t + l.qty * l.price, 0);
        openModal('<h2>Vente à crédit · ' + money(total) + '</h2><form class="form" id="creditSaleForm">' + clientPicker() +
          '<label>À payer avant le<input type="date" name="dueDate" value="' + addDays(today(), state.settings.defaultDays) + '"></label>' +
          '<button class="btn primary block" type="submit">Enregistrer le crédit</button></form>');
        wireClientPicker();
      } else commitSale(lines, null, null);
    };
    if (short.length) askConfirm('Stock insuffisant : ' + short.join(', ') + '. Avez-vous oublié un approvisionnement ou une production ? Vendre quand même ?', 'Vendre quand même', go);
    else go();
  }
  function commitSale(lines, clientId, dueDate) {
    const total = lines.reduce((t, l) => t + l.qty * l.price, 0);
    addMove({ type: 'vente', lines, payMode, total, clientId: clientId || undefined, dueDate: dueDate || undefined });
    const fromRes = lines.some(l => l.fromReserve > 0);
    cart = {}; save();
    toast('Vente enregistrée : ' + money(total) + ' (' + (clientId ? 'crédit · ' + cname(clientId) : PAY[payMode]) + ')' + (fromRes ? ' · complété depuis la réserve' : ''));
    payMode = 'cash'; pendingSale = null; render();
  }

  function restoreFrom(text) {
    let d;
    try { d = JSON.parse(text); if (!d || !Array.isArray(d.products) || !Array.isArray(d.moves)) throw 0; }
    catch (e) { toast('Sauvegarde invalide'); return; }
    askConfirm('Remplacer les données actuelles par cette sauvegarde (' + d.products.length + ' produits, ' + (d.clients || []).length + ' clients, ' + d.moves.length + ' opérations) ?', 'Restaurer', () => {
      state = normalize(d); cart = {}; save(); render(); closeModal(); toast('Sauvegarde restaurée');
    });
  }
  function exportCsv() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Date', 'Heure', 'Opération', 'Détail', 'Montant (F)', 'Paiement'].map(q).join(';')];
    state.moves.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).forEach(m => {
      const x = moveText(m);
      lines.push([fmtDate(m.date), m.time, x.t, x.d, x.a == null ? '' : Math.round(x.a), x.pay ? PAY[x.pay] : ''].map(q).join(';'));
    });
    lines.push('');
    lines.push(['Client', 'Téléphone', 'Total pris', 'Total payé', 'Reste à payer', 'Échéance'].map(q).join(';'));
    state.clients.forEach(c => { const s = clientSummary(c.id); lines.push([c.name, displayPhone(c.phone), s.credit, s.paid, s.balance, s.dueDate ? fmtDate(s.dueDate) : ''].map(q).join(';')); });
    offerFile('caisse-journal-' + today() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8', 'Journal (Excel / CSV)');
  }

  function setupWizard() {
    openModal('<h2>Bienvenue 👋</h2><p class="hint">Trois questions pour régler l\'application à votre commerce. Tout reste modifiable dans les réglages (⚙️).</p>' +
      '<form class="form" id="setupForm">' +
      '<label>Nom de votre commerce<input name="name" required placeholder="Ex : Buvette Le Baobab"></label>' +
      '<label>Votre numéro Orange Money / Moov Money<input name="phone" type="tel" inputmode="tel" placeholder="Ex : 70 12 34 56"></label>' +
      '<label>Votre source d\'énergie<select name="energy">' + Object.keys(ENERGY).map(k => '<option value="' + k + '">' + ENERGY[k] + '</option>').join('') + '</select></label>' +
      '<label class="choice"><input type="checkbox" name="ice" checked> Je fabrique et vends de la glace</label>' +
      '<button class="btn primary block" type="submit">Commencer</button></form>');
  }

  // ---------- Événements ----------
  document.addEventListener('click', e => {
    const remind = e.target.closest('[data-remind]');
    if (remind) { const c = client(remind.dataset.remind); if (c) { c.lastReminderAt = today(); save(); setTimeout(render, 300); } return; }
    const add = e.target.closest('[data-add]');
    if (add) {
      const p = product(add.dataset.add);
      if (p && !p.sell) { productForm(p); toast('Indiquez d\'abord le prix de vente'); return; }
      cart[add.dataset.add] = (cart[add.dataset.add] || 0) + 1; renderSell(computeStocks()); return;
    }
    const dec = e.target.closest('[data-dec]');
    if (dec) { const id = dec.dataset.dec; cart[id] = Math.max(0, (cart[id] || 0) - 1); if (!cart[id]) delete cart[id]; renderSell(computeStocks()); return; }
    const pm = e.target.closest('[data-pay]');
    if (pm) { payMode = pm.dataset.pay; renderCart(); return; }
    const tab = e.target.closest('.tab');
    if (tab) { showView(tab.dataset.view); return; }
    const chip = e.target.closest('[data-period]');
    if (chip) {
      period = chip.dataset.period;
      $$('.chip').forEach(c => c.classList.toggle('active', c === chip));
      $('#customRange').hidden = period !== 'custom';
      if (period === 'custom' && !$('#rangeFrom').value) { $('#rangeFrom').value = today().slice(0, 8) + '01'; $('#rangeTo').value = today(); }
      renderReport(); return;
    }
    const el = e.target.closest('[data-action]');
    if (el) {
      const a = el.dataset.action, id = el.dataset.id;
      if (a === 'close-modal') closeModal();
      else if (a === 'close-confirm') $('#confirmBox').hidden = true;
      else if (a === 'open-settings') showView('settings');
      else if (a === 'clear-cart') { cart = {}; renderSell(computeStocks()); }
      else if (a === 'checkout') checkout();
      else if (a === 'new-product') productForm();
      else if (a === 'edit-product') productForm(product(id));
      else if (a === 'restock') restockForm(id);
      else if (a === 'produce') produceForm(id);
      else if (a === 'load-fridge') fridgeForm(id);
      else if (a === 'inventory') inventoryForm();
      else if (a === 'loss') lossForm(id);
      else if (a === 'new-client') clientForm();
      else if (a === 'edit-client') clientForm(client(id));
      else if (a === 'new-payment') paymentForm(id);
      else if (a === 'new-manual-credit') manualCreditForm(id);
      else if (a === 'copy-msg') { const c = client(id); if (c) { copyText(buildMessage(c, clientSummary(id))); c.lastReminderAt = today(); save(); renderCredits(); } }
      else if (a === 'delete-product') {
        const p = product(id);
        askConfirm('Supprimer « ' + p.name + ' » ? Les ventes passées restent dans les bilans.', 'Supprimer', () => {
          state.products = state.products.filter(x => x.id !== id); delete cart[id]; save(); render(); closeModal(); toast('Produit supprimé');
        });
      } else if (a === 'delete-client') {
        const c = client(id), s = clientSummary(id);
        askConfirm('Supprimer ' + c.name + (s.balance > 0 ? ' (il doit encore ' + money(s.balance) + ')' : '') + ' ? Ses ventes restent dans les bilans, mais son crédit ne sera plus suivi.', 'Supprimer', () => {
          state.clients = state.clients.filter(x => x.id !== id);
          state.moves = state.moves.filter(m => !(m.clientId === id && (m.type === 'credit' || m.type === 'reglement')));
          save(); render(); closeModal(); toast('Client supprimé');
        });
      } else if (a === 'delete-move') {
        const m = state.moves.find(x => x.id === id); if (!m) return;
        const x = moveText(m);
        askConfirm('Annuler « ' + x.t + (x.d ? ' : ' + x.d : '') + ' » ? Le stock, les crédits et les bilans seront corrigés.', 'Annuler l\'opération', () => {
          state.moves = state.moves.filter(y => y.id !== id); save(); render();
          if (!$('#modal').hidden) { if (m.clientId && client(m.clientId)) clientDetail(m.clientId); else if (m.productId) productDetail(m.productId); else closeModal(); }
          toast('Opération annulée');
        });
      } else if (a === 'share-report') {
        openLink('https://wa.me/?text=' + encodeURIComponent(reportText()));
        openModal('<h2>Bilan à envoyer</h2><p class="hint">Si WhatsApp ne s\'ouvre pas, copiez le texte et collez-le dans une discussion.</p><textarea id="exportText" rows="12" readonly>' + esc(reportText()) + '</textarea><button class="btn primary block" data-action="copy-export">Copier le bilan</button>');
      } else if (a === 'copy-export') copyText($('#exportText').value, $('#exportText'));
      else if (a === 'export') offerFile('sauvegarde-caisse-' + today() + '.json', JSON.stringify(state), 'application/json', 'Sauvegarde');
      else if (a === 'export-csv') exportCsv();
      else if (a === 'paste-backup') openModal('<h2>Restaurer depuis un texte</h2><p class="hint">Collez le texte de sauvegarde copié auparavant.</p><textarea id="pasteText" class="mono" rows="10"></textarea><button class="btn primary block" data-action="restore-paste">Restaurer</button>');
      else if (a === 'restore-paste') restoreFrom($('#pasteText').value);
      else if (a === 'reset') askConfirm('Effacer TOUTES les données (produits, ventes, stock, crédits, dépenses) ? Faites d\'abord une sauvegarde. Action définitive.', 'Tout effacer', () => {
        state = defaultState(); cart = {}; save(); render(); renderSettings(); toast('Données effacées'); setupWizard();
      });
      return;
    }
    const prow = e.target.closest('[data-product]');
    if (prow) { productDetail(prow.dataset.product); return; }
    const crow = e.target.closest('[data-client]');
    if (crow) clientDetail(crow.dataset.client);
  });

  document.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, formId = f.getAttribute('id');
    const d = Object.fromEntries(new FormData(f).entries());

    if (formId === 'productForm') {
      const made = d.source === 'fabrication';
      const perCrate = made ? 1 : Math.max(1, num(d.perCrate));
      let p = d.id ? product(d.id) : null; const isNew = !p;
      if (isNew) { p = { id: uid() }; state.products.push(p); }
      Object.assign(p, { name: d.name.trim(), cat: d.cat, source: d.source, unit: (d.unit || '').trim() || (made ? 'sachet' : 'btl'),
        perCrate, buy: made ? 0 : num(d.crateCost) / perCrate, sell: num(d.sell), alert: num(d.alert) });
      if (isNew && (num(d.initReserve) || num(d.initFridge))) addMove({ type: 'inventaire', initial: true, productId: p.id, reserveDelta: made ? 0 : num(d.initReserve), fridgeDelta: num(d.initFridge), cost: p.buy });
      save(); render(); productDetail(p.id); toast('Produit enregistré');
    } else if (formId === 'restockForm') {
      const p = product(d.productId), qty = num(d.qCrates) * p.perCrate + num(d.qBottles);
      if (!qty) { toast('Indiquez la quantité achetée'); return; }
      const unitCost = num(d.crateCost) / p.perCrate;
      p.buy = unitCost; if (num(d.sell)) p.sell = num(d.sell);
      addMove({ type: 'achat', productId: p.id, qty, unitCost, payMode: d.payMode, date: d.date, note: (d.note || '').trim() });
      save(); render(); closeModal(); toast(p.name + ' : ' + fmtQty(qty, p) + ' ajouté(s) à la réserve');
    } else if (formId === 'produceForm') {
      const p = product(d.productId), qty = num(d.qty);
      if (!qty) { toast('Indiquez la quantité fabriquée'); return; }
      addMove({ type: 'production', productId: p.id, qty, date: d.date });
      save(); render(); closeModal(); toast(fmtQty(qty, p) + ' de ' + p.name + ' ajouté(s)');
    } else if (formId === 'fridgeForm') {
      let n = 0;
      state.products.forEach(p => {
        if (!(('c_' + p.id) in d)) return;
        const qty = num(d['c_' + p.id]) * p.perCrate + num(d['b_' + p.id]);
        if (qty > 0) { addMove({ type: 'frigo', productId: p.id, qty }); n += qty; }
      });
      if (!n) { toast('Aucune quantité saisie'); return; }
      save(); render(); closeModal(); toast(n + ' unité(s) mise(s) au frigo');
    } else if (formId === 'inventoryForm') {
      const st = computeStocks(); let changed = 0;
      state.products.forEach(p => {
        const rd = isMade(p) ? 0 : num(d['r_' + p.id]) - st[p.id].reserve, fd = num(d['f_' + p.id]) - st[p.id].fridge;
        if (rd || fd) { addMove({ type: 'inventaire', productId: p.id, reserveDelta: rd, fridgeDelta: fd, cost: p.buy }); changed++; }
      });
      save(); render(); closeModal(); toast(changed ? changed + ' produit(s) corrigé(s)' : 'Inventaire conforme, rien à corriger');
    } else if (formId === 'lossForm') {
      const p = product(d.productId), qty = num(d.qty);
      if (!qty) { toast('Indiquez la quantité'); return; }
      addMove({ type: 'perte', productId: p.id, qty, loc: isMade(p) ? 'fridge' : d.loc, cost: p.buy, reason: d.reason, note: (d.note || '').trim() });
      save(); render(); closeModal(); toast('Enregistré');
    } else if (formId === 'expenseForm') {
      const amount = num(d.amount);
      if (!amount) { toast('Montant invalide'); return; }
      addMove({ type: 'depense', category: d.category, label: (d.label || '').trim(), amount, payMode: d.payMode, date: d.date });
      $('#expAmount').value = ''; $('#expLabel').value = ''; $('#expDate').value = today();
      save(); render(); toast('Dépense enregistrée');
    } else if (formId === 'clientForm') {
      let c = d.id ? client(d.id) : null;
      if (!c) { c = { id: uid(), createdAt: new Date().toISOString() }; state.clients.push(c); }
      Object.assign(c, { name: d.name.trim(), phone: d.phone.trim(), address: d.address.trim(), note: d.note.trim() });
      save(); render(); clientDetail(c.id); toast('Client enregistré');
    } else if (formId === 'creditSaleForm') {
      const c = resolveClient(d);
      if (!c || !pendingSale) { toast('Choisissez un client'); return; }
      closeModal(); commitSale(pendingSale, c.id, d.dueDate || addDays(today(), state.settings.defaultDays));
    } else if (formId === 'paymentForm') {
      const c = resolveClient(d), amount = num(d.amount);
      if (!c) { toast('Choisissez un client'); return; }
      if (!amount) { toast('Montant invalide'); return; }
      const bal = clientSummary(c.id).balance;
      const go = () => { addMove({ type: 'reglement', clientId: c.id, amount, payMode: d.payMode, date: d.date, note: (d.note || '').trim() }); save(); render(); clientDetail(c.id); toast('Paiement enregistré'); };
      if (amount > bal) askConfirm('Ce paiement (' + money(amount) + ') dépasse ce que doit ' + c.name + ' (' + money(bal) + '). Enregistrer quand même ?', 'Enregistrer', go);
      else go();
    } else if (formId === 'manualCreditForm') {
      const c = resolveClient(d), amount = num(d.amount);
      if (!c) { toast('Choisissez un client'); return; }
      if (!amount) { toast('Montant invalide'); return; }
      addMove({ type: 'credit', clientId: c.id, amount, label: (d.label || '').trim(), date: d.date, dueDate: d.dueDate });
      save(); render(); clientDetail(c.id); toast('Crédit enregistré');
    } else if (formId === 'settingsForm') {
      Object.assign(state.settings, {
        name: d.name.trim() || 'Ma Buvette', phone: d.phone.trim(), energy: d.energy,
        solarCost: num(d.solarCost), solarMonths: num(d.solarMonths), solarSaved: num(d.solarSaved),
        defaultDays: num(d.defaultDays), extraCats: d.extraCats.trim(), template: d.template.trim() || DEFAULT_TEMPLATE
      });
      save(); render(); toast('Réglages enregistrés');
    } else if (formId === 'setupForm') {
      Object.assign(state.settings, { name: d.name.trim() || 'Ma Buvette', phone: (d.phone || '').trim(), energy: d.energy });
      if (!d.ice) state.products = state.products.filter(p => p.id !== 'glace');
      save(); render(); closeModal();
      toast('C\'est prêt ! Mettez maintenant vos prix dans l\'onglet Stock.');
    }
  });

  $('#clientSearch').addEventListener('input', renderCredits);
  $('#clientFilter').addEventListener('change', renderCredits);
  $('#setEnergy').addEventListener('change', toggleSolar);
  $('#rangeFrom').addEventListener('change', renderReport);
  $('#rangeTo').addEventListener('change', renderReport);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#confirmBox').hidden) $('#confirmBox').hidden = true; else closeModal();
  });
  $('#importFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { e.target.value = ''; restoreFrom(reader.result); };
    reader.readAsText(file);
  });
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  if (!fresh) save(); // enregistre tout de suite les données récupérées des anciennes applications
  render();
  if (fresh) setupWizard();
})();
