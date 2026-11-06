// Mapa Interactivo de Barrios de Formosa Capital + Modo Editor Visual (Leaflet + OpenStreetMap)

const STORAGE_KEY = 'barrios_formosa_geojson_v2';
const ZONE_COLORS = {
  'Centro y Casco Histórico': '#2563EB',
  'Oeste y Corredor Gutnisky': '#059669',
  'Norte Intermedio y Este': '#D97706',
  'Circuito Cinco (Zona Norte)': '#9333EA',
  'Suroeste y Expansión Sur': '#E11D48'
};

// Cargar desde localStorage si el usuario hizo ediciones locales, o usar el archivo oficial
let geojsonData = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.features) && parsed.features.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error leyendo localStorage:', e);
  }
  return JSON.parse(JSON.stringify(window.BARRIOS_FORMOSA_GEOJSON));
})();

// Asegurar que Laguna Siam esté presente incluso si había datos previos guardados
if (
  window.BARRIOS_FORMOSA_GEOJSON &&
  !geojsonData.features.some((f) => f.properties.id === 'laguna-siam')
) {
  const lagunaSiam = window.BARRIOS_FORMOSA_GEOJSON.features.find(
    (f) => f.properties.id === 'laguna-siam'
  );
  if (lagunaSiam) geojsonData.features.push(JSON.parse(JSON.stringify(lagunaSiam)));
}

// Inicializar el mapa centrado en Formosa Capital
const map = L.map('map', {
  center: [-26.1785, -58.1880],
  zoom: 13,
  minZoom: 11,
  maxZoom: 19,
  zoomControl: true
});

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

// Estado de la aplicación y del Modo Editor
let colorMode = 'barrio'; // 'barrio' | 'zona'
let fillOpacity = 0.48;
let selectedId = null;
let editorMode = false;
let drawingNewBarrio = false;
let drawPoints = [];
let drawPreviewLayer = null;
let drawVertexMarkers = [];

const layerById = new Map();
const labelMarkerById = new Map();
const labelsLayerGroup = L.layerGroup().addTo(map);
const editorHandlesGroup = L.layerGroup().addTo(map);
let geojsonLayer = null;

function computeCentroid(coords) {
  const ring = coords[0];
  let sumLon = 0, sumLat = 0;
  const n = ring.length > 1 ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    sumLon += ring[i][0];
    sumLat += ring[i][1];
  }
  return [Number((sumLat / n).toFixed(5)), Number((sumLon / n).toFixed(5))];
}

function saveToLocalStorage() {
  try {
    geojsonData.metadata.totalBarrios = geojsonData.features.length;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geojsonData));
  } catch (e) {
    console.warn('No se pudo guardar en localStorage:', e);
  }
}

function getFeatureColor(props) {
  return colorMode === 'zona' ? (ZONE_COLORS[props.zone] || props.zoneColor || props.color) : props.color;
}

function getFeatureStyle(feature) {
  const isSelected = feature.properties.id === selectedId;
  const baseColor = getFeatureColor(feature.properties);
  return {
    color: isSelected ? '#ffffff' : baseColor,
    weight: isSelected ? 3.5 : 2,
    opacity: 0.95,
    fillColor: baseColor,
    fillOpacity: isSelected ? Math.min(fillOpacity + 0.22, 0.82) : fillOpacity
  };
}

function createPopupHTML(props) {
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
        ${props.limits || 'Sin especificar'}
      </div>
      <div class="popup-section">
        ${props.description || ''}
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

function rebuildMapLayers() {
  if (geojsonLayer) {
    map.removeLayer(geojsonLayer);
  }
  labelsLayerGroup.clearLayers();
  layerById.clear();
  labelMarkerById.clear();

  geojsonData.features.forEach((f, idx) => {
    f.properties.numero = idx + 1;
    f.properties.zoneColor = ZONE_COLORS[f.properties.zone] || '#2563EB';
    const [cLat, cLon] = computeCentroid(f.geometry.coordinates);
    f.properties.centerLat = cLat;
    f.properties.centerLon = cLon;
  });

  geojsonLayer = L.geoJSON(geojsonData, {
    style: getFeatureStyle,
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      layerById.set(props.id, { layer, feature });

      layer.bindPopup(() => createPopupHTML(feature.properties), { maxWidth: 310 });

      layer.on({
        mouseover: (e) => {
          if (drawingNewBarrio) return;
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
          if (drawingNewBarrio) return;
          geojsonLayer.resetStyle(e.target);
        },
        click: (e) => {
          if (drawingNewBarrio) return;
          L.DomEvent.stopPropagation(e);
          selectBarrio(props.id, false);
          if (editorMode) {
            layer.closePopup();
          }
        }
      });

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
      labelMarkerById.set(props.id, marker);
      labelsLayerGroup.addLayer(marker);
    }
  }).addTo(map);
}

