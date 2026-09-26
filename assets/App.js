// ======================================================================
// PETA AFTERSALES ELITECH — app.js
// ======================================================================

// GANTI dengan URL Web App hasil Deploy backend "Peta Aftersales" (yang barusan dites lewat jalankanTes).
const GAS_URL = 'GANTI_DENGAN_URL_EXEC_PETA_AFTERSALES';
// Geojson yang SAMA persis dipakai Peta Distributor -- copy file-nya ke assets/ folder ini juga.
const GEOJSON_PATH = 'assets/indonesia-provinces-elitech.geojson';

const STATUS_KELAS = {
  'Barang dikirimkan ke alamat tujuan': 'status-selesai',
  'Barang selesai, menunggu pengiriman': 'status-selesai',
  'Proses QC/kalibrasi': 'status-proses',
  'Proses perbaikan': 'status-proses',
  'Dalam pengecekan teknisi': 'status-proses',
  'Barang belum diterima': 'status-belum',
  '(belum ada data servis)': 'status-belum',
};
function kelasStatus(status) { return STATUS_KELAS[status] || 'status-chip'; }

// ----------------------------------------------------------------------
// State
// ----------------------------------------------------------------------
const state = {
  geojson: null,
  distributors: [],      // dari backend: [{nama, provinsiCakupan, totalKomplain, statusBreakdown, kasus}]
  tidakDiketahui: null,  // {totalKomplain, perNamaAsli, kasus}

  featureByProvinsi: new Map(),     // provinsi(upper) -> geojson feature
  distributorsByProvinsi: new Map(), // provinsi(upper) -> [distributor, ...] (bisa lebih dari 1)
  totalByProvinsi: new Map(),        // provinsi(upper) -> jumlah gabungan (utk warna)
  searchIndex: [],

  colorScale: null,
  maxTotal: 0,

  projection: null,
  path: null,
  zoom: null,
  svg: null,
  mapGroup: null,
  width: 1200,
  height: 620,

  isMobile: window.matchMedia('(max-width: 768px)').matches,
};

// ----------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------
init();

async function init() {
  try {
    const [geojson, apiData] = await Promise.all([
      d3.json(GEOJSON_PATH),
      fetch(GAS_URL + '?action=all').then(r => r.json()),
    ]);

    if (apiData.error) throw new Error(apiData.error);

    state.geojson = geojson;
    state.distributors = apiData.distributors || [];
    state.tidakDiketahui = apiData.tidakDiketahui || { totalKomplain: 0, perNamaAsli: {}, kasus: [] };

    buildIndices();
    renderLegend();
    renderMap();
    renderNonDistBadge();
    bindUiEvents();
  } catch (err) {
    console.error('Gagal memuat data:', err);
    document.getElementById('mapStage').innerHTML =
      '<p style="text-align:center;margin-top:40px;color:#999">Gagal memuat data peta aftersales. Coba muat ulang halaman.</p>';
  }
}

// ----------------------------------------------------------------------
// Build lookup indices
// ----------------------------------------------------------------------
function buildIndices() {
  state.geojson.features.forEach(f => {
    state.featureByProvinsi.set(f.properties.provinsi.toUpperCase(), f);
  });

  state.distributors.forEach(d => {
    (d.provinsiCakupan || []).forEach(p => {
      const key = p.toUpperCase();
      if (!state.distributorsByProvinsi.has(key)) state.distributorsByProvinsi.set(key, []);
      state.distributorsByProvinsi.get(key).push(d);
    });
  });

  state.distributorsByProvinsi.forEach((list, provinsi) => {
    const total = list.reduce((sum, d) => sum + d.totalKomplain, 0);
    state.totalByProvinsi.set(provinsi, total);
    if (total > state.maxTotal) state.maxTotal = total;
  });

  state.colorScale = d3.scaleSequential(d3.interpolateOranges)
    .domain([0, Math.max(state.maxTotal, 1)]);

  // ---- Search index: provinsi + nama distributor ----
  const idx = [];
  state.geojson.features.forEach(f => {
    idx.push({ type: 'PROVINSI', label: f.properties.provinsi, target: f.properties.provinsi });
  });
  state.distributors.forEach(d => {
    idx.push({ type: 'DISTRIBUTOR', label: d.nama, target: d.nama, totalKomplain: d.totalKomplain });
  });
  state.searchIndex = idx;
}

