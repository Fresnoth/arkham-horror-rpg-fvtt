# CHANGELOG

## 14.2.0
- Implemented "Straining Oneself" (core p. 31): a button on the character and Major NPC sheet that
  restores the dice pool limit and rolls the injury it costs. NPCs may only do it with the Major NPC
  knack, and only once.
- Attacks on targeted tokens now offer the matching reaction on the roll card — Agility against
  ranged, Melee Combat against melee (core p. 22 and 30). Exactly one die, one reaction per attack,
  and no button when the pool is empty.
- Damage can be applied straight from the roll card: a dialog with a pre-filled amount, a live
  preview of the pool limit, an injury checkbox and a list of the target's protective equipment.
  Reductions are deliberately not calculated automatically — the rules state them as text.
- The tabs of the character and NPC sheet now sit as an icon rail along the right window edge.
- Implemented healing (core p. 33-34 and 38): heal damage (Knowledge, 1 per success), heal injuries
  (1-3 successes depending on severity), and overcome horror through Introspection and Counseling
  (each -1, regardless of the number of successes). Plus a GM tool for a night's rest and one or two
  weeks of recovery. Traumas are never healed, as the rules require.
- Traumas from rolled 1s on horror dice (core p. 37) are now reported — the value was already being
  counted but never evaluated. Can be switched off with a world setting.
- Fix: horror raised the horror limit but never topped up the horror dice in the pool. The roll card
  now also reports when horror was capped at the dice pool maximum.
- Roll effects (`rollEffects`) are now available on useful items and relics as well, with new
  modifiers for granted successes and for healing. Existing knacks and injuries are unchanged.
- Useful items and relics now have a sheet editor for roll effects and usage, and the roll-kind
  picker offers the four healing rolls everywhere. The injury sheet gained fields for heal difficulty
  and natural healing. Skill and roll-kind lists now come from one shared source instead of four
  hand-maintained copies in the templates.
- The healing modifiers on items now actually take effect: `healDamage` adds flatly on top of the
  1 damage per success (core p. 33), `healInjury` lowers the successes an injury costs by 1 (never
  below 1), and `reduceHorrorLimit` grants an extra horror step on top of the single one a successful
  roll gives (p. 38). The healing dialog shows which item contributed what. Until now the three
  values were only carried into the chat flags and ignored there.
- Charges on useful items now run through `system.usage` throughout. The older `system.uses` is only
  read to seed existing items and stays untouched in the data model until a later migration.
- New "Effects" tab on the character and NPC sheet: shows the actor's ActiveEffects grouped into
  temporary, passive and inactive, plus the effects transferred from items with their origin. Effects
  owned by an item can be toggled there, but not deleted.
- Fix: actor sheets grew with their content instead of scrolling — a character with many knacks ran
  far past the window frame. The cause was the icon rail: its `overflow: visible` also took the height
  constraint off the window content. Every tab now stays inside the window and scrolls on its own. The
  sheet header is no longer shrinkable either; otherwise the flex algorithm took its height away and
  cut off the dice pool strip at the bottom (entirely on the character sheet, halfway on the NPC one).
- Injuries and knacks now sit side by side in a full-width grid on the character sheet instead of
  stacked in the narrow right column. Below 700 px window width they stack again.
- German skill names unified: "Presence" is now *Ausstrahlung* instead of "Präsenz" (by the rules the
  skill measures charm and getting along with others, not physical presence), and "Lore" is now
  *Geheimwissen* instead of being left untranslated. The ten abbreviations on the NPC sheet were
  unchanged English copies (AGI, WIT, PRES …) and are now German (BEW, VER, AUS …). Fixed along the
  way: the introspection hint called "Resolve" *Willenskraft* in German and *Temple* in Spanish, while
  both languages name the skill differently everywhere else.
- Fix: section headings on item sheets were sliced in half. The banner shape is a `clip-path` that
  eats into the top and bottom edge, and the generic heading rule outweighs the banner rule on item
  sheets — it removed the vertical padding but could not remove the clip, so the shape cut straight
  through the glyphs. Affected the knack and tome sheets all along, and became obvious once useful
  items and relics gained the same headings.
- Visual redesign of sheets, dialogs and chat cards, following the look of the official sheet.
- Actor sheets are considerably more compact: the gaps between section panels halved, the minimum
  height of the sheet header removed, skill rows tightened. The character sheet needs roughly 150 px
  less height (about 18 %) without shrinking any content.
- Removed `system.skills.*.max` — the field had no mechanical effect; the advancement limit lives on
  the archetype (core p. 66). Existing actors load unchanged: Foundry drops the unknown field on load,
  so no migration is needed.
- Fix: dropping an archetype onto the sheet clamped skill values to the archetype's cap. Since lower
  values are better, that was a free advancement.
