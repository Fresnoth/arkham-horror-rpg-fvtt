import ArkhamHorrorItemBase from "./base-item.mjs";
import { rollEffectsField, usageField } from "./fields/roll-effects.mjs";

export default class ArkhamHorrorRelic extends ArkhamHorrorItemBase {

    static defineSchema() {
        const fields = foundry.data.fields;
        const schema = super.defineSchema();

        schema.alternativeNames = new fields.StringField({ required: true, blank: true });
        schema.rarity = new fields.SchemaField({
            common: new fields.BooleanField({ required: true, initial: false }),
            uncommon: new fields.BooleanField({ required: true, initial: false }),
            rare: new fields.BooleanField({ required: true, initial: false }),
            unique: new fields.BooleanField({ required: true, initial: false })
        });

        schema.usage = usageField();
        schema.rollEffects = rollEffectsField();

        return schema;
    }
}