function renderNonDistBadge() {
  document.getElementById('nonDistCount').textContent = state.tidakDiketahui.totalKomplain;
}

function renderLegend() {
  const legend = document.getElementById('legend');
  legend.innerHTML = `
    <div class="legend-title">Beban komplain distributor</div>
    <div class="legend-bar"></div>
    <div class="legend-scale"><span>0</span><span>${state.maxTotal}</span></div>
  `;
}

// ----------------------------------------------------------------------
// Map rendering
// ----------------------------------------------------------------------
function renderMap() {
  const svg = d3.select('#map');
  state.svg = svg;

  const projection = d3.geoMercator().fitSize([state.width, state.height], state.geojson);
  const path = d3.geoPath(projection);
  state.projection = projection;
  state.path = path;

  const g = svg.append('g').attr('id', 'mapGroup');
  state.mapGroup = g;

  g.selectAll('path.province-path')
    .data(state.geojson.features)
    .enter()
    .append('path')
    .attr('class', 'province-path')
    .attr('data-provinsi', d => d.properties.provinsi)
    .attr('d', path)
    .attr('fill', d => warnaProvinsi(d.properties.provinsi))
    .on('mouseenter', onProvinceHoverIn)
    .on('mousemove', onProvinceHoverMove)
    .on('mouseleave', onProvinceHoverOut)
    .on('click', onProvinceClick);

  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on('zoom', (event) => { g.attr('transform', event.transform); });
  state.zoom = zoom;
  svg.call(zoom).on('dblclick.zoom', null);
}

function warnaProvinsi(provinsi) {
  const total = state.totalByProvinsi.get(provinsi.toUpperCase());
  if (!total) return 'var(--map-idle)';
  return state.colorScale(total);
}

function onProvinceHoverIn(event, d) {
  if (state.isMobile) return;
  d3.select(this).classed('hovered', true);
  const label = document.getElementById('hoverLabel');
  const total = state.totalByProvinsi.get(d.properties.provinsi.toUpperCase());
  label.textContent = titleCase(d.properties.provinsi) + (total ? ` — ${total} komplain` : ' — belum ada data');
  label.classList.remove('hidden');
}
function onProvinceHoverMove(event) {
  if (state.isMobile) return;
  const label = document.getElementById('hoverLabel');
  const [x, y] = d3.pointer(event, document.getElementById('mapStage'));
  label.style.left = x + 'px';
  label.style.top = y + 'px';
}
function onProvinceHoverOut() {
  if (state.isMobile) return;
  d3.select(this).classed('hovered', false);
  document.getElementById('hoverLabel').classList.add('hidden');
}
function onProvinceClick(event, d) {
  clearSelection();
  zoomToFeature(d);
  openPanelForProvince(d.properties.provinsi);
}

// ----------------------------------------------------------------------
// Zoom helpers
// ----------------------------------------------------------------------
function zoomToFeature(feature) {
  const [[x0, y0], [x1, y1]] = state.path.bounds(feature);
  const dx = x1 - x0, dy = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const scale = Math.max(1, Math.min(8, 0.85 / Math.max(dx / state.width, dy / state.height)));
  const translate = [state.width / 2 - scale * cx, state.height / 2 - scale * cy];

  state.svg.transition().duration(700).ease(d3.easeCubicInOut)
    .call(state.zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));

  d3.select(`path[data-provinsi="${cssEscape(feature.properties.provinsi)}"]`).classed('selected', true);
}
function resetZoom() {
  state.svg.transition().duration(700).ease(d3.easeCubicInOut)
    .call(state.zoom.transform, d3.zoomIdentity);
}
function clearSelection() {
  d3.selectAll('.province-path').classed('selected', false).classed('hovered', false);
}

