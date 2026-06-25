schematic/lastflussKomplexBlock/lastflussKomplexBlock_API.md
# lastflussKomplexBlock.js – API-Dokumentation

## Übersicht

`lastflussKomplexBlock` ist eine **abstrakte Basisklasse** für Wechselstrom-Lastfluss-Blöcke im Einleiterschema. Sie erbt von `lastflussBlock` und definiert die Schnittstelle für Blöcke, die mit komplexen Spannungen und Strömen arbeiten.

## Vererbungshierarchie

```
schematicBlock → lastflussBlock → lastflussKomplexBlock
                                   ├── ACKabel
                                   ├── Gleichrichter
                                   ├── Spannungsquelle
                                   ├── Trafo
                                   ├── TrafoGleichrichter
                                   └── WiderstandsLast
```

## Konventionen

### Einleiterschema (Single-Line Diagram)
- **Spannungen u**: Verkettete Leiterspannungen (L-L) in Volt
- **Ströme i**: Strangströme einer Phase
- **Impedanzen z**: Strang-Impedanzen (Einphasen-Ersatzschaltbild)
- **Leistungen P, Q, S**: Dreiphasen-Gesamtleistungen
  - Formel: `S = √3 · U_LL · I_Strang · e^(jφ)`
  - Der Faktor √3 erscheint in allen Leistungsformeln: `p = √3 · u · i*`

### Impedanz bei Nennleistung
- Bei gegebener Nennspannung `U_LL` und Nennleistung `S_3ph` gilt:
  - `Z_Strang = U_LL² / S_3ph`
  - (Nicht `U_LL² / (3·S_3ph)`, weil `U_LL = √3 · U_Strang` bereits im √3-Faktor steckt)

### Vorzeichenkonvention
- Leistungen: `re>0` = Einspeisung, `re<0` = Verbrauch
- Blindleistung: `im<0` = induktiv, `im>0` = kapazitiv

## Komplexe Hilfsfunktionen (Modulebene, global)

Alle Funktionen arbeiten mit Objekten der Form `{ re: number, im: number }`.

| Funktion | Beschreibung |
|----------|--------------|
| `cAdd(a, b)` | Addition: `a + b` |
| `cSub(a, b)` | Subtraktion: `a - b` |
| `cMul(a, b)` | Multiplikation: `a · b` |
| `cDiv(a, b)` | Division: `a / b` |
| `cConj(a)` | Konjugation: `a*` |
| `cAbs(a)` | Betrag: `√(re² + im²)` |
| `cArg(a)` | Argument (Winkel): `atan2(im, re)` |
| `cScale(a, s)` | Skalierung: `a · s` (s = Zahl) |
| `toC(v)` | Konvertierung: Zahl → `{re: v, im: 0}` oder Rückgabe als Objekt |

Die Funktionen stehen auch als **statische Methoden** zur Verfügung:
- `lastflussKomplexBlock.cAdd()`, `lastflussKomplexBlock.cSub()`, usw.

## Abstrakte Methode: `calcPower(voltages)`

```javascript
calcPower(voltages)
```

### Parameter
- `voltages` — Objekt mit komplexen Spannungen pro Connector:
  ```javascript
  {
    connectorName: { re: number, im: number }   // Phasor in V (L-L)
  }
  ```
  - Für DC-Connectoren: `{ connectorName: number }` (reell)

### Rückgabe
- Objekt mit komplexen Leistungen pro Connector:
  ```javascript
  {
    connectorName: { re: number, im: number }   // Scheinleistung in VA
  }
  ```
  - Für DC-Connectoren: `{ connectorName: number }` (reell)
  - Vorzeichen: `re>0` = Einspeisung, `re<0` = Verbrauch

**Muss von jeder Unterklasse implementiert werden.**

## Statische Hilfsmethoden

### `lastflussKomplexBlock.fmtPhasor(v, digits = 3)`
Formatiert einen komplexen Phasor als `"|U| kV ∠ φ°"`.

- **Parameter**: `v` = `{re, im}`, `digits` = Nachkommastellen (default: 3)
- **Rückgabe**: String, z.B. `"20.000 kV ∠ 0.0°"`

### `lastflussKomplexBlock.fmtPower(s, digits = 1)`
Formatiert Scheinleistung als `"( P + jQ ) kVA"`.

