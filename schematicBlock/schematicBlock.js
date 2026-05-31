/*
schematicBlock.js — Abstrakte Basisklasse für Schaltplan-Blöcke
Einbindung via <script src="schematicBlock.js"> → window.schematicBlock
ES-Modul:       import { schematicBlock } from './schematicBlock.module.js'

Verantwortlichkeit:
  - sb-image anlegen und im Schematic positionieren
  - sb-text1 / sb-text2 anlegen (leer — Inhalt ist Sache der Unterklasse)
  - Connector-Interface (renderConnectors, getConnectorPositions, getImageDiv)
  - select / deselect / rotate / delete + Events
  - _repositionText() nach Größenänderungen

DOM-Struktur:
  schematic  (position: relative)
    ├── .sb-text1  (position: absolute) — leer, Inhalt durch Unterklasse
    ├── .sb-image  (position: absolute) — Bild + Connector-Dots, Anker bei (x,y)
    └── .sb-text2  (position: absolute) — leer, Inhalt durch Unterklasse

Anker: (x,y) = Mittelpunkt von .sb-image im Schematic.
Ohne x,y: normaler Dokumentfluss (für test.html, kein position:absolute).
*/

class schematicBlock {

    /**
     * @param {object} [opts]
     * @param {number} [opts.x]      — x des Bildmittelpunkts im Schematic (px)
     * @param {number} [opts.y]      — y des Bildmittelpunkts im Schematic (px)
     * @param {number} [opts.imageW] — Bildbreite in px
     * @param {number} [opts.imageH] — Bildhöhe in px
     */
    constructor({ x = null, y = null, imageW = null, imageH = null, textLayout = 'lr', imageSrc = null } = {}) {
        if (this.constructor === schematicBlock) {
            throw new Error("'schematicBlock' kann nicht direkt instanziiert werden.");
        }
        this.rotation    = 0;
        this._x          = x;
        this._y          = y;
        this._imageW     = imageW;
        this._imageH     = imageH;
        this._textLayout = textLayout; // 'lr' = links/rechts (default), 'tb' = oben/unten
        this._imageSrc   = imageSrc;
        this._imageDiv   = null;
        this._text1Div   = null;
        this._text2Div   = null;
    }

    // ── Abstrakt ────────────────────────────────────────────────────────────

    /**
     * Standard-render() — kann in Unterklassen überschrieben werden.
     * Erwartet dass imageSrc, imageW, imageH im Constructor gesetzt wurden.
     */
    render(schematicEl) {
        if (!this._imageSrc)
            throw new Error(`${this.constructor.name}.render(): 'imageSrc' muss im Constructor gesetzt werden.`);
        this._getOrCreateImageDiv(schematicEl);
        this._getOrCreateText1(schematicEl);
        this._getOrCreateText2(schematicEl);
        this.setImage(this._imageSrc);
        this.renderConnectors();
        this._repositionText();
        return this;
    }

    // ── Connector-Interface ─────────────────────────────────────────────────

    /**
     * Connector-Schema:
     *   name:      string
     *   x, y:      string  — z.B. '50%', '10px' — relativ zu sb-image
     *   type:      'electrical' | 'signal'
     *   direction: 'left' | 'right' | 'up' | 'down'
     *   minLength: number (default 20)
     */
    getConnectors() {
        if (!this.connectors)
            throw new Error(`${this.constructor.name}: 'this.connectors' nicht gesetzt.`);
        return this.connectors;
    }

    getElectricalConnectors() { return this.getConnectors().filter(c => c.type === 'electrical'); }
    getSignalConnectors()     { return this.getConnectors().filter(c => c.type === 'signal'); }

