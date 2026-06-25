# lastflussBlock — API-Dokumentation

## Klassenhierarchie

```
schematicBlock          — Bild + Connectoren + leere Textpanes + Position
  └── labeledBlock      — Name + Params + Kontextmenü
        └── lastflussBlock  — calcPower + applyOperatingPoint + Results
              └── SolarPanel, SolarPanelMPPT, Last, DCDC, DCDCDroop, ...
```

`lastflussBlock` ist eine **abstrakte Zwischenklasse** — sie kann nicht direkt instanziiert werden.

---

## Einbindung

### Script-Tags (global, Ladereihenfolge beachten)
```html
<script src="/schematic/schematicBlock/schematicBlock.js"></script>
<script src="/schematic/labeledBlock/labeledBlock.js"></script>
<script src="/schematic/lastflussBlock/lastflussBlock.js"></script>
<!-- → window.lastflussBlock -->

<!-- Konkrete Block-Implementierungen: -->
<script src="/schematic/lastflussBlock/solarPanel.js"></script>      <!-- window.SolarPanel      -->
<script src="/schematic/lastflussBlock/solarPanelMPPT.js"></script>  <!-- window.SolarPanelMPPT  -->
<script src="/schematic/lastflussBlock/last.js"></script>            <!-- window.Last            -->
<script src="/schematic/lastflussBlock/dcdc.js"></script>            <!-- window.DCDC            -->
<script src="/schematic/lastflussBlock/dcdcDroop.js"></script>       <!-- window.DCDCDroop       -->

<!-- Hilfsfunktionen: -->
<script src="/schematic/lastflussBlock/wireBlocks.js"></script>      <!-- window.wireBlocks      -->

<!-- Simulation: -->
<script src="/schematic/lastflussBlock/lastflussSim.js"></script>    <!-- window.lastflussSim    -->
```

### ES-Modul
```js
import { lastflussBlock } from '/schematic/lastflussBlock/lastflussBlock.module.js';
```

---

## Verantwortlichkeit

| Bereich | Beschreibung |
|---|---|
| **`calcPower()`** | Abstrakt — Leistungsbeitrag je Connector bei gegebenen Knotenspannungen |
| **`applyOperatingPoint()`** | Abstrakt — Arbeitspunkt übernehmen nach Konvergenz |
| **`_setResults()`** | Istwerte in `this.results` speichern + `renderResults()` aufrufen |
| **`renderResults()`** | Istwerte in `sb-text2` anzeigen (überschreibbar) |
| **`invalidateResult()`** | Ergebnis als ungültig markieren |

---

## Constructor

```js
class MyBlock extends lastflussBlock {
    constructor(label, opts = {}) {
        super(opts);
        this._label    = label;
        this._imageSrc = '...';
        this.connectors = [...];
        this.params     = [...];
    }
}
```

> `new lastflussBlock(opts)` direkt wirft `Error` — nur Unterklassen erlaubt.

Nach `super()` ist `this.results = {}` initialisiert.

---

## Abstrakte Methoden (müssen implementiert werden)

### `calcPower(voltages)`

Leistungsbeitrag bei gegebenen Knotenspannungen berechnen.

```js
calcPower(voltages) → { connectorName: power, ... }
```

| Parameter | Typ | Beschreibung |
|---|---|---|
| `voltages` | `{ [connectorName]: number }` | Aktuelle Knotenspannung je Connector in V |

**Rückgabe:** Objekt mit Leistung je Connector in W.
- Positiv = Einspeisung in den Knoten
- Negativ = Verbrauch aus dem Knoten

> **Kein Seiteneffekt!** `calcPower()` wird während der Bisektionsiteration von `lastflussSim` sehr häufig aufgerufen. Weder `this.results` noch der DOM dürfen verändert werden.

```js
// Beispiel: konstante Last
calcPower(voltages) {
    return { in: -this.pNom };
}

// Beispiel: PV-Kennlinie
calcPower(voltages) {
    const u = voltages.out;
    if (u >= this.voc) return { out: 0 };
    return { out: this.pNom * (1 - (u / this.voc) ** 2) };
}

// Beispiel: DC/DC-Wandler (zwei Knoten)
calcPower(voltages) {
    let p = (voltages.in / this.vNomIn - voltages.out / this.vNomOut) * this.couplingImpedance;
    p = Math.max(-this.pMax, Math.min(this.pMax, p));
    return { in: -p, out: p * this.eta };
}
```

