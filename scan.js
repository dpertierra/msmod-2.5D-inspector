import { MAX_PRIORITY } from "./config.js";

/**
 * Altura efectiva de una casilla: la prioridad mas alta de todos sus tiles.
 * Es exactamente lo que el plugin lee para decidir si la casilla es suelo
 * (0, se tumba en el plano y recibe el taper) o un elemento vertical (N, se
 * pone de pie apoyado N filas mas abajo).
 *
 * Devuelve null si la casilla esta vacia en todas las capas: en 2D no se nota
 * porque queda fuera de pantalla, pero en 2.5D la camara ve mas lejos y se
 * dibuja como un agujero negro.
 */
export function cellHeight(ctx, mapId, layers, defaultTilesetId, x, y) {
  let best = null;
  for (const layer of layers) {
    if (layer.kind === "shadow") continue;
    const tileId = ctx.map.readTile(mapId, layer.index, x, y);
    if (!tileId) continue;

    // Los tiles de capa extendida pueden venir de otro tileset.
    let tilesetId = defaultTilesetId;
    if (ctx.map.readTileData) {
      const data = ctx.map.readTileData(mapId, layer.index, x, y);
      if (data && data.tilesetId != null) tilesetId = data.tilesetId;
    }

    const props = resolveProps(ctx, tileId, tilesetId);
    const priority = props ? props.priority || 0 : 0;
    if (best === null || priority > best) best = priority;
  }
  return best;
}

export function resolveProps(ctx, tileId, tilesetId) {
  const ts = ctx.tileset;
  if (ts.resolveTileProperties) return ts.resolveTileProperties(tileId, tilesetId);
  if (tilesetId == null) return null;
  return ts.getTileProperties(tilesetId, tileId);
}

/**
 * Recorre el mapa y devuelve la rejilla de alturas mas los problemas que el
 * plugin no puede resolver solo. Solo se comprueban fallos DOCUMENTADOS en el
 * AI_GUIDE del plugin: inventar reglas propias generaria ruido y la gente
 * dejaria de mirar el informe.
 */
export function scanMap(ctx, mapId) {
  const info = ctx.map.info(mapId);
  if (!info) return null;
  const layers = ctx.map.layers(mapId).filter((l) => l.kind !== "shadow");
  const tilesetId = info.tilesetId;

  const heights = new Map();   // "x,y" -> altura (null = vacia)
  const empty = [];
  const tooTall = [];
  const floating = [];
  const stairStack = [];
  const postColumns = [];

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const h = cellHeight(ctx, mapId, layers, tilesetId, x, y);
      heights.set(`${x},${y}`, h);
      if (h === null) {
        empty.push({ x, y });
      } else if (h > MAX_PRIORITY) {
        tooTall.push({ x, y, height: h });
      }
    }
  }

  // Columna que flota: el plugin apoya un tile de prioridad N en la casilla N
  // filas mas abajo, asi que numerando de abajo arriba la casilla de debajo de
  // una pieza alta nunca deberia ser suelo raso. Es el fallo que el AI_GUIDE
  // nombra explicitamente ("NO dejar base en 0 si la copa tiene prioridad").
  for (const [key, h] of heights) {
    if (h === null || h < 2) continue;
    const [x, y] = key.split(",").map(Number);
    if (y + 1 >= info.height) continue;
    const below = heights.get(`${x},${y + 1}`);
    if (below === 0) floating.push({ x, y, height: h });
  }

  // Si el tile de abajo no es la continuación (p-1), ambos pies quedan a
  // distinta profundidad: la copa se dibuja sobre la base del otro objeto.
  // Este es el mismo caso que antes se informaba como "Pila con escalones".
  for (let x = 0; x < info.width; x++) {
    for (let y = 0; y < info.height;) {
      if ((heights.get(`${x},${y}`) || 0) <= 0) { y++; continue; }
      let end = y;
      while (end + 1 < info.height && heights.get(`${x},${end + 1}`) > 0) end++;
      for (let row = end; row > y; row--) {
        const lower = heights.get(`${x},${row}`);
        const upper = heights.get(`${x},${row - 1}`);
        if (upper > 0 && lower > 0 && lower !== upper - 1) {
          stairStack.push({ x, y: row - 1, height: upper, below: lower });
        }
      }
      // Tres o más piezas iguales por encima de prioridad 1 forman postes
      // repetidos, que el render 2.5D muestra desplazados en escalera.
      let runStart = y;
      for (let row = y + 1; row <= end + 1; row++) {
        const current = row <= end ? heights.get(`${x},${row}`) : null;
        const previous = heights.get(`${x},${row - 1}`);
        if (current !== previous) {
          if (previous > 1 && row - runStart >= 3) {
            for (let cellY = runStart; cellY < row; cellY++) {
              postColumns.push({ x, y: cellY, height: previous });
            }
          }
          runStart = row;
        }
      }
      y = end + 1;
    }
  }

  return { info, heights, empty, tooTall, floating, stairStack, postColumns };
}

/**
 * Cache de alturas por mapa. El overlay se repinta en cada frame y resolver la
 * altura casilla a casilla ahi dentro hace tirones al hacer scroll. Se calcula
 * una vez y se tira entera cuando algo que la afecta cambia.
 */
const heightCache = new Map();   // mapId -> Map("x,y" -> altura)

export function cachedHeight(ctx, mapId, layers, tilesetId, x, y) {
  let grid = heightCache.get(mapId);
  if (!grid) {
    grid = new Map();
    heightCache.set(mapId, grid);
  }
  const key = `${x},${y}`;
  if (grid.has(key)) return grid.get(key);
  const h = cellHeight(ctx, mapId, layers, tilesetId, x, y);
  grid.set(key, h);
  return h;
}

export function invalidateHeights(mapId) {
  if (mapId == null) heightCache.clear();
  else heightCache.delete(mapId);
}

/** Texto corto para el panel de resultados. */
export function summarize(result) {
  const total = result.empty.length + result.tooTall.length + result.floating.length + result.stairStack.length + result.postColumns.length;
  if (total === 0) return "Sin problemas.";
  return `${total} aviso(s).`;
}

/**
 * Tiles distintos (tileset + id) usados en el mapa, para vigilar sus
 * prioridades. El editor no avisa al mod cuando se edita una propiedad en el
 * editor de tilesets, asi que se compara a mano.
 */
export function usedTiles(ctx, mapId) {
  const info = ctx.map.info(mapId);
  if (!info) return [];
  const layers = ctx.map.layers(mapId).filter((l) => l.kind !== "shadow");
  const seen = new Map();
  for (const layer of layers) {
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const tileId = ctx.map.readTile(mapId, layer.index, x, y);
        if (!tileId) continue;
        let tilesetId = info.tilesetId;
        if (ctx.map.readTileData) {
          const data = ctx.map.readTileData(mapId, layer.index, x, y);
          if (data && data.tilesetId != null) tilesetId = data.tilesetId;
        }
        seen.set(`${tilesetId}:${tileId}`, [tileId, tilesetId]);
      }
    }
  }
  return [...seen.values()];
}

/** Firma de las prioridades de esos tiles: cambia si se edita alguna. */
export function prioritySignature(ctx, tiles) {
  let sig = "";
  for (const [tileId, tilesetId] of tiles) {
    const props = resolveProps(ctx, tileId, tilesetId);
    sig += (props ? props.priority || 0 : 0) + ",";
  }
  return sig;
}
