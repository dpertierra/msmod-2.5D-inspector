import { MAX_PRIORITY, TERRAIN_TAGS, HEIGHT_COLORS, heightColor } from "./config.js";
import { cachedHeight, invalidateHeights, scanMap, summarize } from "./scan.js";

let overlayOn = false;
let lastScan = null;

export function activate(ctx) {
  registerVocabulary(ctx);
  registerOverlay(ctx);
  registerValidator(ctx);
  registerInvalidation(ctx);
  ctx.log.info("2.5D Inspector listo");
}

/**
 * Todo lo que puede cambiar la altura de una casilla tira la cache. Pintar un
 * tile cambia una sola casilla, pero editar el tileset cambia la prioridad de
 * ese tile en TODOS los mapas a la vez, asi que ahi se tira entera.
 */
function registerInvalidation(ctx) {
  ctx.bus.on("map.tile.changed", (e) => invalidateHeights(e.mapId));
  ctx.bus.on("map.batch.changed", (e) => invalidateHeights(e.mapId));
  ctx.bus.on("map.loaded", (e) => invalidateHeights(e.mapId));
  ctx.bus.on("map.unloaded", (e) => invalidateHeights(e.mapId));
  ctx.bus.on("undo", (e) => invalidateHeights(e.mapId));
  ctx.bus.on("redo", (e) => invalidateHeights(e.mapId));
  ctx.bus.on("tileset.changed", (e) => {
    // "selected" es solo cambiar de tileset en la paleta: no altera ninguna
    // prioridad. Solo "edited"/"reloaded" tocan la geometria.
    if (e.reason !== "selected") invalidateHeights(null);
  });
}

/**
 * El editor trae de serie prioridades 0-5 y los terrain tags de Essentials. El
 * plugin 2.5D usa mas: alturas hasta MAX_PRIORITY y dos tags propios para las
 * paredes. Registrarlos hace que aparezcan CON NOMBRE en los desplegables del
 * editor de tilesets, en vez de tener que acordarse de que 19 es "Cliff".
 */
function registerVocabulary(ctx) {
  const ts = ctx.tileset;

  if (ts.registerTerrainTag) {
    for (const tag of TERRAIN_TAGS) ts.registerTerrainTag(tag);
  } else {
    ctx.log.warn("Este editor no permite registrar terrain tags; se usaran los numeros crudos.");
  }

  if (ts.registerPriority) {
    // 0-5 ya existen. Se anaden 6..MAX_PRIORITY, que es hasta donde llega el
    // plugin; por encima trata la altura como MAX_PRIORITY y salen cortes.
    for (let id = 6; id <= MAX_PRIORITY; id++) {
      ts.registerPriority({ id, name: `Altura ${id}`, color: heightColor(id) });
    }
  } else {
    ctx.log.warn(`Este editor no permite registrar prioridades; el tope seguira en 5 (el plugin acepta ${MAX_PRIORITY}).`);
  }

  // Que el color de una altura signifique lo mismo en el editor de tilesets y
  // en el overlay del mapa.
  if (ts.setGlyphStyle) ts.setGlyphStyle({ priority: HEIGHT_COLORS.slice(1) });
}

/**
 * El canvas del editor dibuja SOLO por orden de capa: la prioridad, que es lo
 * que decide toda la geometria 2.5D, es invisible mientras editas. Esto la
 * pinta encima.
 */
