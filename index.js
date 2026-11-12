import { MAX_PRIORITY, TERRAIN_TAGS, HEIGHT_COLORS, heightColor } from "./config.js";
import { cachedHeight, invalidateHeights, prioritySignature, scanMap, summarize, usedTiles } from "./scan.js";

let overlayOn = false;
let lastScan = null;
let watchTimer = null;
let watch = null;   // { mapId, tiles, sig }

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
  // Tirar la cache no basta: el canvas no se repinta solo hasta que haces
  // scroll, y el overlay seguia mostrando las alturas viejas.
  const refresh = (mapId) => {
    invalidateHeights(mapId);
    if (overlayOn) ctx.editor.requestRedraw?.();
  };
  // Pintar cambia que tiles se usan: la lista vigilada se rehace.
  const retile = (mapId) => {
    watch = null;
    refresh(mapId);
  };
  ctx.bus.on("map.tile.changed", (e) => retile(e.mapId));
  ctx.bus.on("map.batch.changed", (e) => retile(e.mapId));
  ctx.bus.on("map.loaded", (e) => retile(e.mapId));
  ctx.bus.on("map.unloaded", (e) => invalidateHeights(e.mapId));
  ctx.bus.on("undo", (e) => retile(e.mapId));
  ctx.bus.on("redo", (e) => retile(e.mapId));
  ctx.bus.on("tileset.changed", (e) => {
    // "selected" es solo cambiar de tileset en la paleta.
    if (e.reason !== "selected") refresh(null);
  });

  // El editor de tilesets NO emite tileset.changed al editar una prioridad
  // (comprobado): con el overlay visible se compara la prioridad de los tiles
  // usados en el mapa cada medio segundo. ponytail: O(tiles distintos) por
  // tick; si el mapa usa miles, vigilar solo los del viewport.
  watchTimer = setInterval(() => {
    if (!overlayOn) return;
    const mapId = ctx.editor.activeMapId();
    if (mapId == null) return;
    if (!watch || watch.mapId !== mapId) {
      const tiles = usedTiles(ctx, mapId);
      watch = { mapId, tiles, sig: prioritySignature(ctx, tiles) };
      return;
    }
    const sig = prioritySignature(ctx, watch.tiles);
    if (sig !== watch.sig) {
      watch.sig = sig;
      refresh(null);
    }
  }, 500);
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

      // Maker Studio ya escala el lienzo con el zoom (no por la transformacion
      // del contexto): multiplicar aqui dibujaba los cuadros a zoom^2 y
      // descolocados. Se dibuja en pixeles de tile; el editor pone el zoom.
      const k = 1;
      const size = info.tileSize;
      // Solo las casillas visibles: un mapa grande a zoom bajo son decenas de
      // miles, y esto corre en cada frame.
      const x0 = Math.max(0, Math.floor(info.viewportX / info.tileSize));
      const y0 = Math.max(0, Math.floor(info.viewportY / info.tileSize));
      // Rango holgado: vale tanto si canvasWidth viene en px de pantalla como
      // en px de tile. Lo que cae fuera lo recorta el canvas.
      const span = 1 / Math.min(info.zoom || 1, 1);
      const x1 = Math.min(map.width - 1, Math.ceil((info.viewportX + info.canvasWidth * span) / info.tileSize) + 1);
      const y1 = Math.min(map.height - 1, Math.ceil((info.viewportY + info.canvasHeight * span) / info.tileSize) + 1);

      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `${Math.max(9, Math.round(size * 0.38))}px sans-serif`;
      c.lineWidth = 2;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const h = cachedHeight(ctx, mapId, layers, map.tilesetId, x, y);
          const px = (x * info.tileSize - info.viewportX) * k;
          const py = (y * info.tileSize - info.viewportY) * k;

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
    { key: "stairStack", title: "Copa sobre otro objeto", hint: "Dos piezas contiguas tienen pies distintos (pies = fila + prioridad): la copa se dibuja a la profundidad de sus pies y se monta sobre la base del otro objeto. Numera la pila de abajo arriba; este aviso reúne el antiguo caso de pila con escalones." },
    { key: "postColumns", title: "Columna de postes", hint: "Tres o más casillas seguidas con la misma prioridad > 1 forman una escalera en 2.5D. Numéralas o usa el terrain tag 20 (InteriorWall)." },
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
    const ranges = groupRanges(list);
    for (const range of ranges.slice(0, 200)) {
      const extra = range.start === range.end && range.height != null ? ` (altura ${range.height})` : "";
      const coords = range.axis === "x"
        ? `x=${range.start}–${range.end}, y=${range.fixed}`
        : range.axis === "y"
          ? `x=${range.fixed}, y=${range.start}–${range.end}`
          : `x=${range.start}, y=${range.fixed}`;
      html += `<div>${coords}${extra}</div>`;
    }
    if (ranges.length > 200) html += `<div style="opacity:.6">... y ${ranges.length - 200} rangos mas</div>`;
    html += `</div>`;
  }

  if (clean) html += `<div style="color:var(--accent)">Sin problemas.</div>`;
  html += `</div>`;
  host.innerHTML = html;
}

function groupRanges(items) {
  const remaining = new Map(items.map((item) => [`${item.x},${item.y}`, item]));
  const ranges = [];
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const item of ordered) {
    const key = `${item.x},${item.y}`;
    if (!remaining.has(key)) continue;
    const height = item.height;
    let start = item.x;
    let end = item.x;
    let axis = "point";
    let fixed = item.y;
    remaining.delete(key);

    while (remaining.has(`${end + 1},${item.y}`)) {
      end++;
      remaining.delete(`${end},${item.y}`);
      axis = "x";
    }
    if (axis === "point") {
      let nextY = item.y + 1;
      while (remaining.has(`${item.x},${nextY}`)) {
        remaining.delete(`${item.x},${nextY}`);
        nextY++;
        axis = "y";
      }
      if (axis === "y") {
        start = item.y;
        end = nextY - 1;
        fixed = item.x;
      }
    }
    ranges.push({ axis, fixed, start, end, height });
  }
  return ranges;
}

export function deactivate() {
  overlayOn = false;
  lastScan = null;
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  watch = null;
}
