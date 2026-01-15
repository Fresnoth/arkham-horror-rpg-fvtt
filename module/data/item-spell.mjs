import ArkhamHorrorItemBase from "./base-item.mjs";

export default class ArkhamHorrorSpell extends ArkhamHorrorItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.specialRules = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.skill = new fields.StringField({ required: false, blank: true, initial: "lore" });
    schema.range = new fields.NumberField({ required: false, blank: true, initial: 0 });
    schema.difficulty = new fields.NumberField({ required: false, blank: true, initial: 1 });

    return schema;
  }
}