// ================= MODO EDITOR: NODOS ARRASTRABLES Y DIBUJO =================

function clearEditorHandles() {
  editorHandlesGroup.clearLayers();
}

function renderEditorHandlesForSelected() {
  clearEditorHandles();
  const formEl = document.getElementById('editorBarrioForm');
  if (!editorMode || !selectedId || drawingNewBarrio) {
    formEl.hidden = true;
    return;
  }

  const entry = layerById.get(selectedId);
  if (!entry) {
    formEl.hidden = true;
    return;
  }

  const { feature, layer } = entry;
  const props = feature.properties;

  // Rellenar formulario del barrio seleccionado
  formEl.hidden = false;
  document.getElementById('editNameInput').value = props.name || '';
  document.getElementById('editZoneInput').value = props.zone || 'Centro y Casco Histórico';
  document.getElementById('editColorInput').value = props.color || '#38bdf8';
  document.getElementById('editLimitsInput').value = props.limits || '';
  document.getElementById('editDescInput').value = props.description || '';

  // Obtener anillo de coordenadas (cerrado: el último punto repite al primero)
  const ring = feature.geometry.coordinates[0];
  const openLen = ring.length - 1;

  const updateGeometryLive = () => {
    // Asegurar cierre del anillo
    ring[ring.length - 1] = [ring[0][0], ring[0][1]];
    const latLngs = ring.slice(0, ring.length - 1).map(([lon, lat]) => [lat, lon]);
    layer.setLatLngs([latLngs]);

    // Actualizar centroide y etiqueta
    const [cLat, cLon] = computeCentroid(feature.geometry.coordinates);
    props.centerLat = cLat;
    props.centerLon = cLon;
    const labelMarker = labelMarkerById.get(props.id);
    if (labelMarker) {
      labelMarker.setLatLng([cLat, cLon]);
    }
    saveToLocalStorage();
  };

  // 1. Crear marcadores blancos arrastrables para cada vértice
  for (let i = 0; i < openLen; i++) {
    const [lon, lat] = ring[i];
    const vIcon = L.divIcon({
      className: 'vertex-handle-wrapper',
      html: `<div class="vertex-handle" title="Arrastrá para mover esquina | Clic derecho para borrar punto"></div>`,
      iconSize: [14, 14]
    });

    const vMarker = L.marker([lat, lon], {
      icon: vIcon,
      draggable: true,
      zIndexOffset: 1000
    });

    vMarker.on('drag', (e) => {
      const pos = e.target.getLatLng();
      ring[i] = [Number(pos.lng.toFixed(6)), Number(pos.lat.toFixed(6))];
      updateGeometryLive();
    });

    vMarker.on('dragend', () => {
      renderEditorHandlesForSelected();
      showToast('Punto actualizado');
    });

    vMarker.on('contextmenu', (e) => {
      L.DomEvent.stopPropagation(e);
      if (openLen <= 3) {
        showToast('Un polígono necesita al menos 3 esquinas');
        return;
      }
      ring.splice(i, 1);
      ring[ring.length - 1] = [ring[0][0], ring[0][1]];
      updateGeometryLive();
      renderEditorHandlesForSelected();
      showToast('Esquina eliminada');
    });

    editorHandlesGroup.addLayer(vMarker);

    // 2. Crear punto azul intermedio (+) entre el vértice i y el siguiente
    const nextIdx = (i + 1) % openLen;
    const [nextLon, nextLat] = ring[nextIdx];
    const midLon = Number(((lon + nextLon) / 2).toFixed(6));
    const midLat = Number(((lat + nextLat) / 2).toFixed(6));

    const mIcon = L.divIcon({
      className: 'midpoint-handle-wrapper',
      html: `<div class="midpoint-handle" title="Arrastrá para insertar una nueva esquina aquí"></div>`,
      iconSize: [11, 11]
    });

    const mMarker = L.marker([midLat, midLon], {
      icon: mIcon,
      draggable: true,
      zIndexOffset: 900
    });

    let insertedIdx = null;
    mMarker.on('dragstart', () => {
      insertedIdx = i + 1;
      ring.splice(insertedIdx, 0, [midLon, midLat]);
    });

    mMarker.on('drag', (e) => {
      if (insertedIdx !== null) {
        const pos = e.target.getLatLng();
        ring[insertedIdx] = [Number(pos.lng.toFixed(6)), Number(pos.lat.toFixed(6))];
        updateGeometryLive();
      }
    });

    mMarker.on('dragend', () => {
      renderEditorHandlesForSelected();
      showToast('Nueva esquina agregada');
    });

    editorHandlesGroup.addLayer(mMarker);
  }
}

