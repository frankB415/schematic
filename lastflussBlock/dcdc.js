/*
dcdc.js — Schaltplan-Block: DC/DC-Wandler (Lastflussanalyse)
Ableitung von lastflussBlock

Connectoren:
  in  — oben mittig  (Eingang,  Knoten 1)
  out — unten mittig (Ausgang,  Knoten 2)

Kopplung ueber couplingImpedance:
  pAct     = (vIn/vNomIn - vOut/vNomOut) * pNom * couplingImpedance
  pVerlust = |pAct| * (1 - eta)
  sign     = Vorzeichen von pAct (Energieflussrichtung)
  in:  -(pAct + sign*pVerlust)   // abgebende Seite trägt Verluste
  out:   pAct - sign*pVerlust    // empfangende Seite erhält weniger
  P_out = P_in * eta

Parameter:
  vNomIn            — Nennspannung Eingang  (default: 48)
  vNomOut           — Nennspannung Ausgang  (default: 24)
  eta               — Wirkungsgrad 0..1     (default: 0.95)
  pNom              — Nennleistung in W (default: 500)
  couplingImpedance — Steifigkeit der Kopplung           (default: 20)
*/

const DCDC_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="4" y="4" width="52" height="72" rx="4"
        fill="#1a1a2e" stroke="#c8a030" stroke-width="1.5"/>
  <line x1="30" y1="14" x2="30" y2="42" stroke="#c8a030" stroke-width="2"/>
  <polygon points="30,50 24,38 36,38" fill="#c8a030"/>
  <text x="30" y="66" text-anchor="middle" fill="#c8a030"
        font-size="9" font-family="monospace">DC/DC</text>
</svg>`);

class DCDC extends lastflussBlock {

    constructor(label, { vNomIn = 48, vNomOut = 24, eta = 0.95, pNom = 500, couplingImpedance = 20, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: DCDC_SVG });
        this._label = label;
        this.vNomIn            = vNomIn;
        this.vNomOut           = vNomOut;
        this.eta               = eta;
        this.pNom              = pNom;
        this.couplingImpedance = couplingImpedance;

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'vNomIn',  value: vNomIn,  format: v => `${v} V` },
            { key: 'vNomOut',  value: vNomOut, format: v => `${v} V` },
            { key: 'eta', value: eta,    format: v => `${v}`    },
            { key: 'pNom',       value: pNom,   format: v => `${v} W`  },
        ];
    }

    calcPower(voltages) {
        const uIn  = voltages.in  ?? 0;
        const uOut = voltages.out ?? 0;
        let p = (uIn / this.vNomIn - uOut / this.vNomOut) * this.pNom * this.couplingImpedance;
        p = Math.max(-this.pNom, Math.min(this.pNom, p));
        const pVerlust = Math.abs(p) * (1 - this.eta);
        const sign = Math.sign(p) || 1;
        // Verluste werden auf der abgebenden Seite abgezogen
        return { in: -(p + sign * pVerlust), out: p - sign * pVerlust };
    }

    applyOperatingPoint(voltages) {
        const { in: pIn, out: pOut } = this.calcPower(voltages);
        this._resultFormats = {
            pIn:  v => `pIn:  ${v} W`,
            pOut: v => `pOut: ${v} W`,
            uIn:  v => `uIn:  ${v} V`,
            uOut: v => `uOut: ${v} V`,
        };
        this._setResults({
            pIn:  Math.round(pIn * 10) / 10,
            pOut: Math.round(pOut          * 10) / 10,
            uIn:  Math.round((voltages.in  ?? 0) * 100) / 100,
            uOut: Math.round((voltages.out ?? 0) * 100) / 100,
        });
    }

}

if (typeof window !== 'undefined') window.DCDC = DCDC;