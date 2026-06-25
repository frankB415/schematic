// FILE: schematic/simulator/simulator_API.md
# Simulator-API-Referenz

Diese Referenz dokumentiert die öffentliche Schnittstelle aller Simulator-Klassen.

## 1. Basisklassen-Hierarchie

```
baseSim
├── signalSim              — zeitdiskrete Signal-Simulation
└── nodeBaseSim            — knotenbasierte Simulation
    └── lastflussSim       — DC-Lastfluss (reell)
        └── lastflussKomplexSim — AC/DC-Lastfluss (komplex)
```

## 2. baseSim (abstrakt)

### Konstruktor
```javascript
new baseSim()  // wirft Fehler — nicht direkt instanziierbar
```

### Abstrakte Methoden (müssen überschrieben werden)

#### `run()`
Einen Berechnungsschritt ausführen. Unterklassen müssen implementieren.

#### `start()`
Zyklische Ausführung starten. Unterklassen müssen implementieren.

#### `stop()`
Zyklische Ausführung stoppen. Unterklassen müssen implementieren.

### Öffentliche Methoden

#### `_step()`
`run()` ausführen + Callbacks + Downstream-Sims. Wird von `start()` intern und manuell getriggert.

#### `onStep(cb)` → `this` (chainable)
Callback nach jedem Schritt: `cb(sim) => void`

#### `onStart(cb)` → `this` (chainable)
Callback wenn `start()` aufgerufen wird: `cb(sim) => void`

#### `onStop(cb)` → `this` (chainable)
Callback wenn `stop()` aufgerufen wird: `cb(sim) => void`

#### `addDownstreamSim(sim)` → `this` (chainable)
Downstream-Simulation registrieren. Nach jedem eigenen `run()` wird `sim._step()` aufgerufen. `sim` muss `baseSim`-Instanz sein.

#### `removeDownstreamSim(sim)` → `this` (chainable)
Downstream-Kopplung entfernen.

## 3. signalSim

Erbt von `baseSim`.

### Konstruktor
```javascript
new signalSim(blocks, opts)
```

| Parameter | Typ | Standard | Beschreibung |
|---|---|---|---|
| `blocks` | `signalBlock[]` | - | Liste der Signalblöcke |
| `opts.dt` | `number` | `0.1` | Zeitschritt in Sekunden |
| `opts.autoStart` | `boolean` | `false` | Simulation sofort starten |
| `opts.logging` | `boolean` | `false` | Konsolen-Logging aktivieren |

### Öffentliche Methoden

#### `run()`
Einen Zeitschritt ausführen: `t += dt`, ruft `tick(dt)` auf allen Blöcken.

#### `start()`
Zyklischen Timer starten (Intervall = `dt * 1000` ms). Ruft `_step()` zyklisch auf.

#### `stop()`
Zyklischen Timer stoppen.

#### `setDt(dt)`
Zeitschritt zur Laufzeit ändern. Stoppt und startet Timer neu.

#### `reset()`
Simulation zurücksetzen: `t = 0`, leert `inputs`/`outputs` aller Blöcke.

#### `fireEvent(event)`
Event an alle Blöcke senden (`onEvent`) + Downstream-Sims sofort aktualisieren.
`event`: `{type: string, source?: object, data?: any}`

### Properties

#### `t` (readonly)
Aktuelle Simulationszeit in Sekunden.

## 4. nodeBaseSim (abstrakt)

Erbt von `baseSim`. Stellt Knoten-Konzept und GMRES-Löser bereit.

### Konstruktor (2 Varianten)

**Variante 1 — nodes[] (alt)**
```javascript
new nodeBaseSim(nodes, opts)
```

**Variante 2 — blocks[] + connections[] (neu)**
```javascript
new nodeBaseSim(blocks, connections, opts)
// opts.logging, opts.timing, opts.epsilon, etc. im dritten Parameter
```

| Parameter | Typ | Beschreibung |
|---|---|---|
| `nodes` | `object[]` | Knoten-Array `{id, blocks[], uMin?, uMax?}` |
| `blocks` | `block[]` | Array von Block-Instanzen |
| `connections` | `object[]` | Verbindungen `{id, from: "Label.connector", to: "Label.connector", uMin?, uMax?}` |
| `opts.epsilon` | `number` (default: `10`) | Konvergenztoleranz (Watt) |
| `opts.maxIter` | `number` (default: `50`) | Maximale Newton-Iterationen |
| `opts.damp` | `number` (default: `0.8`) | Dämpfungsfaktor Line-Search |
| `opts.dU` | `number` (default: `0.001`) | Numerische Differentiations-Schrittweite |
| `opts.scanSteps` | `number` (default: `20`) | Raster-Scan Auflösung pro Knoten |
| `opts.scanTop` | `number` (default: `10`) | Anzahl bester Scan-Punkte für Newton |
| `opts.prescanSteps` | `number` (default: `5`) | Auflösung des Block-Prescans |
| `opts.logging` | `boolean` (default: `false`) | Konsolen-Logging |
| `opts.timing` | `boolean` (default: `false`) | Laufzeitmessung aktivieren |

