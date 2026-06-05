/*
setpointBlock.js — Sollwertblock mit konfigurierbarem Sprung
Ableitung von signalBlock

Ausgang 'out': Sollwert
  - Vor t=jumpTime:  value0
  - Ab  t=jumpTime:  value1

Connector: out (rechts)
*/

class SetpointBlock extends signalBlock {

    constructor(label, { value0 = 0, value1 = 1, jumpTime = 1.0 } = {}, opts = {}) {
        super({ imageW: 64, imageH: 40, imageSrc: SetpointBlock._svgUrl(), ...opts });
        this._label = label;
        this._t     = 0;

        this.connectors = [
            { name: 'out', x: '100%', y: '50%', type: 'signal', direction: 'right', flow: 'out', minLength: 20 },
        ];

        this.params = [
            { key: 'value0',   label: 'Wert vorher', value: value0,   format: v => `${v}` },
            { key: 'value1',   label: 'Wert nachher', value: value1,   format: v => `${v}` },
            { key: 'jumpTime', label: 'Sprung bei',   value: jumpTime, format: v => `${v} s` },
        ];

        this._outputFormats = {
            out: v => `w: ${v.toFixed(3)}`,
        };
    }

    tick(dt) {
        this._t += dt;
        const w = this._t >= this.getParam('jumpTime')
            ? this.getParam('value1')
            : this.getParam('value0');
        this._setOutputs({ out: w });
    }

    static _svgUrl() {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40" viewBox="0 0 64 40">
  <rect width="64" height="40" rx="6" fill="#1e1e3a" stroke="#5b2d8e" stroke-width="1.5"/>
  <text x="32" y="14" text-anchor="middle" font-size="8" fill="#aaa" font-family="sans-serif">Sollwert</text>
  <polyline points="8,30 8,26 28,26 28,18 56,18" fill="none" stroke="#c084fc" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
}

window.SetpointBlock = SetpointBlock;
