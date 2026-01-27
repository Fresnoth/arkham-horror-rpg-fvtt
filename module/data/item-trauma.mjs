import ArkhamHorrorItemBase from "./base-item.mjs";

export default class ArkhamHorrorTrauma extends ArkhamHorrorItemBase {

    static defineSchema() {
        const fields = foundry.data.fields;
        const schema = super.defineSchema();

        // Allows future automation (e.g., knacks) to temporarily disable a trauma without deleting it.
        schema.active = new fields.BooleanField({ required: true, nullable: false, initial: true });

        // Simple toggle: this trauma contributes +1 to future Trauma roll modifiers.
        schema.traumaRollModifier = new fields.SchemaField({
            enabled: new fields.BooleanField({ required: true, nullable: false, initial: false }),
        });

        return schema;
    }
}

 