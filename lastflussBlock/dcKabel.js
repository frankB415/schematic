/*
dcKabel.js — DC-Kabel (Hochspannung DC, Einleiterschema)
Ableitung von lastflussBlock

Verwendet dieselbe Widerstandsberechnung wie ACKabel (_kabelParams-Logik),
jedoch nur den DC-Anteil — kein Skin-Effekt, keine Reaktanz, keine
dielektrischen Verluste (bei DC irrelevant).

Modell:
  v1 ──[R_dc]── v2

  i    = (v1 - v2) / R_dc
  p1   = -v1 · i   (Verbrauch an in,  negativ)
  p2   = +v2 · i   (Einspeisung an out, positiv)

Parameter:
  laenge  — Kabellänge in km         (default: 1)
  quer    — Querschnitt in mm²       (default: 150)
  uNenn   — Nennspannung DC in V     (default: 18000)

Connectoren:
  in  — oben mittig   (Einspeiseseite)
  out — unten mittig  (Lastseite)
*/

const DCKABEL_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100">
  <!-- Gehäuse -->
  <rect x="4" y="4" width="52" height="92" rx="4" fill="#1a1a2e" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Kabelquerschnitt: äusserer Mantel -->
  <circle cx="30" cy="50" r="20" fill="none" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Isolation -->
  <circle cx="30" cy="50" r="14" fill="none" stroke="#c0a080" stroke-width="1" opacity="0.6"/>
  <!-- Leiter (gefüllt) -->
  <circle cx="30" cy="50" r="7" fill="#c0a080" opacity="0.8"/>
  <!-- Längslinien (Kabelverlauf) -->
  <line x1="30" y1="4"  x2="30" y2="26" stroke="#c0a080" stroke-width="1.5"/>
  <line x1="30" y1="74" x2="30" y2="96" stroke="#c0a080" stroke-width="1.5"/>
  <!-- DC-Kennzeichnung: zwei Parallellinien -->
  <line x1="14" y1="46" x2="26" y2="46" stroke="#c0a080" stroke-width="1.5"/>
  <line x1="14" y1="50" x2="26" y2="50" stroke="#c0a080" stroke-width="1.5"/>
  <line x1="34" y1="46" x2="46" y2="46" stroke="#c0a080" stroke-width="1.5"/>
  <line x1="34" y1="50" x2="46" y2="50" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Label -->
  <text x="30" y="93" text-anchor="middle" fill="#c0a080" font-size="6" font-family="monospace">DC</text>
</svg>`);

class DCKabel extends lastflussBlock {

    constructor(label, { laenge = 1, quer = 150, uNenn = 18000, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 100, imageSrc: DCKABEL_SVG });
        this._label = label;

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'laenge', label: 'Länge',  value: laenge, format: v => `${v.toFixed(1)} km`        },
            { key: 'quer',   label: 'A',      value: quer,   format: v => `${v} mm²`                  },
            { key: 'uNenn',  label: 'U Nenn', value: uNenn,  format: v => `${(v/1000).toFixed(1)} kV` },
        ];

        this._resultFormats = {
            pIn:   v => `pIn:  ${(v/1000).toFixed(2)} kW`,
            pOut:  v => `pOut: ${(v/1000).toFixed(2)} kW`,
            pLoss: v => `pVerlust: ${(v/1000).toFixed(2)} kW`,
            iAbs:  v => `I: ${v.toFixed(1)} A`,
            v1:    v => `V1: ${(v/1000).toFixed(3)} kV`,
            v2:    v => `V2: ${(v/1000).toFixed(3)} kV`,
            R_dc:  v => `R_dc: ${v.toFixed(4)} Ω`,
        };
    }

    /** DC-Widerstand — identische Formel wie ACKabel._kabelParams(), nur R_dc */
    _R_dc() {
        const l   = this.getParam('laenge') * 1000;   // km → m
        const A   = this.getParam('quer')   * 1e-6;   // mm² → m²
        // ρ_eff = 21.1 nΩm (70°C Betrieb, Verseilungsfaktor, identisch zu ACKabel)
        return 21.1e-9 * l / A;
    }

    _calc(voltages) {
        const v1   = voltages.in  ?? this.getParam('uNenn');
        const v2   = voltages.out ?? this.getParam('uNenn');
        const R_dc = this._R_dc();

        const i    = (v1 - v2) / R_dc;
        const p1   = -v1 * i;   // Verbrauch (negativ)
        const p2   =  v2 * i;   // Einspeisung (positiv)
        const pLoss = p2 - p1;  // Verluste = |p1| - |p2| (negativ, da p1<0, p2>0 → pLoss = p2+|p1| wäre falsch)
                                 // korrekt: Verlust = -p1 - p2 = i²·R_dc
        return { v1, v2, i, p1, p2, pLoss: i * i * R_dc, R_dc };
    }

    calcCurrent(voltages) {
        const v1   = voltages.in  ?? this.getParam('uNenn');
        const v2   = voltages.out ?? this.getParam('uNenn');
        const R_dc = this._R_dc();
        // i = Strom von in nach out (positiv wenn v1 > v2)
        const i    = (v1 - v2) / R_dc;
        // an Knoten in:  Kabel zieht Strom ab  → negativ
        // an Knoten out: Kabel speist Strom ein → positiv
        return { in: -i, out: i };
    }

    calcPower(voltages) {
        throw new Error('DCKabel.calcPower() ist nicht mehr unterstuetzt — calcCurrent() verwenden.');
    }

    applyOperatingPoint(voltages) {
        const { v1, v2, i, p1, p2, pLoss, R_dc } = this._calc(voltages);
        this.renderResults([
            { key: 'v1',    text: `V1: ${(v1/1000).toFixed(3)} kV`        },
            { key: 'v2',    text: `V2: ${(v2/1000).toFixed(3)} kV`        },
            { key: 'pIn',   text: `pIn:  ${(-p1/1000).toFixed(2)} kW`     },
            { key: 'pOut',  text: `pOut: ${(p2/1000).toFixed(2)} kW`      },
            { key: 'pLoss', text: `pVerlust: ${(pLoss/1000).toFixed(2)} kW` },
            { key: 'iAbs',  text: `I: ${Math.abs(i).toFixed(1)} A`        },
            { key: 'R_dc',  text: `R_dc: ${R_dc.toFixed(4)} Ω`            },
        ]);
    }
}

if (typeof window !== 'undefined') window.DCKabel = DCKabel;
