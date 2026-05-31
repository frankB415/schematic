# schematic — Übersicht

## Verzeichnisstruktur

```
schematic/
  schematic.md                        ← diese Datei
  demo2.html                          ← Demo: 2 Solarpanels + Last
  demo3.html                          ← Demo: 2 Solarpanels + DCDC + Last

  schematicBlock/
    schematicBlock.js                 ← Basisklasse
    schematicBlock.module.js          ← ES-Modul-Wrapper
    schematicBlock.css                ← Basisstyles
    schematicBlock_API.md             ← API-Dokumentation
    test.html                         ← Tests + visuelle Demo

  labeledBlock/
    labeledBlock.js                   ← Name + Params + Kontextmenü
    labeledBlock.module.js            ← ES-Modul-Wrapper

  lastflussBlock/
    lastflussBlock.js                 ← Lastfluss-Interface
    lastflussBlock.module.js          ← ES-Modul-Wrapper
    lastflussSim.js                   ← Knotenpotentialanalyse (generisch)
    solarPanel.js                     ← konkreter Block: Solarpanel
    last.js                           ← konkreter Block: elektrische Last
    dcdc.js                           ← konkreter Block: DC/DC-Wandler
```

---

## Klassenhierarchie

```
schematicBlock
  └── labeledBlock
        └── lastflussBlock
              ├── SolarPanel
              ├── Last
              └── DCDC
```

---

## Verantwortlichkeiten

### `schematicBlock`
- `sb-image` im Schematic positionieren — Anker bei `(x, y)` = Bildmittelpunkt
- `sb-text1` und `sb-text2` anlegen (leer — Inhalt durch Unterklasse)
- Connector-Dots in `sb-image` rendern
- `getConnectorPositions()` für `electricalWire`
- `getImageDiv()` für `electricalWire.setBlockedAreas()`
- `select()` / `deselect()` / `rotate()` / `delete()`
- Events: `sb-select`, `sb-rotate`, `sb-delete`

### `labeledBlock extends schematicBlock`
- `setName()` → schreibt in `sb-text1`
- `renderParams()` / `setParam()` / `getParam()` → schreibt in `sb-text1`
- Kontextmenü mit editierbaren Param-Feldern
- Event: `sb-param-change`

### `lastflussBlock extends labeledBlock`
- `calcPower(voltages)` — **abstrakt**, kein Seiteneffekt
- `applyOperatingPoint(voltages)` — **abstrakt**, einmalig nach Konvergenz
- `_setResults(values)` → schreibt in `sb-text2`
- `renderResults()` → rendert Istwerte in `sb-text2` (überschreibbar)
- `invalidateResult()` — markiert Ergebnis als ungültig

### Konkrete Blöcke
Implementieren `render()`, `calcPower()` und `applyOperatingPoint()`.

---

## DOM-Struktur pro Block

```
schematic  (position: relative)
  ├── .sb-text1  (position: absolute) — Name + Params
  ├── .sb-image  (position: absolute) — Bild + Connector-Dots, Anker bei (x,y)
  └── .sb-text2  (position: absolute) — Istwerte (Results)
```

**Anker:** `(x, y)` aus dem Constructor = Mittelpunkt von `.sb-image`.
`sb-text1` wächst nach links, `sb-text2` nach rechts.
Ohne `x,y`: normaler Dokumentfluss (für test.html).

---

## Ladereihenfolge (`<script>`-Tags)

```html
<link rel="stylesheet" href="/schematic/schematicBlock/schematicBlock.css">
<script src="/schematic/schematicBlock/schematicBlock.js"></script>
<script src="/schematic/labeledBlock/labeledBlock.js"></script>
<!-- optional: -->
<script src="/schematic/lastflussBlock/lastflussBlock.js"></script>
<script src="/schematic/lastflussBlock/lastflussSim.js"></script>
<script src="/schematic/lastflussBlock/solarPanel.js"></script>
<script src="/schematic/lastflussBlock/last.js"></script>
<script src="/schematic/lastflussBlock/dcdc.js"></script>
<!-- Wire-Routing: -->
<script src="/electricalWire/electricalWire.js"></script>
```

