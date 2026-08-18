/**
 * Curated 256-word list for spoken attestation phrases.
 *
 * These words are read aloud over a phone line, transcribed by ASR, and then
 * verified with a per-word edit-distance tolerance of 1 (see verifySpokenPhrase
 * in attest.ts). The curation rules exist so that tolerance can never cause one
 * list word to verify as another:
 *
 *  1. Exactly 256 entries — one byte of digest selects one word.
 *  2. Every word is a common, two-syllable, concrete English noun/adjective:
 *     easy to say, easy to hear, familiar to ASR language models.
 *  3. Pairwise Levenshtein distance >= 2 for ALL pairs (hard safety floor:
 *     verification tolerates distance 1, so distance-1 neighbours in the list
 *     would be cross-verifiable).
 *  4. No rhyme pairs: any two words sharing their final three letters must be
 *     at Levenshtein distance >= 3 (mechanical rhyme proxy), and known
 *     sound-alike pairs the spelling rules cannot see (diesel/weasel,
 *     polar/solar, cavern/tavern, ...) were resolved by keeping one member.
 *  5. No homophones of each other or of common English words, no number words
 *     (phrases are spoken amid dollar amounts), no charged vocabulary.
 *
 * All five spelling-level invariants are enforced by test/attest.test.ts —
 * edit this list and the suite will tell you if you broke the phonetics floor.
 */
export const WORDS: readonly string[] = [
  "acorn", "amber", "anchor", "arrow",
  "atlas", "awning", "badger", "banjo",
  "barley", "beaver", "bishop", "blossom",
  "border", "bronco", "budget", "bundle",
  "bunker", "cabbage", "cactus", "camel",
  "canyon", "caption", "cargo", "carpet",
  "castle", "catfish", "cello", "channel",
  "charcoal", "cherry", "chisel", "chowder",
  "cipher", "circle", "closet", "cluster",
  "cobalt", "coffee", "collar", "combo",
  "comet", "condor", "convoy", "coral",
  "corner", "costume", "cotton", "cowboy",
  "coyote", "crater", "cricket", "crystal",
  "cutlass", "cyclone", "decal", "denim",
  "dimple", "dingo", "doctor", "dolphin",
  "donor", "doodle", "drizzle", "duffel",
  "echo", "effort", "emblem", "empire",
  "essay", "falcon", "fathom", "feather",
  "fiddle", "figment", "filter", "finger",
  "forest", "fortress", "fresco", "frontier",
  "furnace", "gallop", "gargoyle", "garlic",
  "geyser", "giraffe", "goblin", "granite",
  "gravel", "grotto", "guitar", "halo",
  "hammer", "harvest", "hatchet", "hazel",
  "hedgehog", "hobby", "husky", "index",
  "ingot", "iris", "island", "jasmine",
  "jigsaw", "kayak", "kingdom", "kiosk",
  "kiwi", "knapsack", "lagoon", "lantern",
  "lattice", "lava", "lemon", "lentil",
  "lilac", "lily", "lion", "litmus",
  "lobster", "lotus", "lunar", "macaw",
  "magma", "mallard", "mammoth", "maple",
  "marble", "mascot", "meerkat", "mentor",
  "method", "metro", "mirror", "mocha",
  "mongoose", "mountain", "mushroom", "napkin",
  "narwhal", "needle", "neon", "nickel",
  "nimbus", "nomad", "nova", "nozzle",
  "nutmeg", "oboe", "ocean", "okra",
  "olive", "opal", "orbit", "organ",
  "ostrich", "otter", "palace", "pamphlet",
  "panda", "panther", "parka", "parrot",
  "peacock", "pebble", "pendant", "penguin",
  "pilot", "pixel", "plastic", "plateau",
  "plaza", "pollen", "poncho", "prairie",
  "pretzel", "profile", "pudding", "puma",
  "pumpkin", "python", "quarry", "rabbit",
  "radish", "rapids", "raptor", "redwood",
  "relic", "rhubarb", "robot", "rosebud",
  "runway", "rustic", "saga", "salad",
  "salsa", "sapphire", "satchel", "satin",
  "sawdust", "scaffold", "schooner", "seahorse",
  "sentry", "serpent", "shepherd", "signal",
  "silo", "skillet", "slogan", "sofa",
  "spider", "spinach", "spiral", "squirrel",
  "stanza", "starfish", "statue", "suitcase",
  "summit", "sunset", "syrup", "tackle",
  "tavern", "tennis", "thunder", "tinsel",
  "toolbox", "topaz", "toucan", "trellis",
  "trombone", "trophy", "tugboat", "tulip",
  "tunnel", "turtle", "twilight", "vacuum",
  "velvet", "viking", "villa", "vinyl",
  "vista", "voyage", "vulture", "walnut",
  "walrus", "wigwam", "willow", "wisdom",
  "wizard", "yodel", "yogurt", "zenith",
];
