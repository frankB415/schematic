/*
kabel.js — AC-Kabel (Mittelspannung, Einleiterschema)
Ableitung von lastflussKomplexBlock

═══════════════════════════════════════════════════════════════════
MODELL
═══════════════════════════════════════════════════════════════════

Einfaches R+jX Serienersatzschaltbild (π-Modell ohne Querkapazität):

  u1 ──[R_ac + jX]── u2

  u1, u2 — L-L-Spannungen (komplex)
  i      — Strangstrom (komplex)
  i      = (u1 - u2) / (√3 · z_kabel)    [√3 wegen L-L → Strang]
  p1     = √3 · u1 · i*   (Verbrauch an k1, negativ)
  p2     = √3 · u2 · i*   (Einspeisung an k2, positiv)

═══════════════════════════════════════════════════════════════════
VERLUSTANTEILE (einzeln ausgewiesen)
═══════════════════════════════════════════════════════════════════

1. DC-Widerstand (Kupfer, 20°C):
   ρ_Cu   = 17.241 nΩm
   R_dc   = ρ_Cu · l / A   [Ω pro Phase]

2. Skin-Effekt (IEC 60287, vereinfacht):
   x_s    = √(8πf·10⁻⁷ / R_dc)
   k_skin = 1 + xs⁴ / (192 + 0.8·xs⁴)   (Näherungsformel)
   R_skin = R_dc · (k_skin - 1)           [Zusatzwiderstand Skin]

3. Proximity-Effekt (IEC 60287, vereinfacht):
   x_p    = x_s  (gleiche Frequenzabhängigkeit)
   k_prox = x_p⁴ / (192 + 0.8·x_p⁴) · (d/s)²· (0.312·(d/s)² + 1.18/(x_p⁴/(192+0.8·x_p⁴)+0.27))
   Vereinfacht: k_prox ≈ 0.3 · k_skin_faktor für typische MS-Kabel
   R_prox = R_dc · k_prox_faktor

   R_ac   = R_dc · k_skin · (1 + k_prox_faktor)   [Gesamtwiderstand AC]

4. Dielektrische Verluste (XLPE, tan δ = 0.0004):
   C      ≈ cKm · l   [Kapazität, cKm ≈ 0.3 µF/km für 20kV XLPE]
   P_diel = ω · C · tan(δ) · (u1_LL/√3)²   [Verlust pro Phase]
           = ω · C · tan(δ) · u1_LL² / 3
   Dreiphasig: P_diel_3ph = 3 · P_diel = ω · C · tan(δ) · u1_LL²

5. Reaktanz (Induktivität):
   L      ≈ lKm · l   [Induktivität, lKm ≈ 0.35 mH/km für MS-Kabel]
   X      = ω · L

Verluste werden einzeln angezeigt:
   P_dc, P_skin, P_prox, P_diel

Ohmsche Verluste im Serienmodell:
   p1.re + p2.re = -√3 · |i|² · R_ac   (Wärmeverluste)
Die dielektrischen Verluste werden als Offset auf p1 aufgeschlagen.

═══════════════════════════════════════════════════════════════════
VORZEICHEN-KONVENTION
═══════════════════════════════════════════════════════════════════

  p1.re < 0  — Verbrauch an k1 (Eingang oben)
  p2.re > 0  — Einspeisung an k2 (Ausgang unten)
  |p1| > |p2|  — Differenz = Verluste

Connectoren:
  in  — oben mittig   (Einspeiseseite, k1)
  out — unten mittig  (Lastseite,      k2)

Parameter:
  laenge  — Kabellänge in km         (default: 1)
  quer    — Querschnitt in mm²       (default: 150)
  uNenn   — Nennspannung L-L in V    (default: 20000)
  fNenn   — Nennfrequenz in Hz         (default: 50)
  cKm     — Kapazitätsbelag in F/km     (default: 0.3e-6 = 0.30 µF/km, 20kV XLPE)
  lKm     — Induktivitätsbelag in H/km  (default: 0.35e-3 = 0.35 mH/km)
*/

