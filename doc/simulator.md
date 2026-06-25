# simulator.md — Architektur & API

## Designprinzip

**Einfache Blockimplementierung — Simulator macht die Arbeit.**

Ein Block implementiert nur `calcPower(voltages)` und `applyOperatingPoint(voltages)`.
Er kennt keine Knoten, keine Iteration, keine Konvergenz. Je einfacher der Block,
desto stabiler das System.

Der Simulator übernimmt:
- **Prescan** — jeden Block isoliert scannen, aktiven Spannungsbereich ermitteln
- **Rasterscan** — Startwerte für Newton suchen, im verfeinerten Bereich
- **Newton-Raphson** — Arbeitspunkt iterativ lösen
- **Ergebnis verteilen** — `applyOperatingPoint()` an alle Blöcke

Der Block-Entwickler muss sich um nichts davon kümmern. Neue Blöcke
entstehen durch Implementierung von `calcPower()` — der Rest ist Sache des Simulators.

---

## Klassenhierarchie

```
baseSim                      — Timer, Callbacks, Downstream-Kopplung
  ├── signalSim              — zeitdiskreter Signalpfad (Regelung)
  └── nodeBaseSim            — Knoten-Konzept, versteckte Knoten, GMRES
        ├── lastflussSim           — DC-Lastfluss (reell, didaktische Basis)
        │     └── lastflussKomplexSim  — AC/DC-Lastfluss (komplex)
        └── zukünftige Simulatoren...
```

**`baseSim`** — gemeinsame Infrastruktur: Timer, Callbacks (`onStep`, `onStart`,
`onStop`), Downstream-Kopplung (`addDownstreamSim`). Kennt keine Knoten.

**`nodeBaseSim`** — Knoten-Konzept für alle Lastfluss-Simulatoren:
- `_nodes`, `_connectorMap`, `_collectHiddenNodes()`
- `_buildConnectorMap()`, `_voltagesForBlock()`
- GMRES-Löser (gemeinsam)
- Abstrakte Methoden: `_scan()`, `_residual()`, `_newton()`, `_applyResult()`

**`lastflussSim`** — DC-Lastfluss, reelle Spannungen:
- Überschreibt: `_residual()`, `_scan()`, `_jacobian()`, `_newton()`, `_applyResult()`
- Gut kommentiert — dient als didaktische Referenz für das Verfahren

**`lastflussKomplexSim`** — AC/DC-Mischnetze, komplexe Spannungen:
- Überschreibt: `_voltagesForBlock()`, `_detectNodeTypes()`, `_scan()`,
  `_residual()`, `_newton()`, `_solveLinear()`, `_applyResult()`
- Alles andere erbt von `lastflussSim` / `nodeBaseSim`

**`signalSim`** — bleibt direkt unter `baseSim`: Signalpfad mit direkten
Block-Verbindungen via `connect()`, kein Knoten-Bilanz-Konzept.

---

## Einbindung

```html
<script src="/schematic/simulator/baseSim.js"></script>
<script src="/schematic/simulator/nodeBaseSim.js"></script>
<script src="/schematic/simulator/signalSim.js"></script>        <!-- optional -->
<script src="/schematic/simulator/lastflussSim.js"></script>     <!-- optional, DC -->
<script src="/schematic/simulator/lastflussKomplexSim.js"></script> <!-- optional, AC+DC -->
```

---

## baseSim — Gemeinsame Basis

Stellt bereit: Downstream-Kopplung, Callbacks (`onStep`, `onStart`, `onStop`),
Timer-Interface (`start`, `stop`, `run`).

```js
sim.addDownstreamSim(otherSim);   // nach jedem run(): otherSim.run()
sim.onStep(cb);                   // cb(sim) nach jedem Schritt
sim.onStart(cb);
sim.onStop(cb);
```

---

## signalSim — Zeitdiskreter Signalpfad

```js
new signalSim(blocks, opts?)
```

