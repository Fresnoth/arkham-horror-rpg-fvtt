/**
* Klassifiziert ALLE Kompendium-Dokumente nach der mechanischen Form ihrer Effekte.
 * Ziel: herausfinden, welche Modifikator-Felder ein rollEffects-Schema tragen muss —
 * und was sich grundsaetzlich nicht als Datensatz abbilden laesst.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = "/home/ghostrifle/Daten/foundry/data_v14/Data/modules/arkham-horror-compendium/src";
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

// Jede Form ist ein Kandidat fuer ein Schemafeld. Reihenfolge = Auswertungsreihenfolge,
// spezifischere Muster zuerst.
const SHAPES = [
  ["addSuccesses",      /increase (the number of |their )?successes?( generated)? by (\w+)|add (\w+) (additional )?success/i],
  ["healDamage",        /heals? (up to )?[\d\w]+ damage|target heals/i],
  ["reduceHorrorLimit", /reduce (their|the target's|the) horror dice limit by/i],
  ["sufferHorror",      /suffers? [\d\w]+ (additional )?horror/i],
  ["reduceHorrorTaken", /reduce the horror (suffered|taken) by/i],
  ["healInjury",        /heals? (an|one|the) injury|injury is healed/i],
  ["addDice",           /adds? [\w\d]+ (additional )?(dice|die)( to)?/i],
  ["rerollDie",         /(may )?reroll (up to )?(one|1|a|the) (die|result)/i],
  ["advantage",         /with advantage|gains? advantage/i],
  ["disadvantage",      /suffers? disadvantage|with disadvantage/i],
  ["dieResultModifier", /add \d+ to (the result of )?(each|the) di|subtract(ing)? \d+ from (the|each) di|−\d penalty on each die|-\d penalty on each die/i],
  ["reduceDamageTaken", /reduce[sd]? the damage (suffered|taken|dealt)( by that attack)? (by|to)/i],
  ["dicePoolMax",       /increases? (their|the) dice pool maximum by/i],
  ["restoreDicePool",   /restore (their|its) dice pool limit to/i],
  ["spendInsight",      /spend \d+ insight/i],
];

const LIMITS = [
  ["oncePerSession", /once per session/i],
  ["oncePerScene",   /once per scene/i],
  ["oncePerTurn",    /once per turn/i],
  ["consumesUse",    /use circles?|mark one of the use/i],
];

const TRIGGERS = [
  ["onHealAction",   /complex action to heal|action to heal damage|to heal an injury/i],
  ["onAttack",       /performs? an attack|on a successful (hit|attack)|when .{0,20}attacks?/i],
  ["onReaction",     /performs? a reaction/i],
  ["onRollResult",   /rolls? (a |one or more )?results? of \d|rolls? \d\+? or/i],
  ["onSufferHorror", /would otherwise suffer horror|when .{0,25}suffers? horror/i],
  ["onWounded",      /when this NPC is wounded|is wounded/i],
  ["onTurnStart",    /at the (start|beginning) of (their|this NPC's|your) turn/i],
];

const docs = [];
for (const f of walk(SRC)) {
  if (!f.endsWith(".json") || f.endsWith("_Folder.json")) continue;
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const doc of [d, ...(d.items ?? [])]) {
    if (!doc.type || ["npc", "character", "vehicle"].includes(doc.type)) continue;
    const text = strip([doc.system?.description, doc.system?.specialRules,
      doc.system?.defensiveBenefit, doc.system?.benefit, doc.system?.positive, doc.system?.negative]
      .filter(Boolean).join(" "));
    if (text) docs.push({ type: doc.type, name: doc.name, text });
  }
}

const uniq = new Map();
for (const d of docs) if (!uniq.has(`${d.type}|${d.name}`)) uniq.set(`${d.type}|${d.name}`, d);
const all = [...uniq.values()];

const count = (list, subset = all) => {
  const res = {};
  for (const [key, rx] of list) res[key] = subset.filter((d) => rx.test(d.text)).length;
  return res;
};

console.log(`Eindeutige Dokumente mit Regeltext: ${all.length}\n`);

// Nur die, die ueberhaupt Heilung oder Horror betreffen — darum ging die Frage.
const relevant = all.filter((d) => /heal|horror/i.test(d.text));
console.log(`Davon mit Heil-/Horror-Bezug: ${relevant.length}`);
console.log("  nach Typ:", relevant.reduce((a, d) => (a[d.type] = (a[d.type] ?? 0) + 1, a), {}));

console.log("\n=== Wirkungsformen (alle Dokumente) ===");
for (const [k, v] of Object.entries(count(SHAPES)).sort((a, b) => b[1] - a[1])) if (v) console.log(`  ${k.padEnd(20)} ${v}`);

console.log("\n=== Wirkungsformen (nur Heil-/Horror-Bezug) ===");
for (const [k, v] of Object.entries(count(SHAPES, relevant)).sort((a, b) => b[1] - a[1])) if (v) console.log(`  ${k.padEnd(20)} ${v}`);

console.log("\n=== Begrenzungen ===");
for (const [k, v] of Object.entries(count(LIMITS, relevant)).sort((a, b) => b[1] - a[1])) if (v) console.log(`  ${k.padEnd(20)} ${v}`);

console.log("\n=== Ausloeser ===");
for (const [k, v] of Object.entries(count(TRIGGERS, relevant)).sort((a, b) => b[1] - a[1])) if (v) console.log(`  ${k.padEnd(20)} ${v}`);

// Was von keinem Muster erfasst wird, ist der eigentlich interessante Rest.
const anyShape = (d) => SHAPES.some(([, rx]) => rx.test(d.text));
const unmatched = relevant.filter((d) => !anyShape(d));
console.log(`\n=== Von keiner Form erfasst: ${unmatched.length} von ${relevant.length} ===`);
for (const d of unmatched.slice(0, 12)) console.log(`  [${d.type}] ${d.name}: ${d.text.slice(0, 120)}`);