function registerOverlay(ctx) {
  ctx.ui.registerOverlay({
    id: "visual25d.heights",
    zOrder: 20,
    render(c, info) {
      if (!overlayOn) return;
      const mapId = info.mapId;
      const map = ctx.map.info(mapId);
      if (!map) return;
      const layers = ctx.map.layers(mapId).filter((l) => l.kind !== "shadow");

      const size = info.tileSize * info.zoom;
      // Solo las casillas visibles: un mapa grande a zoom bajo son decenas de
      // miles, y esto corre en cada frame.
      const x0 = Math.max(0, Math.floor(info.viewportX / info.tileSize));
      const y0 = Math.max(0, Math.floor(info.viewportY / info.tileSize));
      const x1 = Math.min(map.width - 1, Math.ceil((info.viewportX + info.canvasWidth / info.zoom) / info.tileSize));
      const y1 = Math.min(map.height - 1, Math.ceil((info.viewportY + info.canvasHeight / info.zoom) / info.tileSize));

      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `${Math.max(9, Math.round(size * 0.38))}px sans-serif`;
      c.lineWidth = 2;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const h = cachedHeight(ctx, mapId, layers, map.tilesetId, x, y);
          const px = (x * info.tileSize - info.viewportX) * info.zoom;
          const py = (y * info.tileSize - info.viewportY) * info.zoom;

          if (h === null) {
            // Casilla vacia: agujero negro en 2.5D.
            c.fillStyle = "rgba(0,0,0,0.55)";
            c.fillRect(px, py, size, size);
            c.strokeStyle = "#ff3b3b";
            c.strokeRect(px + 1, py + 1, size - 2, size - 2);
            continue;
          }
          if (h === 0) continue;   // suelo: sin marca, para no tapar el mapa

          c.fillStyle = heightColor(h);
          c.globalAlpha = 0.30;
          c.fillRect(px, py, size, size);
          c.globalAlpha = 1;

          if (size >= 18) {
            const label = String(h);
            c.strokeStyle = "rgba(0,0,0,0.85)";
            c.strokeText(label, px + size / 2, py + size / 2);
            c.fillStyle = h > MAX_PRIORITY ? "#ff3b3b" : "#ffffff";
            c.fillText(label, px + size / 2, py + size / 2);
          }
        }
      }
      c.restore();
    },
  });

  ctx.menu.registerMenuItem({
    menu: "Mods",
    label: "2.5D: mostrar alturas",
    icon: "grid",
    isChecked: () => overlayOn,
    handler: () => {
      overlayOn = !overlayOn;
      ctx.ui.showToast({
        message: overlayOn ? "Alturas 2.5D visibles" : "Alturas 2.5D ocultas",
        level: "info",
      });
    },
  });
}

function registerValidator(ctx) {
  ctx.ui.registerPanel({
    id: "visual25d.report",
    title: "2.5D Inspector",
    defaultPosition: "right",
    icon: "grid",
    render(host) {
      renderReport(ctx, host);
      const sub = ctx.bus.on("map.loaded", () => renderReport(ctx, host));
      return () => sub.dispose();
    },
  });

  ctx.menu.registerMenuItem({
    menu: "Mods",
    label: "2.5D: revisar mapa",
    icon: "database",
    handler: () => {
      const mapId = ctx.editor.activeMapId();
      if (mapId == null) {
        ctx.ui.showToast({ message: "No hay ningun mapa abierto.", level: "warn" });
        return;
      }
      lastScan = scanMap(ctx, mapId);
      ctx.ui.showToast({
        message: lastScan ? summarize(lastScan) : "No se pudo leer el mapa.",
        level: lastScan && summarize(lastScan) === "Sin problemas." ? "info" : "warn",
      });
    },
  });
}

function renderReport(ctx, host) {
  const scan = lastScan;
  const css = "color:var(--text-primary);font-family:inherit;font-size:13px;padding:10px;";

  if (!scan) {
    host.innerHTML = `<div style="${css}">Menu <b>Mods -> 2.5D: revisar mapa</b> para analizar el mapa abierto.</div>`;
    return;
  }

  const groups = [
    { key: "empty", title: "Casillas vacias", hint: "Se ven negras: la camara 2.5D llega mas lejos que la 2D. Rellenalas aunque queden fuera del area jugable." },
    { key: "floating", title: "Columnas que flotan", hint: "Pieza alta con suelo raso justo debajo. Numera de abajo arriba: base 1, encima 2..." },
    { key: "tooTall", title: `Altura por encima de ${MAX_PRIORITY}`, hint: "El plugin la recorta a ese tope y salen cortes y Z mal." },
  ];

  let html = `<div style="${css}"><div style="margin-bottom:8px;opacity:.75">Mapa ${scan.info.id} — ${scan.info.name} (${scan.info.width}x${scan.info.height})</div>`;

  let clean = true;
  for (const g of groups) {
    const list = scan[g.key];
    if (!list.length) continue;
    clean = false;
    html += `<div style="margin:10px 0 4px;font-weight:600">${g.title} — ${list.length}</div>`;
    html += `<div style="opacity:.7;margin-bottom:4px">${g.hint}</div>`;
    html += `<div style="height:140px;overflow:auto;resize:vertical;border:1px solid var(--border);border-radius:4px;padding:4px">`;
    for (const item of list.slice(0, 200)) {
      const extra = item.height != null ? ` (altura ${item.height})` : "";
      html += `<div>x=${item.x}, y=${item.y}${extra}</div>`;
    }
    if (list.length > 200) html += `<div style="opacity:.6">... y ${list.length - 200} mas</div>`;
    html += `</div>`;
  }

  if (clean) html += `<div style="color:var(--accent)">Sin problemas.</div>`;
  html += `</div>`;
  host.innerHTML = html;
}

export function deactivate() {
  overlayOn = false;
  lastScan = null;
}
