/*
widerstandsLast.js — Rein ohmsche Last (cos φ = 1)
Ableitung von lastflussKomplexBlock

Modell:
  R = U_nenn² / P_nenn
  I = U / R
  S = U · I* = |U|² / R  (rein reell, Q = 0)

Connector:
  in — oben mittig (Klemme)

Parameter:
  uNenn  — Nennspannung L-L in V (default: 230)
  pNom   — Nennwirkleistung in W (default: 10e3)
*/

const WIDERSTANDSLAST_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="4" y="4" width="52" height="72" rx="4" fill="#1a1a2e" stroke="#ff8080" stroke-width="1.5"/>
  <rect x="18" y="28" width="24" height="28" rx="2" fill="none" stroke="#ff8080" stroke-width="1.5"/>
  <line x1="30" y1="4"  x2="30" y2="28" stroke="#ff8080" stroke-width="1.5"/>
  <line x1="30" y1="56" x2="30" y2="72" stroke="#ff8080" stroke-width="1.5" stroke-dasharray="3,2"/>
  <text x="30" y="47" text-anchor="middle" fill="#ff8080" font-size="9" font-family="monospace">R</text>
</svg>`);

class WiderstandsLast extends lastflussKomplexBlock {

    constructor(label, { uNenn = 230, pNom = 10e3, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: WIDERSTANDSLAST_SVG });
        this._label = label;

        this.connectors = [
            { name: 'in', x: '50%', y: '0%', type: 'electrical', direction: 'up', minLength: 24 },
        ];

        this.params = [
            { key: 'uNenn', label: 'U Nenn', value: uNenn, format: v => `${(v/1000).toFixed(3)} kV`  },
            { key: 'pNom',  label: 'P Nenn', value: pNom,  format: v => `${(v/1e3).toFixed(1)} kW` },
        ];
    }

    calcPower(voltages) {
        const u    = toC(voltages.in ?? { re: this.getParam('uNenn'), im: 0 });
        const uAbs = cAbs(u);
        // iNom = pNom / uNom / √3
        // rNom = uNom / √3 / iNom = uNom² / pNom
        const rNom = this.getParam('uNenn') ** 2 / this.getParam('pNom');
        // pAct = u² / rNom
        const pAct = -(uAbs ** 2) / rNom;
        return { in: { re: pAct, im: 0 } };
    }

    applyOperatingPoint(voltages) {
        const u        = toC(voltages.in ?? { re: this.getParam('uNenn'), im: 0 });
        const { in: s } = this.calcPower(voltages);
        const iAbs     = Math.abs(s.re) / (Math.sqrt(3) * cAbs(u));
        this.renderResults([
            { key: 'u',    text: `U: ${lastflussKomplexBlock.fmtPhasor(u)}` },
            { key: 'p',    text: `P: ${(Math.abs(s.re)/1e3).toFixed(2)} kW` },
            { key: 'iAbs', text: `I: ${iAbs.toFixed(1)} A` },
        ]);
    }
}

if (typeof window !== 'undefined') window.WiderstandsLast = WiderstandsLast;

console.log('[widerstandsLast] Version 2026-06-07 build 1 (renderResults)');