- Fix (#37): "Spend Regular Die", "Spend Horror Die" and "Discard Die" did nothing on the NPC sheet.
  The dice pool strip is shared with the character sheet and dispatches six actions; the NPC sheet had
  only registered three of them.
- Fix (#38): editing a text field on the personality trait sheet left the area blank. A `display: block`
  on the `<prose-mirror>` element destroyed the flex context Foundry uses to reserve room for the
  toolbar, so the toolbar covered the first line of text. The title is legible on the paper again, too.

## 14.1.0
- styling update for the actor sheets

## 14.0.0
- FoundryVTT 14 compatible
- added spanish fan translation by Nixitro

## 13.0.37
- added ability to chose which dice to spend during character rolls and other improvement regarding dices
- pause graphics
  
## 13.0.36
- added property for weapons to decrease ammunition after every usage

## 13.0.35
- added french fan translation
  
## 13.0.34
- fix issue with roll card breaking chat box on long weapon or spell names
- feature injury trauma automation

## 13.0.33
- styling fixes for personality traits

## 13.0.32
- massive localization sweep
  
## 13.0.31
- added other abilities tab to npcs
  
## 13.0.30
- simple money management for characters
- technical improvent saving or archetypes
  
## 13.0.29
- bugfix for archetype saving
- NPC weakness, knacks improvements
- default values for archetypes

## 13.0.28
- initial automation for knacks and dice rolls
- split useful items from other equipment
  
## 13.0.27
- spend Insight Logic
- combat tracker improvements
- d3 rolling & injury card improvements
- added more translation strings

## 13.0.26
- reroll, roll engine fixes and chat card v2

## 13.0.25
- fixed bugs regarding dice roll dialog
- added all skills to skill select options for weapons & spells
- styling fixes
  
## 13.0.24
- added intuition skill to spells
- added force reload to weapons as option
- UI notification if a weapon of a character is empty
  
## 13.0.23
- well.. you need to push
  
## 13.0.22
- fixed native roll format in chat
- added spell usage via dice roll dialog
- fixed some styling regarding spells in actors
- added difficulty configuration to spells
- fixed actor image aspect ratios
- npc don't show tiers for their knacks, not needed
  
## 13.0.21
- extended tomes: a tome can contain spells now, attuning & understanding rules applied to tomes
  
## 13.0.20
- basic spell rolling
- added useable items & spells to npcs
- improved styling
- actors have per default now a vision

## 13.0.19
- added reaction rolls to npc & characters

## 13.0.18
- started refactoring item sheets to unique item sheets
- improved? styling
- added skill and range to spells
- added agility and atheltics skills to select for weapons
- first implementation of trauma & injury table rolling
- token dice pool & damage indicator can now displayed above the tokens
- improved background image for sheets, less noise
  
## 13.0.17
- just bug fixes

## 13.0.16
- improved styling
- dice roll dialog with buttons to inc/decreae the number of dice used
- archetypes item (drag'n' dropable to the character sheet)
- dice roll results with support for GM Roll" "Blind Roll" "Self Roll"

## 13.0.15
- basic handling of weapon usage in dice roll dialog, inc. basic ammo tracking

## 13.0.14
- basic vehicle actor based on the Terra Antarctica campaign
  
## 13.0.13 
- added new dice roll engine by frosnoth
- added new chat cards by frosnoth
- improved styled
- added knacks to NPCs for easier prepping sessions
- bug fixes
 
## 13.0.12 ALPHA
- hotfixes

## 13.0.11 ALPHA
- added spell item
- added new config settings
- improved styling
- added load capacity for characters, auto calc or manually (Terra Antartica rules)
- added range info to weapons in actor sheets
- added system settings for injury & horror tables

## 13.0.10 ALPHA
- bug fixes
  
## 13.0.9 ALPHA
- merged Arkham Combat Tracker v1 #2 by Freshnoth
  
## 13.0.8 ALPHA
- added dice pool & damage numbers below actor tokens
- added settings for dice pool & damage overlay in system settings
- added injuries & trauma to npc
- added favor item type
- styling fixes
  
## 13.0.7 ALPHA
- fixed important styling issues
- added knack creation button on actor sheet

## 13.0.6 ALPHA
- fixed important styling issues
  
## 13.0.5 preview
- improved dice rolling dialog
- first implementation of penalty, adv/disadvantage, difficulty handling in dice handling
- improved styled
- refreshing dice pool per click on characters and npcs
- bug fixes

## 13.0.4 preview
- bug fixes

## 13.0.3 preview
- slightly improved npc sheet
- some styling fixes

## 13.0.2 preview

- updating ammunition for weapons for characters and npc
- reloading for weapons (npc & characters), reloading costs are reduced for characters
- usage count updates for useful items
- fixed some styling
- several bug fixes