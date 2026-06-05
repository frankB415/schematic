/*
piBlock.js — PI-Regler
Ableitung von signalBlock

Eingang 'in':  Regelabweichung e(t)
Ausgang 'out': Stellgröße u(t) = kp * e + ki * integral(e)

Connectoren: in (links), out (rechts)
*/

class PIBlock extends signalBlock {

    constructor(label, { kp = 1.0, ki = 0.5, outMin = -Infinity, outMax = Infinity } = {}, opts = {}) {
        super({ imageW: 64, imageH: 40, imageSrc: PIBlock._svgUrl(), ...opts });
        this._label    = label;
        this._integral = 0;

        this.connectors = [
            { name: 'in',  x: '0%',   y: '50%', type: 'signal', direction: 'left',  flow: 'in',  minLength: 20 },
            { name: 'out', x: '100%', y: '50%', type: 'signal', direction: 'right', flow: 'out', minLength: 20 },
        ];

        this.params = [
            { key: 'kp',     label: 'Kp',       value: kp,     format: v => `${v}` },
            { key: 'ki',     label: 'Ki',        value: ki,     format: v => `${v}` },
            { key: 'outMin', label: 'Min',       value: outMin === -Infinity ? '-∞' : outMin, format: v => `${v}` },
            { key: 'outMax', label: 'Max',       value: outMax ===  Infinity ? '+∞' : outMax, format: v => `${v}` },
        ];

        this._outMin = outMin;
        this._outMax = outMax;

        this._outputFormats = {
            out: v => `u: ${v.toFixed(3)}`,
        };
    }

    tick(dt) {
        const e  = this.inputs.in ?? 0;
        const kp = this.getParam('kp');
        const ki = this.getParam('ki');
        this._integral += e * dt;
        let u = kp * e + ki * this._integral;
        // Anti-Windup: Begrenzung
        u = Math.max(this._outMin, Math.min(this._outMax, u));
        this._setOutputs({ out: u });
    }

    /** Integral zurücksetzen. */
    resetIntegral() {
        this._integral = 0;
    }

    static _svgUrl() {
        // Sprungantwort PI: flache Linie → Sprung (P) → Rampe aufwärts (I)
        // Achsen: x 8..56, y 8..34  (unten=0, oben=Ausgang)
        // Eingang springt bei x=22: davor y=30, danach sofort auf y=20 (P), dann Rampe bis y=10
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40" viewBox="0 0 64 40">
  <rect width="64" height="40" rx="6" fill="#1e1e3a" stroke="#5b2d8e" stroke-width="1.5"/>
  <!-- Achsen -->
  <line x1="8" y1="34" x2="56" y2="34" stroke="#3a3a5a" stroke-width="0.8"/>
  <line x1="8" y1="8"  x2="8"  y2="34" stroke="#3a3a5a" stroke-width="0.8"/>
  <!-- Eingangssprung (dünn, gedimmt) -->
  <polyline points="8,30 22,30 22,18 56,18" fill="none" stroke="#5b2d8e" stroke-width="0.8" opacity="0.5"/>
  <!-- Sprungantwort PI: Sprung + Rampe -->
  <polyline points="8,30 22,30 22,22 56,10" fill="none" stroke="#c084fc" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- Label -->
  <text x="56" y="13" text-anchor="end" font-size="7" fill="#c084fc" font-family="sans-serif" font-weight="bold">PI</text>
</svg>`;
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
}

window.PIBlock = PIBlock;