const KABEL_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100">
  <!-- Gehäuse -->
  <rect x="4" y="4" width="52" height="92" rx="4" fill="#1a1a2e" stroke="#80c0a0" stroke-width="1.5"/>
  <!-- Kabelquerschnitt: äusserer Mantel -->
  <circle cx="30" cy="50" r="20" fill="none" stroke="#80c0a0" stroke-width="1.5"/>
  <!-- Isolation -->
  <circle cx="30" cy="50" r="14" fill="none" stroke="#80c0a0" stroke-width="1" opacity="0.6"/>
  <!-- Leiter (Kupfer, gefüllt) -->
  <circle cx="30" cy="50" r="7" fill="#80c0a0" opacity="0.8"/>
  <!-- Längslinien (Kabelverlauf) -->
  <line x1="30" y1="4"  x2="30" y2="26" stroke="#80c0a0" stroke-width="1.5"/>
  <line x1="30" y1="74" x2="30" y2="96" stroke="#80c0a0" stroke-width="1.5"/>
  <!-- Label -->
  <text x="30" y="93" text-anchor="middle" fill="#80c0a0" font-size="6" font-family="monospace">KBL</text>
</svg>`);

class ACKabel extends lastflussKomplexBlock {

    constructor(label, { laenge = 1, quer = 150, uNenn = 20000, fNenn = 50, cKm = 0.3e-6, lKm = 0.35e-3, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 100, imageSrc: KABEL_SVG });
        this._label = label;

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'laenge', label: 'Länge',  value: laenge, format: v => `${v.toFixed(1)} km`        },
            { key: 'quer',   label: 'A',      value: quer,   format: v => `${v} mm²`                  },
            { key: 'uNenn',  label: 'U Nenn', value: uNenn,  format: v => `${(v/1000).toFixed(1)} kV` },
            { key: 'fNenn',  label: 'f Nenn', value: fNenn,  format: v => `${v} Hz`                   },
            { key: 'cKm',    label: 'C-Belag',     value: cKm,    format: v => `${(v*1e6).toFixed(2)} µF/km`   },
            { key: 'lKm',    label: 'L-Belag',     value: lKm,    format: v => `${(v*1e3).toFixed(2)} mH/km`   },
        ];
    }

    /** Alle Kabelparameter berechnen */
    _kabelParams() {
        const l    = this.getParam('laenge') * 1000;   // km → m
        const A    = this.getParam('quer') * 1e-6;     // mm² → m²
        const f     = this.getParam('fNenn');           // Hz (Nennfrequenz)
        const omega = 2 * Math.PI * f;

        // 1. DC-Widerstand (Kupfer, Betriebsbedingungen):
        // IEC 60228 bei 20°C: ρ = 17.241 nΩm
        // Temperaturkorrektur 70°C: ×1.197  (α_Cu = 0.00393/K, ΔT=50K)
        // Verseilungsfaktor:        ×1.02
        // → ρ_eff ≈ 21.1 nΩm  (typischer IEC 60287 Betriebswert)
        const rho  = 21.1e-9;                          // Ω·m (70°C Betrieb, inkl. Verseilung)
        const R_dc = rho * l / A;                      // Ω pro Phase (Strang)

        // 2. Skin-Effekt (IEC 60287 Näherung)
        // WICHTIG: xs² wird mit R_dc in Ω/m berechnet, nicht mit Gesamtwiderstand!
        const R_dc_pm = rho / A;                       // Ω/m (Widerstand pro Meter)
        const xs2  = 8 * Math.PI * f * 1e-7 / R_dc_pm;  // xs² nach IEC 60287
        const xs4  = xs2 * xs2;                        // xs⁴
        const ks   = xs4 / (192 + 0.8 * xs4);         // k_skin Zusatzfaktor
        const R_skin = R_dc * ks;                      // Zusatzwiderstand Skin (Gesamtlänge)

        // 3. Proximity-Effekt (vereinfacht: ~30% des Skin-Faktors für MS-Kabel)
        const kp     = ks * 0.3;
        const R_prox = R_dc * kp;                      // Zusatzwiderstand Proximity (Gesamtlänge)

        // Gesamtwiderstand AC (Strang)
        const R_ac = R_dc + R_skin + R_prox;

        // 4. Reaktanz (Induktivitätsbelag, kabelspezifisch)
        const lKm  = this.getParam('lKm');             // H/km
        const X    = omega * lKm * this.getParam('laenge');   // Ω (Strang)

        // 5. Dielektrische Verluste: tan δ = 0.0004 (XLPE)
        const cKm  = this.getParam('cKm');             // F/km (Kapazitätsbelag, kabelspezifisch)
        const C    = cKm * this.getParam('laenge');    // F gesamt
        const tanD = 0.0004;
        const uLL2 = Math.pow(this.getParam('uNenn'), 2);
        // P_diel = ω·C·tan(δ)·U_LL²  (Dreiphasen-Gesamtverlust, Wirkanteil)
        const P_diel = omega * C * tanD * uLL2;
        // Q_C = ω·C·U_LL²  (kapazitive Blindleistung, Dreiphasig)
        // Kabel speist Blindleistung ein → positiv (entlastet das Netz)
        const Q_C = omega * C * uLL2;

        return { R_dc, R_skin, R_prox, R_ac, X, P_diel, Q_C };
    }

    _calc(voltages) {
        const u1 = toC(voltages.in  ?? { re: this.getParam('uNenn'), im: 0 });
        const u2 = toC(voltages.out ?? { re: this.getParam('uNenn'), im: 0 });

        const { R_dc, R_skin, R_prox, R_ac, X, P_diel, Q_C } = this._kabelParams();
        const sqrt3 = Math.sqrt(3);

        // Serienimpedanz (Strang): z = R_ac + jX
        const z = { re: R_ac, im: X };

        // Strangstrom: i = (u1 - u2) / (√3 · z)
        // (u1, u2 sind L-L → durch √3 auf Strang)
        const i = cDiv(cSub(u1, u2), cScale(z, sqrt3));

        // Dreiphasen-Leistungen (L-L-Basis)
        const p1 = cScale(cMul(u1, cConj(i)), -sqrt3);   // Verbrauch k1 → negativ
        const p2 = cScale(cMul(u2, cConj(i)),  sqrt3);   // Einspeisung k2 → positiv

        // Einzelne ohmsche Verlustanteile
        // Einleiterschema Drehstrom: 3 Leiter → Faktor 3
        // i ist Strangstrom (aus L-L-Spannung / (√3·z) berechnet)
        const i2    = i.re * i.re + i.im * i.im;         // |i|²
        const P_dc   = 3 * i2 * R_dc;                    // DC-Ohm-Verluste 3 Phasen
        const P_skin = 3 * i2 * R_skin;                  // Skin-Verluste 3 Phasen
        const P_prox = 3 * i2 * R_prox;                  // Proximity-Verluste 3 Phasen

        // Kabelkapazität: π-Modell — je Q_C/2 an Eingang (k1) und Ausgang (k2)
        // P_diel: dielektrische Wirkleistungsverluste, hälftig aufgeteilt
        // Q_C:    kapazitive Blindleistungseinspeisung (positiv = kapazitiv)
        //         Kabel kompensiert induktiven Blindleistungsbedarf des Netzes
        const p1_korr = { re: p1.re - P_diel / 2, im: p1.im + Q_C / 2 };
        const p2_korr = { re: p2.re - P_diel / 2, im: p2.im + Q_C / 2 };

        return { u1, u2, i, p1: p1_korr, p1_ohm: p1, p2: p2_korr, p2_ohm: p2,
                 P_dc, P_skin, P_prox, P_diel, Q_C, R_ac, X };
    }

    calcCurrent(voltages) {
        const u1 = toC(voltages.in  ?? { re: this.getParam('uNenn'), im: 0 });
        const u2 = toC(voltages.out ?? { re: this.getParam('uNenn'), im: 0 });

        const { R_ac, X, P_diel, Q_C } = this._kabelParams();
        const sqrt3 = Math.sqrt(3);

        // Serienimpedanz (Strang)
        const z = { re: R_ac, im: X };
        // Strangstrom: i = (u1 - u2) / (sqrt3 * z)
        const i = cDiv(cSub(u1, u2), cScale(z, sqrt3));

        // π-Modell Querstrom: kapazitive Einspeisung je Haelfte an in und out
        // I_C = j * omega * C/2 * u  [Strangstrom]
        // Q_C = omega*C*u_LL^2 → I_C_abs = Q_C / (sqrt3 * u_LL)
        // Als komplexe Groesse: I_C = j * Q_C/(2 * sqrt3 * |u|)
        // Vereinfacht: Querstrom aus gespeicherter Q_C
        const u1abs = Math.max(1, Math.sqrt(u1.re**2 + u1.im**2));
        const u2abs = Math.max(1, Math.sqrt(u2.re**2 + u2.im**2));
        // kapazitiver Querstrom je Haelfte (imaginaer, positiv = kapazitiv = Einspeisung)
        const iC1 = { re: 0, im:  Q_C / 2 / (sqrt3 * u1abs) };
        const iC2 = { re: 0, im:  Q_C / 2 / (sqrt3 * u2abs) };
        // dielektrischer Verlustwirkstrom je Haelfte (reell, negativ = Entnahme)
        const iD1 = { re: -P_diel / 2 / (sqrt3 * u1abs), im: 0 };
        const iD2 = { re: -P_diel / 2 / (sqrt3 * u2abs), im: 0 };

        // Strom an Knoten in:  Kabel entnimmt Serienstrom, bekommt Querstrom
        const iIn  = { re: -i.re + iC1.re + iD1.re, im: -i.im + iC1.im + iD1.im };
        // Strom an Knoten out: Kabel speist Serienstrom ein, bekommt Querstrom
        const iOut = { re:  i.re + iC2.re + iD2.re, im:  i.im + iC2.im + iD2.im };

        return { in: iIn, out: iOut };
    }

    calcPower(voltages) {
        throw new Error('ACKabel.calcPower() ist nicht mehr unterstuetzt — calcCurrent() verwenden.');
    }

    applyOperatingPoint(voltages) {
        const { u1, u2, i, p1, p2, P_dc, P_skin, P_prox, P_diel, Q_C } = this._calc(voltages);
        this.renderResults([
            { key: 'u1',     text: `U1: ${lastflussKomplexBlock.fmtPhasor(u1)}` },
            { key: 'u2',     text: `U2: ${lastflussKomplexBlock.fmtPhasor(u2)}` },
            { key: 'p1',     text: `S1: ${lastflussKomplexBlock.fmtPower({ re: -p1.re, im: -p1.im })}` },
            { key: 'p2',     text: `S2: ${lastflussKomplexBlock.fmtPower(p2)}` },
            { key: 'iAbs',   text: `I: ${cAbs(i).toFixed(1)} A` },
            { key: 'P_dc',   text: `P_dc: ${(P_dc/1000).toFixed(2)} kW` },
            { key: 'P_skin', text: `P_skin: ${(P_skin/1000).toFixed(2)} kW` },
            { key: 'P_prox', text: `P_prox: ${(P_prox/1000).toFixed(2)} kW` },
            { key: 'P_diel', text: `P_diel: ${(P_diel/1000).toFixed(2)} kW` },
            { key: 'Q_C',    text: `Q_C: ${(Q_C/1000).toFixed(2)} kVAr (kap.)` },
        ]);
    }
}

if (typeof window !== 'undefined') window.ACKabel = ACKabel;