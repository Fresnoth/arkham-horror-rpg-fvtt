import ArkhamHorrorActorBase from "./base-actor.mjs";

export default class ArkhamHorrorNPC extends ArkhamHorrorActorBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.profile = new fields.StringField({
      required: true,
      nullable: false,
      blank: false,
      initial: "generic",
      choices: ["generic", "named", "supernatural", "monstrosity"],
    });

    schema.size = new fields.StringField({
      required: true,
      nullable: false,
      blank: false,
      initial: "standard",
      choices: ["standard", "large", "huge", "titanic"],
    });

    schema.abilitiesDescription = new fields.StringField({ required: false, blank: true });
    
    return schema
  }

  prepareDerivedData() {
    super.prepareDerivedData();
  }
}