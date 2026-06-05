/*
pt1Block.js — PT1-Verzögerungsglied (Tiefpass 1. Ordnung)
Ableitung von signalBlock

Eingang 'in':  Eingangsgröße u(t)
Ausgang 'out': Ausgangsgröße y(t)

Differentialgleichung: T * dy/dt + y = K * u
Diskretisierung (Euler-Vorwärts): y[k+1] = y[k] + (dt/T) * (K*u[k] - y[k])

Connectoren: in (links), out (rechts)
*/

class PT1Block extends signalBlock {

    constructor(label, { K = 1.0, T = 1.0 } = {}, opts = {}) {
        super({ imageW: 64, imageH: 40, imageSrc: PT1Block._svgUrl(), ...opts });
        this._label = label;
        this._state = 0;  // interner PT1-Zustand (nicht verwechseln mit schematicBlock._y)

        this.connectors = [
            { name: 'in',  x: '0%',   y: '50%', type: 'signal', direction: 'left',  flow: 'in',  minLength: 20 },
            { name: 'out', x: '100%', y: '50%', type: 'signal', direction: 'right', flow: 'out', minLength: 20 },
        ];

        this.params = [
            { key: 'K', label: 'Verstärkung', value: K, format: v => `${v}` },
            { key: 'T', label: 'Zeitkonst.',  value: T, format: v => `${v} s` },
        ];

        this._outputFormats = {
            out: v => `y: ${v.toFixed(3)}`,
        };
    }

    tick(dt) {
        const u = this.inputs.in ?? 0;
        const K = this.getParam('K');
        const T = this.getParam('T');
        this._state += (dt / T) * (K * u - this._state);
        this._setOutputs({ out: this._state });
    }

    static _svgUrl() {
        // Sprungantwort PT1: exponentielle Annäherung an Endwert
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40" viewBox="0 0 64 40">
  <rect width="64" height="40" rx="6" fill="#1e1e3a" stroke="#5b2d8e" stroke-width="1.5"/>
  <line x1="8" y1="34" x2="56" y2="34" stroke="#3a3a5a" stroke-width="0.8"/>
  <line x1="8" y1="8"  x2="8"  y2="34" stroke="#3a3a5a" stroke-width="0.8"/>
  <line x1="22" y1="12" x2="56" y2="12" stroke="#3a3a5a" stroke-width="0.6" stroke-dasharray="2,2"/>
  <polyline points="8,30 22,30 22,18 56,18" fill="none" stroke="#5b2d8e" stroke-width="0.8" opacity="0.5"/>
  <polyline points="22,30 22.0,34.0 23.4,31.0 24.8,28.4 26.2,26.2 27.7,24.3 29.1,22.6 30.5,21.2 31.9,19.9 33.3,18.9 34.8,17.9 36.2,17.1 37.6,16.4 39.0,15.8 40.4,15.3 41.8,14.9 43.2,14.5 44.7,14.1 46.1,13.8 47.5,13.6 48.9,13.4 50.3,13.2 51.8,13.0 53.2,12.9 54.6,12.8 56.0,12.7" fill="none" stroke="#c084fc" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="56" y="13" text-anchor="end" font-size="7" fill="#c084fc" font-family="sans-serif" font-weight="bold">PT1</text>
</svg>`;
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
}

window.PT1Block = PT1Block;
