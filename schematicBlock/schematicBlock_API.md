# schematicBlock — API-Dokumentation

## Klassenhierarchie

```
schematicBlock          — Bild + Connectoren + leere Textpanes + Position
  └── labeledBlock      — Name + Params + Kontextmenü
        └── lastflussBlock  — calcPower + applyOperatingPoint + Results
              └── SolarPanel, Last, DCDC, ...
```

## Einbindung

```html
<link rel="stylesheet" href="schematicBlock.css">
<script src="schematicBlock.js"></script>   <!-- window.schematicBlock -->
<script src="labeledBlock.js"></script>     <!-- window.labeledBlock   -->
<!-- optional: -->
<script src="blocks/lastflussBlock.js"></script>  <!-- window.lastflussBlock -->
```

---

## DOM-Struktur

```
schematic  (position: relative)
  ├── .sb-text1  (position: absolute) — leer; Inhalt durch Unterklasse
  ├── .sb-image  (position: absolute) — Bild + Connector-Dots, Anker bei (x,y)
  └── .sb-text2  (position: absolute) — leer; Inhalt durch Unterklasse
```

**Anker:** `(x,y)` = Mittelpunkt von `.sb-image`. `sb-text1` wächst nach links, `sb-text2` nach rechts.
Ohne `x,y`: normaler Dokumentfluss (für test.html).

---

## `schematicBlock`

### Constructor
```js
new MyBlock({ x, y, imageW, imageH })
```
| Parameter | Beschreibung |
|---|---|
| `x`, `y` | Mittelpunkt von sb-image im Schematic (px) |
| `imageW`, `imageH` | Bildgröße in px |

### Methoden
| Methode | Beschreibung |
|---|---|
| `render(schematicEl)` | **abstrakt** — muss implementiert werden |
| `getConnectors()` | `this.connectors` zurückgeben |
| `getElectricalConnectors()` | gefiltert nach `type: 'electrical'` |
| `getSignalConnectors()` | gefiltert nach `type: 'signal'` |
| `getConnectorPositions(containerEl, blockId, gridSize?)` | für `electricalWire.setConnectors()` |
| `getImageDiv()` | für `electricalWire.setBlockedAreas()` |
| `select()` / `deselect()` | Selektion |
| `rotate()` | 90° Drehung |
| `delete()` | DOM entfernen + Event |

### Render-Hilfsmethoden (für `render()` der Unterklasse)
| Methode | Beschreibung |
|---|---|
| `_getOrCreateImageDiv(el)` | sb-image anlegen + positionieren |
| `_getOrCreateText1(el)` | sb-text1 anlegen (leer) |
| `_getOrCreateText2(el)` | sb-text2 anlegen (leer) |
| `setImage(src, w, h)` | Bild-URL + Größe setzen |
| `renderConnectors()` | Connector-Dots in sb-image |
| `_repositionText()` | text1/text2 relativ zum Bild neu positionieren |

### Connector-Schema
```js
this.connectors = [
    { name: 'left', x: '0%', y: '50%', type: 'electrical', direction: 'left', minLength: 20 },
];
```

---

## `labeledBlock extends schematicBlock`

### Methoden
| Methode | Beschreibung |
|---|---|
| `setName(name)` | Label in sb-text1 (erstes Kind) |
| `renderParams()` | alle `this.params` als sb-property in sb-text1 |
| `getParam(key)` | Rohwert lesen |
| `setParam(key, value)` | Wert setzen + DOM + Event `sb-param-change` |
| `_setProperty(key, value)` | einzelne Eigenschaft in sb-text1 |

### Param-Schema
```js
this.params = [
    { key: 'R', label: 'Widerstand', value: 100, format: v => `${v} Ω` },
];
```

---

## `lastflussBlock extends labeledBlock`

### Abstrakte Methoden
| Methode | Beschreibung |
|---|---|
| `calcPower(voltages)` | `{ connectorName: voltage }` → `{ connectorName: power }` — kein Seiteneffekt |
| `applyOperatingPoint(voltages)` | einmalig nach Konvergenz — soll `_setResults()` aufrufen |

### Methoden
| Methode | Beschreibung |
|---|---|
| `_setResults(values)` | `this.results` setzen + `renderResults()` |
| `renderResults()` | Istwerte in sb-text2 (überschreibbar) |
| `invalidateResult()` | `results.valid = false` + neu rendern |

---

## Minimales Beispiel

```js
class ResistorBlock extends labeledBlock {
    constructor(label, opts = {}) {
        super(opts);
        this._label = label;
        this.connectors = [
            { name: 'left',  x: '0%',   y: '50%', type: 'electrical', direction: 'left',  minLength: 20 },
            { name: 'right', x: '100%', y: '50%', type: 'electrical', direction: 'right', minLength: 20 },
        ];
        this.params = [
            { key: 'R', label: 'Widerstand', value: 100, format: v => `${v} Ω` },
        ];
    }
    render(schematicEl) {
        this._getOrCreateImageDiv(schematicEl);
        this._getOrCreateText1(schematicEl);
        this.setImage(svgUrl, 80, 32);
        this.setName(this._label);
        this.renderParams();
        this.renderConnectors();
        this._repositionText();
        return this;
    }
}

// Positioniert im Schematic:
const r1 = new ResistorBlock('R1', { x: 200, y: 150, imageW: 80, imageH: 32 });
r1.render(document.getElementById('schematic'));
```

---

## Events

Alle Events feuern auf `.sb-image` mit `bubbles: true`.

| Event | `detail` |
|---|---|
| `sb-select` | `{ block }` |
| `sb-rotate` | `{ block, rotation }` |
| `sb-delete` | `{ block }` |
| `sb-param-change` | `{ block, key, value }` |
