import ArkhamHorrorActorBase from "./base-actor.mjs";

export default class ArkhamHorrorNPC extends ArkhamHorrorActorBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.abilitiesDescription = new fields.StringField({ required: false, blank: true });
    
    return schema
  }

  prepareDerivedData() {
    super.prepareDerivedData();
  }
}