/*
labeledBlock.js — Zwischenklasse: Name + Params + Kontextmenü
Ableitung von schematicBlock
Einbindung via <script src="labeledBlock.js"> → window.labeledBlock

Verantwortlichkeit:
  - setName()       — Label in sb-text1
  - renderParams()  — Params als sb-property in sb-text1
  - setParam()      — Wert aktualisieren + Event + Repositionierung
  - _setProperty()  — interne Hilfsmethode
  - Kontextmenü erweitert um editierbare Param-Felder

Voraussetzung: schematicBlock.js muss vorher geladen sein.
*/

class labeledBlock extends schematicBlock {

    constructor(opts = {}) {
        super(opts);
        if (this.constructor === labeledBlock) {
            throw new Error("'labeledBlock' kann nicht direkt instanziiert werden.");
        }
    }

    /**
     * Standard-render() für labeledBlock.
     * Überschreibt schematicBlock.render() — fügt Name + Params hinzu.
     */
    render(schematicEl) {
        if (!this._imageSrc)
            throw new Error(`${this.constructor.name}.render(): 'imageSrc' muss im Constructor gesetzt werden.`);
        this._getOrCreateImageDiv(schematicEl);
        this._getOrCreateText1(schematicEl);
        this._getOrCreateText2(schematicEl);
        this.setImage(this._imageSrc);
        if (this._label) this.setName(this._label);
        this.renderParams();
        this.renderConnectors();
        this._repositionText();
        return this;
    }

    // ── Name ────────────────────────────────────────────────────────────────

    /**
     * Label in sb-text1 setzen — idempotent.
     * Wird als erstes Kind eingefügt (vor Params).
     */
    setName(name) {
        if (!this._text1Div) return;
        let label = this._text1Div.querySelector('.sb-name');
        if (!label) {
            label = document.createElement('span');
            this._text1Div.insertBefore(label, this._text1Div.firstChild);
        }
        label.className   = 'sb-name';
        label.textContent = name;
    }

    // ── Parameter ───────────────────────────────────────────────────────────

    /**
     * Parameter-Rohwert lesen.
     * this.params = [{ key, value, format }]
     */
    getParam(key) {
        return this.params?.find(p => p.key === key)?.value;
    }

    /**
     * Parameter-Wert setzen, DOM aktualisieren, Event feuern.
     * Feuert 'sb-param-change' auf sb-image (bubbles).
     */
    setParam(key, value) {
        if (!this.params) return;
        const p = this.params.find(p => p.key === key);
        if (!p) return;
        p.value = value;
        if (this._text1Div) {
            this._setProperty(key, p.format ? p.format(value) : String(value));
            this._imageDiv?.dispatchEvent(new CustomEvent('sb-param-change', {
                bubbles: true, detail: { block: this, key, value }
            }));
            this._repositionText();
        }
    }

    /**
     * Alle this.params als sb-property in sb-text1 rendern — idempotent.
     */
    renderParams() {
        if (!this.params || !this._text1Div) return;
        this.params.forEach(p =>
            this._setProperty(p.key, p.format ? p.format(p.value) : String(p.value))
        );
    }

    /**
     * Einzelne Eigenschaft in sb-text1 setzen — idempotent (matcht über data-key).
     */
    _setProperty(key, value) {
        if (!this._text1Div) return;
        let container = this._text1Div.querySelector('.sb-properties');
        if (!container) {
            container = document.createElement('div');
            container.className = 'sb-properties';
            this._text1Div.appendChild(container);
        }
        let prop = container.querySelector(`[data-key="${key}"]`);
        if (!prop) {
            prop = document.createElement('div');
            prop.className   = 'sb-property';
            prop.dataset.key = key;
            container.appendChild(prop);
        }
        prop.textContent = `${key}: ${value}`;
    }

    // ── Kontextmenü (erweitert um Param-Felder) ──────────────────────────────

    getContextMenuItems() { return []; }

    _showContextMenu(x, y) {
        this._closeContextMenu();
        const menu = document.createElement('div');
        menu.className      = 'sb-context-menu';
        menu.dataset.sbMenu = '1';

        // Basis-Einträge
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

        // Params als editierbare Felder
        if (this.params?.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'sb-context-menu__sep';
            menu.appendChild(sep);
            this.params.forEach(p => {
                const row   = document.createElement('div');
                row.className = 'sb-context-menu__param';
                const lbl   = document.createElement('span');
                lbl.className   = 'sb-context-menu__param-label';
                lbl.textContent = p.label || p.key;
                const input = document.createElement('input');
                input.type      = 'number';
                input.value     = p.value;
                input.className = 'sb-context-menu__param-input';
                input.addEventListener('change', () => this.setParam(p.key, parseFloat(input.value)));
                input.addEventListener('click',  e => e.stopPropagation());
                row.appendChild(lbl);
                row.appendChild(input);
                menu.appendChild(row);
            });
        }

        menu.style.left = `${x}px`;
        menu.style.top  = `${y}px`;
        document.body.appendChild(menu);
        this._menuEl = menu;

        // mousedown statt click: feuert vor focus-Wechsel, contains() greift zuverlässig
        // requestAnimationFrame: stellt sicher dass der contextmenu-Event vollständig abgehandelt ist
        requestAnimationFrame(() => {
            this._menuCloseHandler = (e) => {
                if (this._menuEl?.contains(e.target)) return;
                this._closeContextMenu();
                document.removeEventListener('mousedown', this._menuCloseHandler);
            };
            document.addEventListener('mousedown', this._menuCloseHandler);
        });
    }
}

window.labeledBlock = labeledBlock;