| Parameter | Default | Beschreibung |
|---|---|---|
| `blocks` | — | Ausführungsreihenfolge = Signalpfad |
| `opts.dt` | `0.1` | Zeitschritt in Sekunden |
| `opts.autoStart` | `false` | Sofort starten |
| `opts.logging` | `false` | Debug-Ausgaben |

**Methoden:** `run()`, `start()`, `stop()`, `setDt(dt)`, `reset()`, `fireEvent(event)`, `get t`

**Kopplung mit Lastfluss:**
```js
sigSim.addDownstreamSim(lastSim);
// → nach jedem Tick: lastSim.solve() einmal
```

---

## lastflussSim — DC-Lastfluss

```js
new lastflussSim(nodes, opts?)
```

```js
const sim = new lastflussSim([
    { id: 'k1', blocks: [solar1, dcdc],          uMin: 30, uMax: 50 },
    { id: 'k2', blocks: [solar2, last1, dcdc],   uMin: 20, uMax: 40 },
]);
const { voltages, converged, iterations } = sim.solve();
```

| opts | Default | Beschreibung |
|---|---|---|
| `epsilon` | `10` | Konvergenzgrenze in W |
| `maxIter` | `50` | Maximale Newton-Iterationen |
| `damp` | `0.8` | Newton-Dämpfung 0..1 |
| `scanSteps` | `20` | Rasterpunkte je Knoten |
| `scanTop` | `10` | Beste N Startwerte versuchen |
| `prescanSteps` | `5` | Schritte je Connector im Prescan |
| `logging` | `false` | Debug-Ausgaben |
| `timing` | `false` | Laufzeitmessung (console.warn) |

**Rückgabe `solve()`:** `{ voltages: Map<id,number>, converged, iterations }`

### Solver-Strategie

```
0. Prescan:      jeden Block isoliert scannen → aktiven Spannungsbereich
                 pro Connector ermitteln → verfeinerte uMin/uMax pro Knoten
1. Raster-Scan:  scanSteps^n Punkte (nur sichtbare Knoten) → beste scanTop
                 Kandidaten; versteckte Knoten fix auf uMid
2. Newton-Raphson mit GMRES (numerische Jacobi, Armijo Line-Search)
3. Erster konvergierter Kandidat gewinnt
```

**Bekannte Eigenheiten:**
- `U=0` ist immer Fixpunkt → Lösungen < 1V werden verworfen
- PV-Kennlinie: links vom MPP instabil → Suchbereich `[0.9·voc, 0.99·voc]`
- Relatives Residuum: `√(Σ (F_i/flow_i)²) × 100 [%]`

### Prescan

`_prescan()` läuft automatisch vor `_scan()` und verfeinert den Suchbereich
**ohne Eingriff des Block-Entwicklers** — der Block braucht nur `calcPower()`.

**Vorgehen pro Block:** kartesisches Produkt über alle Connectoren gleichzeitig
(nicht nacheinander). Nur so liefern Mehrport-Blöcke physikalisch konsistente
Leistungswerte — ein Connector einzeln zu variieren ergibt oft P=0 weil die
anderen Ports im falschen Betriebspunkt fixiert sind.

Für TrafoGleichrichter (`in` AC + `out` DC + `u2` AC) mit `prescanSteps=5`:
`25 × 5 × 25 = 3125` Aufrufe — alle Ports gleichzeitig variiert.

**Aggregation:** `uMin = min(alle uMin_eff)`, `uMax = max(alle uMax_eff)`
über alle Blöcke eines Knotens — Fenster eher zu groß als zu klein.
Fallback auf `node.uMin`/`node.uMax` wenn kein aktiver Bereich gefunden.

**Erweiterungspunkt:** `_prescanVal(nodeId, u)` — überschreibbar für
Unterklassen mit anderen Spannungstypen. `lastflussKomplexSim` gibt
`{re: u, im: 0}` für AC-Knoten zurück statt dem reellen `u`.

