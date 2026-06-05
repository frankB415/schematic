/*
solarPanel.js — Schaltplan-Block: Solarpanel (Lastflussanalyse)
Ableitung von lastflussBlock

Connector:
  out — unten mittig (Ausgang, Lastfluss nach unten)

Parameter:
  power  — Nennleistung in Wp
  voc    — Leerlaufspannung in V
*/

const SOLARPANEL_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="4" y="4" width="52" height="72" rx="3"
        fill="#1a2a1a" stroke="#4a9a4a" stroke-width="1.5"/>
  <g stroke="#2a5a2a" stroke-width="0.8" fill="#1e3a1e">
    <rect x="8"  y="8"  width="14" height="16" rx="1"/>
    <rect x="24" y="8"  width="14" height="16" rx="1"/>
    <rect x="40" y="8"  width="14" height="16" rx="1"/>
    <rect x="8"  y="26" width="14" height="16" rx="1"/>
    <rect x="24" y="26" width="14" height="16" rx="1"/>
    <rect x="40" y="26" width="14" height="16" rx="1"/>
    <rect x="8"  y="44" width="14" height="16" rx="1"/>
    <rect x="24" y="44" width="14" height="16" rx="1"/>
    <rect x="40" y="44" width="14" height="16" rx="1"/>
    <rect x="8"  y="62" width="14" height="14" rx="1"/>
    <rect x="24" y="62" width="14" height="14" rx="1"/>
    <rect x="40" y="62" width="14" height="14" rx="1"/>
  </g>
  <circle cx="49" cy="13" r="4" fill="#f0c040" opacity="0.85"/>
  <g stroke="#f0c040" stroke-width="1" opacity="0.7">
    <line x1="49" y1="6"  x2="49" y2="4" />
    <line x1="49" y1="20" x2="49" y2="22"/>
    <line x1="42" y1="13" x2="40" y2="13"/>
    <line x1="56" y1="13" x2="58" y2="13"/>
    <line x1="44" y1="8"  x2="43" y2="7" />
    <line x1="54" y1="18" x2="55" y2="19"/>
    <line x1="44" y1="18" x2="43" y2="19"/>
    <line x1="54" y1="8"  x2="55" y2="7" />
  </g>
</svg>`);

class SolarPanel extends lastflussBlock {

    constructor(label, { pNom = 300, voc = 40, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: SOLARPANEL_SVG });
        this._label = label;
        this.pNom = pNom;
        this.voc  = voc;

        this.connectors = [
            { name: 'out', x: '50%', y: '100%', type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'pNom',     value: pNom,  format: v => `${v} Wp` },
            { key: 'voc',         value: voc,   format: v => `${v} V`  },

        ];
    }

    /**
     * Vereinfachte PV-Kennlinie: quadratischer Abfall von power bei U=0 bis 0 bei U=Voc.
     * Für U >= Voc: keine Einspeisung mehr.
     */
    /**
     * PV-Kennlinie mit MPP bei u_mpp = 0.9 * voc:
     *   0 → u_mpp : linearer Anstieg auf pNom
     *   u_mpp → voc: quadratischer Abfall auf 0
     *   u > voc   : 0 W
     */
    calcPower(voltages) {
        const u     = Math.max(0, Math.min(this.voc, voltages.out ?? 0));
        const u_mpp = 0.9 * this.voc;
        let p;
        if (u <= u_mpp) {
            p = this.pNom * u / u_mpp;
        } else {
            p = this.pNom * (1 - Math.pow((u - u_mpp) / (this.voc - u_mpp), 2));
        }
        return { out: p };
    }

    applyOperatingPoint(voltages) {
        const power = this.calcPower(voltages).out;
        const u     = voltages.out;
        this._resultFormats = {
            pAct: v => `pAct: ${v} W`,
            uAct: v => `uAct: ${v} V`,
        };
        this._setResults({
            pAct: Math.round(-power * 10) / 10,
            uAct: Math.round(u * 100) / 100,
        });
    }


}

if (typeof window !== 'undefined') window.SolarPanel = SolarPanel;