    /**
     * Connector-Positionen für electricalWire.setConnectors().
     * @param {HTMLElement} containerEl
     * @param {string}      blockId     — Präfix, z.B. 'r1' → 'r1.left'
     * @param {number}      [gridSize=10]
     */
    getConnectorPositions(containerEl, blockId, gridSize = 10) {
        if (!this._imageDiv)
            throw new Error(`${this.constructor.name}.getConnectorPositions(): render() zuerst aufrufen.`);
        const cr   = containerEl.getBoundingClientRect();
        const snap = v => Math.round(v / gridSize) * gridSize;
        return this.getConnectors().map(conn => {
            const dot = this._imageDiv.querySelector(`.sb-connector[data-name="${conn.name}"]`);
            if (!dot) throw new Error(`${this.constructor.name}: Connector '${conn.name}' nicht im DOM.`);
            const r = dot.getBoundingClientRect();
            return {
                id:        `${blockId}.${conn.name}`,
                x:         snap(r.left - cr.left + r.width  / 2),
                y:         snap(r.top  - cr.top  + r.height / 2),
                direction: conn.direction || 'right',
                minLength: conn.minLength ?? 20,
            };
        });
    }

    /** Für electricalWire.setBlockedAreas(). */
    getImageDiv() {
        if (!this._imageDiv)
            throw new Error(`${this.constructor.name}.getImageDiv(): render() zuerst aufrufen.`);
        return this._imageDiv;
    }

    // ── Interaktion ─────────────────────────────────────────────────────────

    select() {
        this._imageDiv?.classList.add('sb-image--selected');
        this._text1Div?.classList.add('sb-text--selected');
        this._text2Div?.classList.add('sb-text--selected');
        this._imageDiv?.dispatchEvent(new CustomEvent('sb-select', {
            bubbles: true, detail: { block: this }
        }));
    }

    deselect() {
        [this._imageDiv, this._text1Div, this._text2Div].forEach(el =>
            el?.classList.remove('sb-image--selected', 'sb-text--selected')
        );
    }

    rotate() {
        this.rotation = (this.rotation + 90) % 360;
        if (this._imageDiv) {
            this._imageDiv.style.transform =
                `translate(-50%, -50%) rotate(${this.rotation}deg)`;
            this._imageDiv.dispatchEvent(new CustomEvent('sb-rotate', {
                bubbles: true, detail: { block: this, rotation: this.rotation }
            }));
        }
    }

    delete() {
        this._imageDiv?.dispatchEvent(new CustomEvent('sb-delete', {
            bubbles: true, detail: { block: this }
        }));
        [this._imageDiv, this._text1Div, this._text2Div].forEach(el => el?.remove());
        this._imageDiv = this._text1Div = this._text2Div = null;
    }

    getContextMenuItems() { return []; }

    // ── Render-Hilfsmethoden ────────────────────────────────────────────────

    /**
     * sb-image anlegen (einmalig) und im Schematic verankern.
     * Positionierung: left=x, top=y mit transform:translate(-50%,-50%)
     * → Mittelpunkt liegt exakt bei (x,y).
     */
    _getOrCreateImageDiv(schematicEl) {
        if (!this._imageDiv) {
            const div = document.createElement('div');
            div.className = 'sb-image';
            if (this._x !== null && this._y !== null) {
                div.style.position  = 'absolute';
                div.style.left      = `${this._x}px`;
                div.style.top       = `${this._y}px`;
                div.style.transform = this.rotation
                    ? `translate(-50%, -50%) rotate(${this.rotation}deg)`
                    : 'translate(-50%, -50%)';
            }
            div.addEventListener('click', e => {
                e.stopPropagation();
                document.querySelectorAll('.sb-image--selected, .sb-text--selected')
                    .forEach(el => {
                        if (!this._owns(el)) el.classList.remove('sb-image--selected','sb-text--selected');
                    });
                this.select();
            });
            div.addEventListener('contextmenu', e => {
                e.preventDefault();
                this._showContextMenu(e.clientX, e.clientY);
            });
            document.addEventListener('click', () => this._closeContextMenu(), { capture: true });
            schematicEl.appendChild(div);
            this._imageDiv = div;
        }
        if (this._imageW !== null) this._imageDiv.style.width  = `${this._imageW}px`;
        if (this._imageH !== null) this._imageDiv.style.height = `${this._imageH}px`;
        return this._imageDiv;
    }

