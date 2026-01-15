import ArkhamHorrorItemBase from "./base-item.mjs";

export default class ArkhamHorrorTome extends ArkhamHorrorItemBase {

    static defineSchema() {
        const fields = foundry.data.fields;
        const schema = super.defineSchema();

        const DocumentUUIDField = fields.DocumentUUIDField ?? fields.StringField;

        schema.alternativeNames = new fields.StringField({ required: true, blank: true });
        schema.knowledgeBonus = new fields.StringField({ required: true, blank: true });

        // UUID references to spell Items (world or compendium). Not embedded on the Tome.
        schema.spellUuids = new fields.ArrayField(new DocumentUUIDField({ required: true, nullable: false, blank: false }));

        // Difficulty (successes needed) to understand the tome.
        // Defaults to Difficult (2). Can be overridden per-roll in the DiceRollApp dialog.
        schema.attunementDifficulty = new fields.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 3, initial: 2 });

        // Actor-owned state.
        schema.understood = new fields.BooleanField({ required: true, nullable: false, initial: false });
        schema.attuned = new fields.BooleanField({ required: true, nullable: false, initial: false });
        schema.rarity = new fields.SchemaField({
            common: new fields.BooleanField({ required: true, initial: false }),
            uncommon: new fields.BooleanField({ required: true, initial: false }),
            rare: new fields.BooleanField({ required: true, initial: false }),
            unique: new fields.BooleanField({ required: true, initial: false })
        });

        return schema;
    }
}