---

## Connector-Schema

```js
this.connectors = [
    {
        name:      'left',          // eindeutiger Name
        x:         '0%',            // Position relativ zu sb-image
        y:         '50%',
        type:      'electrical',    // 'electrical' | 'signal'
        direction: 'left',          // 'left' | 'right' | 'up' | 'down'
        minLength: 20,              // Mindestaustrittslänge px (Default: 20)
    },
];
```

---

## Param-Schema

```js
this.params = [
    { key: 'pNom', label: 'P Nenn', value: 300, format: v => `${v} Wp` },
];
```

- Werden in `sb-text1` angezeigt
- Im Kontextmenü editierbar
- `setParam(key, value)` aktualisiert Wert + DOM + feuert `sb-param-change`

---

## Lastfluss-Interface

```js
// Leistungsbeitrag bei gegebenen Knotenspannungen
calcPower(voltages)
// voltages = { connectorName: voltage, ... }
// return  = { connectorName: power,   ... }
//
// Vorzeichenkonvention — Verbraucherzählpfeil:
//   negativ: Leistung fließt von außen in den Block  (Verbraucher, DCDC-Eingang)
//   positiv: Leistung fließt vom Block nach außen    (Erzeuger,   DCDC-Ausgang)
//
// Beispiele:
//   SolarPanel.calcPower → { out: +290 }   // speist 290 W ein
//   Last.calcPower       → { in:  -400 }   // verbraucht 400 W
//   DCDC.calcPower       → { in: -290, out: +275.5 }  // nimmt 290 W, gibt 275.5 W ab
//
// _setResults() speichert Istwerte mit gleichem Vorzeichen:
//   SolarPanel.results.pAct  < 0   (gibt ab)
//   Last.results.pAct        < 0   (verbraucht)
//   DCDC.results.pIn         < 0   (nimmt), pOut > 0 (gibt ab)

// Arbeitspunkt nach Konvergenz übernehmen
applyOperatingPoint(voltages)
// → ruft this._setResults({ pAct, uAct, ... }) auf
```

---

## Simulation (`lastflussSim`)

```js
const sim = new lastflussSim([
    { id: 'k1', blocks: [solar1, dcdc] },
    { id: 'k2', blocks: [solar2, last1, dcdc] },
], { epsilon: 0.1, logging: true });

const result = sim.solve();
// result.voltages   → Map { 'k1' => 33.15, 'k2' => 21.19 }
// result.powers     → Map { block => { connectorName: power } }
// result.converged  → boolean
// result.iterations → number
```

---

## Wire-Integration

```js
// Nach render() und requestAnimationFrame:
const connectors = [
    ...solar1.getConnectorPositions(schematic, 'solar1'),
    ...last1.getConnectorPositions(schematic,  'last1'),
];
const blocked = [solar1, last1].map(b => b.getImageDiv());

const wire = new ElectricalWire(schematic, { gridSize: 10, wireColor: '#333' });
wire.setConnectors(connectors);
wire.setConnections([{ id: 'net1', from: 'solar1.out', to: 'last1.in' }]);
wire.setBlockedAreas(blocked, { shrink: 5 });
wire.render();
```

---

## Minimales Beispiel — eigener Block

```js
class ResistorBlock extends labeledBlock {
    constructor(label, opts = {}) {
        super(opts);
        this._label = label;
        this.connectors = [
            { name: 'left',  x: '0%',   y: '50%', type: 'electrical',
              direction: 'left',  minLength: 20 },
            { name: 'right', x: '100%', y: '50%', type: 'electrical',
              direction: 'right', minLength: 20 },
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

// Im Schematic positioniert (Bildmitte bei x=200, y=150):
const r1 = new ResistorBlock('R1', { x: 200, y: 150, imageW: 80, imageH: 32 });
r1.render(document.getElementById('schematic'));
```