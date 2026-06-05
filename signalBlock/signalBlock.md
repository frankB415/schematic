# signalBlock — Konzept & API-Dokumentation

## Klassenhierarchie

```
schematicBlock
  └── labeledBlock
        ├── lastflussBlock
        │     └── SolarPanel, Last, DCDC, ...
        └── signalBlock               ← neu
              └── PIBlock, PT1Block, SumBlock, SetpointBlock, ...
```

`signalBlock` ist eine **abstrakte Zwischenklasse** für regelungstechnische Blöcke —
sie kann nicht direkt instanziiert werden.

---

## Verantwortlichkeit

| Bereich | Beschreibung |
|---|---|
| **`tick(dt)`** | Zeitdiskrete Berechnung — optional, wird zyklisch vom `signalSim` aufgerufen |
| **`onEvent(event)`** | Eventbasierte Berechnung — optional, wird durch `signalSim.fireEvent()` ausgelöst |
| **`_setOutputs(values)`** | Ausgangswerte speichern + DOM + Downstream-Propagation |
| **`renderOutputs()`** | Ausgangswerte in `sb-text2` anzeigen (überschreibbar) |
| **`setInput(name, value)`** | Eingangswert setzen — kein Auto-Trigger |
| **`connect(outputName, targetBlock, paramKey)`** | Downstream-Verbindung registrieren |

**Typisches Layout:** Eingänge links, Ausgänge rechts. Blöcke im Rückpfad: Eingang rechts, Ausgang links.

---

## Einbindung

```html
<link rel="stylesheet" href="/schematic/schematicBlock/schematicBlock.css">
<script src="/schematic/schematicBlock/schematicBlock.js"></script>
<script src="/schematic/labeledBlock/labeledBlock.js"></script>
<script src="/schematic/signalBlock/signalBlock.js"></script>
<!-- → window.signalBlock -->

<!-- Simulation + Wire: -->
<script src="/schematic/signalBlock/signalSim.js"></script>
<script src="/electricalWire/electricalWire.js"></script>
<script src="/schematic/signalBlock/signalWire.js"></script>

<!-- Konkrete Blöcke: -->
<script src="/schematic/signalBlock/setpointBlock.js"></script>
<script src="/schematic/signalBlock/sumBlock.js"></script>
<script src="/schematic/signalBlock/piBlock.js"></script>
<script src="/schematic/signalBlock/pt1Block.js"></script>
```

---

## Constructor

`imageW`, `imageH` und `imageSrc` sind inhärente Eigenschaften jedes konkreten Blocks
und werden im `super()`-Aufruf gesetzt — nicht beim Instanziieren übergeben.

```js
class MyBlock extends signalBlock {
    constructor(label, { gain = 1.0 } = {}, opts = {}) {
        super({ imageW: 64, imageH: 40, imageSrc: MyBlock._svgUrl(), ...opts });
        this._label = label;

        this.connectors = [
            { name: 'in',  x: '0%',   y: '50%', type: 'signal', direction: 'left',  flow: 'in',  minLength: 20 },
            { name: 'out', x: '100%', y: '50%', type: 'signal', direction: 'right', flow: 'out', minLength: 20 },
        ];

        this.params = [
            { key: 'gain', label: 'Verstärkung', value: gain, format: v => `${v}` },
        ];

        this._outputFormats = {
            out: v => `y: ${v.toFixed(3)}`,
        };
    }
}

// Instanziierung — nur Position, kein imageW/H:
const block = new MyBlock('G1', { gain: 2.0 }, { x: 200, y: 150 });
block.render(schematicEl);
```

Nach `super()` sind initialisiert:
- `this.inputs = {}` — Eingangswerte, via `setInput()` beschreibbar
- `this.outputs = {}` — Ausgangswerte, nur via `_setOutputs()` setzen
- `this._connections = []` — registrierte Downstream-Verbindungen

---

## Connector-Schema

Signal-Connectoren haben gegenüber electrical-Connectoren ein zusätzliches **`flow`-Attribut**,
das die Signalrichtung semantisch beschreibt.

```js
this.connectors = [
    { name: 'in',  x: '0%',   y: '50%', type: 'signal', direction: 'left',  flow: 'in',  minLength: 20 },
    { name: 'out', x: '100%', y: '50%', type: 'signal', direction: 'right', flow: 'out', minLength: 20 },
];
```