- **Parameter**: `s` = `{re, im}`, `digits` = Nachkommastellen (default: 1)
- **Rückgabe**: String, z.B. `"( -49.4 + j1.0 ) kVA"`

---

## Konkrete Block-Implementierungen

### `Spannungsquelle extends lastflussKomplexBlock`

```javascript
new Spannungsquelle(label, { uNom = 400, skNom = 5e6, phiNom = 0, x = null, y = null })
```

| Param | Default | Beschreibung |
|-------|---------|--------------|
| `uNom` | `400` | Nennspannung L-L in V |
| `skNom` | `5e6` | Kurzschlussleistung in VA |
| `phiNom` | `0` | Phasenwinkel der EMK in Grad |

Connector: `out` (unten mittig, Richtung `down`).

**Modell:** Spannungsquelle mit Quellenimpedanz.
- Interne EMK: `u1 = uNom · e^(j·phiNom°)`
- Quellenimpedanz: `zQuelle = (uNom²/skNom) · (0.1 + j)` → R/X = 0.1
- Strom: `i2 = (u1 − u2) / zQuelle`
- Leistung: `p2 = √3 · u2 · i2*` (Einspeisung in Connector `out`)

Ergebnisse: `U` (Phasor), `S` (Scheinleistung), `I` (Betrag Strangstrom in A).

---

### `ACKabel extends lastflussKomplexBlock`

```javascript
new ACKabel(label, {
    laenge = 1,
    quer   = 150,
    uNenn  = 20000,
    fNenn  = 50,
    cKm    = 0.3e-6,
    lKm    = 0.35e-3,
    x = null, y = null
})
```

| Param | Default | Beschreibung |
|-------|---------|--------------|
| `laenge` | `1` | Kabellänge in km |
| `quer` | `150` | Leiterquerschnitt in mm² |
| `uNenn` | `20000` | Nennspannung L-L in V |
| `fNenn` | `50` | Nennfrequenz in Hz |
| `cKm` | `0.3e-6` | Kapazitätsbelag in F/km (20 kV XLPE Richtwert) |
| `lKm` | `0.35e-3` | Induktivitätsbelag in H/km |

Connectoren: `in` (oben mittig), `out` (unten mittig).

**Modell:** R+jX Serienersatzschaltbild (π-Modell ohne Querkapazität im Leistungspfad).

Widerstandsanteile (einzeln berechnet und angezeigt):
- **R_dc** — DC-Widerstand: `ρ_eff · l / A` mit `ρ_eff = 21.1 nΩm` (70 °C inkl. Verseilung)
- **R_skin** — Skin-Effekt (IEC 60287, vereinfacht): `R_dc · (k_skin − 1)`
- **R_prox** — Proximity-Effekt (IEC 60287, vereinfacht): anteilig aus `k_skin`
- **R_ac** = `R_dc · k_skin · (1 + k_prox_faktor)`
- **P_diel** — Dielektrische Verluste: `ω · C · tan(δ) · u1_LL²` mit `tan δ = 0.0004` (XLPE)
- **X** — Reaktanz: `ω · lKm · l`

Strombilanz:
- `i = (u1 − u2) / (√3 · z_kabel)` (Strangstrom aus L-L-Spannungsdifferenz)
- `p1 = √3 · u1 · i*` (Verbrauch an `in`, `re < 0`)
- `p2 = √3 · u2 · i*` (Einspeisung an `out`, `re > 0`)
- Dielektrische Verluste werden als Offset auf `p1` aufgeschlagen.

Ergebnisse: `U1`, `U2` (Phasoren), `S1`, `S2` (Scheinleistungen), `I` (Betrag), `P_dc`, `P_skin`, `P_prox`, `P_diel` (Verlustanteile in W).

---

### `Trafo extends lastflussKomplexBlock`

```javascript
new Trafo(label, { u1Nenn = 400, u2Nenn = 230, sNenn = 100e3, uk = 4, eta = 0.98, x = null, y = null })
```

| Param | Default | Beschreibung |
|-------|---------|--------------|
| `u1Nenn` | `400` | Primärspannung Nenn L-L in V |
| `u2Nenn` | `230` | Sekundärspannung Nenn L-L in V |
| `sNenn` | `100e3` | Nennleistung in VA |
| `uk` | `4` | Kurzschlussspannung in % |
| `eta` | `0.98` | Wirkungsgrad (0..1) |

