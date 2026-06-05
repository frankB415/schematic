/*
last.js — Schaltplan-Block: Elektrische Last (Lastflussanalyse)
Ableitung von lastflussBlock

Connector:
  in — oben mittig (Eingang, Lastfluss von oben)

Parameter:
  pNom  — Nennleistung in W
  uMin  — untere Betriebsspannung in V (darunter: P = 0)
  uMax  — obere Betriebsspannung in V (darüber: P = 0)

Kennlinie:
  uMin <= u <= uMax  →  P = -pNom
  u < uMin           →  P = 0
  u > uMax           →  P = 0
*/

const LAST_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="4" y="4" width="52" height="72" rx="4"
        fill="#1a1a2e" stroke="#7ecfff" stroke-width="1.5"/>
  <polygon points="34,8 20,44 30,44 26,72 44,36 32,36"
           fill="#f0c040" stroke="#c8a030" stroke-width="1" opacity="0.9"/>
</svg>`);

class Last extends lastflussBlock {

    constructor(label, { pNom = 150, uMin = 18, uMax = 32, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: LAST_SVG });
        this._label = label;
        this.pNom = pNom;
        this.uMin = uMin;
        this.uMax = uMax;

        this.connectors = [
            { name: 'in', x: '50%', y: '0%', type: 'electrical', direction: 'up', minLength: 24 },
        ];

        this.params = [
            { key: 'pNom', value: pNom, format: v => lastflussBlock.fmtKW(v) },
            { key: 'uMin', value: uMin, format: v => lastflussBlock.fmtKV(v) },
            { key: 'uMax', value: uMax, format: v => lastflussBlock.fmtKV(v) },
        ];
    }

    /**
     * Nennleistung innerhalb [uMin, uMax], weiches Ein-/Ausschalten über band=uMax*5%.
     * Negativ = Verbrauch (Verbraucherzählpfeil).
     */
    calcPower(voltages) {
        const u    = voltages.in ?? 0;
        const band = this.uMax * 0.05;
        const p    = interpTable([
            { x: this.uMin - band, y: 0          },
            { x: this.uMin,        y: this.pNom  },
            { x: this.uMax,        y: this.pNom  },
            { x: this.uMax + band, y: 0          },
        ], u);
        return { in: -p };
    }

    applyOperatingPoint(voltages) {
        const u    = voltages.in ?? 0;
        const pAct = this.calcPower(voltages).in;
        this._resultFormats = {
            pAct: v => `P: ${lastflussBlock.fmtKW(v)}`,
            uAct: v => `U: ${lastflussBlock.fmtKV(v)}`,
        };
        this._setResults({
            pAct: Math.round(pAct * 10) / 10,
            uAct: Math.round(u    * 100) / 100,
        });
    }
}

if (typeof window !== 'undefined') window.Last = Last;