// ----------------------------------------------------------------------
// Panel: provinsi -> daftar distributor yang menangani wilayah itu
// ----------------------------------------------------------------------
function openPanelForProvince(provinsi) {
  const key = provinsi.toUpperCase();
  const list = state.distributorsByProvinsi.get(key) || [];

  document.getElementById('panelTitle').textContent = titleCase(provinsi);

  const body = document.getElementById('panelBody');
  let html = `<div class="data-caveat">Angka di bawah adalah TOTAL komplain distributor ini di SELURUH wilayah yang dia tangani (bisa banyak provinsi sekaligus) -- bukan jumlah komplain yang pasti terjadi persis di ${titleCase(provinsi)} saja, karena data komplain tidak mencatat provinsi asal secara langsung.</div>`;

  if (list.length === 0) {
    html += '<p class="empty-note">Belum ada distributor dengan data komplain untuk wilayah ini.</p>';
  } else {
    html += list.map(distBlockHtml).join('');
  }

  body.innerHTML = html;
  bindCaseToggles(body);
  showPanel();
}

function openPanelForDistributor(distributor) {
  clearSelection();
  (distributor.provinsiCakupan || []).forEach(p => {
    d3.select(`path[data-provinsi="${cssEscape(p)}"]`).classed('selected', true);
  });
  resetZoom();

  document.getElementById('panelTitle').textContent = titleCase(distributor.nama);
  const body = document.getElementById('panelBody');
  body.innerHTML = `<div class="data-caveat">Total komplain di bawah mencakup SEMUA wilayah yang ditangani distributor ini, bukan per provinsi.</div>` + distBlockHtml(distributor);
  bindCaseToggles(body);
  showPanel();
}

function distBlockHtml(d) {
  const chips = Object.entries(d.statusBreakdown || {})
    .map(([status, jumlah]) => `<span class="status-chip ${kelasStatus(status)}">${escapeHtml(status)}: ${jumlah}</span>`)
    .join('');

  const caseRows = (d.kasus || []).map(k => `
    <div class="case-row">
      <div class="case-main">
        <span class="case-produk">${escapeHtml(k.produk || '-')}${k.noSeri ? ' · ' + escapeHtml(k.noSeri) : ''}</span>
        <span class="status-chip ${kelasStatus(k.statusServis)}">${escapeHtml(k.statusServis)}</span>
      </div>
      ${k.kategori ? `<span>${escapeHtml(k.kategori)}</span>` : ''}
      ${k.sumberNama === 'fallback_customer' ? '<span class="case-note">*nama distributor dari data historis (kolom customer), bukan kolom distributor</span>' : ''}
    </div>`).join('');

  const distId = 'dist-' + Math.random().toString(36).slice(2, 9);

  return `
    <div class="dist-block" data-nama="${escapeAttr(d.nama)}">
      <div class="dist-name-row">
        <span class="dist-name">${escapeHtml(d.nama)}</span>
        <span class="dist-total-badge">${d.totalKomplain} komplain</span>
      </div>
      <div class="status-chips">${chips}</div>
      <button class="case-toggle" data-target="${distId}">Lihat ${d.kasus.length} kasus &darr;</button>
      <div class="case-list" id="${distId}">${caseRows}</div>
    </div>`;
}

function bindCaseToggles(scope) {
  scope.querySelectorAll('.case-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const open = target.classList.toggle('open');
      btn.innerHTML = open
        ? btn.innerHTML.replace('&darr;', '&uarr;')
        : btn.innerHTML.replace('&uarr;', '&darr;');
    });
  });
}

