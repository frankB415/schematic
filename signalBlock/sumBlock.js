/*
sumBlock.js — Summationsblock
Ableitung von signalBlock

Eingang 'in1': erster Summand  (Vorzeichen: +1)
Eingang 'in2': zweiter Summand (Vorzeichen: konfigurierbar, default -1 → Gegenkopplung)
Ausgang 'out': in1 * sign1 + in2 * sign2

Connectoren: in1 (links oben), in2 (links unten), out (rechts)
*/

class SumBlock extends signalBlock {

    constructor(label, { sign1 = 1, sign2 = -1 } = {}, opts = {}) {
        super({ imageW: 48, imageH: 48, imageSrc: SumBlock._svgUrl(sign1, sign2), ...opts });
        this._label = label;
        this._sign1 = sign1;
        this._sign2 = sign2;

        this.connectors = [
            { name: 'in1', x: '0%',   y: '50%',  type: 'signal', direction: 'left',  flow: 'in',  minLength: 20 },
            { name: 'in2', x: '50%',  y: '100%', type: 'signal', direction: 'down',  flow: 'in',  minLength: 20 },
            { name: 'out', x: '100%', y: '50%',  type: 'signal', direction: 'right', flow: 'out', minLength: 20 },
        ];

        this.params = [];

        this._outputFormats = {
            out: v => `e: ${v.toFixed(3)}`,
        };
    }

    tick(dt) {
        const sum = (this.inputs.in1 ?? 0) * this._sign1
                  + (this.inputs.in2 ?? 0) * this._sign2;
        this._setOutputs({ out: sum });
    }

    static _svgUrl(sign1, sign2) {
        const s1 = sign1 >= 0 ? '+' : '−';
        const s2 = sign2 >= 0 ? '+' : '−';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="21" fill="#1e1e3a" stroke="#5b2d8e" stroke-width="1.5"/>
  <text x="24" y="28" text-anchor="middle" font-size="16" fill="#c084fc" font-family="sans-serif" font-weight="bold">Σ</text>
  <text x="6"  y="26" text-anchor="middle" font-size="9"  fill="#aaa"    font-family="sans-serif">${s1}</text>
  <text x="24" y="45" text-anchor="middle" font-size="9"  fill="#aaa"    font-family="sans-serif">${s2}</text>
</svg>`;
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
}

window.SumBlock = SumBlock;