| Feld | Werte | Beschreibung |
|---|---|---|
| `type` | `'signal'` | Unterscheidet von `'electrical'` |
| `direction` | `'left'` `'right'` `'up'` `'down'` | Geometrische Austrittsrichtung — für Wire-Routing |
| `flow` | `'in'` `'out'` | Semantische Signalrichtung — Eingang oder Ausgang des Blocks |

### Visuelle Unterscheidung

`schematicBlock` rendert Signal-Connectoren je nach `flow` unterschiedlich:

| `flow` | Darstellung |
|---|---|
| `'in'` | Ausgefüllter Kreis, dunkellila `#5b2d8e` |
| `'out'` | Hohler Ring, helleres Lila `#c084fc` |

### Regeln

- Ein Connector mit `flow: 'in'` darf **nur eine** eingehende Verbindung haben.
  `connect()` wirft einen `Error` wenn versucht wird, einen bereits belegten Eingang zu verbinden.
- Ein Connector mit `flow: 'out'` kann **mehrere** ausgehende Verbindungen haben.
- Verbindungen werden immer `out → in` registriert.

---

## Methoden — zu implementieren (optional)

### `tick(dt)`

Zeitdiskrete Berechnung. Wird zyklisch vom `signalSim` aufgerufen.
Nicht implementieren wenn der Block rein eventbasiert arbeitet.

```js
tick(dt) {
    const u = this.inputs.in ?? 0;
    const K = this.getParam('K');
    const T = this.getParam('T');
    this._y += (dt / T) * (K * u - this._y);
    this._setOutputs({ out: this._y });
}
```

---

### `onEvent(event)`

Eventbasierte Berechnung. Wird durch `signalSim.fireEvent()` ausgelöst.
Nicht implementieren wenn der Block rein zeitdiskret arbeitet.
Ein Block kann beide Methoden implementieren.

```js
onEvent(event) {
    if (event.type !== 'converter-switched') return;
    const newSetpoint = this._calcSetpoint(event.data);
    this._setOutputs({ out: newSetpoint });
}
```

| Parameter | Typ | Beschreibung |
|---|---|---|
| `event.type` | `string` | Ereignistyp |
| `event.source` | `object?` | Auslösender Block (optional) |
| `event.data` | `any?` | Zusätzliche Daten (optional) |

---

## Methoden — bereitgestellt

### `setInput(name, value)`

Eingangswert setzen. Löst **keinen** Neuberechnungs-Trigger aus —
Berechnung erfolgt beim nächsten `tick()` oder `onEvent()`.

```js
block.setInput('in', 42.5);
```

---

### `_setOutputs(values)`

Ausgangswerte speichern, DOM aktualisieren, Downstream propagieren.
Wird von `tick()` / `onEvent()` der Unterklasse aufgerufen.

```js
this._setOutputs({ out: 3.7 });
```

- Mergt `values` in `this.outputs`
- Ruft `renderOutputs()` auf (wenn `_text2Div` existiert)
- Iteriert `this._connections` und schreibt via `targetBlock.setParam(paramKey, value)`
- Feuert `sb-signal-output` Event

---

### `connect(outputName, targetBlock, paramKey)`

Downstream-Verbindung registrieren. Bei jedem `_setOutputs()` wird
`targetBlock.setParam(paramKey, value)` aufgerufen.

```js
pi.connect('out', last1, 'pNom');          // → lastflussBlock
pi.connect('out', display, 'value');       // ein Ausgang → mehrere Ziele: ok
```

| Parameter | Typ | Beschreibung |
|---|---|---|
| `outputName` | `string` | Schlüssel in `this.outputs` |
| `targetBlock` | `labeledBlock` | Zielblock mit `setParam()` |
| `paramKey` | `string` | Schlüssel in `targetBlock.params` |

**Regeln:**
- Ein Ausgang (`outputName`) kann mit beliebig vielen Zielen verbunden werden.
- Ein Eingang (`targetBlock + paramKey`) darf nur **eine** Quelle haben.
  Ist er bereits belegt, wirft `connect()` einen `Error`:

