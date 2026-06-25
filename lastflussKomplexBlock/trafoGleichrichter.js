/*
trafoGleichrichter.js — Transformator + Gleichrichter (Dioden-Brücke)
Ableitung von lastflussKomplexBlock
*/

const TRAFOGLEICHRICHTER_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100">
  <rect x="4" y="4" width="52" height="92" rx="4" fill="#1a1a2e" stroke="#a0c0ff" stroke-width="1.5"/>
  <circle cx="30" cy="20" r="9" fill="none" stroke="#a0c0ff" stroke-width="1.5"/>
  <circle cx="30" cy="37" r="9" fill="none" stroke="#a0c0ff" stroke-width="1.5"/>
  <line x1="10" y1="52" x2="50" y2="52" stroke="#a0c0ff" stroke-width="0.8" stroke-dasharray="3,2" opacity="0.5"/>
  <line x1="11" y1="70" x2="22" y2="70" stroke="#f0c040" stroke-width="1.5"/>
  <line x1="41" y1="70" x2="47" y2="70" stroke="#f0c040" stroke-width="1.5"/>
  <polygon points="22,62 22,78 41,70" fill="#f0c040" stroke="#f0c040" stroke-width="1" stroke-linejoin="round"/>
  <line x1="41" y1="62" x2="41" y2="78" stroke="#f0c040" stroke-width="2"/>
  <text x="30" y="91" text-anchor="middle" fill="#f0c040" font-size="7" font-family="monospace">DC</text>
