import ArkhamHorrorItemBase from "./base-item.mjs";

export default class ArkhamHorrorInjury extends ArkhamHorrorItemBase {

    static defineSchema() {
        const fields = foundry.data.fields;
        const schema = super.defineSchema();

        const requiredInteger = { required: true, nullable: false, integer: true };

        // Allows future automation (e.g., knacks) to temporarily disable an injury without deleting it.
        schema.active = new fields.BooleanField({ required: true, nullable: false, initial: true });

        // Roll effects: automatic penalties applied to matching skill rolls.
        schema.rollEffects = new fields.SchemaField({
            enabled: new fields.BooleanField({ required: true, nullable: false, initial: false }),

            skillKeys: new fields.ArrayField(
                new fields.StringField({
                    required: true,
                    nullable: false,
                    choices: [
                        "any",
                        "agility",
                        "athletics",
                        "wits",
                        "presence",
                        "intuition",
                        "knowledge",
                        "resolve",
                        "meleeCombat",
                        "rangedCombat",
                        "lore",
                    ],
                }),
                { initial: ["any"] }
            ),

            rollKinds: new fields.ArrayField(
                new fields.StringField({
                    required: true,
                    nullable: false,
                    choices: ["any", "complex", "reaction", "tome-understand", "tome-attune"],
                }),
                { initial: ["any"] }
            ),

            modifier: new fields.SchemaField({
                // Penalty is a per-die face reduction handled by the roll engine.
                penalty: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
            }),
        });

        return schema;
    }
}

 