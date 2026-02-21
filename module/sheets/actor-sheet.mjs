const { ActorSheetV2 } = foundry.applications.sheets
const { HandlebarsApplicationMixin } = foundry.applications.api
const { TextEditor, DragDrop } = foundry.applications.ux
import { ArkhamHorrorItem } from "../documents/item.mjs";
import { DiceRollApp } from '../apps/dice-roll-app.mjs';
import { InjuryTraumaRollApp } from '../apps/injury-trauma-roll-app.mjs';
import { SpendInsightApp } from "../apps/spend-insight-app.mjs";
import { MoneyAdjustApp } from "../apps/money-adjust-app.mjs";
import { attuneTomeExclusive, understandTomeAndLearnSpells } from '../helpers/tome.mjs';
import { refreshDicepoolAndPost } from "../helpers/dicepool.mjs";
import { refreshInsightAndPost } from "../helpers/insight.mjs";
import { formatCurrency, spendMoney } from "../helpers/money.mjs";
import { discardAllDice, discardDice, spendSimpleActionDie } from "../api/resources/index.mjs";
import { setValue as setDicepoolValue } from "../api/dicepool/index.mjs";

export class ArkhamHorrorActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

    static #coerceInputValue(input) {
        if (!input) return undefined;
        if (input.type === 'checkbox') return Boolean(input.checked);

        if (input.type === 'number' || input.dataset?.dtype === 'Number') {
            const raw = input.value;
            if (raw === '' || raw === null || raw === undefined) return 0;
            const n = Number(raw);
            return Number.isFinite(n) ? n : 0;
        }

        return input.value;
    }

    /**
     * If the provided Archetype has an open sheet on this client and the current user is a GM,
     * silently commit relevant form fields to the Archetype document so subsequent policy checks
     * (like dropping the Archetype or an archetype-knack onto an Actor) use the latest values.
     */
    static async #flushOpenArchetypeSheetDraft(archetype) {
        if (!(game.user?.isGM ?? false)) return;
        if (!archetype || archetype.type !== 'archetype') return;

        const sheet = archetype.sheet;
        const form = sheet?.element;
        if (!form || !(form instanceof HTMLFormElement)) return;
        if (!sheet.isEditable) return;

        const update = {};
        const selectors = [
            'input[name^="system.skillCaps."]',
            'input[name^="system.knackTiers."]'
        ];

        const inputs = form.querySelectorAll(selectors.join(', '));
        for (const input of inputs) {
            const name = input?.name;
            if (!name || !name.startsWith('system.')) continue;

            // Only commit tier numeric policy fields; allowedKnacks is managed by explicit update workflows.
            if (name.startsWith('system.knackTiers.') && !name.endsWith('.maxPurchasable') && !name.endsWith('.xpcost')) {
                continue;
            }

            const value = ArkhamHorrorActorSheet.#coerceInputValue(input);
            const current = foundry.utils.getProperty(archetype, name);
            if (value === current) continue;
            update[name] = value;
        }

        if (Object.keys(update).length === 0) return;

        try {
            // Persist silently; the actor drop will read from document data.
            await archetype.update(update, { render: false });
        } catch (e) {
            // Best-effort; if it fails, actor drop will use last-saved values.
        }
    }

    /** @inheritDoc */
    static DEFAULT_OPTIONS = {
        classes: ['sheet', 'actor', 'character'],
        tag: 'form',
        position: {
            width: 700,
            height: 850
        },
        actions: {
            clickedDicePool: this.#handleClickedDicePool,
            clickedDiscardDie: this.#handleClickedDiscardDie,
            clickedSpendRegularDie: this.#handleClickedSpendRegularDie,
            clickedSpendHorrorDie: this.#handleClickedSpendHorrorDie,
            clickedClearDicePool: this.#handleClickedClearDicePool,
            clickedStrainOneself: this.#handleClickedStrainOneself,
            editItem: this.#handleEditItem,
            createItem: this.#handleCreateItem,
            createOtherEquipment: this.#handleCreateOtherEquipment,
            deleteItem: this.#handleDeleteItem,
            toggleItemActive: this.#handleToggleItemActive,
            toggleFoldableContent: this.#handleToggleFoldableContent,
            openActorArchetype: this.#handleOpenActorArchetype,
            clickSkill: this.#handleSkillClicked,
            clickSkillReaction: this.#handleSkillReactionClicked,
            clickWeaponReload: this.#handleWeaponReload,
            clickedRefreshDicePool: this.#handleClickedRefreshDicePool,
            clickedRollWithWeapon: this.#handleClickedRollWithWeapon,
            clickedRollWithSpell: this.#handleClickedRollWithSpell,
            clickedInjuryTraumaRoll: this.#handleClickedInjuryTraumaRoll,
            clickedSpendInsight: this.#handleClickedSpendInsight,
            clickedRefreshInsight: this.#handleClickedRefreshInsight,
            understandTomeFromList: this.#handleUnderstandTomeFromList,
            attuneTomeFromList: this.#handleAttuneTomeFromList,
            resetKnackUses: this.#handleResetKnackUses,
            resetAllKnackUses: this.#handleResetAllKnackUses,
            adjustMoney: this.#handleAdjustMoney,
        },
        form: {
            submitOnChange: true
        },
        actor: {
            type: 'character'
        },
        dragDrop: [{
            dragSelector: '[draggable="true"]',
            dropSelector: '*' // this was .mist-engine.actor I am not sure if it was being used but changed to * for now?  
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
            id: 'header',
            template: 'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-header.hbs'
        },
        tabs: {
            id: 'tabs',
            template: 'templates/generic/tab-navigation.hbs'
        },
        character: {
            id: 'character',
            template: 'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-main.hbs',
            scrollable: ['']
        },
        background: {
            id: 'background',
            template: 'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-background.hbs',
            scrollable: ['']
        },
        mundane_resources: {
            id: 'mundane_resources',
            template: 'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-mundane-resources.hbs',
            scrollable: ['']
        },
        supernatural_resources: {
            id: 'supernatural_resources',
            template: 'systems/arkham-horror-rpg-fvtt/templates/actor/parts/character-supernatural-resources.hbs',
            scrollable: ['']
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
                    { id: 'character', group: 'sheet', label: 'ARKHAM_HORROR.TABS.Character' },
                    { id: 'mundane_resources', group: 'sheet', label: 'ARKHAM_HORROR.TABS.MundaneResources' },
                    { id: 'supernatural_resources', group: 'sheet', label: 'ARKHAM_HORROR.TABS.SupernaturalResources' },
                    { id: 'background', group: 'sheet', label: 'ARKHAM_HORROR.TABS.Background' }
                ],
            initial: 'character'
        }
    }

    constructor(options = {}) {
        super(options)
    }

    /** @inheritDoc */
    async _onDrop(event) {
        const data = TextEditor.getDragEventData(event);

        if (data?.type === 'ArkhamHorrorArchetypeKnack') {
            await this.#onDropArchetypeKnack(event, data);
            return;
        }

        return super._onDrop?.(event);
    }

    async #onDropArchetypeKnack(event, data) {
        const uuid = data?.uuid;
        const tier = Number(data?.tier);
        const sourceArchetypeUuid = data?.archetypeUuid;

        if (!uuid || !tier || tier < 1 || tier > 4) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.ArchetypeKnackDropInvalid'));
            return;
        }

        const actorArchetypeUuid = this.document.system?.archetypeUuid;
        if (!actorArchetypeUuid) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.ArchetypeRequiredForKnacks'));
            return;
        }
        if (sourceArchetypeUuid && actorArchetypeUuid !== sourceArchetypeUuid) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.KnackDifferentArchetype'));
            return;
        }

        const archetype = await fromUuid(actorArchetypeUuid);
        if (!archetype || archetype.type !== 'archetype') {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.ActorArchetypeInvalid'));
            return;
        }

        await ArkhamHorrorActorSheet.#flushOpenArchetypeSheetDraft(archetype);

        const tierData = archetype.system?.knackTiers?.[tier] ?? {};
        const allowed = (tierData.allowedKnacks ?? []).some(e => e?.uuid === uuid);
        if (!allowed) {
            ui.notifications.warn(game.i18n.format('ARKHAM_HORROR.Warnings.KnackNotAllowedTier', { tier }));
            return;
        }

        const maxPurchasable = Number(archetype.system?.knackTiers?.[tier]?.maxPurchasable ?? 0);
        if (maxPurchasable <= 0) {
            ui.notifications.warn(game.i18n.format('ARKHAM_HORROR.Warnings.KnackTierNotPurchasable', { tier, maxPurchasable }));
            return;
        }

        // Policy: this counts ALL owned Knacks by tier (even if added via some other workflow)
        // to enforce the archetype's tier limits system-wide for this actor.
        const existingTierCount = (this.document.items?.contents ?? [])
            .filter(i => i.type === 'knack')
            .filter(i => Number(i.system?.tier ?? 0) === tier)
            .length;

        if (existingTierCount >= maxPurchasable) {
            ui.notifications.warn(game.i18n.format('ARKHAM_HORROR.Warnings.KnackTierLimitReached', { tier, existingTierCount, maxPurchasable }));
            return;
        }

        // Deduplication: when the knack was originally sourced from a UUID (pack/world), we store it in flags.core.sourceId.
        // If present, use that to avoid creating duplicates.
        const existing = (this.document.items?.contents ?? [])
            .find(i => i.type === 'knack' && i.flags?.core?.sourceId === uuid);

        if (existing) {
            await existing.update({
                'system.tier': tier,
                [`flags.arkham-horror-rpg-fvtt.archetypeUuid`]: actorArchetypeUuid,
                [`flags.arkham-horror-rpg-fvtt.archetypeTier`]: tier
            });
            ui.notifications.info(game.i18n.localize('ARKHAM_HORROR.Info.KnackAlreadyOwnedUpdated'));
            return;
        }

        const source = await fromUuid(uuid);
        if (!source || source.type !== 'knack') {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.SourceKnackResolveFailed'));
            return;
        }

        const itemData = foundry.utils.deepClone(source.toObject());
        delete itemData._id;
        itemData.system = itemData.system ?? {};
        itemData.system.tier = tier;
        itemData.flags = itemData.flags ?? {};
        itemData.flags.core = itemData.flags.core ?? {};
        itemData.flags.core.sourceId = uuid;
        itemData.flags['arkham-horror-rpg-fvtt'] = {
            ...(itemData.flags['arkham-horror-rpg-fvtt'] ?? {}),
            archetypeUuid: actorArchetypeUuid,
            archetypeTier: tier
        };

        // NOTE: v13 best practice is usually `this.document.createEmbeddedDocuments('Item', [itemData])`.
        // Leaving as-is for now.
        await ArkhamHorrorItem.create(itemData, { parent: this.document });
    }

    async _onDropItem(event, data) {
        // Prevent NPC-only Knacks from being acquired by Character actors via drag/drop.
        // We treat both flags as NPC-only markers, since older/edited data might set weakness without setting isNPCknack.
        const droppedItemType = data?.data?.type;
        const droppedSystem = data?.data?.system;
        if (droppedItemType === 'knack' && (droppedSystem?.isNPCknack || droppedSystem?.isNPCweakness)) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.NpcKnackDropBlocked'));
            return false;
        }

        try {
            const dropped = await Item.fromDropData(data);

            if (dropped?.type === 'knack' && (dropped.system?.isNPCknack || dropped.system?.isNPCweakness)) {
                ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.NpcKnackDropBlocked'));
                return false;
            }

            if (dropped?.type === 'archetype') {
                await ArkhamHorrorActorSheet.#flushOpenArchetypeSheetDraft(dropped);

                const updateData = {
                    'system.archetypeUuid': dropped.uuid,
                    'system.archetype': dropped.name
                };

                const skillCaps = dropped.system?.skillCaps ?? {};
                for (const skillKey of Object.keys(skillCaps)) {
                    // Ignore any unexpected keys which aren't actual actor skills.
                    if (!(skillKey in (this.document.system?.skills ?? {}))) continue;
                    const cap = Number(skillCaps?.[skillKey] ?? 0);
                    // Always overwrite the actor's max values from the newly-dropped archetype.
                    // Otherwise, switching archetypes can leave behind stale/manual caps from the previous archetype.
                    updateData[`system.skills.${skillKey}.max`] = Number.isFinite(cap) ? cap : 0;

                    // Only clamp current when an actual cap is present.
                    if (Number.isFinite(cap) && cap > 0) {
                        const current = Number(this.document.system?.skills?.[skillKey]?.current ?? 0);
                        if (Number.isFinite(current) && current > cap) {
                            updateData[`system.skills.${skillKey}.current`] = cap;
                        }
                    }
                }

                await this.document.update(updateData);
                ui.notifications.info(game.i18n.format('ARKHAM_HORROR.Info.ArchetypeSet', { archetypeName: dropped.name }));
                return;
            }
        } catch (e) {
            // Fall through to default handling
        }

        return super._onDropItem(event, data);
    }

    /* @inheritDoc */
    async _prepareContext(options) {
        const context = await super._prepareContext(options)
        const actorData = this.document.toPlainObject();

        context.system = actorData.system;
        context.flags = actorData.flags;
        context.actor = this.document;

        // Adding a pointer to CONFIG.MISTENGINE
        //context.config = CONFIG.MISTENGINE;

        context.biographyHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            this.document.system.biography,
            {
                // Whether to show secret blocks in the finished html
                secrets: this.document.isOwner,
                // Necessary in v11, can be removed in v12
                async: true,
                // Data to fill in for inline rolls
                rollData: this.document.getRollData(),
                // Relative UUID resolution
                relativeTo: this.document,
            }
        );

        context.firstSupernaturalEncounterHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            this.document.system.background.firstSupernaturalEncounter,
            {
                // Whether to show secret blocks in the finished html
                secrets: this.document.isOwner,
                // Necessary in v11, can be removed in v12
                async: true,
                // Data to fill in for inline rolls
                rollData: this.document.getRollData(),
                // Relative UUID resolution
                relativeTo: this.document,
            }
        );

        context.notableEnemiesHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            this.document.system.background.notableEnemies,
            {
                // Whether to show secret blocks in the finished html
                secrets: this.document.isOwner,
                // Necessary in v11, can be removed in v12
                async: true,
                // Data to fill in for inline rolls
                rollData: this.document.getRollData(),
                // Relative UUID resolution
                relativeTo: this.document,
            }
        );

        let items = this._prepareItems();

        // is automatic calculation enabled of the load capacity?
        context.isAutoLoadCapacityEnabled = game.settings.get("arkham-horror-rpg-fvtt", "characterLoadCapacity");

        const rawMoney = context.system?.mundaneResources?.money ?? 0;
        context.moneyDisplay = formatCurrency(rawMoney);

        foundry.utils.mergeObject(context, items);
        return context;
    }

    static async #handleAdjustMoney(event, target) {
        event.preventDefault();
        const actor = this.actor;
        if (!actor) return;

        if (!(actor.isOwner || game.user?.isGM)) {
            ui.notifications.warn(game.i18n.localize("ARKHAM_HORROR.MONEY.Errors.Permission"));
            return;
        }

        const mode = target?.dataset?.mode ?? "add";
        MoneyAdjustApp.getInstance({ actor, mode }).render({ force: true });
    }

    _prepareItems() {
        const knacks = [];
        let personalityTrait = null;
        const weapons = [];
        const protectiveEquipments = [];
        const usefulItems = [];
        const otherEquipment = [];
        const tomes = [];
        const relics = [];
        const injuries = [];
        const favors = [];
        const spells = [];

        let inventory = this.options.document.items;
        for (let i of inventory) {
            if (i.type === 'knack') {
                knacks.push(i);
            }
            else if (i.type === 'personality_trait') {
                personalityTrait = i;
            }
            else if (i.type === 'weapon') {
                weapons.push(i);
            }
            else if (i.type === 'protective_equipment') {
                protectiveEquipments.push(i);
            }
            else if (i.type === 'useful_item') {
                const hasSpecialRules = i.system?.hasSpecialRules;
                // Backwards compatibility: treat undefined as true.
                if (hasSpecialRules === false) otherEquipment.push(i);
                else usefulItems.push(i);
            }
            else if (i.type === 'tome') {
                tomes.push(i);
            }
            else if (i.type === 'relic') {
                relics.push(i);
            }
            else if (i.type === 'injury' || i.type === 'trauma') {
                injuries.push(i);
            }
            else if (i.type === 'favor') {
                favors.push(i);
            }
            else if (i.type === 'spell') {
                spells.push(i);
            }
        }

        // sort knacks by tier
        knacks.sort((a, b) => a.system.tier - b.system.tier);

        // caluculate total weight of items
        if (game.settings.get("arkham-horror-rpg-fvtt", "characterLoadCapacity")) {
            let totalWeight = 0;
            for (const item of inventory) {
                if (item.system.weight > 0) {
                    totalWeight += item.system.weight * (item.system.quantity || 1);
                }
            }
            this.document.system.loadCapacity.current = totalWeight;
        }

        return { knacks: knacks, personalityTrait: personalityTrait, weapons: weapons, protectiveEquipments: protectiveEquipments, usefulItems: usefulItems, otherEquipment: otherEquipment, tomes: tomes, relics: relics, injuries: injuries, favors: favors, spells: spells };
    }

    /** @inheritDoc */
    _onRender(context, options) {
        super._onRender(context, options);

        const itemEditableStatsElements = this.element.querySelectorAll('.item-editable-stat')
        for (const input of itemEditableStatsElements) {
            input.addEventListener("change", event => this.handleItemStatChanged(event))
        }
    }

    async handleItemStatChanged(ev) {
        const li = $(ev.currentTarget).parents('.item');
        const item = this.actor.items.get(li.data('itemId'));

        if (ev.target.type === 'checkbox') {
            item.update({ [ev.target.dataset.itemStat]: ev.target.checked });
        } else {
            item.update({ [ev.target.dataset.itemStat]: ev.target.value });
        }
    }

    static async #handleClickedDicePool(event, target) {
        event.preventDefault();
        const dieIndex = Number.parseInt(target.dataset.dieIndex) || 0;
        const newValue = Math.max(0, dieIndex);

        try {
            const outcome = await setDicepoolValue(this.actor, { value: newValue });
            if (!outcome?.ok) {
                ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.PermissionRollActor'));
            }
        } catch (_error) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.SimpleActionSpendFailed'));
        }
    }

    static #notifySimpleSpendFailure(reason) {
        const reasonMap = {
            PERMISSION_DENIED: 'ARKHAM_HORROR.Warnings.PermissionRollActor',
            INSUFFICIENT_HORROR: 'ARKHAM_HORROR.Warnings.SimpleActionInsufficientHorror',
            INSUFFICIENT_REGULAR: 'ARKHAM_HORROR.Warnings.SimpleActionInsufficientRegular',
            INSUFFICIENT_DICEPOOL: 'ARKHAM_HORROR.Warnings.SimpleActionInsufficientDicepool',
            INSUFFICIENT_RESOURCE: 'ARKHAM_HORROR.Warnings.SimpleActionInsufficientDicepool',
            AMOUNT_INVALID: 'ARKHAM_HORROR.Warnings.SimpleActionInvalidAmount',
            HORROR_EXCEEDS_TOTAL: 'ARKHAM_HORROR.Warnings.SimpleActionInvalidHorrorSplit',
        };

        const key = reasonMap[String(reason ?? '')] ?? 'ARKHAM_HORROR.Warnings.SimpleActionSpendFailed';
        ui.notifications.warn(game.i18n.localize(key));
    }

    static async #handleClickedDiscardDie(event, _target) {
        event.preventDefault();

        const outcome = await discardDice(this.actor, {
            amount: 1,
            context: 'discard',
            postChat: true,
            chatVisibility: 'public',
            source: 'sheet',
        });

        if (!outcome?.ok) {
            ArkhamHorrorActorSheet.#notifySimpleSpendFailure(outcome?.reason);
        }
    }

    static async #handleClickedSpendRegularDie(event, _target) {
        event.preventDefault();

        const outcome = await spendSimpleActionDie(this.actor, {
            dieType: 'regular',
            context: 'simple',
            postChat: true,
            chatVisibility: 'public',
            source: 'sheet',
        });

        if (!outcome?.ok) {
            ArkhamHorrorActorSheet.#notifySimpleSpendFailure(outcome?.reason);
        }
    }

    static async #handleClickedSpendHorrorDie(event, _target) {
        event.preventDefault();

        const outcome = await spendSimpleActionDie(this.actor, {
            dieType: 'horror',
            context: 'simple',
            postChat: true,
            chatVisibility: 'public',
            source: 'sheet',
        });

        if (!outcome?.ok) {
            ArkhamHorrorActorSheet.#notifySimpleSpendFailure(outcome?.reason);
        }
    }

    static async #handleClickedClearDicePool(event, target) {
        event.preventDefault();
        const currentPool = Number.parseInt(this.actor?.system?.dicepool?.value) || 0;
        if (currentPool <= 0) {
            return;
        }

        const outcome = await discardAllDice(this.actor, {
            context: 'discard',
            postChat: true,
            chatVisibility: 'public',
            source: 'sheet',
        });

        if (!outcome?.ok) {
            ArkhamHorrorActorSheet.#notifySimpleSpendFailure(outcome?.reason);
        }
    }

    static async #handleEditItem(event, target) {
        event.preventDefault();
        if (target.dataset.itemId == undefined) {
            const li = $(target).parents('.item');
            const item = this.options.document.items.get(li.data('itemId'))
            await item.sheet.render({ force: true });
        } else {
            const item = this.options.document.items.get(target.dataset.itemId)
            await item.sheet.render({ force: true });
        }
    }

    static async #handleCreateItem(event, target) {
        event.preventDefault();
        const actor = this.actor;
        this._onItemCreate(event, target, actor);
    }

    static async #handleCreateOtherEquipment(event, _target) {
        event.preventDefault();
        const actor = this.actor;
        if (!actor) return;

        const itemData = {
            name: game.i18n.format('DOCUMENT.New', {
                type: game.i18n.localize('TYPES.Item.useful_item')
            }),
            type: 'useful_item',
            system: {
                hasSpecialRules: false,
            }
        };

        const created = await ArkhamHorrorItem.create(itemData, { parent: actor });
        try {
            created?.sheet?.render(true);
        } catch (e) {
            // ignore
        }
    }

    async _onItemCreate(event, target, actor) {
        event.preventDefault();

        // Get the type of item to create.
        const type = target.dataset.type;
        // Grab any data associated with this control.
        const data = duplicate(target.dataset);
        // Initialize a default name.
        const name = game.i18n.format('DOCUMENT.New', {
            type: game.i18n.localize(`TYPES.Item.${type}`)
        });
        // Prepare the item object.

        const itemData = {
            name: name,
            type: type,
            system: data
        };
        // Remove the type from the dataset since it's in the itemData.type prop.
        delete itemData.system['type'];

        // Finally, create the item!
        return await ArkhamHorrorItem.create(itemData, { parent: actor });
    }

    static async #handleDeleteItem(event, target) {
        const li = $(target).parents('.item');
        if (target.dataset.itemId == undefined) {
            const item = this.actor.items.get(li.data('itemId'));
            item.delete();
            li.slideUp(200, () => this.render(false));
        } else {
            const item = this.options.document.items.get(target.dataset.itemId);
            item.delete();
            li.slideUp(200, () => this.render(false));
        }
    }

    static async #handleToggleFoldableContent(event, target) {
        event.preventDefault();
        const clickTarget = target instanceof HTMLElement ? target : target?.[0];
        const fcId = clickTarget?.dataset?.fcId;
        if (!fcId) return;

        const scope = clickTarget?.closest?.('form.application') ?? clickTarget?.closest?.('form') ?? document;

        scope.querySelectorAll(`.foldable-content[data-fc-id="${fcId}"]`).forEach(fcElement => {
            fcElement.classList.toggle('collapsed');
        });
    }

    static async #handleToggleItemActive(event, target) {
        event.preventDefault();
        const clickTarget = target instanceof HTMLElement ? target : target?.[0];
        const itemId = clickTarget?.dataset?.itemId;
        if (!itemId) return;

        const item = this.actor?.items?.get?.(itemId);
        if (!item) return;

        // Backwards compatibility: if system.active is missing, treat as active.
        const current = item.system?.active;
        const isActive = current === undefined ? true : Boolean(current);
        await item.update({ 'system.active': !isActive });
    }

    static async #handleOpenActorArchetype(event, target) {
        event.preventDefault();
        await this.openActorArchetype(event, target);
    }

    async openActorArchetype(event, target) {
        const uuid = this.document.system?.archetypeUuid;
        if (!uuid) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.ActorHasNoArchetype'));
            return;
        }

        try {
            const doc = await fromUuid(uuid);
            if (!doc) {
                ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.ActorArchetypeUuidResolveFailed'));
                return;
            }
            if (doc.type !== 'archetype') {
                ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.LinkedDocNotArchetype'));
                return;
            }
            doc.sheet?.render(true);
        } catch (e) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.OpenArchetypeFailed'));
        }
    }

    static async #handleSkillClicked(event, target) {
        event.preventDefault();
        const skillKey = target.dataset.skillKey;

        let skillCurrent = this.actor.system.skills[skillKey].current;
        let skillMax = this.actor.system.skills[skillKey].max;
        let currentDicePool = this.actor.system.dicepool.value;
        DiceRollApp.getInstance({ actor: this.actor, skillKey: skillKey, skillCurrent: skillCurrent, skillMax: skillMax, currentDicePool: currentDicePool, weaponToUse: null,spellToUse: null }).render(true);
    }

    static async #handleSkillReactionClicked(event, target) {
        event.preventDefault();
        const skillKey = target.dataset.skillKey;

        let skillCurrent = this.actor.system.skills[skillKey].current;
        let skillMax = this.actor.system.skills[skillKey].max;
        let currentDicePool = this.actor.system.dicepool.value;

        DiceRollApp.getInstance({ actor: this.actor, rollKind: "reaction", skillKey: skillKey, skillCurrent: skillCurrent, skillMax: skillMax, currentDicePool: currentDicePool, weaponToUse: null, spellToUse: null }).render(true);
    }

    static async #handleWeaponReload(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;

        const item = this.actor.items.get(itemId);
        if (item) {
            const currentAmmo = item.system.ammunition.current;
            const maxAmmo = item.system.ammunition.max;

            if (currentAmmo < maxAmmo) {
                await item.update({ 'system.ammunition.current': maxAmmo });
                // update the money according to reload cost
                const reloadCost = item.system.reloadCost;
                await spendMoney(this.actor, Number(reloadCost ?? 0), { postToChat: false });
            }
        } else {
            console.error(`Item with ID ${itemId} not found on actor.`);
        }
    }

    static async #handleClickedRefreshDicePool(event, target) {
        await refreshDicepoolAndPost({
            actor: this.actor,
            label: game.i18n.localize("ARKHAM_HORROR.DICEPOOL.Chat.Refresh"),
            healDamage: false,
        });

    }

    static async #handleClickedStrainOneself(event, target) {
        event.preventDefault();

        if (!this.actor?.isOwner) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.PermissionStrainActor'));
            return;
        }

        const currentDamage = Number(this.actor.system?.damage ?? 0);
        if (currentDamage <= 0) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.StrainRequiresDamage'));
            return;
        }

        await refreshDicepoolAndPost({
            actor: this.actor,
            label: game.i18n.localize("ARKHAM_HORROR.ACTIONS.StrainOneself"),
            healDamage: true,
        });

        InjuryTraumaRollApp.getInstance({
            actor: this.actor,
            rollKind: "injury",
            rollSource: "strain",
        }).render(true);
    }

    static async #handleClickedRollWithWeapon(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (item) {
            // check if the weapon has ammo
            if( item.system.ammunition.max > 0 && item.system.ammunition.current <= 0){
                ui.notifications.warn(game.i18n.format('ARKHAM_HORROR.Warnings.WeaponOutOfAmmo', { itemName: item.name }));
                return;
            }
            
            let skillKey = item.system.skill;
            let skillCurrent = this.actor.system.skills[skillKey].current;
            let skillMax = this.actor.system.skills[skillKey].max;
            let currentDicePool = this.actor.system.dicepool.value;
            DiceRollApp.getInstance({ actor: this.actor, skillKey: skillKey, skillCurrent: skillCurrent, skillMax: skillMax, currentDicePool: currentDicePool, weaponToUse: item,spellToUse: null}).render(true);
        } else {
            console.error(`Item with ID ${itemId} not found on actor.`);
        }
    }

    static async #handleClickedRollWithSpell(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (item) {
            let skillKey = item.system.skill;
            let skillCurrent = this.actor.system.skills[skillKey].current;
            let skillMax = this.actor.system.skills[skillKey].max;
            let currentDicePool = this.actor.system.dicepool.value;
            DiceRollApp.getInstance({ actor: this.actor, skillKey: skillKey, skillCurrent: skillCurrent, skillMax: skillMax, currentDicePool: currentDicePool, spellToUse: item,weaponToUse: null }).render(true);
        } else {
            console.error(`Item with ID ${itemId} not found on actor.`);
        }
    }

    static async #handleClickedInjuryTraumaRoll(event, target) {
        event.preventDefault();
        InjuryTraumaRollApp.getInstance({ actor: this.actor, rollKind: "injury" }).render(true);
    }

    static async #handleClickedSpendInsight(event, _target) {
        event.preventDefault();

        if (!(this.actor?.isOwner || game.user?.isGM)) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.INSIGHT.Errors.PermissionSpend'));
            return;
        }

        if (this.actor?.type !== "character") return;

        const remaining = Number(this.actor.system?.insight?.remaining) || 0;
        if (remaining <= 0) {
            ui.notifications.warn(game.i18n.format('ARKHAM_HORROR.INSIGHT.Errors.NoneRemaining', { actorName: this.actor.name }));
            return;
        }

        SpendInsightApp.getInstance({ actor: this.actor }).render(true);
    }

    static async #handleClickedRefreshInsight(event, _target) {
        event.preventDefault();

        if (!(this.actor?.isOwner || game.user?.isGM)) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.INSIGHT.Errors.PermissionRefresh'));
            return;
        }

        if (this.actor?.type !== "character") return;

        await refreshInsightAndPost({ actor: this.actor, source: "sheet" });
    }

    static async #handleUnderstandTomeFromList(event, target) {
        event.preventDefault();
        await this.understandTomeFromList(event, target);
    }

    static async #handleAttuneTomeFromList(event, target) {
        event.preventDefault();
        await this.attuneTomeFromList(event, target);
    }

    static async #handleResetKnackUses(event, target) {
        event.preventDefault();
        await this.resetKnackUses(event, target);
    }

    static async #handleResetAllKnackUses(event, target) {
        event.preventDefault();
        await this.resetAllKnackUses(event, target);
    }

    async resetKnackUses(_event, target) {
        const itemId = target?.dataset?.itemId;
        if (!itemId) return;

        const knack = this.actor?.items?.get(itemId);
        if (!knack || knack.type !== 'knack') return;

        // Owner or GM can reset.
        if (!(this.actor?.isOwner || game.user?.isGM)) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.ResetKnackPermission'));
            return;
        }

        const max = Number(knack.system?.usage?.max ?? 0);
        await knack.update({ 'system.usage.remaining': Math.max(0, max) });
    }

    async resetAllKnackUses(_event, _target) {
        if (!(this.actor?.isOwner || game.user?.isGM)) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.ResetKnackPermission'));
            return;
        }

        const { DialogV2 } = foundry.applications.api;
        const choice = await DialogV2.wait({
            window: { title: game.i18n.localize('ARKHAM_HORROR.Dialog.ResetKnacks.Title') },
            content: `<p>${game.i18n.localize('ARKHAM_HORROR.Dialog.ResetKnacks.Prompt')}</p>`,
            buttons: [
                { action: 'oncePerTurn', label: game.i18n.localize('ARKHAM_HORROR.Dialog.ResetKnacks.OncePerTurn'), icon: 'fa-solid fa-rotate-right' },
                { action: 'oncePerScene', label: game.i18n.localize('ARKHAM_HORROR.Dialog.ResetKnacks.OncePerScene'), icon: 'fa-solid fa-rotate-right' },
                { action: 'oncePerSession', label: game.i18n.localize('ARKHAM_HORROR.Dialog.ResetKnacks.OncePerSession'), icon: 'fa-solid fa-rotate-right' },
                { action: 'all', label: game.i18n.localize('ARKHAM_HORROR.Dialog.ResetKnacks.All'), icon: 'fa-solid fa-rotate-right' },
            ],
            rejectClose: false,
        });

        const mode = String(choice ?? '');
        if (!mode) return;

        const updates = [];
        for (const i of (this.actor.items?.contents ?? [])) {
            if (i.type !== 'knack') continue;
            const freq = String(i.system?.usage?.frequency ?? 'passive');
            if (mode !== 'all' && freq !== mode) continue;

            const max = Number(i.system?.usage?.max ?? 0);
            updates.push({ _id: i.id, 'system.usage.remaining': Math.max(0, max) });
        }

        if (updates.length > 0) {
            await this.actor.updateEmbeddedDocuments('Item', updates);
        }
    }

    async understandTomeFromList(event, target) {
        const itemId = target.dataset.itemId;
        const tome = this.actor.items.get(itemId);
        if (!tome || tome.type !== 'tome') return;
        if (!this.actor.isOwner) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.PermissionRollActor'));
            return;
        }
        if (Boolean(tome.system?.understood)) {
            ui.notifications.info(game.i18n.localize('ARKHAM_HORROR.Info.TomeAlreadyUnderstood'));
            return;
        }

        const skillKey = 'knowledge';
        const skillCurrent = this.actor.system.skills?.[skillKey]?.current ?? 0;
        const skillMax = this.actor.system.skills?.[skillKey]?.max ?? 0;
        const currentDicePool = this.actor.system.dicepool?.value ?? 0;
        const successesNeeded = Number(tome.system?.attunementDifficulty ?? 2);

        DiceRollApp.getInstance({
            actor: this.actor,
            rollKind: 'tome-understand',
            skillChoices: ['knowledge', 'lore'],
            skillKey,
            skillCurrent,
            skillMax,
            currentDicePool,
            weaponToUse: null,
            spellToUse: null,
            successesNeeded,
            afterRoll: async ({ outcome }) => {
                if (!outcome?.isSuccess) return;

                await understandTomeAndLearnSpells({ actor: this.actor, tome, notify: true });
            }
        }).render(true);
    }

    async attuneTomeFromList(event, target) {
        const itemId = target.dataset.itemId;
        const tome = this.actor.items.get(itemId);
        if (!tome || tome.type !== 'tome') return;
        if (!this.actor.isOwner) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.PermissionRollActor'));
            return;
        }
        if (!Boolean(tome.system?.understood)) {
            ui.notifications.warn(game.i18n.localize('ARKHAM_HORROR.Warnings.ItemTomeMustUnderstandBeforeAttune'));
            return;
        }

        const skillKey = 'intuition';
        const skillCurrent = this.actor.system.skills?.[skillKey]?.current ?? 0;
        const skillMax = this.actor.system.skills?.[skillKey]?.max ?? 0;
        const currentDicePool = this.actor.system.dicepool?.value ?? 0;
        const successesNeeded = 2;

        DiceRollApp.getInstance({
            actor: this.actor,
            rollKind: 'tome-attune',
            skillKey,
            skillCurrent,
            skillMax,
            currentDicePool,
            weaponToUse: null,
            spellToUse: null,
            successesNeeded,
            afterRoll: async ({ outcome }) => {
                if (!outcome?.isSuccess) return;

                await attuneTomeExclusive({ actor: this.actor, tome, notify: true });
            }
        }).render(true);
    }
}