---

### `applyOperatingPoint(voltages)`

Arbeitspunkt übernehmen — wird einmalig nach Konvergenz von `lastflussSim.solve()` aufgerufen.

```js
applyOperatingPoint(voltages)
```

| Parameter | Typ | Beschreibung |
|---|---|---|
| `voltages` | `{ [connectorName]: number }` | Konvergierte Knotenspannungen in V |

Soll `this._setResults(values)` aufrufen, um Istwerte zu speichern und im DOM anzuzeigen.

```js
applyOperatingPoint(voltages) {
    const power = this.calcPower(voltages).out;
    this._resultFormats = {
        pAct: v => `pAct: ${v} W`,
        uAct: v => `uAct: ${v} V`,
    };
    this._setResults({
        pAct: Math.round(power * 10) / 10,
        uAct: Math.round(voltages.out * 100) / 100,
    });
}
```

---

## Methoden

### `_setResults(values)`

Istwerte speichern und DOM aktualisieren.

```js
this._setResults({ pAct: 287.3, uAct: 33.15 });
```

| Parameter | Typ | Beschreibung |
|---|---|---|
| `values` | `object` | Schlüssel-Wert-Paare der Istwerte |

- Mergt `values` in `this.results` (mit `Object.assign`) und setzt `results.valid = true`
- Ruft `renderResults()` auf, wenn `_text2Div` existiert

---

### `renderResults()`

Istwerte in `sb-text2` rendern — idempotent. Kann in Unterklassen überschrieben werden.

```js
block.renderResults();
```

Default-Implementierung:
- Erstellt/aktualisiert `.sb-results`-Container in `sb-text2`
- Rendert je Istwert (außer `valid`) ein `div.sb-result[data-key]`
- Verwendet `this._resultFormats[key](value)` zur Formatierung, falls vorhanden, sonst `"key: value"`
- Setzt Klasse `.sb-results--invalid` wenn `results.valid === false`
- Ruft `_repositionText()` auf

```js
// Optional: Formatierung in applyOperatingPoint() definieren
this._resultFormats = {
    pAct: v => `P: ${v} W`,
    uAct: v => `U: ${v} V`,
};
```

---

### `invalidateResult()`

Ergebnis als ungültig markieren — z.B. bei Nicht-Konvergenz.

```js
block.invalidateResult();
```

Setzt `this.results.valid = false` und ruft `renderResults()` auf. Wird von `lastflussSim` automatisch aufgerufen wenn die Simulation nicht konvergiert.

---

## `this.results`

Internes Ergebnis-Objekt — nur via `_setResults()` setzen.

```js
// Nach applyOperatingPoint():
block.results = {
    pAct:  287.3,
    uAct:  33.15,
    valid: true,     // false nach invalidateResult()
};
```

| Feld | Typ | Beschreibung |
|---|---|---|
| `valid` | `boolean` | `true` nach `_setResults()`, `false` nach `invalidateResult()` |
| *beliebig* | `number` | Istwerte aus `applyOperatingPoint()` |

---

## `lastflussSim` — Knotenpotentialanalyse

`lastflussSim` löst den Lastfluss für ein Netz aus `lastflussBlock`-Instanzen via Bisektion.

### Constructor

```js
new lastflussSim(nodes, opts?)
```

| Parameter | Typ | Default | Beschreibung |
|---|---|---|---|
| `nodes` | `Node[]` | — | Nicht-leeres Array von Knoten-Definitionen |
| `opts.epsilon` | `number` | `0.01` | Konvergenzgrenze (W) |
| `opts.maxIter` | `number` | `200` | Maximale Iterationen |
| `opts.logging` | `boolean` | `false` | Debug-Ausgaben in der Konsole |

**Knoten-Definition:**