// Dibujar un nuevo barrio haciendo clic en el mapa
function startDrawingNewBarrio() {
  drawingNewBarrio = true;
  drawPoints = [];
  clearEditorHandles();
  document.getElementById('editorBarrioForm').hidden = true;
  document.getElementById('startDrawBarrioBtn').hidden = true;
  document.getElementById('finishDrawBarrioBtn').hidden = false;
  document.getElementById('cancelDrawBarrioBtn').hidden = false;
  document.getElementById('editorStatusBadge').textContent = 'Dibujando...';
  document.getElementById('map').classList.add('drawing-cursor');
  showToast('Hacé clic en el mapa esquina por esquina para dibujar el nuevo barrio');
}

function stopDrawingNewBarrio() {
  drawingNewBarrio = false;
  drawPoints = [];
  if (drawPreviewLayer) {
    map.removeLayer(drawPreviewLayer);
    drawPreviewLayer = null;
  }
  drawVertexMarkers.forEach((m) => map.removeLayer(m));
  drawVertexMarkers = [];
  document.getElementById('startDrawBarrioBtn').hidden = false;
  document.getElementById('finishDrawBarrioBtn').hidden = true;
  document.getElementById('cancelDrawBarrioBtn').hidden = true;
  document.getElementById('editorStatusBadge').textContent = 'Activo';
  document.getElementById('map').classList.remove('drawing-cursor');
}

map.on('click', (e) => {
  if (!editorMode || !drawingNewBarrio) return;
  const lat = Number(e.latlng.lat.toFixed(6));
  const lon = Number(e.latlng.lng.toFixed(6));
  drawPoints.push([lon, lat]);

  const vIcon = L.divIcon({
    className: 'vertex-handle-wrapper',
    html: `<div class="vertex-handle"></div>`,
    iconSize: [14, 14]
  });
  const m = L.marker([lat, lon], { icon: vIcon }).addTo(map);
  drawVertexMarkers.push(m);

  const latLngs = drawPoints.map(([ln, lt]) => [lt, ln]);
  if (drawPreviewLayer) {
    map.removeLayer(drawPreviewLayer);
  }
  drawPreviewLayer = L.polygon(latLngs, {
    color: '#38bdf8',
    weight: 3,
    fillColor: '#38bdf8',
    fillOpacity: 0.35,
    dashArray: '6, 4'
  }).addTo(map);
});

document.getElementById('startDrawBarrioBtn').addEventListener('click', startDrawingNewBarrio);

document.getElementById('cancelDrawBarrioBtn').addEventListener('click', () => {
  stopDrawingNewBarrio();
  renderEditorHandlesForSelected();
});

document.getElementById('finishDrawBarrioBtn').addEventListener('click', () => {
  if (drawPoints.length < 3) {
    showToast('Hacé clic en al menos 3 esquinas en el mapa antes de terminar');
    return;
  }
  const name = prompt('Nombre del nuevo barrio (ej: Barrio Laguna Siam):', 'Barrio Nuevo');
  if (!name) return;

  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^barrio\s+/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') + '-' + Math.floor(Math.random() * 900 + 100);

  const closedRing = [...drawPoints, [drawPoints[0][0], drawPoints[0][1]]];
  const [cLat, cLon] = computeCentroid([closedRing]);

  const newFeature = {
    type: 'Feature',
    properties: {
      id: slug,
      numero: geojsonData.features.length + 1,
      name: name.trim(),
      zone: 'Oeste y Corredor Gutnisky',
      limits: 'Calles a definir en el panel editor',
      description: 'Barrio agregado desde el Modo Editor.',
      color: '#10B981',
      zoneColor: ZONE_COLORS['Oeste y Corredor Gutnisky'],
      centerLat: cLat,
      centerLon: cLon
    },
    geometry: {
      type: 'Polygon',
      coordinates: [closedRing]
    }
  };

  geojsonData.features.push(newFeature);
  saveToLocalStorage();
  stopDrawingNewBarrio();
  rebuildMapLayers();
  renderSidebarList();
  selectBarrio(slug, true);
  showToast(`¡${name} creado! Ahora podés ajustar sus datos o puntos.`);
});