### Abstrakte Methoden (müssen überschrieben werden)

#### `_scan()` → `candidates[]`
Raster-Scan: gibt Array von Startwerten zurück. Format abhängig von Unterklasse:
- `lastflussSim`: Array von `Map<nodeId, number>` (DC)
- `lastflussKomplexSim`: Array von `number[]` (AC/DC-Zustandsvektor)

#### `_residual(x)` → `number[]`
Residualvektor für Zustand `x`. DC: `[ΣP₁, ΣP₂, ..., ΣPₙ]`, AC: abwechselnd `[ΣPₖ, ΣQₖ, ΣPₖ₊₁, ΣQₖ₊₁, ...]`

#### `_newton(x0)` → `{x, converged, iter, residual}`
Newton-Raphson für Startwert `x0`.

#### `_applyResult(best, converged, iter)` → `result`
Arbeitspunkt an Blöcke übergeben.

### Öffentliche Methoden

#### `solve()` → `result`
Vollständigen Lösungsdurchlauf ausführen:
1. Prescan/Rasterscan
2. Newton-Raphson für beste Scan-Punkte
3. Nachlauf vom besten Punkt
4. `applyResult()`
5. Ergebnis-Logger + Timing-Report (optional)

**Rückgabe `result`:**
```javascript
{
    voltages: Map<nodeId, voltage>,  // DC: number, AC: {re, im}
    powers: Map<block, powerObj>,    // block → {connectorName: power, ...}
    converged: boolean,
    iterations: number
}
```

#### `run()`
Ruft `solve()` auf.

#### `start()` / `stop()`
Leer — keine zyklische Ausführung.

### Versteckte Knoten

Blöcke können optional implementieren:
```javascript
getHiddenNodes() {
    return [{
        id: this._uid + '.u2',           // eindeutig
        blocks: [this],
        connectorName: 'u2',             // für Connector-Map
        type: 'ac' | 'dc',              // nur für lastflussKomplexSim
        uMin: 100,
        uMax: 300,
    }];
}
```

### Timing

Aktivierung: `opts.timing = true`

`_timingReset()` — internes Timing-Objekt zurücksetzen.
`_timingReport()` — Timing-Tabelle in console.warn ausgeben.

Akkumulatoren im Newton-Lauf:
- `prescan`: Zeit für Block-Prescan + Anzahl calcPower-Aufrufe
- `rasterscan`: Zeit für Rasterscan + Anzahl calcPower-Aufrufe
- `newton[]`: Array mit Einträgen `{total, residual, jacobian, solver, linSearch}`

## 5. lastflussSim

Erbt von `nodeBaseSim`. DC-Lastflussanalyse (reelle Knotenspannungen).

### Besonderheiten
- Alle Spannungen und Leistungen sind reell (`number`)
- Knotenspannungen werden als `Map<nodeId, number>` behandelt
- Newton: koordinatenweise Minimierung mit Bisektion pro Knoten (kein volles GLS)

### Interne Methoden (für Debugging/Erweiterung)

#### `_sumPowerForNode(node, voltageMap)` → `number`
Summe aller Leistungsbeiträge an einem Knoten.

#### `_uMaxForNode(node)` / `_uMinForNode(node)` → `number`
Spannungsgrenzen aus Prescan oder Knoten-Definition.

#### `_uClampMin(node)` / `_uClampMax(node)` → `number`
Newton-Clamp-Grenzen (weiter als aktiver Bereich).

#### `_prescanVal(nodeId, u)` → `number`
Spannungswert für Prescan (DC: reell).

#### `_prescan()`
Jeden Block isoliert scannen → `_prescanRanges` füllen.

#### `_residual(voltageMap)` → `number[]`
`[ΣP₁, ΣP₂, ..., ΣPₙ]` — Leistungsbilanz pro Knoten.

#### `_scan()` → `Map<nodeId, number>[]`
Raster-Scan: kartesisches Produkt über Knoten-Spannungen, bewertet nach relativem Residuum.

#### `_newton(startVoltages)` → `{nodeVoltages, converged, iter, residual}`
Newton-Raphson mit Bisektion: jeden Knoten einzeln optimieren (1D-Nullstellensuche).

## 6. lastflussKomplexSim

Erbt von `lastflussSim`. AC/DC-Lastflussanalyse (komplexe Knotenspannungen).

### Besonderheiten
- AC-Knoten: Spannung = `{re, im}` → 2 Freiheitsgrade
- DC-Knoten: Spannung = `number` → 1 Freiheitsgrad
- Knotentyp automatisch erkannt (kein manuelles `type`-Feld)
- Newton: volles GLS mit Gauß-Elimination (kein GMRES)

### Interne Methoden

#### `_toC(v)` → `{re, im}`
Wandelt `number` oder `{re, im}` in einheitliches Komplex-Format.

#### `_cAbs(a)` → `number`
Betrag einer komplexen Zahl.

#### `_cAdd(a, b)` → `{re, im}`
Komplexe Addition.

#### `_cScale(a, s)` → `{re, im}`
Komplexe Skalierung.

