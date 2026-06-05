/*
signalWire.js — Erweiterung von ElectricalWire für Signalleitungen

Zeichnet gefüllte Richtungspfeile auf den Wires, Spitze liegt am Connector.

Ladereihenfolge:
  electricalWire.js
  signalWire.js
*/

class SignalWire extends ElectricalWire {

    /**
     * @param {HTMLElement} container
     * @param {object}      [opts]
     * @param {number}      [opts.arrowSize=14]   — Länge der Pfeilspitze in px
     * @param {string}      [opts.arrowColor]     — Standard: wireColor
     */
    constructor(container, opts = {}) {
        super(container, opts);
        this._arrowSize  = opts.arrowSize  ?? 14;
        this._arrowColor = opts.arrowColor ?? null;
    }

    render(connectors, connections, blockedAreas) {
        super.render(connectors, connections, blockedAreas);
        this._drawArrows();
        return this;
    }

    _drawArrows() {
        if (!this._svg || !this._connectors || !this._connections) return;

        const ns    = 'http://www.w3.org/2000/svg';
        const color = this._arrowColor ?? this._options.wireColor;
        const size  = this._arrowSize;

        const connMap = new Map(this._connectors.map(c => [c.id, c]));
        const drawn   = new Set();

        for (const conn of this._connections) {
            const toId = conn.to;
            if (drawn.has(toId)) continue;
            drawn.add(toId);
            const toConn = connMap.get(toId);
            if (!toConn) continue;

            this._drawArrow(toConn.x, toConn.y, toConn.direction, size, color, ns);
        }
    }

    /**
     * Gefülltes Dreieck — Spitze liegt exakt am Connector, Basis liegt
     * arrowSize px zurück auf dem Wire (in Ankunftsrichtung des Signals).
     *
     * direction = Austrittsrichtung des to-Connectors aus dem Block.
     * Der Wire nähert sich aus der entgegengesetzten Richtung:
     *
     *   direction 'left'  → Wire kommt von links  → Spitze bei cx,    Basis bei cx - size
     *   direction 'right' → Wire kommt von rechts → Spitze bei cx,    Basis bei cx + size
     *   direction 'down'  → Wire kommt von oben   → Spitze bei cy,    Basis bei cy - size
     *   direction 'up'    → Wire kommt von unten  → Spitze bei cy,    Basis bei cy + size
     */
    _drawArrow(cx, cy, direction, size, color, ns) {
        const half = size * 0.45;
        let tip, base1, base2;

        switch (direction) {
            case 'left':
                // Connector zeigt links → Wire kommt von links → Pfeil → tip am Connector, Basis links
                tip   = { x: cx,        y: cy        };
                base1 = { x: cx - size, y: cy - half };
                base2 = { x: cx - size, y: cy + half };
                break;
            case 'right':
                // Connector zeigt rechts → Wire kommt von rechts → Pfeil ← tip am Connector, Basis rechts
                tip   = { x: cx,        y: cy        };
                base1 = { x: cx + size, y: cy - half };
                base2 = { x: cx + size, y: cy + half };
                break;
            case 'down':
                // Connector zeigt unten → Wire kommt von unten → Pfeil ↑ tip am Connector, Basis unterhalb
                tip   = { x: cx,        y: cy        };
                base1 = { x: cx - half, y: cy + size };
                base2 = { x: cx + half, y: cy + size };
                break;
            case 'up':
                // Connector zeigt oben → Wire kommt von oben → Pfeil ↓ tip am Connector, Basis oberhalb
                tip   = { x: cx,        y: cy        };
                base1 = { x: cx - half, y: cy - size };
                base2 = { x: cx + half, y: cy - size };
                break;
            default:
                return;
        }

        const poly = document.createElementNS(ns, 'polygon');
        poly.setAttribute('points',
            `${tip.x},${tip.y} ${base1.x},${base1.y} ${base2.x},${base2.y}`
        );
        poly.setAttribute('fill',   color);
        poly.setAttribute('stroke', 'none');
        poly.setAttribute('class',  'sw-arrow');
        this._svg.appendChild(poly);
    }
}

window.SignalWire = SignalWire;