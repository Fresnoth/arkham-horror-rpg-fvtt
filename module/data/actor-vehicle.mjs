import ArkhamHorrorActorBase from "./base-actor.mjs";

export default class ArkhamHorrorVehicle extends ArkhamHorrorActorBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.skillsToUse = new fields.SchemaField({
      agility: new fields.BooleanField({ required: true, initial: false }),
      athletics: new fields.BooleanField({ required: true, initial: false }),
      wits: new fields.BooleanField({ required: true, initial: false }),
      presence: new fields.BooleanField({ required: true, initial: false }),
      intuition: new fields.BooleanField({ required: true, initial: false }),
      knowledge: new fields.BooleanField({ required: true, initial: false }),
      resolve: new fields.BooleanField({ required: true, initial: false }),
      lore: new fields.BooleanField({ required: true, initial: false }),
    });

    schema.specialRules = new fields.StringField({ required: true, blank: true });
    schema.cost = new fields.NumberField({ required: true, nullable: false, integer: false, initial: 0, min: 0 });
    schema.fuel = new fields.SchemaField({
      max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      current: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
    });
    schema.damage = new fields.SchemaField({
      max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      current: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
    });
    schema.passengers = new fields.SchemaField({
      max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      current: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
    });
    schema.loadCapacity = new fields.SchemaField({
      max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      current: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.maxRange = new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 });
    
    return schema
  }

  prepareDerivedData() {
    super.prepareDerivedData();
  }
}