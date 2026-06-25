/*
solarPanelMPPT.js — Solarpanel mit internem MPPT-Tracker
Ableitung von lastflussBlock

Connector:
  out — unten mittig

Parameter:
  pNom  — Nennleistung in Wp
  uMin  — untere Betriebsspannung in V  (default: 20)
  uMax  — obere  Betriebsspannung in V  (default: 40)

Kennlinie (positiv = Einspeisung, Verbraucherzählpfeil):
  u < uMin-5%        →  P = 0
  uMin-5% .. uMin    →  P linear 0 → pNom   (weiches Einschalten)
  uMin    .. uMax    →  P = pNom             (MPPT aktiv, konstant)
  uMax    .. uMax+5% →  P linear pNom → 0   (weiches Abregeln)
  u > uMax+5%        →  P = 0

Damit hat die Kennlinie überall eine endliche Ableitung →
die numerische Jacobi wird nicht null → Newton konvergiert.
*/

const SOLARPANELMPPT_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="4" y="4" width="52" height="72" rx="3"
        fill="#1a2a1a" stroke="#4a9a4a" stroke-width="1.5"/>
  <g stroke="#2a5a2a" stroke-width="0.8" fill="#1e3a1e">
    <rect x="8"  y="8"  width="14" height="14" rx="1"/>
    <rect x="24" y="8"  width="14" height="14" rx="1"/>
    <rect x="40" y="8"  width="14" height="14" rx="1"/>
    <rect x="8"  y="24" width="14" height="14" rx="1"/>
    <rect x="24" y="24" width="14" height="14" rx="1"/>
    <rect x="40" y="24" width="14" height="14" rx="1"/>
    <rect x="8"  y="40" width="14" height="14" rx="1"/>
    <rect x="24" y="40" width="14" height="14" rx="1"/>
    <rect x="40" y="40" width="14" height="14" rx="1"/>
  </g>
  <rect x="6" y="57" width="48" height="16" rx="2" fill="#0a1a0a" stroke="#4a9a4a" stroke-width="0.8"/>
  <text x="30" y="69" text-anchor="middle" fill="#4a9a4a"
        font-size="7" font-family="monospace" font-weight="bold">MPPT</text>
  <circle cx="49" cy="13" r="3.5" fill="#f0c040" opacity="0.9"/>
  <g stroke="#f0c040" stroke-width="1" opacity="0.7">
    <line x1="49" y1="7"  x2="49" y2="5" />
    <line x1="49" y1="19" x2="49" y2="21"/>
    <line x1="43" y1="13" x2="41" y2="13"/>
    <line x1="55" y1="13" x2="57" y2="13"/>
    <line x1="45" y1="9"  x2="44" y2="8" />
    <line x1="53" y1="17" x2="54" y2="18"/>
    <line x1="45" y1="17" x2="44" y2="18"/>
    <line x1="53" y1="9"  x2="54" y2="8" />
  </g>
</svg>`);

class SolarPanelMPPT extends lastflussBlock {

    constructor(label, { pNom = 300, uMin = 20, uMax = 40, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: SOLARPANELMPPT_SVG });
        this._label = label;
        this.pNom   = pNom;
        this.uMin   = uMin;
        this.uMax   = uMax;

        this.connectors = [
            { name: 'out', x: '50%', y: '100%', type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'pNom', value: pNom, format: v => `${v} Wp` },
            { key: 'uMin', value: uMin, format: v => `${v} V`  },
            { key: 'uMax', value: uMax, format: v => `${v} V`  },
        ];

        this._resultFormats = {
            pAct: v => `pAct: ${v} W`,
            uAct: v => `uAct: ${v} V`,
        };
    }

    calcPower(voltages) {
        const u    = voltages.out ?? 0;
        const band = this.uMax * 0.05;
        const p    = interpTable([
            { x: this.uMin - band, y: 0         },
            { x: this.uMin,        y: this.pNom },
            { x: this.uMax,        y: this.pNom },
            { x: this.uMax + band, y: 0         },
        ], u);
        return { out: p };
    }

    applyOperatingPoint(voltages) {
        const u    = voltages.out ?? 0;
        const pAct = this.calcPower(voltages).out;
        this.renderResults([
            { key: 'pAct', text: `pAct: ${pAct.toFixed(1)} W` },
            { key: 'uAct', text: `uAct: ${u.toFixed(2)} V` },
        ]);
    }
}

if (typeof window !== 'undefined') window.SolarPanelMPPT = SolarPanelMPPT;