```
[lastflussKomplexSim] ── Prescan (steps=5) ─────────────────
  Block Q3:
    'out' → k_ac: aktiv 350.0–450.0 V  (P_max=120.6 kW bei U=450.0 V)
  Block TR-GR1:
    'in'  → k_ac: aktiv 350.0–450.0 V  (P_max=309.4 kW bei U=450.0 V)
    'out' → k_dc: aktiv 1.0–315.0 V    (P_max=8995 kW bei U=158.0 V)
    'u2'  → TR_GR1.u2: aktiv 195.5–241.5 V  (P_max=9179 kW bei U=241.5 V)
  Block Last:
    'in'  → k_dc: aktiv 299.3–315.0 V  (P_max=250.0 kW bei U=315.0 V)
  ── Knotenbereiche ──
  k_ac:      350.0–450.0 V
  k_dc:      1.0–315.0 V
  TR_GR1.u2: 195.5–241.5 V
─────────────────────────────────────────────────
```

### Timing

`opts.timing = true` gibt nach jedem `solve()` eine Tabelle via `console.warn` aus:

```
[lastflussKomplexSim] ══ Timing ════════════════════════════════
  scan           :   143.900 ms
    prescan      :    37.800 ms  (26%) [1260×]
    rasterscan   :   104.500 ms  (73%) [500×]
  newton #1      :     2.300 ms
    residual     :     0.300 ms  (13%)
    jacobian     :     1.600 ms  (70%)
    solver       :     0.200 ms   (9%)
    line-search  :     0.200 ms   (9%)
  applyResult    :    14.600 ms
──────────────────────────────────────────────────────────────
  GESAMT         :   162.200 ms
```

`[N×]` = Anzahl `calcPower`-Aufrufe in diesem Abschnitt.

Typische Engpässe (demo9, langsamer Prozessor):
- **rasterscan** dominiert (73%) — 500 Punkte × `_residual()` über alle Knoten
- **prescan** ist effizienter pro Aufruf (0.03 ms) als rasterscan (0.21 ms),
  weil `_residual()` das ganze Netz auswertet, `calcPower` im Prescan nur einen Block
- **jacobian** dominiert Newton (70%) — n+1 `_residual()`-Aufrufe pro Iteration
- **applyResult** unerwartet hoch — `applyOperatingPoint()` aller Blöcke

**Stellschrauben:**
- `prescanSteps` (Default: 5) — Auflösung des Block-Scans
- `scanSteps` (Default: 20) — Rasterpunkte je Knoten im Hauptscan
- `scanTop` (Default: 10) — wie viele Newton-Startwerte versucht werden

---

## lastflussKomplexSim — AC/DC-Lastfluss

Baut auf `lastflussSim` auf. Alle DC-Konzepte gelten unverändert —
zusätzlich werden AC-Knoten mit komplexen Spannungsphasoren behandelt.

```js
new lastflussKomplexSim(nodes, opts?)
```

```js
const sim = new lastflussKomplexSim([
    { id: 'k1',   blocks: [quelle, trafo],   uMin: 350, uMax: 450 },
    { id: 'k_dc', blocks: [trafo, last],     uMin: 0,   uMax: 315 },
], { epsilon: 50, logging: true });
```

### Knotentyp-Erkennung

Der Simulator erkennt AC/DC automatisch: er testet jeden Knoten mit einer
Probespannung und prüft ob ein angeschlossener Block `{re,im}` zurückgibt.
Kein `type`-Feld nötig.

```
[lastflussKomplexSim] 2 Knoten (1 AC + 1 DC) → 3 Solver-Variablen: [ k1.re, k1.im, k_dc ]
  k1   (AC): Quelle[out]  +  Trafo[in]
  k_dc (DC): Trafo[out]   +  Last[in]
```

### Zustandsvektor

| Knotentyp | Variablen | Residuen |
|---|---|---|
| AC | `re`, `im` (2) | `ΣP`, `ΣQ` (2) |
| DC | `u` (1) | `ΣP` (1) |