```js
{
    id:     'bus48v',        // eindeutiger Bezeichner
    blocks: [solar, dcdc],   // lastflussBlock-Instanzen an diesem Knoten
    uMin:   0,               // optional, Untergrenze Bisektion (default: 0)
    uMax:   60,              // optional, Obergrenze (default: auto aus voc/pNom)
}
```

> Ein Block kann in **mehreren Knoten** vorkommen (z.B. DCDC mit Connectoren `in` und `out`). Die Connector-Reihenfolge in `this.connectors` bestimmt, welcher Connector welchem Knoten zugeordnet wird.

### `solve()`

Simulation ausführen.

```js
const result = sim.solve();
```

**Rückgabe:**

```js
{
    voltages:   Map<nodeId, voltage>,   // konvergierte Knotenspannungen in V
    powers:     Map<block, powerObj>,   // Leistungen je Block (aus calcPower)
    converged:  boolean,                // true wenn Konvergenz erreicht
    iterations: number,                 // Anzahl Iterationen
}
```

Ruft nach Konvergenz `applyOperatingPoint(voltages)` für jeden Block auf (jeder Block nur einmal). Bei Nicht-Konvergenz wird `invalidateResult()` auf allen Blöcken aufgerufen.

---

## Konkrete Block-Implementierungen

### `SolarPanel extends lastflussBlock`

```js
new SolarPanel(label, { pNom = 300, voc = 40, x = null, y = null })
```

| Param | Default | Beschreibung |
|---|---|---|
| `pNom` | `300` | Nennleistung in Wp |
| `voc`  | `40`  | Leerlaufspannung in V |

Connector: `out` (unten mittig, Richtung `down`).

Kennlinie: quadratischer Abfall — `pNom * (1 - (u/voc)²)`, null ab `u ≥ voc`.

Ergebnisse: `pAct` (W), `uAct` (V).

---

### `SolarPanelMPPT extends lastflussBlock`

```js
new SolarPanelMPPT(label, { pNom = 300, uMin = 20, uMax = 40, x = null, y = null })
```

| Param | Default | Beschreibung |
|---|---|---|
| `pNom` | `300` | Nennleistung in Wp |
| `uMin` | `20`  | Untere MPPT-Betriebsspannung in V |
| `uMax` | `40`  | Obere MPPT-Betriebsspannung in V |

Connector: `out` (unten mittig, Richtung `down`).

Kennlinie: trapezförmig mit weichen Flanken (5 % des `uMax` als Übergangsbereich):
- `u < uMin − 5 %` → P = 0
- `uMin − 5 % … uMin` → P linear 0 → `pNom`
- `uMin … uMax` → P = `pNom` (MPPT aktiv, konstant)
- `uMax … uMax + 5 %` → P linear `pNom` → 0
- `u > uMax + 5 %` → P = 0

Die Übergänge werden über `interpTable()` berechnet; die Kennlinie hat überall eine endliche Ableitung, sodass der Newton-Solver nicht stagniert.

Ergebnisse: `pAct` (W), `uAct` (V).

**Unterschied zu `SolarPanel`:** `SolarPanelMPPT` hält die Leistung über einen einstellbaren Spannungsbereich konstant (realer MPPT-Tracker), während `SolarPanel` eine quadratische Kennlinie ohne Betriebsbereich verwendet.

---

### `Last extends lastflussBlock`

```js
new Last(label, { pNom = 150, uNom = 24, x = null, y = null })
```

| Param | Default | Beschreibung |
|---|---|---|
| `pNom` | `150` | Nennleistung in W |
| `uNom` | `24`  | Nennspannung in V |

Connector: `in` (oben mittig, Richtung `up`).

Kennlinie: konstante Leistungsaufnahme unabhängig von der Spannung.

Ergebnisse: `pAct` (W), `uAct` (V).

---

### `DCDC extends lastflussBlock`

```js
new DCDC(label, { vNomIn = 48, vNomOut = 24, eta = 0.95, pMax = 500, couplingImpedance = 10000, x = null, y = null })
```

| Param | Default | Beschreibung |
|---|---|---|
| `vNomIn` | `48` | Nennspannung Eingang in V |
| `vNomOut` | `24` | Nennspannung Ausgang in V |
| `eta` | `0.95` | Wirkungsgrad (0..1) |
| `pMax` | `500` | Max. Übertragungsleistung in W |
| `couplingImpedance` | `10000` | Steifigkeit der Kopplung |

