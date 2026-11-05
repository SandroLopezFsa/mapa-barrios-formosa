// Mapa Interactivo de Barrios de Formosa Capital (Leaflet + OpenStreetMap)

const geojsonData = window.BARRIOS_FORMOSA_GEOJSON;
const features = geojsonData.features;

// Inicializar el mapa centrado en Formosa Capital
const map = L.map('map', {
  center: [-26.1785, -58.1880],
  zoom: 13,
  minZoom: 11,
  maxZoom: 19,
  zoomControl: true
});

// Capas base:
// - En GitHub Pages (https://) OpenStreetMap oficial funciona al 100%.
// - En archivo local (file://) usamos automáticamente Esri World Street Map o IGN Argenmap que no bloquean file:// ni piden API Key.
const isLocalFile = window.location.protocol === 'file:';

const baseLayers = {
  osm: L.tileLayer(
    isLocalFile
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
      : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  ),
  argenmap: L.tileLayer(
    'https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG%3A3857@png/{z}/{x}/{-y}.png',
    {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.ign.gob.ar/">Instituto Geográfico Nacional (IGN)</a> &copy; OpenStreetMap'
    }
  ),
  esriStreet: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; OpenStreetMap contributors'
    }
  ),
  satellite: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 18,
      attribution: 'Tiles &copy; Esri'
    }
  )
};

baseLayers.osm.addTo(map);

// Estado de la aplicación
let colorMode = 'barrio'; // 'barrio' | 'zona'
let fillOpacity = 0.48;
let selectedId = null;
const layerById = new Map();
const labelMarkers = [];
const labelsLayerGroup = L.layerGroup().addTo(map);

function getFeatureColor(props) {
  return colorMode === 'zona' ? props.zoneColor : props.color;
}

function getFeatureStyle(feature) {
  const isSelected = feature.properties.id === selectedId;
  const baseColor = getFeatureColor(feature.properties);
  return {
    color: isSelected ? '#ffffff' : baseColor,
    weight: isSelected ? 3.5 : 2,
    opacity: 0.95,
    fillColor: baseColor,
    fillOpacity: isSelected ? Math.min(fillOpacity + 0.25, 0.85) : fillOpacity,
    dashArray: isSelected ? '' : ''
  };
}