Beispiel 1 AC + 1 DC: `x = [k1.re, k1.im, k_dc]`, `F = [F1_P, F1_Q, F_dc]`

### AC-Scan

AC-Knoten werden in Polarkoordinaten gescannt:
- `|U| ∈ [uMin, uMax]` — Amplitude
- `φ ∈ [-30°, +30°]` — Winkel (5 Stützpunkte)

### Newton-Clamp

Nach jedem Newton-Schritt werden alle Variablen auf `[uMin, uMax]` geklemmt.
Verhindert negative DC-Spannungen und andere unphysikalische Zustände.

---

## Einleiterschema / Single-Line

Alle `lastflussKomplexBlock`-Blöcke arbeiten im **Einleiterschema eines
symmetrischen Dreiphasensystems**:

### Grundgrößen

- **Spannung** `u` = verkettete L-L-Spannung (z.B. 400V)
  Strangspannung wäre `u/√3 = 231V` — wird im Einleiterschema nicht explizit verwendet
- **Strom** `i` = Strangstrom (eine Phase)
- **Impedanz** `z` = Strang-Impedanz (Einphasen-Ersatzschaltbild)

### Leistungsformel

```
S = √3 · u · conj(i)        Dreiphasen-Scheinleistung
S = |u|² / R                 Wirkverbraucher (R ist Strang-R, L-L normiert)
```

Der Strom folgt aus Kirchhoff mit L-L-Spannungen und Strang-Impedanz:
```
i = (u1 - u2) / (√3 · z)    Faktor √3 weil u L-L, z aber Strang
```

### Impedanz-Normierung

```
Z_Strang = U_LL² / S_3ph     NICHT U_LL² / (3·S_3ph)
```

Herleitung: `S_3ph = 3 · |U_Strang|² / R = 3 · (U_LL/√3)² / R = U_LL² / R`
Der √3-Faktor steckt bereits in `U_LL` — kein zusätzliches `/3` nötig.

### Gleichrichter B6 — DC-Leerlaufspannung

```
vDc0 = |u_LL| · 1.35
```

Der Faktor 1.35 = 3√2/π kommt aus dem Integral über drei Phasenhalbwellen
der Dreiphasen-Brücke (B6-Schaltung).

### Gleichrichter B6 — Strom-Transformation AC ↔ DC

Zu jedem Zeitpunkt leiten genau zwei Dioden — der Strangstrom ist ein
Rechteckpuls der Breite 2π/3. Daraus folgen zwei verschiedene Größen:

```
I_AC_eff = i_DC · √(2/3)  ≈  i_DC · 0.816    Effektivwert Strangstrom
I_AC_1   = i_DC · √6/π    ≈  i_DC · 0.780    Grundschwingung Strangstrom
```

Für den Lastfluss-Grundschwingungs-Ansatz ist **I_AC_1** die relevante Größe,
da der Solver nur mit Grundschwingungen arbeitet. Die Oberschwingungen
(5., 7., 11., 13., ...) werden vernachlässigt.

**Falsch wäre:** `i_AC = i_DC / √3 ≈ i_DC · 0.577` — das gilt nur für
den idealen Sinusstrom, nicht für den gepulsten Gleichrichterstrom.

---

## Block-Schnittstelle `calcPower`

```
Eingabe:  voltages = { connectorName: {re,im}|number, ... }
Ausgabe:  powers   = { connectorName: {re,im}|number, ... }
```

Vorzeichen (Verbraucherzählpfeil):
- `re > 0` — Einspeisung in Knoten (Erzeuger)
- `re < 0` — Verbrauch aus Knoten
- `im < 0` — induktive Blindleistung
- `im > 0` — kapazitive Blindleistung

Reelle Blöcke (`extends lastflussBlock`) geben `number` zurück —
der Simulator konvertiert automatisch via `toComplex(p)`.

---

