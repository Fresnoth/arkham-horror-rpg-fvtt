const { ItemSheetV2 } = foundry.applications.sheets
const { HandlebarsApplicationMixin } = foundry.applications.api
const { TextEditor, DragDrop } = foundry.applications.ux
import { enrichHTML } from "../util/util.mjs"
import { DiceRollApp } from "../apps/dice-roll-app.mjs";
import { attuneTomeExclusive, clearTomeUnderstanding as clearTomeUnderstandingHelper, understandTomeAndLearnSpells } from "../helpers/tome.mjs";

export class ArkhamHorrorItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
    #dragDrop // Private field to hold dragDrop handlers
    #dragDropBoundElement
    #tomeInaccessibleWarned = false
    // Right now need these 4 helpers to be able to force auto save of the archetype document since default
    // ItemSheetV2 autosave interactions are lagging, when we are qucick change then drag dropping knacks
    //  onto the actors, without these 4 helpers there can be scenarios where
    // we change the archetype max knacks for a tier but it doesn't update the policy on the actor and thus
    // prevents drag dropping which causes a bad UX.  If there is a better way to do this I am open to it.
    #archetypeAutosaveBoundElement
    #archetypeAutosaveTimer
    #archetypeAutosavePending = {}
    #archetypeAutosaveHandler

    /** @inheritDoc */
    static DEFAULT_OPTIONS = {
        classes: ['arkham-horror-rpg-fvtt', 'sheet', 'item'],
        tag: 'form',
        position: {
            width: 600,
            height: 550
        },
        actions: {
            removeArchetypeKnack: this.#handleRemoveArchetypeKnack,
            removeTomeSpell: this.#handleRemoveTomeSpell,
            removeKnackGrant: this.#handleRemoveKnackGrant,
            addKnackRollEffectKey: this.#handleAddKnackRollEffectKey,
            removeKnackRollEffectKey: this.#handleRemoveKnackRollEffectKey,
            understandTome: this.#handleUnderstandTome,
            attuneTome: this.#handleAttuneTome,
            clearTomeUnderstanding: this.#handleClearTomeUnderstanding,
            toggleFoldableContent: this.#handleToggleFoldableContent,
            openUuidItem: this.#handleOpenUuidItem
        },
        form: {
            // handler: DCCActorSheet.#onSubmitForm,
            submitOnChange: true
        },
        actor: {
            type: 'item'
        },
        dragDrop: [{
            dragSelector: '[draggable="true"]',
            // Bind drop handling broadly, then validate the actual tier in `_onDrop`.
            // This avoids brittle selector/event-target quirks that can make some tiers hard to drop onto.
            dropSelector: '*'
        }],
        window: {
            resizable: true,
            controls: [
            ]
        }
    }

    /** @inheritDoc */
    static PARTS = {
        header: {
            template: 'systems/arkham-horror-rpg-fvtt/templates/item/parts/item-header.hbs'
        },
        tabs: {
            // Foundry-provided generic template
            template: 'templates/generic/tab-navigation.hbs',
            // classes: ['sysclass'], // Optionally add extra classes to the part for extra customization
        },
        form: {
            template: 'systems/arkham-horror-rpg-fvtt/templates/item/item-sheet.hbs'
        },
        description: {
            template: 'systems/arkham-horror-rpg-fvtt/templates/shared/tab-description.hbs',
            id: 'description',
            scrollable: ['scrollable']
        }
    }

    /**
   * Define the structure of tabs used by this sheet.
   * @type {Record<string, ApplicationTabsConfiguration>}
   */
    static TABS = {
        sheet: { // this is the group name
            tabs:
                [
                    { id: 'form', group: 'sheet', label: 'ARKHAM_HORROR.LABELS.Form' },
                    { id: 'description', group: 'sheet', label: 'ARKHAM_HORROR.LABELS.Description' }
                ],
            initial: 'form'
        }
    }

    constructor(options = {}) {
        super(options)
        this.#dragDrop = this.#createDragDropHandlers()
        this.#archetypeAutosaveHandler = this.#onArchetypeAutosaveEvent.bind(this)
    }

    static async #handleAddKnackRollEffectKey(event, target) {
        return await this.addKnackRollEffectKey(event, target)
    }

    static async #handleRemoveKnackRollEffectKey(event, target) {
        return await this.removeKnackRollEffectKey(event, target)
    }

    async addKnackRollEffectKey(event, target) {
        event.preventDefault()
        if (this.document.type !== 'knack') return
        if (!this.isEditable) return

        const group = String(target?.dataset?.group ?? '')
        if (!group) return

        const selectName = group === 'skillKeys' ? '_knackSkillKey' : group === 'rollKinds' ? '_knackRollKind' : null
        if (!selectName) return

        const select = this.element?.querySelector?.(`select[name="${selectName}"]`)
        const value = String(select?.value ?? '')
        if (!value) return

        const path = group === 'skillKeys' ? 'system.rollEffects.skillKeys' : 'system.rollEffects.rollKinds'
        const current = foundry.utils.getProperty(this.document, path)
        const arr = Array.isArray(current) ? current.map(String).filter(Boolean) : ['any']

        let next
        if (value === 'any') {
            next = ['any']
        } else {
            next = arr.filter(v => v !== 'any')
            if (!next.includes(value)) next.push(value)
            if (next.length === 0) next = ['any']
        }

        await this.document.update({ [path]: next })
        this.render(false)
    }

    async removeKnackRollEffectKey(event, target) {
        event.preventDefault()
        if (this.document.type !== 'knack') return
        if (!this.isEditable) return

        const group = String(target?.dataset?.group ?? '')
        const value = String(target?.dataset?.value ?? '')
        if (!group || !value) return

        const path = group === 'skillKeys' ? 'system.rollEffects.skillKeys' : group === 'rollKinds' ? 'system.rollEffects.rollKinds' : null
        if (!path) return

        const current = foundry.utils.getProperty(this.document, path)
        const arr = Array.isArray(current) ? current.map(String).filter(Boolean) : ['any']

        let next = arr.filter(v => v !== value)
        if (next.length === 0) next = ['any']
        if (next.includes('any') && next.length > 1) next = ['any']

        await this.document.update({ [path]: next })
        this.render(false)
    }

    #bindArchetypeAutosaveHandlers() {
        if (this.document.type !== 'archetype') return
        if (!this.isEditable) return
        if (!(game.user?.isGM ?? false)) return

        if (this.#archetypeAutosaveBoundElement === this.element) return

        this.element.addEventListener('input', this.#archetypeAutosaveHandler, true)
        this.element.addEventListener('change', this.#archetypeAutosaveHandler, true)
        this.#archetypeAutosaveBoundElement = this.element
    }

    #coerceFormValue(target) {
        if (!target) return undefined
        if (target.type === 'checkbox') return Boolean(target.checked)

        if (target.type === 'number' || target.dataset?.dtype === 'Number') {
            // Foundry number fields sometimes allow an empty string while editing; treat that as 0.
            const raw = target.value
            if (raw === '' || raw === null || raw === undefined) return 0
            const n = Number(raw)
            return Number.isFinite(n) ? n : 0
        }

        return target.value
    }

    async #flushArchetypeAutosave() {
        if (this.document.type !== 'archetype') return
        if (!this.isEditable) return
        if (!(game.user?.isGM ?? false)) return

        if (this.#archetypeAutosaveTimer) {
            clearTimeout(this.#archetypeAutosaveTimer)
            this.#archetypeAutosaveTimer = null
        }

        const pending = this.#archetypeAutosavePending
        this.#archetypeAutosavePending = {}
        if (!pending || Object.keys(pending).length === 0) return

        try {
            await this.document.update(pending, { diff: false, render: false })
        } catch (e) {
            // No UI noise during close; just best-effort.
        }
    }

    #queueArchetypeAutosave(update) {
        Object.assign(this.#archetypeAutosavePending, update)
        if (this.#archetypeAutosaveTimer) clearTimeout(this.#archetypeAutosaveTimer)

        // Debounce persistence so typing doesn't spam DB writes.
        this.#archetypeAutosaveTimer = setTimeout(async () => {
            this.#archetypeAutosaveTimer = null
            const pending = this.#archetypeAutosavePending
            this.#archetypeAutosavePending = {}

            if (!pending || Object.keys(pending).length === 0) return

            try {
                // Persist without re-rendering the sheet to avoid focus churn.
                await this.document.update(pending, { diff: false, render: false })
            } catch (e) {
                ui.notifications?.warn?.('Failed to auto-save Archetype changes.')
            }
        }, 250)
    }

    #onArchetypeAutosaveEvent(event) {
        if (this.document.type !== 'archetype') return
        if (!this.isEditable) return
        if (!(game.user?.isGM ?? false)) return

        const target = event?.target
        const name = target?.name
        if (!name || typeof name !== 'string') return
        if (!name.startsWith('system.')) return

        const value = this.#coerceFormValue(target)
        const update = { [name]: value }

        // Immediately update local source so other workflows (like drag/drop) see the latest values
        // even before the database write completes.
        // this can create conditions where the DB update fails due to the later Autosave attempt trying to save a diff that is stale or null but it is better for UI/UX responsiveness.
        // We should probably move away from this architecture long term and rely on a "save button" for archetypes instead of autosave.
        try {
            this.document.updateSource(update)
        } catch (e) {
            return
        }

        this.#queueArchetypeAutosave(update)
    }

    /** @inheritDoc */
    _configureRenderParts(options) {
        const parts = super._configureRenderParts(options)

        let templatePath = `systems/arkham-horror-rpg-fvtt/templates/item/item-${this.document.type}-sheet.hbs`;
        // Add the main item type part
        if (this.document.type) {
            parts.form = {
                id: 'form',
                template: templatePath
            }
        }
        return parts;
    }

    /* @inheritDoc */
    async _prepareContext(options) {
        const context = await super._prepareContext(options)
        const actorData = this.document.toPlainObject();

        context.system = actorData.system;
        context.flags = actorData.flags;
        context.item = this.document;

        // Adding a pointer to CONFIG.SHADOWCITY
        context.config = CONFIG.SHADOWCITY;

        context.descriptionHTML = await enrichHTML('system.description',this.document);

        if (actorData.system.specialRules) {
            context.specialRulesHTML = await enrichHTML('system.specialRules',this.document);
        }

        if(actorData.system.defensiveBenefit){
             context.defensiveBenefitHTML = await enrichHTML('system.defensiveBenefit',this.document);
        }

        if(actorData.system.negative){
             context.negativeHTML = await enrichHTML('system.negative',this.document);
        }

        if(actorData.system.positive){
             context.positiveHTML = await enrichHTML('system.positive',this.document);
        }

        if(actorData.system.positive){
             context.positiveHTML = await enrichHTML('system.positive',this.document);
        }
        if(actorData.system.benefit){
             context.benefitHTML = await enrichHTML('system.benefit',this.document);
        }
        if(actorData.system.decliningText){
             context.decliningTextHTML = await enrichHTML('system.decliningText',this.document);
        }
        if(actorData.system.losingText){
             context.losingTextHTML = await enrichHTML('system.losingText',this.document);
        }

        if (this.document.type === 'archetype') {
            context.isGM = game.user?.isGM ?? false;
            context.skillCapKeys = Object.keys(context.system?.skillCaps ?? {});
            const docByUuid = new Map();
            const descriptionByUuid = new Map();

            const buildTier = async (tierNumber) => {
                const tierData = this.document.system.knackTiers?.[tierNumber] ?? {};
                const normalized = (tierData.allowedKnacks ?? []).filter(e => e?.uuid);

                const resolved = [];
                for (const entry of normalized) {
                    let name = entry.uuid;
                    let sourceLabel = 'Unknown';

                    let doc = docByUuid.get(entry.uuid);
                    if (!docByUuid.has(entry.uuid)) {
                        try {
                            doc = await fromUuid(entry.uuid);
                        } catch (e) {
                            doc = null;
                        }
                        docByUuid.set(entry.uuid, doc ?? null);
                    }

                    if (doc) {
                        name = doc.name ?? name;
                        sourceLabel = doc.pack ? (game.packs.get(doc.pack)?.metadata?.label ?? doc.pack) : (game.world?.title ?? 'World');
                    }

                    let descriptionHTML = descriptionByUuid.get(entry.uuid);
                    if (descriptionHTML === undefined) {
                        descriptionHTML = doc ? await enrichHTML('system.description', doc) : '';
                        descriptionByUuid.set(entry.uuid, descriptionHTML);
                    }

                    resolved.push({
                        uuid: entry.uuid,
                        name,
                        tier: Number(entry.tier ?? tierNumber),
                        sourceLabel,
                        descriptionHTML
                    });
                }

                return {
                    maxPurchasable: tierData.maxPurchasable ?? 0,
                    xpcost: tierData.xpcost ?? 0,
                    allowedKnacks: resolved
                };
            };
            context.knackTiers = {
                "1": await buildTier(1),
                "2": await buildTier(2),
                "3": await buildTier(3),
                "4": await buildTier(4)
            };
        }

        if (this.document.type === 'tome') {
            context.isGM = game.user?.isGM ?? false;
            context.isOwnedByActor = !!this.document.actor;

            const difficulty = Number(this.document.system?.attunementDifficulty ?? 2);
            context.attunementDifficultyLabel = difficulty === 3 ? 'Very Difficult (3)' : difficulty === 1 ? 'Normal (1)' : 'Difficult (2)';

            const spellUuids = (this.document.system?.spellUuids ?? []).filter(u => !!u);
            const docByUuid = new Map();
            const descriptionByUuid = new Map();
            const resolved = [];
            let inaccessibleCount = 0;

            for (const uuid of spellUuids) {
                let doc = docByUuid.get(uuid);
                if (!docByUuid.has(uuid)) {
                    try {
                        doc = await fromUuid(uuid);
                    } catch (e) {
                        doc = null;
                    }
                    docByUuid.set(uuid, doc ?? null);
                }

                if (!doc) {
                    inaccessibleCount += 1;
                    continue;
                }

                const name = doc.name ?? uuid;
                const sourceLabel = doc.pack ? (game.packs.get(doc.pack)?.metadata?.label ?? doc.pack) : (game.world?.title ?? 'World');
                let descriptionHTML = descriptionByUuid.get(uuid);
                if (descriptionHTML === undefined) {
                    descriptionHTML = await enrichHTML('system.description', doc);
                    descriptionByUuid.set(uuid, descriptionHTML);
                }

                resolved.push({ uuid, name, sourceLabel, descriptionHTML });
            }

            context.tomeSpells = resolved;
            context.inaccessibleSpellCount = inaccessibleCount;
            context.showInaccessibleSpellWarning = inaccessibleCount > 0 && !(game.user?.isGM ?? false);

            // Button visibility
            const actor = this.document.actor;
            const isOwner = actor ? actor.isOwner : this.document.isOwner;
            context.canUnderstand = !!actor && isOwner && !Boolean(this.document.system?.understood);
            context.canAttune = !!actor && isOwner && Boolean(this.document.system?.understood);
        }

        if (this.document.type === 'knack') {
            const grants = (this.document.system?.grants ?? []).filter(g => g?.type === 'spell' && g?.uuid);
            const docByUuid = new Map();
            const resolved = [];

            for (const g of grants) {
                const uuid = g.uuid;
                let doc = docByUuid.get(uuid);
                if (!docByUuid.has(uuid)) {
                    try {
                        doc = await fromUuid(uuid);
                    } catch (e) {
                        doc = null;
                    }
                    docByUuid.set(uuid, doc ?? null);
                }

                const name = doc?.name ?? uuid;
                const sourceLabel = doc?.pack
                    ? (game.packs.get(doc.pack)?.metadata?.label ?? doc.pack)
                    : (game.world?.title ?? 'World');

                resolved.push({ uuid, name, sourceLabel });
            }

            context.knackGrants = resolved;
        }
        return context;
    }

    static async #handleRemoveArchetypeKnack(event, target) {
        this.removeArchetypeKnack(event, target);
    }

    static async #handleToggleFoldableContent(event, target) {
        this.toggleFoldableContent(event, target);
    }

    static async #handleOpenUuidItem(event, target) {
        this.openUuidItem(event, target);
    }

    static async #handleRemoveTomeSpell(event, target) {
        this.removeTomeSpell(event, target);
    }

    static async #handleRemoveKnackGrant(event, target) {
        return await this.removeKnackGrant(event, target);
    }

    static async #handleUnderstandTome(event, target) {
        this.understandTome(event, target);
    }

    static async #handleAttuneTome(event, target) {
        this.attuneTome(event, target);
    }

    static async #handleClearTomeUnderstanding(event, target) {
        this.clearTomeUnderstanding(event, target);
    }

    toggleFoldableContent(event, target) {
        event.preventDefault();
        const fcId = target.dataset.fcId;
        if (!fcId) return;
        this.element.querySelectorAll(`.foldable-content[data-fc-id="${fcId}"]`).forEach(fcElement => {
            fcElement.classList.toggle('collapsed');
        });
    }

    async openUuidItem(event, target) {
        event.preventDefault();
        event.stopPropagation();
        // Archetype knacks are UUID references (not embedded). Opening their sheets for players is risky because it
        // can lead to editing the source document (world/compendium) rather than an owned copy.
        if (this.document.type === 'archetype' && !(game.user?.isGM ?? false)) {
            ui.notifications.warn('Only the GM can open/edit source Knack documents from an Archetype.');
            return;
        }
        const uuid = target.dataset.uuid;
        if (!uuid) return;

        try {
            const doc = await fromUuid(uuid);
            if (!doc) {
                ui.notifications.warn('Could not resolve the dropped UUID.');
                return;
            }
            if (doc.sheet) {
                // Tome spell viewing: players can open read-only to avoid editing source docs.
                if (this.document.type === 'tome' && !(game.user?.isGM ?? false)) {
                    doc.sheet.render(true, { editable: false });
                } else {
                    doc.sheet.render(true);
                }
                return;
            }
            ui.notifications.warn('No sheet available for that document.');
        } catch (e) {
            ui.notifications.warn('Failed to open the UUID document.');
        }
    }

    async removeTomeSpell(event, target) {
        event.preventDefault();
        if (this.document.type !== 'tome') return;
        if (!(game.user?.isGM ?? false)) {
            ui.notifications.warn('Only the GM can modify a Tome\'s spells.');
            return;
        }

        const uuid = target.dataset.uuid;
        if (!uuid) return;

        const current = (this.document.system?.spellUuids ?? []).filter(u => !!u);
        const next = current.filter(u => u !== uuid);
        await this.document.update({ 'system.spellUuids': next });
        this.render(false);
    }

    async removeKnackGrant(event, target) {
        event.preventDefault();
        if (this.document.type !== 'knack') return;

        const uuid = target.dataset.uuid;
        if (!uuid) return;

        const current = (this.document.system?.grants ?? []).filter(g => g?.type === 'spell' && g?.uuid);
        const next = current.filter(g => g.uuid !== uuid);

        await this.document.update({ 'system.grants': next });
        this.render(false);
    }

    async understandTome(event, target) {
        event.preventDefault();
        if (this.document.type !== 'tome') return;
        const actor = this.document.actor;
        if (!actor) {
            ui.notifications.warn('This Tome must be owned by an Actor to be understood.');
            return;
        }
        if (!actor.isOwner) {
            ui.notifications.warn('You do not have permission to roll for this Actor.');
            return;
        }
        if (Boolean(this.document.system?.understood)) {
            ui.notifications.info('This Tome is already understood.');
            return;
        }

        // Default to Knowledge, but allow switching to Lore by editing the dialog's skillCurrent (success-on) and skillKey is fixed.
        // For v1: we prompt with Knowledge by default; player can re-open and pick Lore from a secondary button in future.
        const skillKey = 'knowledge';
        const skillCurrent = actor.system.skills?.[skillKey]?.current ?? 0;
        const skillMax = actor.system.skills?.[skillKey]?.max ?? 0;
        const currentDicePool = actor.system.dicepool?.value ?? 0;
        const successesNeeded = Number(this.document.system?.attunementDifficulty ?? 2);

        DiceRollApp.getInstance({
            actor,
            rollKind: 'tome-understand',
            skillChoices: ['knowledge', 'lore'],
            skillKey,
            skillCurrent,
            skillMax,
            currentDicePool,
            weaponToUse: null,
            successesNeeded,
            afterRoll: async ({ outcome }) => {
                if (!outcome?.isSuccess) return;

                await understandTomeAndLearnSpells({ actor, tome: this.document, notify: true });
            }
        }).render(true);
    }

    async attuneTome(event, target) {
        event.preventDefault();
        if (this.document.type !== 'tome') return;
        const actor = this.document.actor;
        if (!actor) {
            ui.notifications.warn('This Tome must be owned by an Actor to attune to it.');
            return;
        }
        if (!actor.isOwner) {
            ui.notifications.warn('You do not have permission to roll for this Actor.');
            return;
        }
        if (!Boolean(this.document.system?.understood)) {
            ui.notifications.warn('You must understand this Tome before attuning to it.');
            return;
        }

        const skillKey = 'intuition';
        const skillCurrent = actor.system.skills?.[skillKey]?.current ?? 0;
        const skillMax = actor.system.skills?.[skillKey]?.max ?? 0;
        const currentDicePool = actor.system.dicepool?.value ?? 0;
        const successesNeeded = 2;

        DiceRollApp.getInstance({
            actor,
            rollKind: 'tome-attune',
            skillKey,
            skillCurrent,
            skillMax,
            currentDicePool,
            weaponToUse: null,
            successesNeeded,
            afterRoll: async ({ outcome }) => {
                if (!outcome?.isSuccess) return;

                await attuneTomeExclusive({ actor, tome: this.document, notify: true });
            }
        }).render(true);
    }

    async clearTomeUnderstanding(event, target) {
        event.preventDefault();
        if (this.document.type !== 'tome') return;
        if (!(game.user?.isGM ?? false)) {
            ui.notifications.warn("Only the GM can clear a Tome's understood/attuned state.");
            return;
        }

        await clearTomeUnderstandingHelper({ tome: this.document, notify: true });

        this.render(false);
    }

    async removeArchetypeKnack(event, target) {
        event.preventDefault();
        if (this.document.type !== 'archetype') return;
        if (!(game.user?.isGM ?? false)) {
            ui.notifications.warn('Only the GM can modify an Archetype\'s allowed Knacks.');
            return;
        }

        const tier = Number(target.dataset.tier);
        const uuid = target.dataset.uuid;
        if (!tier || !uuid) return;

        const structuredPath = `system.knackTiers.${tier}.allowedKnacks`;
        const currentStructured = foundry.utils.getProperty(this.document, structuredPath) ?? [];
        const nextStructured = currentStructured.filter(e => e?.uuid !== uuid);

        await this.document.update({ [structuredPath]: nextStructured });
        this.render(false);
    }

    async #addKnackUuidToTier(tier, uuid) {
        if (!(game.user?.isGM ?? false)) {
            ui.notifications.warn('Only the GM can modify an Archetype\'s allowed Knacks.');
            return;
        }
        const structuredPath = `system.knackTiers.${tier}.allowedKnacks`;

        const currentStructured = foundry.utils.getProperty(this.document, structuredPath) ?? [];

        if (currentStructured.some(e => e?.uuid === uuid)) {
            ui.notifications.info("Knack already added to this tier.");
            return;
        }

        await this.document.update({ [structuredPath]: [...currentStructured, { uuid, tier }] });
    }


    /** @override */
    async _processSubmitData(event, form, formData) {
        const result = await super._processSubmitData(event, form, formData)
        return result
    }

    /**
  * Create drag-and-drop workflow handlers for this Application
  * @returns {DragDrop[]} An array of DragDrop handlers
  * @private
  */
    #createDragDropHandlers() {
        return this.options.dragDrop.map((d) => {
            d.permissions = {
                dragstart: this._canDragStart.bind(this),
                drop: this._canDragDrop.bind(this)
            }
            d.callbacks = {
                dragstart: this._onDragStart.bind(this),
                dragover: this._onDragOver.bind(this),
                drop: this._onDrop.bind(this)
            }
            return new DragDrop(d)
        })
    }

    /**
     * Define whether a user is able to begin a dragstart workflow for a given drag selector
     * @param {string} selector       The candidate HTML selector for dragging
     * @returns {boolean}             Can the current user drag this selector?
     * @protected
     */
    _canDragStart(selector) {
        // game.user fetches the current user
        return this.isEditable;
    }


    /**
     * Define whether a user is able to conclude a drag-and-drop workflow for a given drop selector
     * @param {string} selector       The candidate HTML selector for the drop target
     * @returns {boolean}             Can the current user drop on this selector?
     * @protected
     */
    _canDragDrop(selector) {
        // game.user fetches the current user
        return this.isEditable;
    }


    /**
     * Callback actions which occur at the beginning of a drag start workflow.
     * @param {DragEvent} event       The originating DragEvent
     * @protected
     */
    _onDragStart(event) {
        const el = event.currentTarget;
        if (!event.dataTransfer) return;
        if ('link' in event.target.dataset) return;

        let dragData = null;

        // Dragging a knack entry from an Archetype tier list onto an Actor sheet
        if (el?.dataset?.dragType === 'archetype-knack') {
            const uuid = el.dataset.uuid;
            const tier = Number(el.dataset.tier);
            if (!uuid || !tier) return;

            dragData = {
                type: 'ArkhamHorrorArchetypeKnack',
                uuid,
                tier,
                archetypeUuid: this.document.uuid
            };
        }

        if (!dragData) return;

        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';
    }


    /**
     * Callback actions which occur when a dragged element is over a drop target.
     * @param {DragEvent} event       The originating DragEvent
     * @protected
     */
    _onDragOver(event) { }


    /**
     * Callback actions which occur when a dragged element is dropped on a target.
     * @param {DragEvent} event       The originating DragEvent
     * @protected
     */
    async _onDrop(event) {
        const data = TextEditor.getDragEventData(event);

        // Archetype: only store UUID references to dropped knacks (no embedding)
        if (this.document.type === 'archetype' && data?.type === 'Item') {
            if (!(game.user?.isGM ?? false)) {
                ui.notifications.warn('Only the GM can modify an Archetype.');
                return;
            }

            const tierEl = event.target?.closest?.('.archetype-tier-drop')
                ?? event.currentTarget?.closest?.('.archetype-tier-drop');
            const tier = Number(tierEl?.dataset?.archetypeTier);
            if (!tier) {
                ui.notifications.warn('Drop the Knack onto a specific tier section.');
                return;
            }

            const dropped = await Item.fromDropData(data);
            if (!dropped || dropped.type !== 'knack') {
                ui.notifications.warn('Only Knack items can be dropped onto an Archetype.');
                return;
            }

            await this.#addKnackUuidToTier(tier, dropped.uuid);
            this.render(false);
            return;
        }

        // Tome: store UUID references to dropped spells (no embedding)
        if (this.document.type === 'tome' && data?.type === 'Item') {
            if (!(game.user?.isGM ?? false)) {
                ui.notifications.warn('Only the GM can add or remove spells from a Tome.');
                return;
            }

            // Only accept drops inside the Tome spells section
            const inSpellSection = !!(event.target?.closest?.('.tome-spells') ?? event.currentTarget?.closest?.('.tome-spells'));
            if (!inSpellSection) return;

            // Prefer UUID resolution (works for compendium/world)
            const uuid = data.uuid
                ?? (data.pack && (data.id || data.documentId)
                    ? `Compendium.${data.pack}.Item.${data.id ?? data.documentId}`
                    : null);

            let dropped = null;
            if (uuid) {
                try {
                    dropped = await fromUuid(uuid);
                } catch (e) {
                    dropped = null;
                }
            }

            // Fallback to Foundry drop helper
            if (!dropped) {
                try {
                    dropped = await Item.fromDropData(data);
                } catch (e) {
                    dropped = null;
                }
            }

            if (!dropped || dropped.type !== 'spell') {
                ui.notifications.warn('Only Spell items can be dropped onto a Tome.');
                return;
            }

            const current = (this.document.system?.spellUuids ?? []).filter(u => !!u);
            if (current.includes(dropped.uuid)) {
                ui.notifications.info('That spell is already in this Tome.');
                return;
            }

            await this.document.update({ 'system.spellUuids': [...current, dropped.uuid] });
            this.render(false);
            return;
        }

        // Knack: store UUID references to dropped spells in grants (no embedding)
        if (this.document.type === 'knack' && data?.type === 'Item') {
            // Only accept drops inside the Knack grants section
            const inGrantSection = !!(event.target?.closest?.('.knack-grants') ?? event.currentTarget?.closest?.('.knack-grants'));
            if (!inGrantSection) return;

            // Prefer UUID resolution (works for compendium/world)
            const uuid = data.uuid
                ?? (data.pack && (data.id || data.documentId)
                    ? `Compendium.${data.pack}.Item.${data.id ?? data.documentId}`
                    : null);

            let dropped = null;
            if (uuid) {
                try {
                    dropped = await fromUuid(uuid);
                } catch (e) {
                    dropped = null;
                }
            }

            // Fallback to Foundry drop helper
            if (!dropped) {
                try {
                    dropped = await Item.fromDropData(data);
                } catch (e) {
                    dropped = null;
                }
            }

            if (!dropped || dropped.type !== 'spell') {
                ui.notifications.warn('Only Spell items can be dropped onto a Knack grant list.');
                return;
            }

            const current = (this.document.system?.grants ?? []).filter(g => g?.type === 'spell' && g?.uuid);
            if (current.some(g => g.uuid === dropped.uuid)) {
                ui.notifications.info('That spell is already granted by this Knack.');
                return;
            }

            await this.document.update({ 'system.grants': [...current, { type: 'spell', uuid: dropped.uuid }] });
            this.render(false);
            return;
        }

        // Handle different data types
        switch (data.type) {
            // write your cases
        }

        return super._onDrop?.(event);
    }

    /** @inheritDoc */
    _onRender(context, options) {
        super._onRender(context, options);
        if (this.#dragDropBoundElement !== this.element) {
            for (const dd of (this.#dragDrop ?? [])) dd.bind(this.element);
            this.#dragDropBoundElement = this.element;
        }

        this.#bindArchetypeAutosaveHandlers()

        // The Knack picker dropdowns are an intermediate UI control.
        // With submitOnChange enabled, changing the dropdown would trigger an auto-submit + re-render,
        // resetting the dropdown value and creating confusing "not saving" behavior.
        if (this.document.type === 'knack') {
            const root = this.element;
            const pickerSelects = root?.querySelectorAll?.('.knack-picker__select') ?? [];
            for (const sel of pickerSelects) {
                // Capture phase so we stop the form change handler before it submits.
                sel.addEventListener('change', (event) => {
                    event.stopImmediatePropagation();
                }, true);
            }
        }

        if (this.document.type === 'tome') {
            const inaccessible = Number(context?.inaccessibleSpellCount ?? 0);
            if (inaccessible > 0 && !(game.user?.isGM ?? false) && !this.#tomeInaccessibleWarned) {
                ui.notifications.warn(`This Tome contains ${inaccessible} spell(s) you do not have permission to view.`);
                this.#tomeInaccessibleWarned = true;
            }
        }
    }

    /** @override */
    async close(options = {}) {
        await this.#flushArchetypeAutosave()
        return super.close(options)
    }
}