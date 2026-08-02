import ArkhamHorrorItemBase from "./base-item.mjs";
import { rollEffectsField, usageField } from "./fields/roll-effects.mjs";

export default class ArkhamHorrorKnack extends ArkhamHorrorItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();
    const requiredInteger = { required: true, nullable: false, integer: true };

    const DocumentUUIDField = fields.DocumentUUIDField ?? fields.StringField;

    schema.isNPCknack = new fields.BooleanField({ required: true, nullable: false, initial: false });
    schema.isNPCweakness = new fields.BooleanField({ required: true, nullable: false, initial: false });

    schema.tier = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    schema.usage = usageField();

    // Roll effects are prompt-selectable only in v1.
    schema.rollEffects = rollEffectsField();

    // Grants: primarily spell UUID references. These are applied immediately when the knack is acquired.
    // We store structured grant entries to allow future expansion beyond spells.
    schema.grants = new fields.ArrayField(
      new fields.SchemaField({
        type: new fields.StringField({ required: true, nullable: false, initial: "spell", choices: ["spell"] }),
        uuid: new DocumentUUIDField({ required: true, nullable: false, blank: false }),
      }),
      { initial: [] }
    );

    return schema;
  }
}