```
Error: signalBlock.connect(): Eingang 'pNom' von 'L1' ist bereits mit
Ausgang 'out' von 'Regler1' verbunden.
```

---

### `renderOutputs()`

Ausgangswerte in `sb-text2` rendern — idempotent, überschreibbar.
Default: alle `this.outputs`-Werte, formatiert via `this._outputFormats[key]`.

```js
this._outputFormats = {
    out: v => `y: ${v.toFixed(3)}`,
};
```

---

## `signalWire` — Leitungsdarstellung

`signalWire extends ElectricalWire` — kein Eingriff in die Basis-Lib.
Ergänzt nach `render()` einen **gefüllten Richtungspfeil** am `to`-Connector jeder Verbindung.

```js
const wire = new SignalWire(schematicEl, {
    gridSize: 10, wireColor: '#7c3db0', wireWidth: 1.5,
    arrowSize: 9,   // Pfeillänge in px (default: 9)
});
wire.setConnectors([
    ...pi.getConnectorPositions(schematicEl, 'pi'),
    ...pt1.getConnectorPositions(schematicEl, 'pt1'),
]);
wire.setConnections([
    { id: 'w-pi-pt1', from: 'pi.out', to: 'pt1.in' },
]);
wire.setBlockedAreas([pi, pt1].map(b => b.getImageDiv()), { shrink: 5 });
wire.render();
```

**Pfeil:** ausgefülltes Dreieck (`<polygon>`), Spitze liegt exakt auf dem Connector-Punkt,
zeigt in `connector.direction` (= Ankunftsrichtung des Signals). Bei mehreren Verbindungen
auf denselben Empfänger wird nur ein Pfeil gezeichnet.

---

## `signalSim` — Simulation

### Constructor

```js
new signalSim(blocks, opts?)
```

| Parameter | Typ | Default | Beschreibung |
|---|---|---|---|
| `blocks` | `signalBlock[]` | — | Ausführungsreihenfolge beachten (Signalpfad von links nach rechts) |
| `opts.dt` | `number` | `0.1` | Zeitschritt in Sekunden |
| `opts.autoStart` | `boolean` | `false` | Sofort starten |
| `opts.logging` | `boolean` | `false` | Debug-Ausgaben |

### Methoden

| Methode | Beschreibung |
|---|---|
| `start()` | Zyklische Berechnung starten |
| `stop()` | Stoppen |
| `step()` | Einzelnen Zeitschritt ausführen |
| `fireEvent(event)` | Event an alle Blöcke → `onEvent()` → sofort `lastflussSim.solve()` |
| `setDt(dt)` | Zeitschritt zur Laufzeit ändern |
| `setLastflussSim(sim)` | Kopplung mit `lastflussSim` registrieren |
| `onTick(cb)` | Callback nach jedem Tick: `(t, dt) => void` |
| `reset()` | Simulationszeit + Zustände aller Blöcke zurücksetzen |

---

## Kopplung der beiden Simulationen

`signalSim` steuert wann `lastflussSim` rechnet — über `sigSim.setLastflussSim(lastSim)`.

### Zeitdiskreter Tick

Alle `tick()`-Aufrufe zuerst, dann **einmal** `lastflussSim.solve()`:

```
┌─────────────────────────────────────────────┐
│  signalSim-Tick                             │
│                                             │
│  pid.tick(dt)    → setParam('pNom', 142)    │
│  sensor.tick(dt) → (liest nur)              │
│  gain.tick(dt)   → setParam('pNom2', 88)    │
│                          ↓                  │
│              lastflussSim.solve()  ← einmal │
│                          ↓                  │
│         uAct, pAct bereit für nächsten Tick │
└─────────────────────────────────────────────┘
```

Lastflussergebnisse stehen den Signal-Blöcken erst im **nächsten Tick** bereit —
ein Tick Verzug, der für langsame Regelkreise (dt 0.05–1 s) vernachlässigbar ist.

### Eventbasiert

`fireEvent()` löst nach allen `onEvent()`-Aufrufen **sofort** `lastflussSim.solve()` aus:

```
┌──────────────────────────────────────────────────────┐
│  sigSim.fireEvent({ type: 'converter-switched', ... })│
│                                                      │
│  pid.onEvent(event)    → setParam('pNom', 160)       │
│  sensor.onEvent(event) → (ignoriert)                 │
│                          ↓                           │
│              lastflussSim.solve()  ← sofort          │
└──────────────────────────────────────────────────────┘
```