Connectoren: `in` (oben mittig), `out` (unten mittig).

Kopplung: `p = (vIn/vNomIn − vOut/vNomOut) × couplingImpedance`, begrenzt auf `±pMax`.

Ergebnisse: `pIn` (W), `pOut` (W), `uIn` (V), `uOut` (V).

> **Abgrenzung zu `DCDCDroop`:** `DCDC` verwendet eine feste `couplingImpedance` ohne Spannungsband, Droop-Arbeitspunkt oder korrekte Richtungsumkehr bei REV-Betrieb. Für Produktionssimulationen ist `DCDCDroop` vorzuziehen.

---

### `DCDCDroop extends lastflussBlock`

```js
new DCDCDroop(label, {
    vNomIn   = 48,
    vNomOut  = 24,
    eta      = 0.95,
    pNom     = 500,
    pRef     = 0,
    kDroop   = 5,
    vBandIn  = 10,
    vBandOut = 10,
    vMaxIn   = 20,
    vMaxOut  = 20,
    x = null, y = null
})
```

| Param | Default | Beschreibung |
|---|---|---|
| `vNomIn` | `48` | Nennspannung Eingang in V |
| `vNomOut` | `24` | Nennspannung Ausgang in V |
| `eta` | `0.95` | Wirkungsgrad (0..1) |
| `pNom` | `500` | Nennleistung (maximale Senkeleistung) in W |
| `pRef` | `0` | Droop-Referenz-/Sollleistung in W |
| `kDroop` | `5` | Droop-Konstante in % (Δu_pu = kDroop_pu → Δp = pNom) |
| `vBandIn` | `10` | Zulässiges Spannungsband Eingang in % (±) |
| `vBandOut` | `10` | Zulässiges Spannungsband Ausgang in % (±) |
| `vMaxIn` | `20` | Überspannungsgrenze Eingang in % relativ zu `vNomIn` |
| `vMaxOut` | `20` | Überspannungsgrenze Ausgang in % relativ zu `vNomOut` |

Connectoren: `in` (oben mittig), `out` (unten mittig).

**Regelschichten (Auswertungsreihenfolge):**

1. **Droop** — `pAct = pRef + (vIn_pu − vOut_pu) / kDroop_pu * pNom`
2. **Spannungsband** — Korrekturterm wenn eine Seite das ±Band verlässt (gleicher Mechanismus wie kDroop, bezogen auf Bandgrenze)
3. **pNom-Clamp** — hart begrenzt auf `[−pNom, +pNom]`
4. **ILim** — weiche Strombegrenzung über 2 %-Fenster oberhalb `iMax = pNom / (eta · vNom)`
5. **OVP** — weiche Abschaltung über 2 %-Fenster oberhalb `vShutdown = vNom · (1 + vMax/100)`

**Richtungsbetrieb:**
- `pAct > 1 % pNom` → **FWD** (in → out); Verlustformel: `out = +pAct`, `in = −pAct/eta`
- `pAct < −1 % pNom` → **REV** (out → in); Verlustformel: `in = −pAct`, `out = +pAct·eta`  *(negativ = Einspeisung)*
- sonst → **STBY**

**Modus-String** (Priorität höchste zuerst): `"OVP"` | `"ILim"` | `"P-Limit"` | `"V-Band"` | `"Droop"` + `" FWD"` | `" REV"` | `" STBY"`

Ergebnisse: `pIn` (W), `pOut` (W), `iIn` (A), `iOut` (A), `uIn` (V), `uOut` (V), `factorILim` (0..1), `factorOVP` (0..1), `mode` (String).

---

## `wireBlocks` — Hilfsfunktion

```js
wireBlocks(schematic, blocks, connections, opts = {})
```

Verbindet `lastflussBlock`-Instanzen im Schaltplan über `ElectricalWire`.

**Abhängigkeit:** `electricalWire.js` (muss vor `wireBlocks.js` geladen sein).

