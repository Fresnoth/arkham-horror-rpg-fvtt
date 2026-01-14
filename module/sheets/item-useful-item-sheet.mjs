import { ArkhamHorrorItemSheet } from "./item-sheet.mjs";

export class ArkhamHorrorUsefulItemSheet extends ArkhamHorrorItemSheet {
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
        specialRules: {
            template: 'systems/arkham-horror-rpg-fvtt/templates/item/parts/special-rules-tab.hbs',
            id: 'specialRules',
            scrollable: ['scrollable']
        },
        description: {
            template: 'systems/arkham-horror-rpg-fvtt/templates/shared/tab-description.hbs',
            id: 'description',
            scrollable: ['scrollable']
        },
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
                    { id: 'specialRules', group: 'sheet', label: 'ITEM.UsefulItem.specialRules' },
                    { id: 'description', group: 'sheet', label: 'ARKHAM_HORROR.LABELS.Description' }
                ],
            initial: 'form'
        }
    }
}