### Zusammenfassung

| Auslöser | `lastflussSim.solve()` |
|---|---|
| `signalSim`-Tick | einmal **nach** allen `tick()`-Aufrufen |
| `signalSim.fireEvent()` | einmal **nach** allen `onEvent()`-Aufrufen |
| `setParam()` manuell (ohne signalSim) | nicht automatisch — Applikation ruft `solve()` selbst auf |

---

## Interaktion mit lastflussBlock

```
signalBlock.outputs.out
        │
        │  connect('out', last1, 'pNom')
        ▼
lastflussBlock.setParam('pNom', value)   ← kein solve() hier
        │
        ↓
signalSim ruft lastflussSim.solve() am Tick-Ende / nach fireEvent()
```

```js
const pid     = new PIBlock('Regler1', { kp: 2, ki: 0.1 });
const last1   = new Last('L1', { pNom: 150, uNom: 24 });
const lastSim = new lastflussSim([{ id: 'bus', blocks: [solar, last1] }]);

pid.connect('out', last1, 'pNom');
sigSim.setLastflussSim(lastSim);
```

---

## Events

Alle Events feuern auf `.sb-image` mit `bubbles: true`.

| Event | `detail` | Auslöser |
|---|---|---|
| `sb-signal-output` | `{ block, outputs }` | `_setOutputs()` |
| `sb-param-change` | `{ block, key, value }` | `setParam()` (geerbt) |
| `sb-select` | `{ block }` | `select()` |
| `sb-rotate` | `{ block, rotation }` | `rotate()` |
| `sb-delete` | `{ block }` | `delete()` |

---

## Ladereihenfolge

```html
<link rel="stylesheet" href="/schematic/schematicBlock/schematicBlock.css">
<script src="/schematic/schematicBlock/schematicBlock.js"></script>
<script src="/schematic/labeledBlock/labeledBlock.js"></script>
<script src="/schematic/signalBlock/signalBlock.js"></script>
<script src="/schematic/signalBlock/signalSim.js"></script>
<script src="/electricalWire/electricalWire.js"></script>
<script src="/schematic/signalBlock/signalWire.js"></script>
<!-- Konkrete Blöcke: -->
<script src="/schematic/signalBlock/setpointBlock.js"></script>
<script src="/schematic/signalBlock/sumBlock.js"></script>
<script src="/schematic/signalBlock/piBlock.js"></script>
<script src="/schematic/signalBlock/pt1Block.js"></script>
<!-- Lastfluss (optional): -->
<script src="/schematic/lastflussBlock/lastflussBlock.js"></script>
<script src="/schematic/lastflussBlock/lastflussSim.js"></script>
```

---

## Eigenen Block implementieren

```js
class PT1Block extends signalBlock {

    constructor(label, { K = 1.0, T = 1.0 } = {}, opts = {}) {
        super({ imageW: 64, imageH: 40, imageSrc: PT1Block._svgUrl(), ...opts });
        this._label = label;
        this._y     = 0;

        // Eingang rechts, Ausgang links — Block liegt im Rückpfad
        this.connectors = [
            { name: 'in',  x: '100%', y: '50%', type: 'signal', direction: 'right', flow: 'in',  minLength: 20 },
            { name: 'out', x: '0%',   y: '50%', type: 'signal', direction: 'left',  flow: 'out', minLength: 20 },
        ];

        this.params = [
            { key: 'K', label: 'Verstärkung', value: K, format: v => `${v}`   },
            { key: 'T', label: 'Zeitkonst.',  value: T, format: v => `${v} s` },
        ];

        this._outputFormats = {
            out: v => `y: ${v.toFixed(3)}`,
        };
    }

    tick(dt) {
        const u = this.inputs.in ?? 0;
        this._y += (dt / this.getParam('T')) * (this.getParam('K') * u - this._y);
        this._setOutputs({ out: this._y });
    }

    static _svgUrl() { /* ... SVG als data-URL */ }
}

// Instanziierung:
const pt1 = new PT1Block('PT1', { K: 1.0, T: 2.0 }, { x: 330, y: 270 });
pt1.render(schematicEl);
```