| Parameter | Typ | Beschreibung |
|---|---|---|
| `schematic` | `HTMLElement` | Schaltplan-Container |
| `blocks` | `lastflussBlock[]` | Alle Blöcke des Schemas |
| `connections` | `{ id, from, to }[]` | Verbindungen als `"Label.connectorName"` |
| `opts` | `object` | Optionale `ElectricalWire`-Optionen (`gridSize`, `wireColor`, `wireWidth`, `shrink`) |

Default-Optionen: `{ gridSize: 10, wireColor: '#a0c0ff', wireWidth: 1.5, shrink: 5 }`

**Rückgabe:** `ElectricalWire`-Instanz (nach `render()`).

Label-Eindeutigkeit: Doppelte `_label`-Werte werden intern mit einem Zufallssuffix aufgelöst (`console.warn`).

```js
// Beispiel
const blocks = [quelle, trafo, last];
const connections = [
    { id: 'k1', from: 'Quelle.out', to: 'TR1.in' },
    { id: 'k2', from: 'TR1.out',    to: 'Last.in' },
];
wireBlocks(schematic, blocks, connections);
```

---

## Vollständiges Beispiel

```js
// Blöcke anlegen
const solar = new SolarPanelMPPT('PV1', { pNom: 300, uMin: 28, uMax: 38 });
const dcdc  = new DCDCDroop('DC1', { vNomIn: 36, vNomOut: 24, pNom: 500, kDroop: 5 });
const last1 = new Last('L1', { pNom: 100, uNom: 24 });
const last2 = new Last('L2', { pNom: 80,  uNom: 24 });

// Im Schematic rendern
solar.render(schematicEl);
dcdc.render(schematicEl);
last1.render(schematicEl);
last2.render(schematicEl);

// Simulation konfigurieren
const sim = new lastflussSim([
    {
        id:     'bus36v',
        blocks: [solar, dcdc],
        uMin:   0,
        uMax:   50,
    },
    {
        id:     'bus24v',
        blocks: [dcdc, last1, last2],
        uMin:   0,
        uMax:   35,
    },
], { epsilon: 0.01, logging: true });

// Simulation starten
const { voltages, converged, iterations } = sim.solve();

console.log('Konvergiert:', converged, 'nach', iterations, 'Iterationen');
console.log('U bus36v:', voltages.get('bus36v').toFixed(2), 'V');
console.log('U bus24v:', voltages.get('bus24v').toFixed(2), 'V');
// Istwerte sind jetzt in solar.results, dcdc.results, last1.results, last2.results
// und wurden automatisch im DOM von sb-text2 angezeigt.
```

---

## Eigenen Block implementieren

```js
class BatteryBlock extends lastflussBlock {

    constructor(label, { soc = 0.8, capacity = 5000, uNom = 48 } = {}) {
        super();
        this._label    = label;
        this._imageSrc = '/img/battery.svg';
        this.uNom      = uNom;
        this.capacity  = capacity;

        this.connectors = [
            { name: 'bus', x: '50%', y: '0%', type: 'electrical', direction: 'up', minLength: 24 },
        ];

        this.params = [
            { key: 'soc',      label: 'SoC',       value: soc,      format: v => `${(v*100).toFixed(0)} %` },
            { key: 'capacity', label: 'Kapazität',  value: capacity, format: v => `${v} Wh` },
            { key: 'uNom',     label: 'U Nenn',     value: uNom,     format: v => `${v} V`  },
        ];

        this._resultFormats = {
            pAct: v => `P: ${v} W`,
            uAct: v => `U: ${v} V`,
        };
    }

    calcPower(voltages) {
        const uBus = voltages.bus ?? 0;
        const p = (this.uNom - uBus) * 100;
        return { bus: Math.max(-2000, Math.min(2000, p)) };
    }

    applyOperatingPoint(voltages) {
        const p = this.calcPower(voltages).bus;
        this._setResults({
            pAct: Math.round(p * 10) / 10,
            uAct: Math.round((voltages.bus ?? 0) * 100) / 100,
        });
    }
}
```

---

## Änderungshistorie

- **2026-06-11**: `DCDCDroop`, `SolarPanelMPPT`, `wireBlocks` dokumentiert
- **2026-06-07 build 1**: Erste Version
