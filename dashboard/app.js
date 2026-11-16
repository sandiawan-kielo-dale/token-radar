// Token Radar dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail page with the model's own
// inputs, its sector benchmark and the protocol's farm plan. No network: every byte it shows is in
// data.js. The model in this file is the same arithmetic main.ts writes to board.json, so the page's
// code and the board's data are visibly the same function of the snapshot figures.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.getElementById('board');
  if (!DATA || !main) return;
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries. Sector multiple: the sector's calibrated multiple from the snapshot's
  // own live tokens (data.js carries it per row); thin sectors use the market-wide median.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_max_chains);
    var chainMult = 1 + model.chain_step * extra;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $10 against your supply on ' + name + ', then repay it the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $5 through ' + name + "'s main pool on " + chain + ' or add a little liquidity once a week.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount to a second chain through ' + name + ' once, then use it in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Open " + name + "'s rewards page once a week and claim or restake what it shows.";
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open and close one small hedge a week on ' + name + ' to keep the account active.';
    if (c.indexOf('prediction') >= 0) return 'Place one small market position a week on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Top up the ' + name + ' vault by $5 once a week.';
    if (c.indexOf('stable') >= 0) return 'Mint or redeem a small amount of the stable asset through ' + name + ' once a week.';
    if (c.indexOf('rwa') >= 0) return 'Buy $5 more of the yield asset on ' + name + ' once a week.';
    if (c.indexOf('insurance') >= 0) return 'Check the policy page on ' + name + ' once a week and renew or adjust cover when it asks.';
    return 'Make one qualifying action a week on ' + name + ', such as a deposit, a swap or a vote.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p, capital, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist') === '1') state.watchlist = true;
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchlist && !WATCH[r.slug]) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function openDetail(slug) { state.selected = slug; writeHash(); render(); }
  function closeDetail() { state.selected = null; writeHash(); render(); }

  function facts() {
    var top = DATA.rows[0];
    var box = document.getElementById('facts');
    if (!box) return;
    box.textContent = '';
    var items = [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Top implied value · ' + (top ? top.name : ''), top ? fmtUsd(top.implied_value_usd) : 'n/a']
    ];
    items.forEach(function (it) {
      box.appendChild(el('div', { class: 'fact' }, el('span', { text: it[0] }), el('b', { text: it[1] })));
    });
    var meta = document.getElementById('meta-date');
    if (meta) meta.textContent = 'Snapshot ' + DATA.as_of;
  }

  function spotlight() {
    var box = document.getElementById('spotlight');
    if (!box) return;
    box.textContent = '';
    box.appendChild(el('h2', { text: 'Top 10 most valuable launches' }));
    var cards = el('div', { class: 'cards' });
    DATA.rows.slice(0, 10).forEach(function (r) {
      cards.appendChild(el('button', { type: 'button', class: 'card', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rank', text: '#' + r.rank }),
        el('b', { text: r.name }),
        el('span', { class: 'val num', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'meta', text: 'TVL ' + fmtUsd(r.tvl_usd) + ' · ' + (r.category || 'Other') })
      ));
    });
    box.appendChild(cards);
  }

  function controls() {
    var box = document.getElementById('controls');
    if (!box) return;
    box.textContent = '';
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderTable(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); renderTable(); });
    var wl = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.watchlist ? 'checked' : null, onchange: function (e) { state.watchlist = e.target.checked; writeHash(); renderTable(); } }),
      'Watchlist only');
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); renderTable(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); renderTable(); } });
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search));
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat));
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch));
    box.appendChild(wl);
    box.appendChild(el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)));
    box.appendChild(el('span', { class: 'count', id: 'count', text: '' }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderTable(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    var wrap = document.getElementById('table-wrap');
    wrap.textContent = '';
    if (list.length === 0) {
      wrap.appendChild(el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
      return;
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (WATCH[r.slug] ? ' · watchlist' : ' · early') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    wrap.appendChild(el('table', null,
      el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, sector benchmark and farm plan.' }),
      el('thead', null, el('tr', null,
        sortHeader('implied', 'Rank'),
        sortHeader('name', 'Protocol'),
        sortHeader('tvl', 'TVL'),
        sortHeader('growth', '7d'),
        sortHeader('age', 'Age'),
        sortHeader('implied', 'Implied value'),
        el('th', { scope: 'col', text: 'Token' })
      )),
      tbody
    ));
  }

  function liveTable() {
    var wrap = document.getElementById('table-wrap');
    wrap.textContent = '';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    wrap.appendChild(el('table', null,
      el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the market that prices the sectors.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
      tbody
    ));
  }

  function signalsFor(row) {
    var chips = [];
    chips.push(el('span', { class: 'chip', text: WATCH[row.slug] ? 'Watchlist' : 'Early radar' }));
    if (row.change_7d !== null && row.change_7d >= 10) chips.push(el('span', { class: 'chip hot', text: 'Heating up: TVL +' + row.change_7d.toFixed(1) + '% in 7 days' }));
    if (row.change_7d !== null && row.change_7d <= -10) chips.push(el('span', { class: 'chip cold', text: 'Cooling: TVL ' + row.change_7d.toFixed(1) + '% in 7 days' }));
    if ((row.chains || []).length >= 3) chips.push(el('span', { class: 'chip', text: 'Live on ' + row.chains.length + ' chains' }));
    if (row.age_days !== null && row.age_days >= 730) chips.push(el('span', { class: 'chip', text: 'Running ' + fmtAge(row.age_days) + ' with no token on record' }));
    return chips;
  }

  function detailPage() {
    var page = document.getElementById('detail-page');
    page.textContent = '';
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (!row) { page.hidden = true; return; }
    page.hidden = false;
    var recomputed = impliedOf(row, DATA.model);
    var sector = (DATA.sectors || []).filter(function (s) { return s.category === (row.category || 'Other'); })[0];
    page.appendChild(el('button', { class: 'back', type: 'button', text: '← Back to the board', onclick: closeDetail }));
    page.appendChild(el('div', null,
      el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
      el('h2', { text: row.name }),
      el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
    ));
    page.appendChild(el('div', { class: 'signals' }, signalsFor(row)));
    var stats = el('div', { class: 'detail-grid' });
    [['TVL', fmtUsd(row.tvl_usd)], ['Seven-day growth', fmtPct(row.change_7d)], ['Age with no token', fmtAge(row.age_days)], ['Implied value', fmtUsd(row.implied_value_usd)]].forEach(function (kv) {
      stats.appendChild(el('div', { class: 'stat' }, el('span', { text: kv[0] }), el('b', { class: 'num', text: kv[1] })));
    });
    page.appendChild(stats);
    page.appendChild(el('h3', { text: 'How the value is built' }));
    var eq = el('div', { class: 'equation' });
    [['TVL', fmtUsd(row.tvl_usd)], ['Sector multiple', String(row.category_multiple) + 'x'], ['Growth multiplier', String(row.growth_multiplier) + 'x'], ['Maturity multiplier', String(row.maturity_multiplier) + 'x'], ['Chain multiplier', String(row.chain_multiplier) + 'x'], ['Implied value', fmtUsd(row.implied_value_usd)]].forEach(function (kv) {
      eq.appendChild(el('div', null, el('span', { text: kv[0] }), el('b', { class: 'num', text: kv[1] })));
    });
    page.appendChild(eq);
    page.appendChild(el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }));
    if (sector) {
      page.appendChild(el('h3', { text: 'Sector benchmark: ' + sector.category }));
      page.appendChild(el('p', { class: 'sub', text: 'The sector multiple of ' + sector.multiple + 'x comes from ' + sector.live_count + ' live-token protocol' + (sector.live_count === 1 ? '' : 's') + ' in this sector (median market-cap/TVL ' + sector.median_ratio + 'x, market-wide median ' + DATA.global_multiple + 'x). The largest live comparables:' }));
      var ct = el('table', { class: 'comps' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Live comparable' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
        el('tbody', null, sector.comps.map(function (c) {
          return el('tr', null, el('td', null, el('b', { text: c.name })), el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }), el('td', { class: 'num', text: c.ratio + 'x' }));
        }))
      );
      page.appendChild(ct);
    }
    page.appendChild(el('h3', { text: 'Farm plan' }));
    var steps = farmSteps(row);
    page.appendChild(el('ol', { class: 'steps' }, steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
    })));
    page.appendChild(el('p', { class: 'sub', text: '“Records no token” is what the snapshot says — it is not proof this protocol has none. Farm with money you can afford to lose, and never pay anyone to claim an airdrop.' }));
  }

  function renderTable() {
    var panel = document.getElementById('table-panel');
    var count = document.getElementById('count');
    if (state.selected) {
      document.getElementById('spotlight').style.display = 'none';
      document.getElementById('model-panel').style.display = 'none';
      panel.style.display = 'none';
      detailPage();
    } else {
      document.getElementById('spotlight').style.display = '';
      document.getElementById('model-panel').style.display = '';
      panel.style.display = '';
      document.getElementById('detail-page').hidden = true;
      if (state.tab === 'pre-token') boardTable(); else liveTable();
    }
    if (count) count.textContent = state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
  }

  function render() {
    facts();
    spotlight();
    controls();
    renderTable();
    main.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });
})();
