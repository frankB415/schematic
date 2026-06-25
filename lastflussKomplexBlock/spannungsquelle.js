/*
spannungsquelle.js — Spannungsquelle mit Quellenimpedanz
Ableitung von lastflussKomplexBlock

Modell:
  u1      — interne feste Spannung (Konfiguration, kein Knoten)
           u1 = uNom · e^(j·phiNom°)
  zQuelle = (uNom² / skNom) · (j + 0.1)   — R/L = 10
  dU      = u1 - u2
  i2      = dU / zQuelle   (geht aus dem Connector heraus in den Knoten)
  p2      = u2 · i2* · √3  (Einspeisung in k2, positiv)

Connector:
  out — unten mittig (Klemme, verbunden mit Primärknoten)

Parameter:
  uNom    — Nennspannung L-L in V         (default: 400)
  skNom   — Kurzschlussleistung in VA     (default: 5e6)
  phiNom  — Phasenwinkel der EMK in Grad  (default: 0)
*/

const SPANNUNGSQUELLE_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="4" y="4" width="52" height="72" rx="4" fill="#1a1a2e" stroke="#60a0ff" stroke-width="1.5"/>
  <circle cx="30" cy="36" r="16" fill="none" stroke="#60a0ff" stroke-width="1.5"/>
  <text x="30" y="31" text-anchor="middle" fill="#60a0ff" font-size="9" font-family="monospace">AC</text>
  <text x="30" y="44" text-anchor="middle" fill="#60a0ff" font-size="14" font-family="monospace">~</text>
  <text x="30" y="66" text-anchor="middle" fill="#60a0ff" font-size="7" font-family="monospace">Quelle</text>
</svg>`);

class Spannungsquelle extends lastflussKomplexBlock {

    constructor(label, { uNom = 400, skNom = 5e6, phiNom = 0, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: SPANNUNGSQUELLE_SVG });
        this._label = label;

        this.connectors = [
            { name: 'out', x: '50%', y: '100%', type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'uNom',   label: 'U Nenn', value: uNom,   format: v => `${(v/1000).toFixed(1)} kV`        },
            { key: 'skNom',  label: 'S_k',    value: skNom,  format: v => `${(v/1e6).toFixed(0)} MVA`        },
            { key: 'phiNom', label: 'φ',       value: phiNom, format: v => `${v} °`                           },
        ];
    }

    /** Interne feste EMK: u1 = uNom · e^(j·phiNom) */
    _u1() {
        const uNom  = this.getParam('uNom');
        const phi   = this.getParam('phiNom') * Math.PI / 180;
        return { re: uNom * Math.cos(phi), im: uNom * Math.sin(phi) };
    }

    /** Quellenimpedanz: zQuelle = (uNom²/skNom) · (j + 0.1) */
    _zQuelle() {
        const zBase = this.getParam('uNom') ** 2 / this.getParam('skNom');
        return { re: zBase * 0.1, im: zBase * 1.0 };
    }

    _calc(voltages) {
        const u2 = toC(voltages.out ?? this._u1());
        const u1 = this._u1();
        const zQ = this._zQuelle();
        // dU = u1 - u2
        const dU = cSub(u1, u2);
        const i2 = cDiv(dU, zQ);
        const p2 = cScale(cMul(u2, cConj(i2)), Math.sqrt(3));
        return { u2, i2, p2 };
    }

    calcCurrent(voltages) {
        const { i2 } = this._calc(voltages);
        // i2 fliesst aus Quelle in den Knoten → Einspeisung → positiv
        return { out: i2 };
    }

    calcPower(voltages) {
        throw new Error('Spannungsquelle.calcPower() ist nicht mehr unterstuetzt — calcCurrent() verwenden.');
    }

    applyOperatingPoint(voltages) {
        const { u2, i2, p2 } = this._calc(voltages);
        this.renderResults([
            { key: 'u2',   text: `U: ${lastflussKomplexBlock.fmtPhasor(u2)}` },
            { key: 'p2',   text: `S: ${lastflussKomplexBlock.fmtPower(p2)}` },
            { key: 'iAbs', text: `I: ${cAbs(i2).toFixed(1)} A` },
        ]);
    }
}

if (typeof window !== 'undefined') window.Spannungsquelle = Spannungsquelle;