</svg>`);

class TrafoGleichrichter extends lastflussKomplexBlock {

    constructor(label, { u1Nenn = 400, u2Nenn = 230, sNenn = 100e3, uk = 4, eta = 0.993, etaBruecke = 0.997, pNom = null, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 100, imageSrc: TRAFOGLEICHRICHTER_SVG });
        this._label = label;
        this._pNom  = pNom ?? sNenn * 0.98;

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'u1Nenn',    label: 'u1Nenn',    value: u1Nenn,    format: v => `${(v/1000).toFixed(1)} kV`  },
            { key: 'u2Nenn',    label: 'u2Nenn',    value: u2Nenn,    format: v => `${(v/1000).toFixed(1)} kV`  },
            { key: 'sNenn',     label: 'sNenn',     value: sNenn,     format: v => `${(v/1e3).toFixed(0)} kVA`  },
            { key: 'uk',        label: 'uk',        value: uk,        format: v => `${v} %`                     },
            { key: 'eta',       label: 'etaTrafo',  value: eta,       format: v => `${(v*100).toFixed(1)} %`    },
            { key: 'etaBruecke',label: 'etaBruecke',value: etaBruecke,format: v => `${(v*100).toFixed(2)} %`   },
        ];
    }

    getHiddenNodes() {
        const u2Nenn = this.getParam('u2Nenn');
        return [{
            id:           this._uid + '.u2',
            type:         'ac',
            connectorName: 'u2',
            blocks:       [this],
            uMin:   u2Nenn * 0.85,
            uMax:   u2Nenn * 1.05,
        }];
    }

    get _uid() {
        if (!this.__uid) this.__uid = this._label.replace(/[^a-zA-Z0-9]/g, '_');
        return this.__uid;
    }

    _zTrafo() {
        const zBase = this.getParam('u2Nenn') ** 2 / this.getParam('sNenn');
        const uk    = this.getParam('uk') / 100;
        const eta   = this.getParam('eta');
        return { re: zBase * (1 - eta), im: zBase * uk };
    }

    _calc(voltages) {
        const u1  = toC(voltages.in  ?? { re: this.getParam('u1Nenn'), im: 0 });
        const vDc = typeof voltages.out === 'number'
            ? voltages.out
            : (voltages.out ? cAbs(voltages.out) : this.getParam('u2Nenn') * 1.35);

        const hiddenId = this._uid + '.u2';
        const u2raw = voltages['u2'] ?? voltages[hiddenId];
        const u2 = u2raw
            ? toC(u2raw)
            : toC({ re: this.getParam('u2Nenn'), im: 0 });

        const ue     = this.getParam('u1Nenn') / this.getParam('u2Nenn');
        const zTrafo = this._zTrafo();
        const sqrt3  = Math.sqrt(3);

        // ── Trafo-Teil ───────────────────────────────────────────────────────
        const u2LL = cScale(u1, 1 / ue);
        const i2   = cDiv(cSub(u2LL, u2), cScale(zTrafo, sqrt3));
        const i1   = cScale(i2, 1 / ue);
        const p1   = cScale(cMul(u1,  cConj(i1)), -sqrt3);
        const p_u2_trafo = cScale(cMul(u2, cConj(i2)), sqrt3);

        // ── Gleichrichter-Teil ───────────────────────────────────────────────
        const u2Abs  = cAbs(u2);
        const vDc0   = u2Abs * 1.35;
        const vDcPos = Math.max(0, vDc);

        const etaBruecke = this.getParam('etaBruecke');
        const vDc0Nenn   = this.getParam('u2Nenn') * 1.35;
        const r_int      = (1 - etaBruecke) * vDc0Nenn * vDc0Nenn / this._pNom;

        const i_dc   = Math.max(0, (vDc0 - vDcPos) / r_int);

        const pDc        = vDcPos * i_dc;
        const pVerlustR  = r_int * i_dc * i_dc;

        // Mindest-Querlast: hält den Jacobian regulär wenn die Diode sperrt.
        // G_MIN = 1e-6 S → bei u2=600V nur ~0.36 W — physikalisch vernachlässigbar.
        const G_MIN      = 1e-6;
        const pAcAbs     = pDc + pVerlustR + G_MIN * u2Abs * u2Abs;
        const p_u2_rect  = { re: -pAcAbs, im: 0 };

        return { u1, u2, u2Abs, vDc, vDcPos, vDc0, i1, i2, i_dc,
                 p1, p_u2_trafo, p_u2_rect, pDc, pVerlustR, hiddenId };
    }

    calcCurrent(voltages) {
        const { u1, u2, i1, i2, i_dc, p_u2_rect, hiddenId } = this._calc(voltages);

        // Strom an Knoten in (AC-Primaerseite):
        //   i1 fliesst aus Quelle in Knoten → aber Trafo zieht Strom aus Knoten
        //   → Entnahme: negativ. i1 ist bereits "Strom durch Trafo von k_ac2 aus"
        const iIn = { re: -i1.re, im: -i1.im };

        // DC-Ausgangsknoten: i_dc fliesst in Knoten ein → positiv
        const iOut = i_dc;

        // Versteckter AC-Knoten u2 (Sekundaerseite):
        //   i2 fliesst von u2 durch Gleichrichter → Entnahme aus u2
        //   p_u2_rect modelliert den Gleichrichter als Leitwert
        //   Strom = i2 (Trafo speist ein) + Gleichrichterstrom (entnimmt)
        const u2abs = Math.max(1, Math.sqrt(u2.re**2 + u2.im**2));
        // Gleichrichter-Entnahmestrom am u2-Knoten (Einleiterschema):
        // S = sqrt(3) * U_LL * I* → I = S* / (sqrt(3) * U*)
        // p_u2_rect = {re: -pAcAbs, im: 0} (reelle Entnahme)
        // I_rect = p_u2_rect / (sqrt(3) * u2abs)  (Vorzeichen: Entnahme negativ)
        const sqrt3 = Math.sqrt(3);
        const iRect = { re: p_u2_rect.re / (sqrt3 * u2abs), im: p_u2_rect.im / (sqrt3 * u2abs) };
        const iU2 = {
            re: i2.re + iRect.re,
            im: i2.im + iRect.im,
        };

        const result = { in: iIn, out: iOut };
        result[hiddenId] = iU2;
        return result;
    }

    calcPower(voltages) {
        throw new Error('TrafoGleichrichter.calcPower() ist nicht mehr unterstuetzt — calcCurrent() verwenden.');
    }

    applyOperatingPoint(voltages) {
        const { u1, u2, vDc, vDc0, i_dc, p1, p_u2_trafo, pDc } = this._calc(voltages);
        this.renderResults([
            { key: 'u1',   text: `U1: ${lastflussKomplexBlock.fmtPhasor(u1)}` },
            { key: 'u2',   text: `U2: ${lastflussKomplexBlock.fmtPhasor(u2)}` },
            { key: 's1',   text: `S1: ${lastflussKomplexBlock.fmtPower({ re: -p1.re, im: -p1.im })}` },
            { key: 's2',   text: `S2: ${lastflussKomplexBlock.fmtPower(p_u2_trafo)}` },
            { key: 'vDc0', text: `vDc0: ${vDc0.toFixed(1)} V` },
            { key: 'vDc',  text: `vDc: ${vDc.toFixed(1)} V` },
            { key: 'pDc',  text: `P_dc: ${(pDc/1e3).toFixed(1)} kW` },
            { key: 'iDc',  text: `I_dc: ${i_dc.toFixed(1)} A` },
            { key: 'state',text: `Diode: ${pDc <= 0 ? 'gesperrt' : 'leitend'}` },
        ]);
    }
}

if (typeof window !== 'undefined') window.TrafoGleichrichter = TrafoGleichrichter;