#### `_detectNodeTypes()` → `Map<nodeId, 'ac' | 'dc'>`
Erkennt Knotentyp: AC wenn mindestens ein Block `{re,im}` zurückgibt.

#### `_voltagesForBlock(block, voltageMap)` → `{connName: voltage}`
Überschreibt `nodeBaseSim._voltagesForBlock`: reelle Blöcke bekommen `|u|` statt `{re,im}`.

#### `_dim(nodeId)` → `1 | 2`
Freiheitsgrad eines Knotens (DC: 1, AC: 2).

#### `_xToVoltages(x)` → `Map<nodeId, voltage>`
Zustandsvektor `number[]` in Spannungs-Map konvertieren.

#### `_voltagesToX(voltageMap)` → `number[]`
Spannungs-Map in Zustandsvektor konvertieren.

#### `_residual(x)` → `number[]`
Residualvektor: AC-Knoten → `[ΣP, ΣQ]`, DC-Knoten → `[ΣP]`

#### `_scan()` → `number[][]`
Raster-Scan: AC-Knoten in Polarkoordinaten (Amplitude × Winkel-Scan), versteckte Knoten fix.

#### `_newton(x0)` → `{x, converged, iter, residual}`
Newton mit:
- Vollständigem Jacobian (numerisch via Vorwärtsdifferenzen)
- Gauß-Elimination (pivotisiert) als Solver
- Gradient-Clipping: max. 20% der Amplitude pro Schritt
- Armijo Line-Search (bis 8 Halbierungen)

## 7. Blockschnittstelle

Blöcke müssen folgendes Interface implementieren:

### Pflichtmethoden

#### `calcPower(v)` → `{connectorName: power, ...}`
Berechne Leistung für gegebene Spannungen.
- DC: `power` = `number` (Watt)
- AC: `power` = `{re, im}` (Watt, Var)

#### `applyOperatingPoint(v)`
Arbeitspunkt setzen (Spannungen setzen, interne Zustände aktualisieren).

### Optionale Methoden

#### `getConnectors()` → `{name: string, type: string}[]`
Liste der Connectoren für Auto-Zuordnung.

#### `getHiddenNodes()` → `{id, blocks, uMin?, uMax?, connectorName?, type?}[]`
Versteckte Knoten deklarieren.

#### `getParam(name)` → `any`
Parameter abfragen (z.B. `voc` für Leerlaufspannung).

#### `invalidateResult()`
Ergebnis verwerfen bei Nicht-Konvergenz.

#### `tick(dt)` (nur `signalSim`)
Zeitschritt für Signalblöcke.

#### `onEvent(event)` (nur `signalSim`)
Event verarbeiten.

### Properties

- `_label` — eindeutiger Block-Name
- `_uid` — eindeutige numerische ID
- `_lastRows` — Array von `{text: string}` für Ergebnis-Logger
- `results` — Ergebnis-Objekt für Fallback-Logging
- `_resultFormats` — Formatierungsfunktionen für `results`
- `voc` — Leerlaufspannung (für Prescan)

## 8. Beispiel: Vollständiger Ablauf

```javascript
// 1. Blöcke erzeugen (angenommene Block-Klassen)
const gen = new GeneratorBlock({ label: 'G1', voc: 230 });
const load = new LoadBlock({ label: 'L1', p: 1000 });

// 2. Simulator erzeugen (neues Interface)
const sim = new lastflussKomplexSim(
    [gen, load],
    [
        { id: 'bus1', from: 'G1.out', to: 'L1.in', uMin: 200, uMax: 250 }
    ],
    { logging: true, timing: true, epsilon: 1 }
);

// 3. Lösen
const result = sim.solve();
// → logging: Iterationen, Timing-Tabelle
// → result.voltages: Map mit Spannungen
// → result.powers: Map mit Leistungen
// → Blöcke haben jetzt Arbeitspunkt gesetzt

// 4. (Optional) Ergebnis abfragen
console.log(gen.results);       // { u_out: 230.0, p_out: 1000.0 }
console.log(load.results);     // { u_in: 229.8, p_in: -999.8 }
```

## 9. Fehlerbehandlung

### Nicht-Konvergenz
Wenn der Newton nicht konvergiert:
- `solve()` gibt `{converged: false, iterations: maxIter}` zurück
- `invalidateResult()` wird auf allen Blöcken aufgerufen
- Blöcke sollen ungültige Ergebnisse verwerfen

### Exception-Handling
- `calcPower()`: Fehler abfangen, Block überspringen
- `applyOperatingPoint()`: Fehler loggen, fortsetzen
- Konstruktor: Fehler bei doppelten Knoten-IDs, fehlenden Blöcken etc.

## 10. Kopplung von Simulatoren

```javascript
const sigSim = new signalSim([...], { dt: 0.5 });
const lastSim = new lastflussSim([...], {...});

// Nach jedem Tick: Lastfluss lösen
sigSim.addDownstreamSim(lastSim);

// Event an beide
sigSim.fireEvent({ type: 'switch', data: { state: 'on' } });

sigSim.start();  // startet zyklischen Timer
```

Bei `fireEvent()` werden Downstream-Sims sofort aktualisiert (vor dem nächsten Tick).