function createPopupHTML(props) {
  const shareUrl = `${window.location.origin}${window.location.pathname}?barrio=${encodeURIComponent(props.id)}`;
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${props.centerLat},${props.centerLon}`;
  const swatchColor = getFeatureColor(props);

  return `
    <div class="popup-card">
      <div class="popup-header">
        <span class="popup-swatch" style="background:${swatchColor}"></span>
        <div class="popup-title">${props.name}</div>
      </div>
      <span class="popup-zone">${props.zone}</span>
      <div class="popup-section">
        <strong>Delimitación / Calles de referencia:</strong><br/>
        ${props.limits}
      </div>
      <div class="popup-section">
        ${props.description}
      </div>
      <div class="popup-actions">
        <button class="popup-btn primary" onclick="window.copyBarrioLink('${props.id}', '${props.name.replace(/'/g, "\\'")}')">
          🔗 Compartir barrio
        </button>
        <a class="popup-btn" href="${gmapsUrl}" target="_blank" rel="noopener">
          📍 Google Maps
        </a>
      </div>
    </div>
  `;
}

// Capa GeoJSON de barrios
const geojsonLayer = L.geoJSON(geojsonData, {
  style: getFeatureStyle,
  onEachFeature: (feature, layer) => {
    const props = feature.properties;
    layerById.set(props.id, { layer, feature });

    layer.bindPopup(() => createPopupHTML(props), { maxWidth: 310 });

    layer.on({
      mouseover: (e) => {
        const target = e.target;
        if (props.id !== selectedId) {
          target.setStyle({
            weight: 3,
            color: '#ffffff',
            fillOpacity: Math.min(fillOpacity + 0.2, 0.8)
          });
          target.bringToFront();
        }
      },
      mouseout: (e) => {
        geojsonLayer.resetStyle(e.target);
      },
      click: () => {
        selectBarrio(props.id, false);
      }
    });

    // Etiqueta centrada en cada barrio
    const shortName = props.name.replace(/^Barrio\s+/i, '');
    const labelIcon = L.divIcon({
      className: 'barrio-label-wrapper',
      html: `<div class="barrio-map-label" style="border-left: 3px solid ${props.color}">${shortName}</div>`,
      iconSize: [0, 0]
    });
    const marker = L.marker([props.centerLat, props.centerLon], {
      icon: labelIcon,
      interactive: false
    });
    labelMarkers.push({ id: props.id, marker, props });
    labelsLayerGroup.addLayer(marker);
  }
}).addTo(map);

// Renderizar lista lateral
const listContainer = document.getElementById('barriosList');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const zoneSelect = document.getElementById('zoneSelect');
const colorModeSelect = document.getElementById('colorModeSelect');
const baseMapSelect = document.getElementById('baseMapSelect');
const toggleLabelsCheckbox = document.getElementById('toggleLabels');
const countLabel = document.getElementById('barriosCount');
const sidebar = document.getElementById('sidebar');

function renderSidebarList() {
  const query = searchInput.value.trim().toLowerCase();
  const zoneFilter = zoneSelect.value;

  clearSearchBtn.style.display = query ? 'block' : 'none';
  listContainer.innerHTML = '';

  const filtered = features.filter((f) => {
    const p = f.properties;
    const matchZone = zoneFilter === 'all' || p.zone === zoneFilter;
    const matchQuery =
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.limits.toLowerCase().includes(query) ||
      p.zone.toLowerCase().includes(query);
    return matchZone && matchQuery;
  });

  countLabel.textContent = `Mostrando ${filtered.length} de ${features.length} barrios`;

  // Actualizar visibilidad en el mapa según filtro
  const visibleIds = new Set(filtered.map((f) => f.properties.id));
  layerById.forEach(({ layer }, id) => {
    if (visibleIds.has(id)) {
      if (!map.hasLayer(layer)) geojsonLayer.addLayer(layer);
    } else {
      if (map.hasLayer(layer)) geojsonLayer.removeLayer(layer);
    }
  });
  labelMarkers.forEach(({ id, marker }) => {
    if (visibleIds.has(id)) {
      if (!labelsLayerGroup.hasLayer(marker)) labelsLayerGroup.addLayer(marker);
    } else {
      if (labelsLayerGroup.hasLayer(marker)) labelsLayerGroup.removeLayer(marker);
    }
  });

  filtered.forEach((f) => {
    const p = f.properties;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `barrio-item${p.id === selectedId ? ' active' : ''}`;
    btn.dataset.id = p.id;
    const swatchColor = getFeatureColor(p);

    btn.innerHTML = `
      <span class="color-swatch" style="background:${swatchColor}"></span>
      <div class="barrio-info">
        <div class="barrio-name-row">
          <span class="barrio-name">${p.name}</span>
          <span class="barrio-num">#${p.numero}</span>
        </div>
        <span class="barrio-zone-tag">${p.zone}</span>
        <div class="barrio-limits">${p.limits}</div>
      </div>
    `;

    btn.addEventListener('click', () => {
      selectBarrio(p.id, true);
      if (window.innerWidth <= 820) {
        sidebar.classList.remove('open');
      }
    });

    listContainer.appendChild(btn);
  });
}

function selectBarrio(id, flyTo = true) {
  selectedId = id;
  geojsonLayer.setStyle(getFeatureStyle);

  const entry = layerById.get(id);
  if (entry) {
    entry.layer.bringToFront();
    if (flyTo) {
      map.flyToBounds(entry.layer.getBounds(), {
        padding: [60, 60],
        maxZoom: 15,
        duration: 0.75
      });
    }
    entry.layer.openPopup();
  }

  // Actualizar URL sin recargar para poder compartir directo
  const url = new URL(window.location.href);
  url.searchParams.set('barrio', id);
  window.history.replaceState({}, '', url.toString());

  // Marcar activo en la lista
  document.querySelectorAll('.barrio-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  const activeItem = listContainer.querySelector(`.barrio-item[data-id="${id}"]`);
  if (activeItem && !flyTo) {
    activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function resetView() {
  selectedId = null;
  map.closePopup();
  geojsonLayer.setStyle(getFeatureStyle);
  map.flyTo([-26.1785, -58.1880], 13, { duration: 0.75 });

  const url = new URL(window.location.href);
  url.searchParams.delete('barrio');
  window.history.replaceState({}, '', url.toString());

  document.querySelectorAll('.barrio-item').forEach((el) => el.classList.remove('active'));
}

// Eventos de controles
searchInput.addEventListener('input', renderSidebarList);
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  renderSidebarList();
});

zoneSelect.addEventListener('change', () => {
  renderSidebarList();
  const visibleLayers = [];
  layerById.forEach(({ layer }) => {
    if (map.hasLayer(layer)) visibleLayers.push(layer);
  });
  if (visibleLayers.length > 0 && zoneSelect.value !== 'all') {
    const group = L.featureGroup(visibleLayers);
    map.flyToBounds(group.getBounds(), { padding: [40, 40], duration: 0.75 });
  } else if (zoneSelect.value === 'all') {
    resetView();
  }
});

colorModeSelect.addEventListener('change', (e) => {
  colorMode = e.target.value;
  geojsonLayer.setStyle(getFeatureStyle);
  renderSidebarList();
});

baseMapSelect.addEventListener('change', (e) => {
  Object.values(baseLayers).forEach((layer) => map.removeLayer(layer));
  const chosen = baseLayers[e.target.value] || baseLayers.osm;
  chosen.addTo(map);
});

toggleLabelsCheckbox.addEventListener('change', (e) => {
  document.body.classList.toggle('labels-hidden', !e.target.checked);
});

document.getElementById('resetViewBtn').addEventListener('click', resetView);
document.getElementById('fitCityBtn').addEventListener('click', resetView);

// Menú móvil
document.getElementById('mobileMenuBtn').addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// Compartir enlace
const shareDialog = document.getElementById('shareDialog');
const shareUrlInput = document.getElementById('shareUrlInput');

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2800);
}

window.copyBarrioLink = (id, name) => {
  const shareUrl = `${window.location.origin}${window.location.pathname}?barrio=${encodeURIComponent(id)}`;
  navigator.clipboard?.writeText(shareUrl).then(() => {
    showToast(`Enlace de ${name} copiado al portapapeles`);
  }).catch(() => {
    shareUrlInput.value = shareUrl;
    shareDialog.showModal();
  });
};

document.getElementById('openShareModalBtn').addEventListener('click', () => {
  shareUrlInput.value = window.location.href;
  shareDialog.showModal();
});

document.getElementById('copyShareUrlBtn').addEventListener('click', () => {
  shareUrlInput.select();
  navigator.clipboard?.writeText(shareUrlInput.value);
  showToast('¡Enlace copiado para compartir!');
});

document.getElementById('closeDialogBtn').addEventListener('click', () => {
  shareDialog.close();
});

// Inicializar lista y leer parámetro ?barrio= de la URL si viene de un enlace compartido
renderSidebarList();

const initialBarrio = new URLSearchParams(window.location.search).get('barrio');
if (initialBarrio && layerById.has(initialBarrio)) {
  setTimeout(() => selectBarrio(initialBarrio, true), 350);
}