    /** sb-text1 anlegen (einmalig) — leer, Inhalt durch Unterklasse. */
    _getOrCreateText1(schematicEl) {
        if (!this._text1Div) {
            const div = document.createElement('div');
            div.className = 'sb-text1';
            if (this._x !== null) div.style.position = 'absolute';
            div.addEventListener('click',       e => { e.stopPropagation(); this.select(); });
            div.addEventListener('contextmenu', e => { e.preventDefault(); this._showContextMenu(e.clientX, e.clientY); });
            schematicEl.appendChild(div);
            this._text1Div = div;
        }
        return this._text1Div;
    }

    /** sb-text2 anlegen (einmalig) — leer, Inhalt durch Unterklasse. */
    _getOrCreateText2(schematicEl) {
        if (!this._text2Div) {
            const div = document.createElement('div');
            div.className = 'sb-text2';
            if (this._x !== null) div.style.position = 'absolute';
            div.addEventListener('click',       e => { e.stopPropagation(); this.select(); });
            div.addEventListener('contextmenu', e => { e.preventDefault(); this._showContextMenu(e.clientX, e.clientY); });
            schematicEl.appendChild(div);
            this._text2Div = div;
        }
        return this._text2Div;
    }

    /**
     * Bild-URL und Größe setzen — idempotent.
     * Aktualisiert auch _imageW/_imageH für _repositionText().
     */
    /**
     * Bild-URL setzen — idempotent.
     * width/height optional: wenn nicht angegeben, werden _imageW/_imageH aus Constructor verwendet.
     */
    setImage(src, width = null, height = null) {
        if (!this._imageDiv)
            throw new Error(`${this.constructor.name}.setImage(): _getOrCreateImageDiv() zuerst aufrufen.`);
        if (src) this._imageSrc = src;
        let img = this._imageDiv.querySelector('img');
        if (!img) { img = document.createElement('img'); this._imageDiv.appendChild(img); }
        img.src = this._imageSrc || src;
        const w = width  ?? this._imageW;
        const h = height ?? this._imageH;
        if (w !== null) { img.style.width  = `${w}px`; this._imageDiv.style.width  = `${w}px`; this._imageW = w; }
        if (h !== null) { img.style.height = `${h}px`; this._imageDiv.style.height = `${h}px`; this._imageH = h; }
        else img.style.height = 'auto';
    }

    /**
     * Connector-Dots in sb-image zeichnen — idempotent.
     */
    renderConnectors() {
        if (!this._imageDiv) return;
        this._imageDiv.querySelectorAll('.sb-connector').forEach(el => el.remove());
        (this.connectors || []).forEach(conn => {
            const type = conn.type === 'signal' ? 'signal' : 'electrical';
            const dot  = document.createElement('div');
            dot.className         = `sb-connector sb-connector--${type}`;
            dot.dataset.name      = conn.name;
            dot.dataset.type      = type;
            dot.dataset.direction = conn.direction || '';
            dot.style.left        = conn.x;
            dot.style.top         = conn.y;
            dot.title = `${conn.name} (${type}${conn.direction ? ', '+conn.direction : ''})`;
            this._imageDiv.appendChild(dot);
        });
    }

    /**
     * text1 und text2 relativ zum Bild neu positionieren.
     * text1: rechte Kante bündig mit linker Bildkante.
     * text2: linke Kante bündig mit rechter Bildkante.
     * Nur aktiv wenn x,y gesetzt. Intern via requestAnimationFrame.
     */
    /**
     * text1 und text2 relativ zum Bild positionieren.
     * textLayout 'lr' (default): text1 links, text2 rechts.
     * textLayout 'tb':           text1 oben,  text2 unten.
     */
    _repositionText() {
        if (this._x === null || !this._imageW || !this._imageH) return;
        requestAnimationFrame(() => {
            const halfW = this._imageW / 2;
            const halfH = this._imageH / 2;
            if (this._textLayout === 'tb') {
                if (this._text1Div) {
                    const h = this._text1Div.offsetHeight;
                    this._text1Div.style.left = `${this._x - halfW}px`;
                    this._text1Div.style.top  = `${this._y - halfH - h}px`;
                }
                if (this._text2Div) {
                    this._text2Div.style.left = `${this._x - halfW}px`;
                    this._text2Div.style.top  = `${this._y + halfH}px`;
                }
            } else {
                // 'lr' — default
                if (this._text1Div) {
                    const w = this._text1Div.offsetWidth;
                    this._text1Div.style.left = `${this._x - halfW - w}px`;
                    this._text1Div.style.top  = `${this._y - halfH}px`;
                }
                if (this._text2Div) {
                    this._text2Div.style.left = `${this._x + halfW}px`;
                    this._text2Div.style.top  = `${this._y - halfH}px`;
                }
            }
        });
    }