function showPanel() {
  document.getElementById('panel').classList.remove('hidden');
  requestAnimationFrame(() => {
    document.getElementById('panel').classList.add('open');
    document.getElementById('overlay').classList.remove('hidden');
    requestAnimationFrame(() => document.getElementById('overlay').classList.add('visible'));
  });
}
function closePanel() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('visible');
  clearSelection();
  resetZoom();
  setTimeout(() => {
    document.getElementById('panel').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
  }, 700);
}

// ----------------------------------------------------------------------
// Panel non-distributor (komplain institusi langsung / tidak dikenal)
// ----------------------------------------------------------------------
function openPanelNonDistributor() {
  clearSelection();
  document.getElementById('panelTitle').textContent = 'Komplain Non-Distributor';
  const body = document.getElementById('panelBody');

  const entries = Object.entries(state.tidakDiketahui.perNamaAsli || {})
    .sort((a, b) => b[1] - a[1]);

  const rows = entries.map(([nama, jumlah]) =>
    `<li class="nondist-row"><span>${escapeHtml(nama)}</span><span class="n">${jumlah}</span></li>`
  ).join('');

  body.innerHTML = `
    <div class="data-caveat">Ini komplain yang nama pelapornya BUKAN nama distributor yang dikenal peta ini -- biasanya karena pembelian langsung (institusi pemerintah, RS, Puskesmas) tanpa lewat distributor, atau nama yang belum terverifikasi.</div>
    <ul class="nondist-list">${rows}</ul>
  `;
  showPanel();
}

// ----------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------
let searchDebounce = null;

function bindUiEvents() {
  document.getElementById('panelClose').addEventListener('click', closePanel);
  document.getElementById('overlay').addEventListener('click', closePanel);
  document.getElementById('nonDistBtn').addEventListener('click', openPanelNonDistributor);

  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runSearch(input.value), 150);
  });
  input.addEventListener('focus', () => runSearch(input.value));
  document.getElementById('searchBtn').addEventListener('click', () => runSearch(input.value));

  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.search-wrap');
    if (!wrap.contains(e.target)) hideDropdown();
  });

  window.addEventListener('resize', () => {
    state.isMobile = window.matchMedia('(max-width: 768px)').matches;
  });
}

function runSearch(query) {
  const q = query.trim().toLowerCase();
  if (q.length === 0) { hideDropdown(); return; }

  const results = state.searchIndex
    .filter(e => e.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts;
    })
    .slice(0, 8);

  renderDropdown(results);
}

function renderDropdown(results) {
  const dd = document.getElementById('searchDropdown');
  if (results.length === 0) {
    dd.innerHTML = '<div class="empty-note" style="padding:10px;text-align:center;">Tidak ditemukan</div>';
  } else {
    dd.innerHTML = results.map((r, i) => `
      <button class="search-item" data-idx="${i}">
        <span>${escapeHtml(r.label)}</span>
        ${r.type === 'DISTRIBUTOR' ? `<span class="badge">${r.totalKomplain}</span>` : ''}
      </button>`).join('');
  }
  dd.classList.remove('hidden');
  dd.querySelectorAll('.search-item').forEach((btn, i) => {
    btn.addEventListener('click', () => selectSearchResult(results[i]));
  });
}
function hideDropdown() { document.getElementById('searchDropdown').classList.add('hidden'); }

function selectSearchResult(result) {
  hideDropdown();
  document.getElementById('searchInput').value = result.label;

  if (result.type === 'DISTRIBUTOR') {
    const dist = state.distributors.find(d => d.nama === result.target);
    if (dist) openPanelForDistributor(dist);
  } else {
    clearSelection();
    const feature = state.featureByProvinsi.get(result.target.toUpperCase());
    if (feature) zoomToFeature(feature);
    openPanelForProvince(result.target);
  }
}

// ----------------------------------------------------------------------
// Small utils
// ----------------------------------------------------------------------
function titleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
function cssEscape(str) { return String(str).replace(/["\\]/g, '\\$&'); }
