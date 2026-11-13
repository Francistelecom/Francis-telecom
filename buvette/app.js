/* Ma Buvette — stock (réserve + frigo), ventes, dépenses et bénéfices.
 * Données stockées localement sur l'appareil (localStorage). Aucun serveur requis.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'ma-buvette-v1';
  const PAY = { cash: 'Espèces', om: 'Orange Money', moov: 'Moov Money' };

  // Liste de départ : noms et tailles de casier modifiables, prix à remplir par le gérant.
  const DEFAULT_PRODUCTS = [
    ['Brakina 65 cl', 'biere', 12], ['Brakina 33 cl', 'biere', 24], ['So.b.bra', 'biere', 12],
    ['Castel', 'biere', 12], ['Flag', 'biere', 12], ['Guinness', 'biere', 24], ['Beaufort', 'biere', 24],
    ['Coca-Cola', 'sucrerie', 24], ['Fanta', 'sucrerie', 24], ['Sprite', 'sucrerie', 24], ['Eau minérale', 'eau', 12]
  ];

  // ---------- État ----------
  let state = load();
  let cart = {};          // { productId: quantité }
  let payMode = 'cash';
  let period = 'today';

  function defaultState() {
    return {
      settings: { name: 'Ma Buvette' },
      products: DEFAULT_PRODUCTS.map(([name, cat, perCrate], i) => ({
        id: 'p' + i, name, cat, perCrate, buy: 0, sell: 0, alert: perCrate
      })),
      moves: []
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const d = JSON.parse(raw);
      return {
        settings: Object.assign(defaultState().settings, d.settings || {}),
        products: Array.isArray(d.products) ? d.products : [],
        moves: Array.isArray(d.moves) ? d.moves : []
      };
    } catch (e) { return defaultState(); }
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
  const num = s => Math.max(0, Math.round(Number(String(s == null ? '' : s).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0));
  function money(n) {
    const v = Math.round(Number(n) || 0);
    return (v < 0 ? '−' : '') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' F';
  }
  const pad = n => (n < 10 ? '0' : '') + n;
  const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => isoDate(new Date());
  const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtDate = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
  function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
  const product = id => state.products.find(p => p.id === id);
  const pname = id => (product(id) || { name: '(boisson supprimée)' }).name;

  // "2 cs + 5 btl" — affichage casiers / bouteilles
  function fmtQty(n, perCrate) {
    n = Math.round(n);
    const neg = n < 0; let a = Math.abs(n);
    if (!perCrate || perCrate <= 1 || a < perCrate) return (neg ? '−' : '') + a + ' btl';
    const c = Math.floor(a / perCrate), b = a % perCrate;
    return (neg ? '−' : '') + c + ' cs' + (b ? ' + ' + b + ' btl' : '') ;
  }

  // ---------- Stock ----------
  function computeStocks() {
    const s = {};
    state.products.forEach(p => { s[p.id] = { reserve: 0, fridge: 0 }; });
    state.moves.forEach(m => {
      const t = s[m.productId];
      if (m.type === 'achat' && t) t.reserve += m.qty;
      else if (m.type === 'frigo' && t) { t.reserve -= m.qty; t.fridge += m.qty; }
      else if (m.type === 'perte' && t) t[m.loc === 'reserve' ? 'reserve' : 'fridge'] -= m.qty;
      else if (m.type === 'inventaire' && t) { t.reserve += m.reserveDelta || 0; t.fridge += m.fridgeDelta || 0; }
      else if (m.type === 'vente') m.lines.forEach(l => {
        const x = s[l.productId];
        if (x) { x.fridge -= l.fromFridge; x.reserve -= l.fromReserve; }
      });
    });
    return s;
  }
  const isLow = (p, st) => p.sell > 0 && p.alert > 0 && (st.reserve + st.fridge) <= p.alert;

  // ---------- Bilan ----------
  function rangeFor(key) {
    const t = today();
    if (key === 'today') return [t, t];
    if (key === 'yesterday') { const y = addDays(t, -1); return [y, y]; }
    if (key === 'week') return [addDays(t, -6), t];
    if (key === 'month') return [t.slice(0, 8) + '01', t];
    if (key === 'lastmonth') {
      const d = new Date(t.slice(0, 8) + '01T12:00:00'); d.setDate(0);
      const end = isoDate(d); return [end.slice(0, 8) + '01', end];
    }
    const f = $('#rangeFrom').value || t, to = $('#rangeTo').value || t;
    return f <= to ? [f, to] : [to, f];
  }

  function report(from, to) {
    const r = {
      ca: 0, cogs: 0, sales: 0, dep: 0, pertes: 0, ecart: 0, achats: 0,
      inBy: { cash: 0, om: 0, moov: 0 }, outBy: { cash: 0, om: 0, moov: 0 },
      depBy: {}, prod: {}, moves: []
    };
    state.moves.forEach(m => {
      if (m.date < from || m.date > to) return;
      r.moves.push(m);
      if (m.type === 'vente') {
        r.sales++; r.ca += m.total; r.inBy[m.payMode] += m.total;
        m.lines.forEach(l => {
          const c = l.qty * l.cost; r.cogs += c;
          const p = r.prod[l.productId] || (r.prod[l.productId] = { qty: 0, ca: 0, profit: 0 });
          p.qty += l.qty; p.ca += l.qty * l.price; p.profit += l.qty * l.price - c;
        });
      } else if (m.type === 'depense') {
        r.dep += m.amount; r.outBy[m.payMode] += m.amount;
        r.depBy[m.category] = (r.depBy[m.category] || 0) + m.amount;
      } else if (m.type === 'achat') {
        const v = m.qty * m.unitCost; r.achats += v; r.outBy[m.payMode] += v;
      } else if (m.type === 'perte') {
        r.pertes += m.qty * m.cost;
      } else if (m.type === 'inventaire' && !m.initial) {
        r.ecart += -((m.reserveDelta || 0) + (m.fridgeDelta || 0)) * (m.cost || 0);
      }
    });
    r.brut = r.ca - r.cogs;
    r.net = r.brut - r.dep - r.pertes - r.ecart;
    r.moves.sort((a, b) => (b.date + b.time + b.createdAt).localeCompare(a.date + a.time + a.createdAt));
    return r;
  }

  function moveText(m) {
    const p = product(m.productId);
    const pc = p ? p.perCrate : 1;
    switch (m.type) {
      case 'vente': return { t: 'Vente', d: m.lines.map(l => l.qty + ' ' + pname(l.productId)).join(', '), a: m.total, pay: m.payMode };
      case 'achat': return { t: 'Approvisionnement', d: pname(m.productId) + ' · ' + fmtQty(m.qty, pc) + (m.note ? ' · ' + m.note : ''), a: -m.qty * m.unitCost, pay: m.payMode };
      case 'frigo': return { t: 'Chargement frigo', d: pname(m.productId) + ' · ' + fmtQty(m.qty, pc) };
      case 'perte': return { t: 'Casse / perte', d: pname(m.productId) + ' · ' + m.qty + ' btl (' + (m.loc === 'reserve' ? 'réserve' : 'frigo') + ')' + (m.note ? ' · ' + m.note : ''), a: -m.qty * m.cost };
      case 'inventaire': {
        const parts = [];
        if (m.reserveDelta) parts.push('réserve ' + (m.reserveDelta > 0 ? '+' : '') + m.reserveDelta);
        if (m.fridgeDelta) parts.push('frigo ' + (m.fridgeDelta > 0 ? '+' : '') + m.fridgeDelta);
        return { t: m.initial ? 'Stock de départ' : 'Inventaire', d: pname(m.productId) + ' · ' + parts.join(', ') + ' btl' };
      }
      case 'depense': return { t: 'Dépense', d: m.category + (m.label ? ' · ' + m.label : ''), a: -m.amount, pay: m.payMode };
    }
    return { t: m.type, d: '' };
  }
  function moveRow(m, showDate) {
    const x = moveText(m);
    return '<li class="item"><div class="item-main"><b>' + esc(x.t) + (x.pay ? ' <span class="tag ' + x.pay + '">' + PAY[x.pay] + '</span>' : '') + '</b>' +
      '<small>' + esc(x.d) + '</small><small>' + (showDate ? fmtDate(m.date) + ' · ' : '') + esc(m.time || '') + '</small></div>' +
      (x.a != null ? '<div class="amount ' + (x.a >= 0 ? 'pos' : 'neg') + '">' + (x.a > 0 ? '+' : '') + money(x.a) + '</div>' : '') +
      '<button class="icon-btn" title="Annuler cette opération" data-action="delete-move" data-id="' + m.id + '">🗑️</button></li>';
  }

  // ---------- Rendu ----------
  function render() {
    $('#barTitle').textContent = state.settings.name || 'Ma Buvette';
    const st = computeStocks();
    renderSell(st);
    renderStock(st);
    renderExpenses();
    renderReport();
    const low = state.products.filter(p => isLow(p, st[p.id])).length;
    $('#stockBadge').hidden = !low; $('#stockBadge').textContent = low;
  }

  function renderSell(st) {
    const r = report(today(), today());
    $('#todaySales').textContent = money(r.ca);
    $('#todayProfit').textContent = money(r.brut);
    $('#todayMobile').textContent = money(r.inBy.om + r.inBy.moov);

    $('#productGrid').innerHTML = state.products.map(p => {
      const s = st[p.id], q = cart[p.id] || 0;
      const fr = s.fridge;
      return '<button class="pbtn' + (q ? ' in-cart' : '') + (p.sell ? '' : ' noprice') + '" data-add="' + p.id + '">' +
        (q ? '<span class="qty">' + q + '</span>' : '') +
        '<b>' + esc(p.name) + '</b>' +
        '<span class="price">' + (p.sell ? money(p.sell) : 'Prix ?') + '</span>' +
        '<small class="' + (fr <= 0 ? 'low' : '') + '">' + (fr <= 0 ? 'Frigo vide' : '❄ ' + fr) + '</small></button>';
    }).join('') || '<p class="empty">Aucune boisson. Ajoutez-en dans l\'onglet Stock.</p>';

    const sales = r.moves.filter(m => m.type === 'vente');
    $('#todayList').innerHTML = sales.length ? sales.map(m => moveRow(m)).join('') : '<li class="empty">Aucune vente aujourd\'hui.</li>';
    renderCart();
  }

  function renderCart() {
    const ids = Object.keys(cart).filter(id => cart[id] > 0 && product(id));
    $('#cart').hidden = !ids.length;
    document.body.classList.toggle('has-cart', ids.length > 0);
    let total = 0;
    $('#cartLines').innerHTML = ids.map(id => {
      const p = product(id), t = p.sell * cart[id]; total += t;
      return '<li><button class="step" data-dec="' + id + '" aria-label="Retirer">−</button><b>' + cart[id] + '</b>' +
        '<button class="step" data-add="' + id + '" aria-label="Ajouter">+</button>' +
        '<span class="n">' + esc(p.name) + '</span><span class="t">' + money(t) + '</span></li>';
    }).join('');
    $('#cartTotal').textContent = money(total);
    $$('.pm').forEach(b => b.classList.toggle('active', b.dataset.pay === payMode));
  }

  function renderStock(st) {
    let value = 0, margin = 0;
    $('#stockList').innerHTML = state.products.map(p => {
      const s = st[p.id], tot = s.reserve + s.fridge;
      value += Math.max(0, tot) * p.buy; margin += Math.max(0, tot) * (p.sell - p.buy);
      const warn = !p.sell || !p.buy ? '<span class="badge warn">Prix à remplir</span>' : '';
      return '<li class="item clickable" data-product="' + p.id + '"><div class="item-main"><b>' + esc(p.name) +
        (isLow(p, s) ? '<span class="badge">Stock bas</span>' : '') + warn + '</b>' +
        '<div class="locs"><span class="loc">Réserve : ' + fmtQty(s.reserve, p.perCrate) + '</span>' +
        '<span class="loc fridge">Frigo : ' + s.fridge + ' btl</span></div></div>' +
        '<div class="amount">' + fmtQty(tot, p.perCrate) + '<br><small class="muted">' + tot + ' btl</small></div></li>';
    }).join('') || '<li class="empty">Aucune boisson.</li>';
    $('#stockValue').textContent = money(value);
    $('#stockMargin').textContent = money(margin);
  }

  function renderExpenses() {
    if (!$('#expDate').value) $('#expDate').value = today();
    const ym = today().slice(0, 7);
    const list = state.moves.filter(m => m.type === 'depense' && m.date.slice(0, 7) === ym)
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    const tot = list.reduce((s, m) => s + m.amount, 0);
    $('#expMonthTotal').textContent = list.length ? '· ' + money(tot) : '';
    $('#expenseList').innerHTML = list.length ? list.map(m => moveRow(m, true)).join('') : '<li class="empty">Aucune dépense ce mois-ci.</li>';
  }

  function renderReport() {
    const [from, to] = rangeFor(period);
    const r = report(from, to);
    const row = (label, v, cls) => '<div class="pl-row ' + (cls || '') + '"><span>' + label + '</span><span class="' + (v < 0 ? 'neg' : '') + '">' + money(v) + '</span></div>';
    const prodRows = Object.keys(r.prod).map(id => Object.assign({ id }, r.prod[id])).sort((a, b) => b.qty - a.qty);
    const depRows = Object.keys(r.depBy).sort((a, b) => r.depBy[b] - r.depBy[a]);
    const label = from === to ? fmtDate(from) : fmtDate(from) + ' → ' + fmtDate(to);

    $('#report').innerHTML =
      '<p class="hint">Période : <b>' + label + '</b> · ' + r.sales + ' vente(s)</p>' +
      '<div class="pl"><h3>Résultat</h3>' +
        row('Ventes (chiffre d\'affaires)', r.ca) +
        row('− Coût d\'achat des boissons vendues', -r.cogs) +
        row('= Bénéfice sur les boissons', r.brut) +
        row('− Dépenses', -r.dep) +
        (r.pertes ? row('− Casse / pertes', -r.pertes) : '') +
        (r.ecart ? row(r.ecart > 0 ? '− Manquants à l\'inventaire' : '+ Surplus à l\'inventaire', -r.ecart) : '') +
        '<div class="pl-row total"><span>Bénéfice net</span><span class="' + (r.net < 0 ? 'neg' : 'pos') + '">' + money(r.net) + '</span></div>' +
      '</div>' +
      '<div class="pl"><h3>Argent encaissé (ventes)</h3>' +
        row('Espèces', r.inBy.cash) + row('Orange Money', r.inBy.om) + row('Moov Money', r.inBy.moov) +
        '<div class="pl-row total"><span>Total encaissé</span><span>' + money(r.ca) + '</span></div></div>' +
      '<div class="pl"><h3>Caisse : entrées − sorties (achats + dépenses)</h3>' +
        ['cash', 'om', 'moov'].map(k => row(PAY[k] + ' : ' + money(r.inBy[k]) + ' − ' + money(r.outBy[k]), r.inBy[k] - r.outBy[k])).join('') +
        '<p class="hint">Achats de boissons sur la période : ' + money(r.achats) + '</p></div>' +
      '<div class="pl"><h3>Boissons vendues</h3>' + (prodRows.length
        ? '<div class="table-wrap"><table><thead><tr><th>Boisson</th><th>Qté</th><th>Ventes</th><th>Bénéfice</th></tr></thead><tbody>' +
          prodRows.map(p => '<tr><td>' + esc(pname(p.id)) + '</td><td>' + p.qty + '</td><td>' + money(p.ca) + '</td><td class="' + (p.profit < 0 ? 'neg' : 'pos') + '">' + money(p.profit) + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<p class="hint">Aucune vente sur la période.</p>') + '</div>' +
      (depRows.length ? '<div class="pl"><h3>Dépenses par type</h3>' + depRows.map(k => row(esc(k), r.depBy[k])).join('') + '</div>' : '') +
      '<button class="btn block" data-action="share-report">Envoyer ce bilan sur WhatsApp</button>' +
      '<h2>Journal de la période</h2><ul class="list">' +
        (r.moves.length ? r.moves.map(m => moveRow(m, from !== to)).join('') : '<li class="empty">Aucune opération.</li>') + '</ul>';
  }

  function reportText() {
    const [from, to] = rangeFor(period);
    const r = report(from, to);
    const prod = Object.keys(r.prod).sort((a, b) => r.prod[b].qty - r.prod[a].qty)
      .map(id => '• ' + pname(id) + ' : ' + r.prod[id].qty + ' btl').join('\n');
    return '*' + (state.settings.name || 'Buvette') + ' — Bilan ' + (from === to ? fmtDate(from) : fmtDate(from) + ' au ' + fmtDate(to)) + '*\n' +
      'Ventes : ' + money(r.ca) + ' (' + r.sales + ' ventes)\n' +
      'Coût des boissons : ' + money(r.cogs) + '\n' +
      'Dépenses : ' + money(r.dep) + '\n' +
      (r.pertes ? 'Casse : ' + money(r.pertes) + '\n' : '') +
      (r.ecart ? 'Écart inventaire : ' + money(-r.ecart) + '\n' : '') +
      '*Bénéfice net : ' + money(r.net) + '*\n\n' +
      'Espèces : ' + money(r.inBy.cash) + '\nOrange Money : ' + money(r.inBy.om) + '\nMoov Money : ' + money(r.inBy.moov) +
      (prod ? '\n\nBoissons vendues :\n' + prod : '');
  }

  function showView(name) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    $('#cart').hidden = name !== 'sell' || !Object.keys(cart).some(k => cart[k] > 0);
    document.body.classList.toggle('has-cart', !$('#cart').hidden);
    if (name === 'settings') $('#setName').value = state.settings.name || '';
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
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
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

  const productOptions = sel => state.products.map(p => '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  const qtyFields = (prefix, perCrate) =>
    '<div class="row"><label>Casiers' + (perCrate > 1 ? ' (de ' + perCrate + ')' : '') + '<input name="' + prefix + 'Crates" inputmode="numeric" placeholder="0"></label>' +
    '<label>Bouteilles en plus<input name="' + prefix + 'Bottles" inputmode="numeric" placeholder="0"></label></div>';

  function productForm(p) {
    const isNew = !p; p = p || { name: '', cat: 'biere', perCrate: 12, buy: 0, sell: 0, alert: 12 };
    openModal('<h2>' + (isNew ? 'Nouvelle boisson' : 'Modifier ' + esc(p.name)) + '</h2><form class="form" id="productForm">' +
      '<input type="hidden" name="id" value="' + esc(p.id || '') + '">' +
      '<label>Nom<input name="name" required value="' + esc(p.name) + '" placeholder="Ex : Brakina 65 cl"></label>' +
      '<div class="row"><label>Catégorie<select name="cat">' +
        [['biere', 'Bière'], ['sucrerie', 'Sucrerie'], ['eau', 'Eau'], ['autre', 'Autre']].map(([v, l]) => '<option value="' + v + '"' + (p.cat === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      '</select></label><label>Bouteilles par casier<input name="perCrate" inputmode="numeric" required value="' + p.perCrate + '"></label></div>' +
      '<div class="row"><label>Prix d\'achat du casier (F)<input name="crateCost" inputmode="numeric" value="' + (p.buy ? Math.round(p.buy * p.perCrate) : '') + '" placeholder="Ex : 7200"></label>' +
      '<label>Prix de vente bouteille (F)<input name="sell" inputmode="numeric" value="' + (p.sell || '') + '" placeholder="Ex : 700"></label></div>' +
      '<label>Alerte « stock bas » à partir de (bouteilles)<input name="alert" inputmode="numeric" value="' + p.alert + '"></label>' +
      (isNew ? '<p class="hint">Stock que vous avez déjà :</p><div class="row"><label>Dans la réserve (btl)<input name="initReserve" inputmode="numeric" placeholder="0"></label><label>Dans le frigo (btl)<input name="initFridge" inputmode="numeric" placeholder="0"></label></div>' : '') +
      '<button class="btn primary block" type="submit">Enregistrer</button>' +
      (isNew ? '' : '<button class="btn danger block" type="button" data-action="delete-product" data-id="' + p.id + '">Supprimer cette boisson</button>') +
      '</form>');
  }

  function productDetail(id) {
    const p = product(id); if (!p) return;
    const s = computeStocks()[id];
    const moves = state.moves.filter(m => m.productId === id || (m.type === 'vente' && m.lines.some(l => l.productId === id)))
      .sort((a, b) => (b.date + b.time + b.createdAt).localeCompare(a.date + a.time + a.createdAt)).slice(0, 15);
    openModal('<h2>' + esc(p.name) + '</h2>' +
      '<div class="stats"><div class="stat"><span>Réserve</span><strong>' + fmtQty(s.reserve, p.perCrate) + '</strong></div>' +
      '<div class="stat"><span>Frigo</span><strong>' + s.fridge + ' btl</strong></div>' +
      '<div class="stat"><span>Achat / bouteille</span><strong>' + money(p.buy) + '</strong></div>' +
      '<div class="stat"><span>Vente / bouteille</span><strong>' + money(p.sell) + '</strong></div></div>' +
      '<p class="hint">Bénéfice par bouteille : <b class="' + (p.sell - p.buy < 0 ? 'neg' : 'pos') + '">' + money(p.sell - p.buy) + '</b> · Casier de ' + p.perCrate + '</p>' +
      '<div class="row"><button class="btn primary" data-action="restock" data-id="' + id + '">+ Approvisionner</button>' +
      '<button class="btn cold" data-action="load-fridge" data-id="' + id + '">❄ Charger frigo</button>' +
      '<button class="btn" data-action="loss" data-id="' + id + '">Casse / perte</button>' +
      '<button class="btn" data-action="edit-product" data-id="' + id + '">Modifier / prix</button></div>' +
      '<h2>Derniers mouvements</h2><ul class="list">' + (moves.length ? moves.map(m => moveRow(m, true)).join('') : '<li class="empty">Aucun mouvement.</li>') + '</ul>');
  }

  function restockForm(id) {
    const p = product(id) || state.products[0];
    if (!p) { toast('Ajoutez d\'abord une boisson'); return; }
    openModal('<h2>Approvisionnement (achat de boissons)</h2><form class="form" id="restockForm">' +
      '<label>Boisson<select name="productId" id="restockProduct">' + productOptions(p.id) + '</select></label>' +
      '<div id="restockQty">' + qtyFields('q', p.perCrate) + '</div>' +
      '<div class="row"><label>Prix d\'achat du casier (F)<input name="crateCost" id="restockCost" inputmode="numeric" value="' + (p.buy ? Math.round(p.buy * p.perCrate) : '') + '" required></label>' +
      '<label>Prix de vente bouteille (F)<input name="sell" id="restockSell" inputmode="numeric" value="' + (p.sell || '') + '"></label></div>' +
      '<div class="row"><label>Payé par<select name="payMode">' + Object.keys(PAY).map(k => '<option value="' + k + '">' + PAY[k] + '</option>').join('') + '</select></label>' +
      '<label>Date<input type="date" name="date" value="' + today() + '" required></label></div>' +
      '<label>Fournisseur / note<input name="note" placeholder="Ex : dépôt Sobbra du quartier"></label>' +
      '<p class="hint" id="restockTotal"></p>' +
      '<button class="btn primary block" type="submit">Enregistrer l\'achat</button></form>');
    const sel = $('#restockProduct');
    const upd = () => {
      const f = $('#restockForm'), q = product(sel.value);
      const qty = num(f.qCrates.value) * q.perCrate + num(f.qBottles.value);
      const cost = num(f.crateCost.value) / q.perCrate;
      $('#restockTotal').textContent = qty ? qty + ' bouteilles · total ' + money(qty * cost) : '';
    };
    sel.addEventListener('change', () => {
      const q = product(sel.value);
      $('#restockQty').innerHTML = qtyFields('q', q.perCrate);
      $('#restockCost').value = q.buy ? Math.round(q.buy * q.perCrate) : '';
      $('#restockSell').value = q.sell || '';
      upd();
    });
    $('#restockForm').addEventListener('input', upd);
  }

  function fridgeForm(onlyId) {
    const st = computeStocks();
    const list = onlyId ? [product(onlyId)] : state.products;
    openModal('<h2>❄ Charger le frigo</h2><p class="hint">Indiquez ce que vous sortez de la réserve pour mettre au frigo.</p>' +
      '<form class="form" id="fridgeForm"><div class="load-head"><span>Boisson</span><span>Casiers</span><span>Bouteilles</span></div>' +
      list.map(p => '<div class="load-row"><div><b>' + esc(p.name) + '</b><small>Réserve ' + fmtQty(st[p.id].reserve, p.perCrate) + ' · frigo ' + st[p.id].fridge + '</small></div>' +
        '<input name="c_' + p.id + '" inputmode="numeric" placeholder="0" aria-label="Casiers ' + esc(p.name) + '">' +
        '<input name="b_' + p.id + '" inputmode="numeric" placeholder="0" aria-label="Bouteilles ' + esc(p.name) + '"></div>').join('') +
      '<button class="btn cold block" type="submit">Enregistrer le chargement</button></form>');
  }

  function inventoryForm() {
    const st = computeStocks();
    openModal('<h2>Inventaire (comptage réel)</h2><p class="hint">Comptez les bouteilles pleines et corrigez si besoin. Les différences apparaîtront dans le bilan (manquants ou surplus).</p>' +
      '<form class="form" id="inventoryForm"><div class="load-head"><span>Boisson</span><span>Réserve</span><span>Frigo</span></div>' +
      state.products.map(p => '<div class="load-row"><div><b>' + esc(p.name) + '</b><small>en bouteilles</small></div>' +
        '<input name="r_' + p.id + '" inputmode="numeric" value="' + st[p.id].reserve + '" aria-label="Réserve ' + esc(p.name) + '">' +
        '<input name="f_' + p.id + '" inputmode="numeric" value="' + st[p.id].fridge + '" aria-label="Frigo ' + esc(p.name) + '"></div>').join('') +
      '<button class="btn primary block" type="submit">Valider l\'inventaire</button></form>');
  }

  function lossForm(id) {
    openModal('<h2>Casse / perte</h2><form class="form" id="lossForm">' +
      '<label>Boisson<select name="productId">' + productOptions(id) + '</select></label>' +
      '<div class="row"><label>Bouteilles<input name="qty" inputmode="numeric" required placeholder="1"></label>' +
      '<label>Où ?<select name="loc"><option value="fridge">Frigo</option><option value="reserve">Réserve</option></select></label></div>' +
      '<label>Raison<input name="note" placeholder="Ex : bouteille cassée, offerte…"></label>' +
      '<button class="btn danger block" type="submit">Enregistrer la perte</button></form>');
  }

  // ---------- Enregistrements ----------
  function addMove(m) {
    m.id = uid(); m.createdAt = new Date().toISOString();
    m.date = m.date || today(); m.time = m.time || nowTime();
    state.moves.push(m);
  }

  function checkout() {
    const ids = Object.keys(cart).filter(id => cart[id] > 0 && product(id));
    if (!ids.length) return;
    const noPrice = ids.filter(id => !product(id).sell);
    if (noPrice.length) { toast('Mettez le prix de vente de ' + pname(noPrice[0]) + ' (onglet Stock)'); return; }
    const st = computeStocks();
    const short = [];
    const lines = ids.map(id => {
      const p = product(id), q = cart[id], s = st[id];
      const fromFridge = Math.min(q, Math.max(0, s.fridge));
      const fromReserve = q - fromFridge;
      if (fromReserve > Math.max(0, s.reserve)) short.push(p.name + ' (reste ' + Math.max(0, s.fridge + s.reserve) + ')');
      return { productId: id, qty: q, price: p.sell, cost: p.buy, fromFridge, fromReserve };
    });
    const commit = () => {
      const total = lines.reduce((t, l) => t + l.qty * l.price, 0);
      addMove({ type: 'vente', lines, payMode, total });
      const fromRes = lines.some(l => l.fromReserve > 0);
      cart = {}; save(); render();
      toast('Vente enregistrée : ' + money(total) + ' (' + PAY[payMode] + ')' + (fromRes ? ' · complété depuis la réserve' : ''));
      payMode = 'cash'; renderCart();
    };
    if (short.length) askConfirm('Stock insuffisant : ' + short.join(', ') + '. Avez-vous oublié un approvisionnement ? Enregistrer la vente quand même ?', 'Vendre quand même', commit);
    else commit();
  }

  function restoreFrom(text) {
    let d;
    try { d = JSON.parse(text); if (!d || !Array.isArray(d.products) || !Array.isArray(d.moves)) throw 0; }
    catch (e) { toast('Sauvegarde invalide'); return; }
    askConfirm('Remplacer les données actuelles par cette sauvegarde (' + d.products.length + ' boissons, ' + d.moves.length + ' opérations) ?', 'Restaurer', () => {
      state = { settings: Object.assign(defaultState().settings, d.settings || {}), products: d.products, moves: d.moves };
      cart = {}; save(); render(); closeModal(); toast('Sauvegarde restaurée');
    });
  }

  function exportCsv() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Date', 'Heure', 'Opération', 'Détail', 'Montant (F)', 'Paiement'].map(q).join(';')];
    state.moves.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).forEach(m => {
      const x = moveText(m);
      lines.push([fmtDate(m.date), m.time, x.t, x.d, x.a == null ? '' : Math.round(x.a), x.pay ? PAY[x.pay] : ''].map(q).join(';'));
    });
    offerFile('buvette-journal-' + today() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8', 'Journal (Excel / CSV)');
  }

  // ---------- Événements ----------
  document.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const p = product(add.dataset.add);
      if (p && !p.sell) { productForm(p); toast('Indiquez d\'abord le prix de vente'); return; }
      cart[add.dataset.add] = (cart[add.dataset.add] || 0) + 1;
      renderSell(computeStocks()); return;
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
      else if (a === 'clear-cart') { cart = {}; renderSell(computeStocks()); }
      else if (a === 'checkout') checkout();
      else if (a === 'new-product') productForm();
      else if (a === 'edit-product') productForm(product(id));
      else if (a === 'restock') restockForm(id);
      else if (a === 'load-fridge') fridgeForm(id);
      else if (a === 'inventory') inventoryForm();
      else if (a === 'loss') lossForm(id);
      else if (a === 'delete-product') {
        const p = product(id);
        askConfirm('Supprimer « ' + p.name + ' » ? Les ventes passées restent dans les bilans.', 'Supprimer', () => {
          state.products = state.products.filter(x => x.id !== id); delete cart[id];
          save(); render(); closeModal(); toast('Boisson supprimée');
        });
      } else if (a === 'delete-move') {
        const m = state.moves.find(x => x.id === id); if (!m) return;
        const x = moveText(m);
        askConfirm('Annuler « ' + x.t + ' : ' + x.d + ' » ? Le stock et les bilans seront corrigés.', 'Annuler l\'opération', () => {
          state.moves = state.moves.filter(y => y.id !== id);
          save(); render(); if (!$('#modal').hidden && m.productId) productDetail(m.productId);
          toast('Opération annulée');
        });
      } else if (a === 'share-report') {
        const link = document.createElement('a');
        link.href = 'https://wa.me/?text=' + encodeURIComponent(reportText());
        link.target = '_blank'; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
        openModal('<h2>Bilan à envoyer</h2><p class="hint">Si WhatsApp ne s\'ouvre pas, copiez le texte et collez-le dans une discussion.</p><textarea id="exportText" rows="12" readonly>' + esc(reportText()) + '</textarea><button class="btn primary block" data-action="copy-export">Copier le bilan</button>');
      } else if (a === 'copy-export') copyText($('#exportText').value, $('#exportText'));
      else if (a === 'export') offerFile('sauvegarde-buvette-' + today() + '.json', JSON.stringify(state), 'application/json', 'Sauvegarde');
      else if (a === 'export-csv') exportCsv();
      else if (a === 'paste-backup') openModal('<h2>Restaurer depuis un texte</h2><p class="hint">Collez le texte de sauvegarde copié auparavant.</p><textarea id="pasteText" class="mono" rows="10"></textarea><button class="btn primary block" data-action="restore-paste">Restaurer</button>');
      else if (a === 'restore-paste') restoreFrom($('#pasteText').value);
      else if (a === 'reset') askConfirm('Effacer TOUTES les données (boissons, ventes, stock, dépenses) ? Faites d\'abord une sauvegarde. Action définitive.', 'Tout effacer', () => {
        state = defaultState(); cart = {}; save(); render(); toast('Données effacées');
      });
      return;
    }
    const row = e.target.closest('[data-product]');
    if (row) productDetail(row.dataset.product);
  });

  document.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, formId = f.getAttribute('id');
    const d = Object.fromEntries(new FormData(f).entries());

    if (formId === 'productForm') {
      const perCrate = Math.max(1, num(d.perCrate));
      let p = d.id ? product(d.id) : null;
      const isNew = !p;
      if (isNew) { p = { id: uid() }; state.products.push(p); }
      Object.assign(p, { name: d.name.trim(), cat: d.cat, perCrate, buy: num(d.crateCost) / perCrate, sell: num(d.sell), alert: num(d.alert) });
      if (isNew && (num(d.initReserve) || num(d.initFridge))) {
        addMove({ type: 'inventaire', initial: true, productId: p.id, reserveDelta: num(d.initReserve), fridgeDelta: num(d.initFridge), cost: p.buy });
      }
      save(); render(); productDetail(p.id); toast('Boisson enregistrée');
    } else if (formId === 'restockForm') {
      const p = product(d.productId);
      const qty = num(d.qCrates) * p.perCrate + num(d.qBottles);
      if (!qty) { toast('Indiquez la quantité achetée'); return; }
      const unitCost = num(d.crateCost) / p.perCrate;
      p.buy = unitCost; if (num(d.sell)) p.sell = num(d.sell);
      addMove({ type: 'achat', productId: p.id, qty, unitCost, payMode: d.payMode, date: d.date, note: (d.note || '').trim() });
      save(); render(); closeModal(); toast(p.name + ' : ' + fmtQty(qty, p.perCrate) + ' ajouté(s) à la réserve');
    } else if (formId === 'fridgeForm') {
      let n = 0;
      state.products.forEach(p => {
        if (!(('c_' + p.id) in d)) return;
        const qty = num(d['c_' + p.id]) * p.perCrate + num(d['b_' + p.id]);
        if (qty > 0) { addMove({ type: 'frigo', productId: p.id, qty }); n += qty; }
      });
      if (!n) { toast('Aucune quantité saisie'); return; }
      save(); render(); closeModal(); toast(n + ' bouteille(s) mise(s) au frigo');
    } else if (formId === 'inventoryForm') {
      const st = computeStocks(); let changed = 0;
      state.products.forEach(p => {
        const rd = num(d['r_' + p.id]) - st[p.id].reserve, fd = num(d['f_' + p.id]) - st[p.id].fridge;
        if (rd || fd) { addMove({ type: 'inventaire', productId: p.id, reserveDelta: rd, fridgeDelta: fd, cost: p.buy }); changed++; }
      });
      save(); render(); closeModal(); toast(changed ? changed + ' boisson(s) corrigée(s)' : 'Inventaire conforme, rien à corriger');
    } else if (formId === 'lossForm') {
      const p = product(d.productId), qty = num(d.qty);
      if (!qty) { toast('Indiquez le nombre de bouteilles'); return; }
      addMove({ type: 'perte', productId: p.id, qty, loc: d.loc, cost: p.buy, note: (d.note || '').trim() });
      save(); render(); closeModal(); toast('Perte enregistrée');
    } else if (formId === 'expenseForm') {
      const amount = num(d.amount);
      if (!amount) { toast('Montant invalide'); return; }
      addMove({ type: 'depense', category: d.category, label: (d.label || '').trim(), amount, payMode: d.payMode, date: d.date });
      f.reset(); $('#expDate').value = today();
      save(); render(); toast('Dépense enregistrée');
    } else if (formId === 'settingsForm') {
      state.settings.name = d.name.trim() || 'Ma Buvette';
      save(); render(); toast('Réglages enregistrés');
    }
  });

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

  render();
})();
