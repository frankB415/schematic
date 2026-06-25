/*
last.js — Schaltplan-Block: Elektrische Last (Lastflussanalyse)
Ableitung von lastflussBlock

Connector:
  in — oben mittig (Eingang, Lastfluss von oben)

Parameter:
  pNom  — Nennleistung in W  (bei uNom)
  uNom  — Nennspannung in V  → Lastwiderstand R = uNom² / pNom
  uMin  — untere Betriebsspannung in V (darunter: I = 0)
  uMax  — obere Betriebsspannung in V  (darüber:  I = 0)

Kennlinie:
  R = uNom² / pNom  (konstant)
  uMin <= u <= uMax  →  I = -u / R   (ohmsche Last)
  u < uMin           →  I = 0
  u > uMax           →  I = 0
*/

const LAST_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="4" y="4" width="52" height="72" rx="4"
        fill="#1a1a2e" stroke="#7ecfff" stroke-width="1.5"/>
  <polygon points="34,8 20,44 30,44 26,72 44,36 32,36"
           fill="#f0c040" stroke="#c8a030" stroke-width="1" opacity="0.9"/>
</svg>`);

class Last extends lastflussBlock {

    constructor(label, { pNom = 150, uNom = 24, uMin = 300, uMax = 1300, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: LAST_SVG });
        this._label = label;
        this.pNom = pNom;
        this.uNom = uNom;
        this.uMin = uMin;
        this.uMax = uMax;
        // Lastwiderstand R = uNom² / pNom
        this._R = (uNom * uNom) / pNom;

        this.connectors = [
            { name: 'in', x: '50%', y: '0%', type: 'electrical', direction: 'up', minLength: 24 },
        ];

        this.params = [
            { key: 'pNom', value: pNom, format: v => lastflussBlock.fmtKW(v) },
            { key: 'uNom', value: uNom, format: v => lastflussBlock.fmtKV(v) },
            { key: 'uMin', value: uMin, format: v => lastflussBlock.fmtKV(v) },
            { key: 'uMax', value: uMax, format: v => lastflussBlock.fmtKV(v) },
        ];
    }

    calcCurrent(voltages) {
        const u = voltages.in ?? this.uNom;
        if (u < this.uMin || u > this.uMax) return { in: 0 };
        // Verbrauch: Strom fliesst aus Knoten heraus → negativ
        return { in: -u / this._R };
    }

    calcPower(voltages) {
        throw new Error('Last.calcPower() ist nicht mehr unterstuetzt — calcCurrent() verwenden.');
    }

    applyOperatingPoint(voltages) {
        const u    = voltages.in ?? 0;
        const iAct = (u >= this.uMin && u <= this.uMax) ? u / this._R : 0;
        const pAct = u * iAct;
        this.renderResults([
            { key: 'pAct', text: `P: ${lastflussBlock.fmtKW(pAct)}` },
            { key: 'uAct', text: `U: ${lastflussBlock.fmtKV(u)}` },
        ]);
    }
}

if (typeof window !== 'undefined') window.Last = Last;