// Valores que tienen que coincidir con los del plugin Ruby
// [ROYAL] Visual 2.5D HD. Si alli cambian, cambialos aqui.
//
//   MAX_PRIORITY      -> [001] Settings.rb
//   WALL_TERRAIN_TAG  -> [001] Settings.rb  (GameData::TerrainTag :Cliff)
//   INTERIOR_WALL_TAG -> [011] Interior Walls.rb (:InteriorWall)
//   SHELF_TAG         -> [014] Shelf Tiles.rb (:Shelf)

/** Altura maxima que el plugin acepta. Por encima la trata como este valor,
 *  lo que produce cortes y Z mal. El editor de tilesets solo llega a 5 de
 *  serie, asi que el mod registra el resto. */
export const MAX_PRIORITY = 12;

/** Terrain tags que el plugin interpreta como geometria de pared. */
export const TERRAIN_TAGS = [
  { id: 19, name: "Cliff (pared frontal 2.5D)" },
  { id: 20, name: "InteriorWall (pared interior 2.5D)" },
  { id: 21, name: "Shelf (repisa plana 2.5D)" },
];

/** Color por nivel de altura. El indice 0 es suelo y no se pinta. Se usa tanto
 *  en el overlay del mapa como en los chips del editor de tilesets, para que
 *  "verde = bajo, rojo = alto" signifique lo mismo en los dos sitios. */
export const HEIGHT_COLORS = [
  "#00000000", // 0 - suelo, sin marca
  "#4ade80",   // 1
  "#a3e635",   // 2
  "#facc15",   // 3
  "#fb923c",   // 4
  "#f87171",   // 5
  "#f472b6",   // 6
  "#e879f9",   // 7
  "#c084fc",   // 8
  "#a78bfa",   // 9
  "#818cf8",   // 10
  "#60a5fa",   // 11
  "#38bdf8",   // 12
];

export function heightColor(level) {
  return HEIGHT_COLORS[level] || HEIGHT_COLORS[HEIGHT_COLORS.length - 1];
}
