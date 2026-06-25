/*
dcdc.js — Ableitung von lastflussBlock
*/
const DCDC_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <!-- Hintergrund -->
  <rect x="4" y="4" width="52" height="72" rx="4" fill="#1a1a2e" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Anschlusslinien oben/unten -->
  <line x1="30" y1="0"  x2="30" y2="14" stroke="#c0a080" stroke-width="2"/>
  <line x1="30" y1="66" x2="30" y2="80" stroke="#c0a080" stroke-width="2"/>
  <!-- Gehäuse (Konverter-Symbol) -->
  <rect x="12" y="18" width="36" height="44" rx="0"
        fill="none" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Diagonale -->
  <line x1="12" y1="62" x2="48" y2="18" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Eingangsseite: zwei Gleichstromlinien (oben links) -->
  <line x1="16" y1="28" x2="26" y2="28" stroke="#c0a080" stroke-width="1.5"/>
  <line x1="16" y1="33" x2="26" y2="33" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Ausgangsseite: zwei Gleichstromlinien (unten rechts) -->
  <line x1="34" y1="47" x2="44" y2="47" stroke="#c0a080" stroke-width="1.5"/>
  <line x1="34" y1="52" x2="44" y2="52" stroke="#c0a080" stroke-width="1.5"/>
</svg>`);

class DCDC extends lastflussBlock {

    static interfaceVersion = 2;

    static defaultOpts = {
        vNomIn: 48,
        vNomOut: 24,
        eta: 0.95,
        pNom: 500,
        couplingImpedance: 20,
        x: null,
        y: null,
    };

    constructor(label, opts = {}) {
        const o = lastflussBlock.resolveOpts(DCDC, opts);
        super({ x: o.x, y: o.y, imageW: 60, imageH: 80, imageSrc: DCDC_SVG });
        this._label = label;
        Object.assign(this, o);
        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];
        this.params = [
            { key: 'vNomIn',  value: o.vNomIn,  format: v => lastflussBlock.fmtKV(v) },
            { key: 'vNomOut', value: o.vNomOut, format: v => lastflussBlock.fmtKV(v) },
            { key: 'eta',     value: o.eta,     format: v => `${(v*100).toFixed(1)} %`  },
            { key: 'pNom',             value: o.pNom,             format: v => lastflussBlock.fmtKW(v)      },
            { key: 'couplingImpedance', value: o.couplingImpedance, format: v => `${v} pu`                  },
        ];
    }

    calcPower(voltages) {
        const uIn  = voltages.in  ?? 0;
        const uOut = voltages.out ?? 0;
        let p = (uIn / this.vNomIn - uOut / this.vNomOut) * this.pNom * this.couplingImpedance;
        p = Math.max(-this.pNom, Math.min(this.pNom, p));
        const pVerlust = Math.abs(p) * (1 - this.eta);
        return { in: -(p + pVerlust), out: p };
    }

    applyOperatingPoint(voltages) {
        const { in: pIn, out: pOut } = this.calcPower(voltages);
        const uIn  = voltages.in  ?? 0;
        const uOut = voltages.out ?? 0;
        this.renderResults([
            { key: 'pIn',  text: `pIn:  ${lastflussBlock.fmtKW(-pIn)}` },
            { key: 'pOut', text: `pOut: ${lastflussBlock.fmtKW(pOut)}` },
            { key: 'uIn',  text: `uIn:  ${lastflussBlock.fmtKV(uIn)}` },
            { key: 'uOut', text: `uOut: ${lastflussBlock.fmtKV(uOut)}` },
        ]);
    }
}

if (typeof window !== 'undefined') window.DCDC = DCDC;