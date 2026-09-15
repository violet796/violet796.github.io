(function () {
  'use strict';

  var runtime = window.KnightTravelRuntime || { controller: null, hooksBound: false };
  window.KnightTravelRuntime = runtime;

  function destroyTravelMap() {
    var controller = runtime.controller;
    if (!controller) return;
    runtime.controller = null;
    try {
      (controller.cleanup || []).forEach(function (fn) {
        try { fn(); } catch (e) {}
      });
    } catch (e) {}
    try {
      if (controller.map) {
        controller.map.off();
        controller.map.remove();
      }
    } catch (e) {}
    try {
      if (controller.mapNode) {
        controller.mapNode.dataset.ready = '';
        controller.mapNode.innerHTML = '';
        if (controller.mapNode._leaflet_id) delete controller.mapNode._leaflet_id;
      }
    } catch (e) {}
  }

  function initTravelMap() {
    var root = document.querySelector('[data-travel-page]');
    var mapNode = document.getElementById('travelMap');
    if (!root || !mapNode || !window.L || typeof window.L.markerClusterGroup !== 'function') return;

    if (runtime.controller && runtime.controller.root === root && runtime.controller.mapNode === mapNode) {
      try { runtime.controller.map.invalidateSize({ pan: false }); } catch (e) {}
      return;
    }

    destroyTravelMap();
    // Defensive recovery for a node that was previously touched by Leaflet but
    // whose map instance was lost during a PJAX swap / aborted navigation.
    // Leaflet refuses to initialize the same container twice unless its stamp
    // is cleared.
    try {
      if (mapNode._leaflet_id) delete mapNode._leaflet_id;
      mapNode.innerHTML = '';
    } catch (e) {}
    mapNode.dataset.ready = '1';
    var cleanup = [];

    var places = Array.isArray(window.KnightTravelPlaces) ? window.KnightTravelPlaces : [];
    var activeYear = 'all';
    var currentPlace = null;
    var currentVisit = 'all';
    var currentPhoto = null;
    var archiveMode = 'timeline';
    var openCities = Object.create(null);

    function escaped(value) {
      return String(value == null ? '' : value).replace(/[&<>'"]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c];
      });
    }

    function bySlug(slug) {
      return places.find(function (p) { return p.slug === slug; });
    }

    function journeyList(place) {
      return (place && (place.journeys || place.visits)) || [];
    }

    function declaredVisitList(place) {
      return (place && (place.declared_visits || place.journeys || place.visits)) || [];
    }

    function visitYearById(place, visitId) {
      var id = String(visitId || '');
      if (!id) return '';
      var visit = declaredVisitList(place).find(function (row) { return String(row.id) === id; });
      var raw = String((visit && (visit.date || visit.id)) || id);
      var year = raw.slice(0, 4);
      return /^\d{4}$/.test(year) ? year : '';
    }

    function photoYear(photo, place) {
      var archived = String((photo && photo.archive_year) || '');
      if (/^\d{4}$/.test(archived)) return archived;
      var direct = String((photo && photo.taken_at) || '').slice(0, 4);
      if (/^\d{4}$/.test(direct)) return direct;
      // A matched journey photo is also part of the timeline. If capture time
      // is missing, the declared journey date may supply its archive year.
      return photo && photo.visit ? visitYearById(place, photo.visit) : '';
    }

    function photoMonth(photo, place) {
      var archived = String((photo && photo.archive_month) || '');
      if (/^\d{4}-\d{2}$/.test(archived)) return archived;
      var direct = String((photo && photo.taken_at) || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(direct)) return direct;
      if (photo && photo.visit) {
        var visit = visitById(place, photo.visit) || declaredVisitList(place).find(function (row) {
          return String(row.id) === String(photo.visit);
        });
        var raw = String((visit && (visit.date || visit.id)) || '');
        var month = raw.slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(month)) return month;
      }
      return '';
    }

    function placeHasDeclaredVisitYear(place, year) {
      if (!year || year === 'all') return false;
      return declaredVisitList(place).some(function (visit) {
        var y = String(visit.date || visit.id || '').slice(0, 4);
        return y === String(year);
      });
    }

    function visiblePhoto(photo, place) {
      return activeYear === 'all' || photoYear(photo, place) === activeYear;
    }

    function visiblePhotos(place, groupKey) {
      var key = String(groupKey || 'all');
      return (place.photos || []).filter(function (photo) {
        if (!visiblePhoto(photo, place)) return false;
        if (key === 'all') return true;
        if (key.indexOf('time:') === 0) {
          var year = key.slice(5);
          var pYear = photoYear(photo, place);
          return year === 'undated' ? !pYear : pYear === year;
        }
        if (key.indexOf('month:') === 0) {
          var month = key.slice(6);
          var pMonth = photoMonth(photo, place);
          return month === 'undated' ? !pMonth : pMonth === month;
        }
        if (key.indexOf('journey:') === 0) {
          return String(photo.visit || '') === key.slice(8);
        }
        // Backwards compatibility for callers still passing a raw journey id.
        return String(photo.visit || '') === key;
      });
    }

    function visitById(place, id) {
      if (!place || !id) return null;
      return journeyList(place).find(function (v) { return String(v.id) === String(id); }) || null;
    }

    function visitLabel(place, id) {
      if (!id) return '未归档旅程';
      var visit = visitById(place, id);
      return visit ? (visit.label || visit.date || visit.id) : String(id);
    }

    function timeArchiveLabel(photo, place) {
      var month = photoMonth(photo, place);
      if (activeYear !== 'all' && month && month.slice(0, 4) === activeYear) {
        return parseInt(month.slice(5, 7), 10) + '月';
      }
      var year = photoYear(photo, place);
      return year ? year + '年' : '未标记时间';
    }

    function formatDate(value) {
      if (!value) return '未填写';
      var raw = String(value).trim();
      var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
      if (!m) return raw;
      return m[1] + '.' + m[2] + '.' + m[3] + (m[4] ? ' · ' + m[4] + ':' + m[5] : '');
    }

    function formatCoords(lat, lng) {
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '未填写';
      var a = Math.abs(Number(lat)).toFixed(5) + '°' + (Number(lat) >= 0 ? 'N' : 'S');
      var b = Math.abs(Number(lng)).toFixed(5) + '°' + (Number(lng) >= 0 ? 'E' : 'W');
      return a + ' · ' + b;
    }

    function allVisiblePhotos() {
      var rows = [];
      places.forEach(function (place) {
        visiblePhotos(place, 'all').forEach(function (photo) {
          rows.push({ place: place, photo: photo });
        });
      });
      return rows;
    }

    var worldBounds = L.latLngBounds([[-84, -179.8], [84, 179.8]]);
    var map = L.map(mapNode, {
      minZoom: 2,
      maxZoom: 18,
      zoomSnap: 1,
      worldCopyJump: false,
      zoomControl: false,
      attributionControl: true,
      maxBounds: worldBounds,
      maxBoundsViscosity: 1,
      fadeAnimation: false,
      markerZoomAnimation: true,
      preferCanvas: true
    }).setView([26, 18], 2);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    runtime.controller = { root: root, mapNode: mapNode, map: map, cleanup: cleanup };

    var loading = root.querySelector('[data-travel-loading]');
    // V2.1: return to the V1 OpenStreetMap visual language.  The dark look is
    // produced by CSS so we keep the richer road/land/label detail that the
    // first prototype had, while retaining V2's buffering and loading guards.
    var tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc',
      maxZoom: 19,
      noWrap: true,
      keepBuffer: 5,
      updateWhenIdle: true,
      updateWhenZooming: false,
      detectRetina: false,
      attribution: '&copy; OpenStreetMap contributors'
    });
    tileLayer.addTo(map);

    var firstTileShown = false;
    function hideLoading() {
      if (!loading || firstTileShown) return;
      firstTileShown = true;
      loading.classList.add('is-hidden');
      setTimeout(function () { if (loading) loading.hidden = true; }, 320);
    }
    tileLayer.once('tileload', hideLoading);
    tileLayer.once('load', hideLoading);
    setTimeout(hideLoading, 2600);

    map.on('moveend', function () {
      map.panInsideBounds(worldBounds, { animate: false });
    });

    var clusters = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 58,
      spiderfyOnMaxZoom: true,
      spiderfyDistanceMultiplier: 1.35,
      removeOutsideVisibleBounds: true,
      chunkedLoading: true,
      chunkInterval: 120,
      chunkDelay: 16,
      iconCreateFunction: function (cluster) {
        var n = cluster.getChildCount();
        return L.divIcon({
          className: 'travel-cluster-shell',
          html: '<div class="travel-cluster"><span>' + n + '</span><small>photos</small></div>',
          iconSize: [54, 54]
        });
      }
    });
    map.addLayer(clusters);

    // City-level year highlights are independent from photo clusters. They are
    // shown when a year is selected and a city's meta.json declares a visit in
    // that year, even when the visit currently has no photos.
    var yearVisitLayer = L.layerGroup().addTo(map);

    var photoMarkers = new Map();
    var panel = root.querySelector('[data-travel-panel]');
    var panelEmpty = panel.querySelector('[data-panel-empty]');
    var panelPlace = panel.querySelector('[data-panel-place]');
    var panelPhoto = panel.querySelector('[data-panel-photo]');
    var archiveNode = root.querySelector('[data-travel-archive]');
    var lightbox = document.querySelector('[data-travel-lightbox]');
    var lightboxImg = lightbox && lightbox.querySelector('[data-travel-lightbox-image]');
    var lightboxCaption = lightbox && lightbox.querySelector('[data-travel-lightbox-caption]');
    var lightboxItems = [];
    var lightboxIndex = 0;

    function markerIcon(place, photo) {
      var ratio = Number(photo && photo.aspect_ratio);
      if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;
      var markerHeight = 60;
      var markerWidth = Math.max(46, Math.min(112, Math.round(markerHeight * ratio)));
      var visual = photo && photo.src
        ? '<img src="' + escaped(photo.src) + '" alt="">'
        : '<div class="travel-pin-fallback"><i class="fas fa-camera"></i></div>';
      return L.divIcon({
        className: 'travel-photo-marker-wrap',
        html: '<div class="travel-photo-marker" style="--travel-marker-w:' + markerWidth + 'px;--travel-marker-h:' + markerHeight + 'px" role="button" aria-label="查看照片详情" data-travel-photo-id="' + escaped(photo.id) + '" data-travel-place-slug="' + escaped(place.slug) + '">' + visual + '</div>',
        iconSize: [markerWidth, markerHeight + 10],
        iconAnchor: [Math.round(markerWidth / 2), markerHeight + 8]
      });
    }

    function showPanelMode(mode) {
      if (!panel || !panelEmpty || !panelPlace || !panelPhoto) return false;
      panel.classList.add('is-open');
      panel.dataset.mode = mode;
      panelEmpty.hidden = mode !== 'empty';
      panelPlace.hidden = mode !== 'place';
      panelPhoto.hidden = mode !== 'photo';
      return true;
    }

    // Delegated capture handler: this is the authoritative photo-marker click
    // path.  It does not depend on Leaflet/MarkerCluster bubbling, so clicking
    // the thumbnail itself always opens the photo-detail panel.
    mapNode.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-travel-photo-id]') : null;
      if (!target || !mapNode.contains(target)) return;
      var place = bySlug(target.getAttribute('data-travel-place-slug'));
      if (!place) return;
      var photoId = target.getAttribute('data-travel-photo-id');
      var photo = (place.photos || []).find(function (item) { return String(item.id) === String(photoId); });
      if (!photo) return;
      event.preventDefault();
      event.stopPropagation();
      showPhoto(place, photo, false);
    }, true);

    function fitPhotoRows(rows, maxZoom) {
      if (!rows || !rows.length) return;
      if (rows.length === 1) {
        map.flyTo([rows[0].photo.lat, rows[0].photo.lng], Math.max(map.getZoom(), maxZoom || 12), { duration: .65 });
        return;
      }
      var bounds = L.latLngBounds(rows.map(function (row) { return [row.photo.lat, row.photo.lng]; }));
      if (bounds.isValid()) map.fitBounds(bounds.pad(.22), { maxZoom: maxZoom || 12, animate: true });
    }

    function showPlace(place, groupKey, fly) {
      if (!place) return;
      currentPlace = place;
      currentVisit = groupKey || 'all';
      currentPhoto = null;
      var photos = visiblePhotos(place, currentVisit);
      if (fly !== false && photos.length) fitPhotoRows(photos.map(function (photo) { return { place: place, photo: photo }; }), 13);

      showPanelMode('place');
      var cover = panel.querySelector('[data-travel-cover]');
      var coverPhoto = photos[0] || (place.photos || [])[0];
      cover.style.backgroundImage = coverPhoto ? 'url("' + coverPhoto.src.replace(/"/g, '\\"') + '")' : '';
      cover.classList.toggle('is-empty', !coverPhoto);
      panel.querySelector('[data-travel-country]').textContent = place.country;
      panel.querySelector('[data-travel-name]').textContent = place.name;
      var journeyCount = journeyList(place).filter(function (journey) { return visiblePhotos(place, 'journey:' + journey.id).length > 0; }).length;
      panel.querySelector('[data-place-summary]').textContent = (journeyCount ? (journeyCount + ' 次旅程 · ') : '') + photos.length + ' 张照片';

      var currentJourney = currentVisit.indexOf('journey:') === 0 ? visitById(place, currentVisit.slice(8)) : null;
      panel.querySelector('[data-travel-note]').textContent = currentJourney && currentJourney.note ? currentJourney.note : (place.note || '');

      var tabs = panel.querySelector('[data-travel-visit-tabs]');
      tabs.innerHTML = '';
      var allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = currentVisit === 'all' ? 'is-active' : '';
      allBtn.textContent = '全部';
      allBtn.addEventListener('click', function () { showPlace(place, 'all', false); });
      tabs.appendChild(allBtn);

      // The global year filter already establishes the year context. Once a
      // specific year is selected, the place panel drills down by month for
      // every city instead of redundantly showing years (or journey tabs).
      if (activeYear !== 'all') {
        monthRows(place, activeYear).forEach(function (row) {
          var group = row.group;
          var count = row.photos.length;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = currentVisit === group.id ? 'is-active' : '';
          btn.textContent = (group.label || '未标记月份') + ' · ' + count;
          btn.addEventListener('click', function () { showPlace(place, group.id, true); });
          tabs.appendChild(btn);
        });
      } else if (place.resident) {
        timeRows(place).forEach(function (row) {
          var group = row.group;
          var count = row.photos.length;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = currentVisit === group.id ? 'is-active' : '';
          btn.textContent = (group.label || group.year || '未标记时间') + ' · ' + count;
          btn.addEventListener('click', function () { showPlace(place, group.id, true); });
          tabs.appendChild(btn);
        });
      } else {
        journeyList(place).forEach(function (journey) {
          var key = 'journey:' + journey.id;
          var count = visiblePhotos(place, key).length;
          if (!count) return;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = currentVisit === key ? 'is-active' : '';
          btn.textContent = (journey.label || journey.date || journey.id) + ' · ' + count;
          btn.addEventListener('click', function () { showPlace(place, key, true); });
          tabs.appendChild(btn);
        });
      }

      var gallery = panel.querySelector('[data-travel-photos]');
      gallery.innerHTML = '';
      photos.forEach(function (photo) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.title = photo.title || place.name;
        btn.innerHTML = '<img src="' + escaped(photo.src) + '" alt="' + escaped(photo.title || place.name) + '"><span>' + escaped(formatDate(photo.taken_at)) + '</span>';
        btn.addEventListener('click', function () { showPhoto(place, photo, true); });
        gallery.appendChild(btn);
      });
    }

    function photoGroupKey(place, photo) {
      if (photo && photo.visit) return 'journey:' + photo.visit;
      var month = photoMonth(photo, place);
      if (activeYear !== 'all' && month && month.slice(0, 4) === activeYear) return 'month:' + month;
      var year = photoYear(photo, place);
      return 'time:' + (year || 'undated');
    }

    function showPhoto(place, photo, fly) {
      if (!place || !photo) return;
      currentPlace = place;
      currentPhoto = photo;
      currentVisit = photoGroupKey(place, photo);
      if (fly !== false) map.flyTo([photo.lat, photo.lng], Math.max(map.getZoom(), 14), { duration: .65 });
      if (!showPanelMode('photo')) return;
      panelPhoto.scrollTop = 0;
      var photoImage = panel.querySelector('[data-photo-image]');
      photoImage.src = photo.src;
      photoImage.alt = photo.title || photo.file || place.name;
      panel.querySelector('[data-photo-place]').textContent = place.country + ' · ' + place.name;
      panel.querySelector('[data-photo-title]').textContent = photo.title || photo.file || place.name;
      panel.querySelector('[data-photo-time]').textContent = formatDate(photo.taken_at);
      var groupName = panel.querySelector('[data-photo-group-name]');
      var groupAction = panel.querySelector('[data-photo-show-group-label]');
      var groupKey = photoGroupKey(place, photo);
      if (photo.visit) {
        panel.querySelector('[data-photo-visit]').textContent = visitLabel(place, photo.visit);
        if (groupName) groupName.textContent = '旅程';
        if (groupAction) groupAction.textContent = '查看本次旅程';
      } else {
        panel.querySelector('[data-photo-visit]').textContent = timeArchiveLabel(photo, place);
        if (groupName) groupName.textContent = '时间归档';
        if (groupAction) groupAction.textContent = '查看同期照片';
      }
      panel.querySelector('[data-photo-coords]').textContent = formatCoords(photo.lat, photo.lng);
      panel.querySelector('[data-photo-note]').textContent = photo.note || '这张照片还没有写下感想。';
      panel.querySelectorAll('[data-photo-lightbox]').forEach(function (btn) {
        btn.onclick = function () { openLightbox(place, photo, visiblePhotos(place, groupKey)); };
      });
      panel.querySelector('[data-photo-show-visit]').onclick = function () { showPlace(place, groupKey, true); };
    }

    function closePanel() {
      panel.classList.remove('is-open');
    }

    function openLightbox(place, photo, list) {
      if (!lightbox) return;
      var source = Array.isArray(list) && list.length ? list : (place.photos || []);
      lightboxItems = source.map(function (p) { return { place: place, photo: p }; });
      lightboxIndex = Math.max(0, lightboxItems.findIndex(function (item) { return item.photo.id === photo.id; }));
      lightbox.hidden = false;
      document.documentElement.classList.add('travel-lightbox-open');
      renderLightbox();
    }

    function renderLightbox() {
      if (!lightboxItems.length) return;
      var item = lightboxItems[lightboxIndex];
      lightboxImg.src = item.photo.src;
      var pieces = [item.place.name, formatDate(item.photo.taken_at), (lightboxIndex + 1) + ' / ' + lightboxItems.length];
      if (item.photo.note) pieces.push(item.photo.note);
      lightboxCaption.textContent = pieces.join(' · ');
    }

    function closeLightbox() {
      if (!lightbox) return;
      lightbox.hidden = true;
      document.documentElement.classList.remove('travel-lightbox-open');
    }

    function stepLightbox(dir) {
      if (!lightboxItems.length) return;
      lightboxIndex = (lightboxIndex + dir + lightboxItems.length) % lightboxItems.length;
      renderLightbox();
    }

    function yearCityIcon(place) {
      var label = escaped(place.name || '城市');
      return L.divIcon({
        className: 'travel-year-city-marker-wrap',
        html: '<div class="travel-year-city-marker"><i></i><span>' + label + '</span></div>',
        iconSize: [116, 36],
        iconAnchor: [18, 18]
      });
    }

    function renderMap() {
      clusters.clearLayers();
      yearVisitLayer.clearLayers();
      photoMarkers.clear();
      var rows = allVisiblePhotos();
      var focusPoints = rows.map(function (row) { return [row.photo.lat, row.photo.lng]; });

      if (activeYear !== 'all') {
        places.forEach(function (place) {
          if (!placeHasDeclaredVisitYear(place, activeYear)) return;
          if (!Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) return;
          var marker = L.marker([place.lat, place.lng], {
            icon: yearCityIcon(place),
            keyboard: true,
            zIndexOffset: -120,
            title: (place.name || '城市') + ' · ' + activeYear + ' 有旅程记录'
          });
          marker.on('click', function () {
            showPlace(place, 'all', false);
            map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 9), { duration: .55 });
          });
          marker.addTo(yearVisitLayer);
          focusPoints.push([place.lat, place.lng]);
        });
      }

      rows.forEach(function (row) {
        var photo = row.photo;
        var place = row.place;
        var marker = L.marker([photo.lat, photo.lng], {
          icon: markerIcon(place, photo),
          title: (photo.title || place.name) + ' · ' + place.name,
          keyboard: true,
          riseOnHover: true
        });
        // Marker click is bound twice on purpose: Leaflet's own event is the
        // normal path, while a capture-phase DOM handler guarantees that a
        // click on the thumbnail itself still opens the photo panel.  The DOM
        // handler stops propagation, so the two paths do not double-fire.
        marker.on('click', function (evt) {
          if (evt && evt.originalEvent) L.DomEvent.stopPropagation(evt.originalEvent);
          showPhoto(place, photo, false);
        });
        marker.on('add', function () {
          var el = marker.getElement();
          if (!el || el.dataset.travelPhotoBound === '1') return;
          el.dataset.travelPhotoBound = '1';
          el.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            showPhoto(place, photo, false);
          }, true);
          el.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            showPhoto(place, photo, false);
          });
        });
        clusters.addLayer(marker);
        photoMarkers.set(photo.id, marker);
      });

      if (focusPoints.length) {
        if (focusPoints.length === 1) {
          map.setView(focusPoints[0], rows.length === 1 ? 11 : 8, { animate: true });
        } else {
          var bounds = L.latLngBounds(focusPoints);
          if (bounds.isValid()) map.fitBounds(bounds.pad(.24), { maxZoom: rows.length ? 6 : 7, animate: true });
        }
      } else {
        map.setView([26, 18], 2);
      }
      renderArchive();
    }

    function countryKey(place) {
      return place.country_code || place.country || 'unknown';
    }

    function cityArchivePhotos(place) {
      return visiblePhotos(place, 'all');
    }

    function journeyRows(place) {
      return journeyList(place).map(function (journey) {
        return { journey: journey, photos: visiblePhotos(place, 'journey:' + journey.id) };
      }).filter(function (row) { return row.photos.length > 0; });
    }

    function timeRows(place) {
      // Build the timeline directly from real city photos at runtime instead of
      // trusting a precomputed time_archives array. This keeps the archive in
      // sync with the actual country/city/photos directory and also allows a
      // journey photo to appear in the year timeline at the same time.
      var buckets = Object.create(null);
      visiblePhotos(place, 'all').forEach(function (photo) {
        var year = photoYear(photo, place);
        var key = year || 'undated';
        if (!buckets[key]) {
          buckets[key] = {
            group: {
              id: key === 'undated' ? 'time:undated' : 'time:' + key,
              year: key === 'undated' ? '' : key,
              label: key === 'undated' ? '未标记时间' : key + '年'
            },
            photos: []
          };
        }
        buckets[key].photos.push(photo);
      });
      return Object.keys(buckets).sort(function (a, b) {
        if (a === 'undated') return 1;
        if (b === 'undated') return -1;
        return b.localeCompare(a);
      }).map(function (key) { return buckets[key]; });
    }

    function monthRows(place, year) {
      var targetYear = String(year || activeYear || '');
      var buckets = Object.create(null);
      visiblePhotos(place, 'all').forEach(function (photo) {
        var month = photoMonth(photo, place);
        var key = month && month.slice(0, 4) === targetYear ? month : 'undated';
        if (!buckets[key]) {
          var monthNumber = key === 'undated' ? '' : String(parseInt(key.slice(5, 7), 10));
          buckets[key] = {
            group: {
              id: key === 'undated' ? 'month:undated' : 'month:' + key,
              month: key === 'undated' ? '' : key,
              label: key === 'undated' ? '未标记月份' : monthNumber + '月'
            },
            photos: []
          };
        }
        buckets[key].photos.push(photo);
      });
      return Object.keys(buckets).sort(function (a, b) {
        if (a === 'undated') return 1;
        if (b === 'undated') return -1;
        return a.localeCompare(b);
      }).map(function (key) { return buckets[key]; });
    }

    function renderPhotoGrid(container, place, photos) {
      var grid = document.createElement('div');
      grid.className = 'travel-city-photo-grid';
      photos.forEach(function (photo) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = '<img src="' + escaped(photo.src) + '" alt="' + escaped(photo.title || place.name) + '"><span><strong>' + escaped(photo.title || '旅行照片') + '</strong><em>' + escaped(formatDate(photo.taken_at)) + '</em></span>';
        btn.addEventListener('click', function () { openLightbox(place, photo, photos); });
        grid.appendChild(btn);
      });
      container.appendChild(grid);
    }

    function renderArchiveSections(album, place) {
      if (archiveMode === 'timeline') {
        var rows = timeRows(place);
        rows.forEach(function (row) {
          var section = document.createElement('section');
          section.className = 'travel-album-section';
          section.innerHTML = '<header><div><small>TIME ARCHIVE</small><strong>' + escaped(row.group.label || row.group.year || '未标记时间') + '</strong></div><span>' + row.photos.length + ' 张照片</span></header>';
          renderPhotoGrid(section, place, row.photos);
          album.appendChild(section);
        });
        return;
      }

      journeyRows(place).forEach(function (row) {
        var section = document.createElement('section');
        section.className = 'travel-album-section travel-album-section--journey';
        var note = row.journey.note ? '<p>' + escaped(row.journey.note) + '</p>' : '';
        section.innerHTML = '<header><div><small>JOURNEY</small><strong>' + escaped(row.journey.label || row.journey.date || row.journey.id) + '</strong>' + note + '</div><span>' + row.photos.length + ' 张照片</span></header>';
        renderPhotoGrid(section, place, row.photos);
        album.appendChild(section);
      });
    }

    function renderArchive() {
      if (!archiveNode) return;
      archiveNode.innerHTML = '';
      var groups = Object.create(null);
      places.forEach(function (place) {
        var key = countryKey(place);
        if (!groups[key]) groups[key] = { key: key, country: place.country, places: [] };
        groups[key].places.push(place);
      });

      Object.keys(groups).sort(function (a, b) { return groups[a].country.localeCompare(groups[b].country, 'zh-CN'); }).forEach(function (key) {
        var group = groups[key];
        var cityRows = group.places.map(function (place) {
          var photos = cityArchivePhotos(place);
          var groupsForMode = archiveMode === 'timeline' ? timeRows(place) : journeyRows(place);
          return { place: place, photos: photos, archiveGroups: groupsForMode };
        }).filter(function (row) {
          if (archiveMode === 'journey') return row.archiveGroups.length > 0;
          return row.photos.length > 0;
        });
        if (!cityRows.length) return;

        var photoCount = cityRows.reduce(function (sum, row) {
          if (archiveMode === 'journey') return sum + row.archiveGroups.reduce(function (n, g) { return n + g.photos.length; }, 0);
          return sum + row.photos.length;
        }, 0);
        var groupCount = cityRows.reduce(function (sum, row) { return sum + row.archiveGroups.length; }, 0);

        var country = document.createElement('article');
        country.className = 'travel-country-block';
        var statHtml = '<strong>' + cityRows.length + '</strong><span>城市</span>';
        if (archiveMode === 'journey') statHtml += '<strong>' + groupCount + '</strong><span>旅程</span>';
        statHtml += '<strong>' + photoCount + '</strong><span>照片</span>';
        country.innerHTML = '<header class="travel-country-head">' +
          '<div><span>' + escaped(group.key) + '</span><h3>' + escaped(group.country) + '</h3></div>' +
          '<div class="travel-country-stats">' + statHtml + '</div>' +
          '</header><div class="travel-city-list"></div>';

        var cityList = country.querySelector('.travel-city-list');
        cityRows.forEach(function (row) {
          var place = row.place;
          var photos = row.photos;
          var archiveGroups = row.archiveGroups;
          var city = document.createElement('section');
          city.className = 'travel-city-card' +
            (openCities[place.slug] ? ' is-open' : '') +
            (activeYear !== 'all' && placeHasDeclaredVisitYear(place, activeYear) ? ' is-year-visit' : '');
          var cover = photos[0] || (place.photos || [])[0];
          var summary = archiveMode === 'timeline'
            ? (photos.length + ' 张照片')
            : (archiveGroups.length + ' 次旅程 · ' + archiveGroups.reduce(function (n, g) { return n + g.photos.length; }, 0) + ' 张照片');
          city.innerHTML = '<div class="travel-city-main">' +
            '<button type="button" class="travel-city-toggle" aria-expanded="' + (openCities[place.slug] ? 'true' : 'false') + '">' +
              '<span class="travel-city-cover"' + (cover ? ' style="background-image:url(&quot;' + escaped(cover.src) + '&quot;)"' : '') + '></span>' +
              '<span class="travel-city-copy"><small>' + escaped(group.country) + '</small><strong>' + escaped(place.name) + '</strong><em>' + summary + '</em></span>' +
              '<i class="fas fa-chevron-down"></i>' +
            '</button>' +
            '<button type="button" class="travel-city-locate"><i class="fas fa-location-arrow"></i>地图</button>' +
          '</div><div class="travel-city-album"></div>';

          city.querySelector('.travel-city-toggle').addEventListener('click', function () {
            openCities[place.slug] = !openCities[place.slug];
            renderArchive();
          });
          city.querySelector('.travel-city-locate').addEventListener('click', function () {
            showPlace(place, 'all', true);
            mapNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });

          if (openCities[place.slug]) {
            renderArchiveSections(city.querySelector('.travel-city-album'), place);
          }
          cityList.appendChild(city);
        });

        archiveNode.appendChild(country);
      });
    }

    var archiveModeNode = root.querySelector('[data-travel-archive-mode]');
    if (archiveModeNode) {
      archiveModeNode.querySelectorAll('[data-archive-mode]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          archiveMode = btn.dataset.archiveMode === 'journey' ? 'journey' : 'timeline';
          archiveModeNode.querySelectorAll('[data-archive-mode]').forEach(function (item) {
            item.classList.toggle('is-active', item === btn);
          });
          renderArchive();
        });
      });
    }

    root.querySelectorAll('[data-year]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        root.querySelectorAll('[data-year]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        activeYear = btn.dataset.year || 'all';
        closePanel();
        renderMap();
      });
    });

    panel.querySelector('.travel-panel-close').addEventListener('click', closePanel);
    panel.querySelector('[data-photo-back]').addEventListener('click', function () {
      if (currentPlace) showPlace(currentPlace, currentVisit || 'all', false);
    });

    if (lightbox) {
      lightbox.querySelector('.travel-lightbox-close').addEventListener('click', closeLightbox);
      lightbox.querySelector('.travel-lightbox-prev').addEventListener('click', function () { stepLightbox(-1); });
      lightbox.querySelector('.travel-lightbox-next').addEventListener('click', function () { stepLightbox(1); });
      lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
    }

    function travelKeys(e) {
      if (!lightbox || lightbox.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
    }
    document.addEventListener('keydown', travelKeys);
    cleanup.push(function () { document.removeEventListener('keydown', travelKeys); });

    var resizeTimer = null;
    function travelResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        try { map.invalidateSize({ pan: false }); } catch (e) {}
      }, 120);
    }
    window.addEventListener('resize', travelResize);
    cleanup.push(function () {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', travelResize);
    });

    if (window.ResizeObserver) {
      var travelResizeObserver = new ResizeObserver(function () {
        if (!runtime.controller || runtime.controller.map !== map) return;
        try { map.invalidateSize({ pan: false }); } catch (e) {}
      });
      travelResizeObserver.observe(mapNode.parentElement || mapNode);
      cleanup.push(function () { travelResizeObserver.disconnect(); });
    }

    renderMap();
    [0, 80, 240, 600].forEach(function (delay) {
      var timer = setTimeout(function () {
        if (!runtime.controller || runtime.controller.map !== map) return;
        try { map.invalidateSize({ pan: false }); } catch (e) {}
      }, delay);
      cleanup.push(function () { clearTimeout(timer); });
    });
  }

  window.KnightTravelInit = initTravelMap;
  window.KnightTravelDestroy = destroyTravelMap;

  if (!runtime.hooksBound) {
    runtime.hooksBound = true;
    document.addEventListener('knight:before-navigate', destroyTravelMap);
    document.addEventListener('knight:page-loaded', function () {
      if (document.querySelector('[data-travel-page]')) initTravelMap();
    });
  }

  initTravelMap();
})();