    _owns(el) {
        return el === this._imageDiv || el === this._text1Div || el === this._text2Div;
    }

    // ── Kontextmenü (Basis: nur Drehen/Src/Löschen) ─────────────────────────

    _showContextMenu(x, y) {
        this._closeContextMenu();
        const menu = document.createElement('div');
        menu.className      = 'sb-context-menu';
        menu.dataset.sbMenu = '1';
        [
            { label: '↻ Drehen',       action: () => this.rotate()   },
            { label: '⎘ Src anzeigen', action: () => this._showSrc() },
            { label: '✕ Löschen',      action: () => this.delete()   },
            ...this.getContextMenuItems(),
        ].forEach(item => {
            const el = document.createElement('div');
            el.className   = 'sb-context-menu__item';
            if (item.label.startsWith('✕')) el.classList.add('sb-context-menu__item--delete');
            el.textContent = item.label;
            el.addEventListener('click', e => { e.stopPropagation(); this._closeContextMenu(); item.action(); });
            menu.appendChild(el);
        });
        menu.style.left = `${x}px`;
        menu.style.top  = `${y}px`;
        document.body.appendChild(menu);
    }

    _closeContextMenu() {
        document.querySelectorAll('[data-sb-menu]').forEach(el => el.remove());
    }

    _showSrc() {
        const cn = this.constructor.name;
        const methods = Object.getOwnPropertyNames(this.constructor.prototype)
            .filter(m => m !== 'constructor')
            .map(m => `<b>${m}()</b>\n${esc(this.constructor.prototype[m].toString())}`)
            .join('\n\n');
        const pRows = (this.params||[]).map(p =>
            `<tr><td>${esc(p.key)}</td><td>${esc(p.label||'')}</td><td>${esc(String(p.value))}</td><td>${p.format?esc(p.format.toString()):'—'}</td></tr>`).join('');
        const cRows = (this.connectors||[]).map(c =>
            `<tr><td>${esc(c.name)}</td><td>${esc(c.x)}</td><td>${esc(c.y)}</td><td style="color:${c.type==='signal'?'#5b2d8e':'#1a6fcc'}">${esc(c.type||'electrical')}</td><td>${esc(c.direction||'—')}</td></tr>`).join('');
        function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Src: ${cn}</title>
<style>body{font-family:sans-serif;padding:1.5rem;font-size:.85rem}h1{font-size:1.1rem}h2{font-size:.9rem;border-bottom:1px solid #ddd;padding-bottom:2px;margin:1rem 0 .4rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:3px 8px;text-align:left}th{background:#eee}pre{background:#fff;border:1px solid #ddd;padding:.75rem;overflow-x:auto;font-size:.8rem;line-height:1.5;white-space:pre-wrap}b{color:#1a6fcc}</style>
</head><body><h1>${cn}</h1>
<h2>Parameter</h2>${pRows?`<table><tr><th>key</th><th>label</th><th>value</th><th>format</th></tr>${pRows}</table>`:'<p>—</p>'}
<h2>Connectoren</h2>${cRows?`<table><tr><th>name</th><th>x</th><th>y</th><th>type</th><th>direction</th></tr>${cRows}</table>`:'<p>—</p>'}
<h2>Methoden</h2>${methods?`<pre>${methods}</pre>`:'<p>—</p>'}
</body></html>`;
        const w = window.open('', `sb-src-${cn}`, 'width=700,height=600,scrollbars=yes,resizable=yes');
        w.document.open(); w.document.write(html); w.document.close();
    }
}

window.schematicBlock = schematicBlock;