// Guardar propiedades del formulario del barrio
document.getElementById('savePropsBtn').addEventListener('click', () => {
  if (!selectedId) return;
  const entry = layerById.get(selectedId);
  if (!entry) return;
  const p = entry.feature.properties;
  p.name = document.getElementById('editNameInput').value.trim() || p.name;
  p.zone = document.getElementById('editZoneInput').value;
  p.color = document.getElementById('editColorInput').value;
  p.zoneColor = ZONE_COLORS[p.zone] || '#2563EB';
  p.limits = document.getElementById('editLimitsInput').value.trim();
  p.description = document.getElementById('editDescInput').value.trim();

  saveToLocalStorage();
  rebuildMapLayers();
  renderSidebarList();
  selectBarrio(selectedId, false);
  showToast('Datos del barrio actualizados');
});

// Eliminar barrio seleccionado
document.getElementById('deleteBarrioBtn').addEventListener('click', () => {
  if (!selectedId) return;
  const entry = layerById.get(selectedId);
  if (!entry) return;
  if (!confirm(`¿Seguro que querés eliminar "${entry.feature.properties.name}"?`)) return;

  geojsonData.features = geojsonData.features.filter((f) => f.properties.id !== selectedId);
  selectedId = null;
  saveToLocalStorage();
  clearEditorHandles();
  rebuildMapLayers();
  renderSidebarList();
  document.getElementById('editorBarrioForm').hidden = true;
  showToast('Barrio eliminado');
});

// Restaurar datos originales
document.getElementById('resetDefaultDataBtn').addEventListener('click', () => {
  if (!confirm('¿Descartar las ediciones locales del navegador y volver a la versión publicada original?')) return;
  localStorage.removeItem(STORAGE_KEY);
  geojsonData = JSON.parse(JSON.stringify(window.BARRIOS_FORMOSA_GEOJSON));
  clearEditorHandles();
  rebuildMapLayers();
  renderSidebarList();
  showToast('Datos originales restaurados');
});

// Activar/Desactivar Modo Editor
const toggleEditorBtn = document.getElementById('toggleEditorBtn');
const editorPanel = document.getElementById('editorPanel');

toggleEditorBtn.addEventListener('click', () => {
  editorMode = !editorMode;
  toggleEditorBtn.classList.toggle('active', editorMode);
  editorPanel.hidden = !editorMode;
  if (!editorMode) {
    stopDrawingNewBarrio();
    clearEditorHandles();
  } else {
    map.closePopup();
    renderEditorHandlesForSelected();
    showToast('Modo Editor activado: hacé clic en un barrio para mover sus puntos');
  }
});