Connectoren: `in` (oben mittig, Primärseite), `out` (unten mittig, Sekundärseite).

**Modell:**
- Übersetzungsverhältnis: `ue = u1Nenn / u2Nenn`
- Trafo-Impedanz: `zTrafo = (u2Nenn² / sNenn) · ((1−η) + j·uk/100)`
- Spannungsdifferenz: `dU = u1/ue − u2`
- Sekundärstrom: `i2 = dU / zTrafo`
- Primärstrom: `i1 = i2 / ue`
- Leistungen: `p1 = −√3 · u1 · i1*` (Verbrauch), `p2 = √3 · u2 · i2*` (Einspeisung)

Ergebnisse: `U1`, `U2` (Phasoren), `S1`, `S2` (Scheinleistungen), `I2` (Betrag Sekundärstrom in A).

---

### `Gleichrichter extends lastflussKomplexBlock`

```javascript
new Gleichrichter(label, { u1Nenn = 230, pNom = 100e3, eta = 0.98, x = null, y = null })
```

| Param | Default | Beschreibung |
|-------|---------|--------------|
| `u1Nenn` | `230` | AC-Eingangsspannung Nenn L-L in V |
| `pNom` | `100e3` | Nenn-DC-Leistung in W |
| `eta` | `0.98` | Wirkungsgrad (0..1) |

Connectoren: `in` (oben mittig, AC-Eingang komplex L-L), `out` (unten mittig, DC-Ausgang reell).

**Modell:** Dreiphasen-Brückengleichrichter B6 (nur Gleichrichter, ohne Trafo — für Kombination mit `Trafo` verwenden).
- Leerlauf-DC: `vDc0 = |u1| · 1.35`
- Innenwiderstand: `r_int = (1−η) · (u1Nenn·1.35)² / pNom`
- DC-Strom: `i_dc = max(0, (vDc0 − vDc) / r_int)` (Diodenbedingung)
- DC-Leistung: `pDc = vDc · i_dc` (Einspeisung in `out`)
- AC-Verbrauch: `pAcAbs = vDc0 · i_dc` (cos φ = 1)
- AC-Scheinleistung: `s1 = { re: −pAcAbs, im: 0 }` (Verbrauch an `in`)

> **Vorteil gegenüber `TrafoGleichrichter`:** Die Zwischenspannung u1 ist ein echter Solver-Knoten → keine blockinterne φ-Iteration nötig, Newton-Solver übernimmt vollständige Konvergenz.

Ergebnisse: `U1` (Phasor), `S1` (AC-Scheinleistung), `vDc0`, `vDc` (V), `I_dc` (A), `P_dc` (W), `Diode` (leitend/gesperrt).

---

### `TrafoGleichrichter extends lastflussKomplexBlock`

```javascript
new TrafoGleichrichter(label, {
    u1Nenn     = 400,
    u2Nenn     = 230,
    sNenn      = 100e3,
    uk         = 4,
    eta        = 0.993,
    etaBruecke = 0.997,
    pNom       = null,    // default: sNenn * 0.98
    x = null, y = null
})
```

| Param | Default | Beschreibung |
|-------|---------|--------------|
| `u1Nenn` | `400` | Primärspannung Nenn L-L in V |
| `u2Nenn` | `230` | Sekundärspannung Nenn L-L in V |
| `sNenn` | `100e3` | Trafo-Nennleistung in VA |
| `uk` | `4` | Kurzschlussspannung in % |
| `eta` | `0.993` | Trafo-Wirkungsgrad (0..1) |
| `etaBruecke` | `0.997` | Brücken-Wirkungsgrad (0..1) |
| `pNom` | `sNenn·0.98` | Max. DC-Nennleistung in W |

Connectoren: `in` (oben mittig, AC Primär komplex), `out` (unten mittig, DC reell).

**Modell:** Trafo + B6-Brückengleichrichter in einem Block mit internem Knoten `u2`.

Interner Knoten (via `getHiddenNodes()`):
```javascript
{
    id:           label + '.u2',   // eindeutig aus _label
    type:         'ac',
    connectorName: 'u2',
    blocks:       [this],
    uMin:   u2Nenn * 0.85,
    uMax:   u2Nenn * 1.05,
}
```

