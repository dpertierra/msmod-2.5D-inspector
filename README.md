# 2.5D Inspector

Mod del editor **Maker Studio** para diseñar mapas destinados al plugin Ruby
[ROYAL] Visual 2.5D HD.

## El problema

En 2.5D la **prioridad de un tile deja de ser oclusión y pasa a ser geometría**:
prioridad `N` significa "este tile mide N casillas de alto y se apoya N filas
más abajo". Pero los propios docs del editor lo dicen:

> On the editor canvas, tiles are drawn purely in **layer order** — a tile on a
> higher layer always covers a tile on a lower layer, **regardless of its
> priority**.

Es decir: el dato que determina toda la geometría 2.5D es **invisible mientras
editas**. Los errores solo aparecen al arrancar el juego.

## Qué hace

**1. Pone nombre al vocabulario del 2.5D.** Registra los terrain tags que el
plugin interpreta como paredes (`19` Cliff, `20` InteriorWall), así que salen
con nombre en el desplegable del editor de tilesets en vez de números crudos.

**2. Sube el tope de altura de 5 a 12.** El editor trae prioridades 0–5; el
plugin acepta hasta `MAX_PRIORITY = 12`. El mod registra las que faltan
("Altura 6"… "Altura 12"), con el mismo código de color que el overlay.

**3. Overlay de alturas.** `Mods → 2.5D: mostrar alturas`. Pinta sobre cada
casilla su altura efectiva, coloreada. El suelo (0) se deja limpio para no
tapar el mapa. Las casillas vacías salen marcadas en rojo.

**4. Validador.** `Mods → 2.5D: revisar mapa` + panel con el informe:

| Aviso | Por qué importa |
|---|---|
| Casillas vacías | La cámara 2.5D ve ~4-5 casillas más allá del borde: se dibujan negras |
| Columnas que flotan | Pieza alta con suelo raso debajo. Hay que numerar de abajo arriba: base 1, encima 2… |
| Copa sobre otro objeto | En casillas verticales contiguas de prioridad positiva, si la pieza de abajo no es la continuación (prioridad de abajo = prioridad de arriba − 1), sus pies quedan a distinta profundidad (`pies = fila + prioridad`) y la copa se monta sobre la base ajena. Reúne el antiguo aviso de pila con escalones para no duplicar el mismo caso. |
| Columna de postes | Tres o más casillas seguidas en una columna con la misma prioridad > 1 salen en escalera en 2.5D. Numéralas o usa el terrain tag 20 (`InteriorWall`). |
| Altura > 12 | El plugin la recorta al tope y salen cortes y Z mal |

Los avisos contiguos se agrupan en rangos de coordenadas en el panel.

### Pendiente por falta de documentación de la API

- Esquina de escalón lateral en terrain tag `Cliff` (19), informativa.
- Alpha semitransparente en el tile inferior de cada casilla.
- Clic en un aviso para seleccionar y centrar su casilla en el editor.

El aviso de alpha sigue pendiente: la API ofrece `getImageBlobUrl` para obtener
la imagen del tileset, pero no documenta lectura de píxeles/alfa ni decodificación
PNG desde el mod. No se añade una dependencia para analizarlo.

La lectura del terrain tag y la selección/centrado del mapa también siguen
pendientes de una API documentada para esas operaciones.

## Instalación

Copiar o enlazar esta carpeta en una de las dos ubicaciones:

- **Por proyecto** (viaja con el juego):
  `<juego>/Plugins/MakerStudio/003_Editor/Mods/com.dpertierra.visual25d-inspector/`
- **Global** (todos los proyectos): `~/.local/share/maker-studio/Mods/` en Linux,
  `%APPDATA%/maker-studio/Mods/` en Windows.

Luego **Reload** en la fila del mod dentro del Mod Manager.

## Mantenimiento

`config.js` duplica tres valores del plugin Ruby. Si allí cambian, cambiarlos
aquí:

| `config.js` | Origen en el plugin |
|---|---|
| `MAX_PRIORITY` | `[001] Settings.rb` |
| Tag `19` | `[001] Settings.rb` → `WALL_TERRAIN_TAG` |
| Tag `20` | `[011] Interior Walls.rb` → `:InteriorWall` |
| Tag `21` | `[014] Shelf Tiles.rb` → `:Shelf` (repisa plana a la prioridad propia del tile, no vertical) |

## Notas

El overlay cachea la rejilla de alturas y la invalida por eventos del bus
(pintar, batch, undo/redo, editar tileset). Sin caché, resolver la altura
casilla a casilla en cada frame hace tirones al hacer scroll.

`tileset.changed` con `reason: "selected"` no invalida: cambiar de tileset en la
paleta no altera ninguna prioridad.

El editor de tilesets no emite `tileset.changed` al editar una prioridad. Con el
overlay visible, el mod compara cada 0,5 s la prioridad de los tiles que usa el
mapa y, si cambia alguna, tira la caché y pide repintado
(`ctx.editor.requestRedraw`). Así el overlay se actualiza sin tocar el mapa.
