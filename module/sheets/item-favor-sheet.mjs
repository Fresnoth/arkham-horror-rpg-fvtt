import { ArkhamHorrorItemSheet } from "./item-sheet.mjs";

export class ArkhamHorrorFavorSheet extends ArkhamHorrorItemSheet {
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
        benefit:{
            template: 'systems/arkham-horror-rpg-fvtt/templates/item/parts/benefit-tab.hbs',
            id: 'benefit',
            scrollable: ['scrollable']
        },
        declining:{
            template: 'systems/arkham-horror-rpg-fvtt/templates/item/parts/declining-tab.hbs',
            id: 'declining',
            scrollable: ['scrollable']
        },
        losing:{
            template: 'systems/arkham-horror-rpg-fvtt/templates/item/parts/losing-tab.hbs',
            id: 'losing',
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
                    { id: 'benefit', group: 'sheet', label: 'ITEM.Favor.benefit' },
                    { id: 'declining', group: 'sheet', label: 'ITEM.Favor.decliningText' },
                    { id: 'losing', group: 'sheet', label: 'ITEM.Favor.losingText' },
                    { id: 'description', group: 'sheet', label: 'ARKHAM_HORROR.LABELS.Description' }
                ],
            initial: 'form'
        }
    }
}