`calcPower()` gibt drei Einträge zurück:
```javascript
{
    in:   p1,          // AC-Primär (komplex, Verbrauch)
    out:  pDc,         // DC (reell, Einspeisung)
    'u2': p_u2_trafo + p_u2_rect   // Netto am internen Knoten (komplex)
}
```

`G_MIN = 1e-6 S` als Mindest-Querlast am internen Knoten — hält den Jacobian regulär wenn die Diode sperrt.

Ergebnisse: `U1`, `U2` (Phasoren), `S1`, `S2` (Scheinleistungen), `vDc0`, `vDc` (V), `I_dc` (A), `P_dc` (kW), `Diode` (leitend/gesperrt).

---

### `WiderstandsLast extends lastflussKomplexBlock`

```javascript
new WiderstandsLast(label, { uNenn = 230, pNom = 10e3, x = null, y = null })
```

| Param | Default | Beschreibung |
|-------|---------|--------------|
| `uNenn` | `230` | Nennspannung L-L in V |
| `pNom` | `10e3` | Nennwirkleistung in W |

Connector: `in` (oben mittig, Richtung `up`).

**Modell:** Konstanter ohmscher Widerstand `rNom = uNenn² / pNom`.
- `pAct = −|u|² / rNom` (spannungsabhängige Leistung, Verbrauch)
- `s1 = { re: pAct, im: 0 }` (rein ohmscher Last, cos φ = 1)

Ergebnisse: `U` (Phasor), `P` (kW), `I` (Betrag Strangstrom in A).

---

## Verwendung in Unterklassen

### Minimal-Implementierung einer Unterklasse

```javascript
class MeinBlock extends lastflussKomplexBlock {
    constructor(label, options = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: MEIN_SVG });
        this._label = label;

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'uNenn', label: 'U Nenn', value: uNenn, format: v => `${(v/1000).toFixed(3)} kV` },
        ];
    }

    _calc(voltages) {
        const u1 = toC(voltages.in ?? { re: this.getParam('uNenn'), im: 0 });
        // ... Berechnungen ...
        return { u1, p1, p2 };
    }

    calcPower(voltages) {
        const { p1, p2 } = this._calc(voltages);
        return { in: p1, out: p2 };
    }

    applyOperatingPoint(voltages) {
        const { u1, p1, p2 } = this._calc(voltages);
        this.renderResults([
            { key: 'u1', text: `U1: ${lastflussKomplexBlock.fmtPhasor(u1)}` },
            { key: 's1', text: `S1: ${lastflussKomplexBlock.fmtPower({ re: -p1.re, im: -p1.im })}` },
        ]);
    }
}
```

### Versteckte Knoten (hidden nodes)

Ein Block kann interne Knoten melden, die der Simulator automatisch anlegt:

```javascript
getHiddenNodes() {
    return [{
        id:           this._uid + '.u2',
        type:         'ac',                        // oder 'dc' für Gleichspannung
        connectorName: 'u2',                        // Name für calcPower-Zugriff
        blocks:       [this],                       // Zuständiger Block
        uMin:   u2Nenn * 0.85,                     // Scan-Bereich
        uMax:   u2Nenn * 1.05,
    }];
}
```

Das `calcPower` erhält dann die Spannung des versteckten Knotens unter dem `connectorName`:
```javascript
// In _calc:
const u2 = toC(voltages['u2'] ?? voltages[hiddenId] ?? { re: this.getParam('u2Nenn'), im: 0 });
```

## Unterschied zu `lastflussBlock`

| Aspekt | `lastflussBlock` | `lastflussKomplexBlock` |
|--------|-----------------|-------------------------|
| Spannungen | Reell (Betrag) | Komplex `{re, im}` |
| Ströme | Betrag | Komplex `{re, im}` |
| Leistungen | Reell (Wirkleistung) | Komplex (Scheinleistung) |
| Energiefluss | Vorzeichen (positiv/negativ) | Komplex (Wirk- und Blindleistung) |
| calcPower | Rückgabe reell | Rückgabe komplex |
| √3-Faktor | Nicht enthalten | In Leistungsformeln enthalten |

## Änderungshistorie

- **2026-06-11**: Alle konkreten Blöcke dokumentiert (ACKabel, Gleichrichter, Spannungsquelle, Trafo, TrafoGleichrichter, WiderstandsLast)
- **2026-06-07 build 1**: Erste Version (Julia)
