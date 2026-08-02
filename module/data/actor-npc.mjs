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

    // The "Major NPC" knack allows straining exactly once (core p. 190/196). Once spent, being
    // wounded means the NPC is immediately killed or knocked out at the GM's discretion.
    schema.strainedOnce = new fields.BooleanField({ required: true, nullable: false, initial: false });

    return schema
  }

  prepareDerivedData() {
    super.prepareDerivedData();
  }
}