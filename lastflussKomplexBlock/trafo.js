/*
trafo.js — Transformator mit Übersetzung und Kurzschlussspannung
Ableitung von lastflussKomplexBlock

Modell:
  ue      = u1Nom / u2Nom
  zTrafo  = (u2Nom² / sNom) · (j·uk + (1-eta))   — komplex!
  dU      = u1/ue - u2
  i2      = dU / zTrafo   (geht aus Knoten 2 heraus)
  i1      = i2 / ue        (geht in Knoten 1 hinein)
  p1      = u1 · i1* · √3  (Verbraucher an k1, negativ)
  p2      = u2 · i2* · √3  (Erzeuger an k2, positiv)

Connectoren:
  in  — oben mittig  (Primärseite,   Knoten 1)
  out — unten mittig (Sekundärseite, Knoten 2)

Parameter:
  u1Nenn — Primärspannung Nenn L-L in V    (default: 400)
  u2Nenn — Sekundärspannung Nenn L-L in V  (default: 230)
  sNenn  — Nennleistung in VA              (default: 100e3)
  uk  — Kurzschlussspannung in %        (default: 4)
  eta    — Wirkungsgrad 0..1               (default: 0.98)
*/

const TRAFO_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <!-- Hintergrund -->
  <rect x="0" y="0" width="60" height="80" rx="4" fill="#1a1a2e" stroke="#a0c0ff" stroke-width="1.5"/>
  <!-- Anschlusslinien -->
  <line x1="30" y1="0"  x2="30" y2="18" stroke="#a0c0ff" stroke-width="2"/>
  <line x1="30" y1="62" x2="30" y2="80" stroke="#a0c0ff" stroke-width="2"/>
  <!-- Oberer Kreis (Primär) -->
  <circle cx="30" cy="30" r="12" fill="none" stroke="#a0c0ff" stroke-width="2"/>
  <!-- Unterer Kreis (Sekundär) -->
  <circle cx="30" cy="50" r="12" fill="none" stroke="#a0c0ff" stroke-width="2"/>
</svg>`);

class Trafo extends lastflussKomplexBlock {

    constructor(label, { u1Nenn = 400, u2Nenn = 230, sNenn = 100e3, uk = 4, eta = 0.98, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: TRAFO_SVG });
        this._label = label;

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'u1Nenn', label: 'U1 Nenn', value: u1Nenn, format: v => `${(v/1000).toFixed(3)} kV`        },
            { key: 'u2Nenn', label: 'U2 Nenn', value: u2Nenn, format: v => `${(v/1000).toFixed(3)} kV`        },
            { key: 'sNenn',  label: 'S Nenn',  value: sNenn,  format: v => `${(v/1e3).toFixed(0)} kVA`        },
            { key: 'uk',  label: 'uk',      value: uk,  format: v => `${v} %`                           },
            { key: 'eta',    label: 'η',        value: eta,    format: v => `${(v*100).toFixed(1)} %`          },
        ];
    }

    /** Gemeinsame Berechnung für calcPower und applyOperatingPoint */
    _calc(voltages) {
        const u1    = toC(voltages.in  ?? { re: this.getParam('u1Nenn'), im: 0 });
        const u2    = toC(voltages.out ?? { re: this.getParam('u2Nenn'), im: 0 });
        const ue    = this.getParam('u1Nenn') / this.getParam('u2Nenn');
        const zBase = this.getParam('u2Nenn') ** 2 / this.getParam('sNenn');
        const uk    = this.getParam('uk') / 100;
        const eta   = this.getParam('eta');

        // zTrafo = (u2Nom² / sNom) · (j·uk + (1-eta))
        const zTrafo = { re: zBase * (1 - eta), im: zBase * uk };

        // dU = u1/ue - u2
        const dU = cSub(cScale(u1, 1 / ue), u2);

        // i2 = dU / zTrafo  (geht aus Knoten 2 heraus)
        const i2 = cDiv(dU, zTrafo);

        // i1 = i2 / ue  (geht in Knoten 1 hinein)
        const i1 = cScale(i2, 1 / ue);

        const sqrt3 = Math.sqrt(3);
        // p1 = √3 · u1 · i1*  (Verbraucher an k1 → negativ)
        const p1 = cScale(cMul(u1, cConj(i1)), -sqrt3);
        // p2 = √3 · u2 · i2*  (Erzeuger an k2 → positiv)
        const p2 = cScale(cMul(u2, cConj(i2)), sqrt3);

        return { u1, u2, i2, p1, p2 };
    }

    calcPower(voltages) {
        const { p1, p2 } = this._calc(voltages);
        return { in: p1, out: p2 };
    }

    applyOperatingPoint(voltages) {
        const { u1, u2, i2, p1, p2 } = this._calc(voltages);
        this.renderResults([
            { key: 'u1',   text: `U1: ${lastflussKomplexBlock.fmtPhasor(u1)}` },
            { key: 'u2',   text: `U2: ${lastflussKomplexBlock.fmtPhasor(u2)}` },
            { key: 'p1',   text: `S1: ${lastflussKomplexBlock.fmtPower({ re: -p1.re, im: -p1.im })}` },
            { key: 'p2',   text: `S2: ${lastflussKomplexBlock.fmtPower(p2)}` },
            { key: 'iAbs', text: `I2: ${cAbs(i2).toFixed(1)} A` },
        ]);
    }
}

if (typeof window !== 'undefined') window.Trafo = Trafo;

console.log('[trafo] Version 2026-06-07 build 1 (renderResults)');