// ================= LISTA LATERAL Y CONTROLES GENERALES =================

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

  const features = geojsonData.features;
  const filtered = features.filter((f) => {
    const p = f.properties;
    const matchZone = zoneFilter === 'all' || p.zone === zoneFilter;
    const matchQuery =
      !query ||
      p.name.toLowerCase().includes(query) ||
      (p.limits && p.limits.toLowerCase().includes(query)) ||
      p.zone.toLowerCase().includes(query);
    return matchZone && matchQuery;
  });

  countLabel.textContent = `Mostrando ${filtered.length} de ${features.length} barrios`;

  const visibleIds = new Set(filtered.map((f) => f.properties.id));
  layerById.forEach(({ layer }, id) => {
    if (visibleIds.has(id)) {
      if (!map.hasLayer(layer)) geojsonLayer.addLayer(layer);
    } else {
      if (map.hasLayer(layer)) geojsonLayer.removeLayer(layer);
    }
  });
  labelMarkerById.forEach((marker, id) => {
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
    if (!editorMode) {
      entry.layer.openPopup();
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set('barrio', id);
  window.history.replaceState({}, '', url.toString());

  document.querySelectorAll('.barrio-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  const activeItem = listContainer.querySelector(`.barrio-item[data-id="${id}"]`);
  if (activeItem && !flyTo) {
    activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (editorMode) {
    renderEditorHandlesForSelected();
  }
}

function resetView() {
  selectedId = null;
  map.closePopup();
  clearEditorHandles();
  document.getElementById('editorBarrioForm').hidden = true;
  geojsonLayer.setStyle(getFeatureStyle);
  map.flyTo([-26.1785, -58.1880], 13, { duration: 0.75 });

  const url = new URL(window.location.href);
  url.searchParams.delete('barrio');
  window.history.replaceState({}, '', url.toString());

  document.querySelectorAll('.barrio-item').forEach((el) => el.classList.remove('active'));
}

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

document.getElementById('mobileMenuBtn').addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// Descargar GeoJSON actualizado (incluyendo ediciones)
document.getElementById('downloadGeojsonBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(geojsonData, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'barrios-formosa.geojson';
  a.click();
  URL.revokeObjectURL(url);
});

// ================= COMPARTIR Y PUBLICAR EN GITHUB DESDE EL NAVEGADOR =================

const shareDialog = document.getElementById('shareDialog');
const shareUrlInput = document.getElementById('shareUrlInput');
const githubDialog = document.getElementById('githubDialog');
const githubTokenInput = document.getElementById('githubTokenInput');
const githubPublishStatus = document.getElementById('githubPublishStatus');

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
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

// Publicar en GitHub directamente desde la web
document.getElementById('publishGithubBtn').addEventListener('click', () => {
  const savedToken = localStorage.getItem('gh_token_formosa') || '';
  githubTokenInput.value = savedToken;
  githubPublishStatus.textContent = '';
  githubDialog.showModal();
});

document.getElementById('closeGithubDialogBtn').addEventListener('click', () => {
  githubDialog.close();
});

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function updateGitHubFile(token, path, contentStr, message) {
  const owner = 'SandroLopezFsa';
  const repo = 'mapa-barrios-formosa';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };

  const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers });
  let sha = undefined;
  if (getRes.ok) {
    const data = await getRes.json();
    sha = data.sha;
  }

  const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message,
      content: utf8ToBase64(contentStr),
      branch: 'main',
      ...(sha ? { sha } : {})
    })
  });

  if (!putRes.ok) {
    const err = await putRes.json();
    throw new Error(err.message || `Error HTTP ${putRes.status}`);
  }
}

document.getElementById('confirmPublishGithubBtn').addEventListener('click', async () => {
  const token = githubTokenInput.value.trim();
  if (!token) {
    githubPublishStatus.textContent = 'Por favor ingresá tu token ghp_...';
    return;
  }
  localStorage.setItem('gh_token_formosa', token);
  githubPublishStatus.textContent = '⏳ Subiendo cambios a GitHub Pages...';

  try {
    const geojsonStr = JSON.stringify(geojsonData, null, 2);
    const dataJsStr = `// Auto-generated GeoJSON data for Barrios de Formosa Capital\nwindow.BARRIOS_FORMOSA_GEOJSON = ${geojsonStr};\n`;

    await updateGitHubFile(token, 'barrios-formosa.geojson', geojsonStr, 'Actualizar límites y barrios desde el Editor Web');
    await updateGitHubFile(token, 'barrios-data.js', dataJsStr, 'Actualizar datos de barrios desde el Editor Web');

    githubPublishStatus.textContent = '✅ ¡Publicado con éxito! En 30-60 seg se actualiza para todo el mundo.';
    showToast('¡Cambios publicados en tu GitHub Pages!');
    setTimeout(() => githubDialog.close(), 2200);
  } catch (err) {
    githubPublishStatus.textContent = `❌ Error: ${err.message}`;
  }
});

// Inicializar capas y lista
rebuildMapLayers();
renderSidebarList();

const initialBarrio = new URLSearchParams(window.location.search).get('barrio');
if (initialBarrio && layerById.has(initialBarrio)) {
  setTimeout(() => selectBarrio(initialBarrio, true), 350);
}