## Versteckte Knoten

### Motivation

Ein Block wie `TrafoGleichrichter` enthält intern zwei physikalische
Teilmodelle (Trafo + Gleichrichter) die über eine interne Spannung `u2`
gekoppelt sind. Aktuell wird `u2` **blockinternen** iteriert — das
destabilisiert den äußeren Newton-Solver weil die Jacobian-Matrix
unstetig wird.

Die sauberere Lösung: `u2` wird ein echter Solver-Knoten, aber der
Benutzer deklariert ihn nicht explizit — der Block meldet ihn selbst.

### Schnittstelle

Ein Block kann optional `getHiddenNodes()` implementieren:

```js
class TrafoGleichrichter extends lastflussKomplexBlock {

    getHiddenNodes() {
        return [{
            id:    this._uid + '.u2',      // eindeutiger Name mit Block-UID
            type:  'ac',                   // 'ac' oder 'dc'
            uMin:  this.getParam('u2Nenn') * 0.8,
            uMax:  this.getParam('u2Nenn') * 1.2,
            // Welche internen Connectoren hängen an diesem Knoten:
            connectors: {
                trafo_out:  'out',   // Trafo-Teil gibt Spannung ab
                rect_in:    'in',    // Gleichrichter-Teil nimmt sie ab
            }
        }];
    }
}
```

### Integration im Simulator

`baseSim` ruft in `_buildConnectorMap()` für jeden Block `getHiddenNodes()`
ab und fügt die versteckten Knoten automatisch in `this._nodes` ein:

```js
_collectHiddenNodes() {
    const allBlocks = new Set(this._nodes.flatMap(n => n.blocks));
    for (const block of allBlocks) {
        if (typeof block.getHiddenNodes !== 'function') continue;
        for (const hn of block.getHiddenNodes()) {
            // Knoten anlegen wenn noch nicht vorhanden
            if (!this._nodes.find(n => n.id === hn.id)) {
                this._nodes.push({
                    id:     hn.id,
                    blocks: [block],   // der Block selbst verwaltet beide Seiten
                    uMin:   hn.uMin,
                    uMax:   hn.uMax,
                    hidden: true,      // nicht im User-Log anzeigen
                });
            }
        }
    }
}
```

### Auswirkungen

- `baseSim` bekommt `_collectHiddenNodes()` — gilt für alle Simulatoren
- Versteckte Knoten werden im Log mit `(intern)` markiert
- Block-UID als Prefix verhindert Namenskollisionen
- Bestehende Demos: **keine Änderung** — versteckte Knoten sind optional
- `TrafoGleichrichter` kann die blockinterne φ-Iteration vollständig
  abgeben an den Newton-Solver → sauberere Konvergenz

### Status

Implementiert. Versteckte Knoten werden in `_collectHiddenNodes()` automatisch
angelegt, im Log mit `(intern)` markiert, und im Prescan mit fixem `uMid`
initialisiert (nicht kombinatorisch gescannt).
Referenz-Implementierung: `TrafoGleichrichter` mit internem `u2`-Knoten.

---

## Ladereihenfolge gesamt

```html
<script src="/schematic/schematicBlock/schematicBlock.js"></script>
<script src="/schematic/labeledBlock/labeledBlock.js"></script>
<script src="/schematic/lastflussBlock/lastflussBlock.js"></script>
<script src="/schematic/lastflussKomplexBlock/lastflussKomplexBlock.js"></script>
<!-- Blöcke nach Bedarf -->
<script src="/schematic/simulator/baseSim.js"></script>
<script src="/schematic/simulator/nodeBaseSim.js"></script>      <!-- Knoten-Basis -->
<script src="/schematic/simulator/signalSim.js"></script>        <!-- optional -->
<script src="/schematic/simulator/lastflussSim.js"></script>     <!-- optional, DC -->
<script src="/schematic/simulator/lastflussKomplexSim.js"></script> <!-- optional, AC+DC -->
```