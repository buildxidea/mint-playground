// Guest briefs = levels.
//  - requires: pieces that MUST be present or the round is a miss
//  - wants: pieces / wall paint that earn favor
//  - dislikes: placed pieces that cost favor (revealed by the "hate" interview question)
//  - maxPieces: clutter tolerance (revealed by the "clutter" question)
//  - answers: what the guest says to each interview question — you may ask ONE
//  - reactions: high / mid / low + special missing / clutter / hated outcomes
export const BRIEFS = [
  {
    name: 'Mara',
    emoji: '🌧️',
    line: 'I want somewhere soft and green where I can nap while it rains.',
    requires: ['bed'],
    wants: { pieces: ['plant'], wall: ['#ccd3bd'] },
    dislikes: ['crt', 'lava'],
    maxPieces: 6,
    answers: {
      hate: 'Screens. Glowing things. Anything that hums.',
      need: 'A bed. That is the entire point of a nap.',
      clutter: 'Six things feels right. More gets loud.',
    },
    reactions: {
      high: 'This is exactly what I meant and I didn’t even know it.',
      mid: 'It’s lovely… maybe something growing in the corner?',
      low: 'It’s very nice! It’s just… not very *me*.',
      missing: 'Wait — where would I actually nap?',
      clutter: 'It’s a lot of furniture for a nap, isn’t it?',
      hated: 'Something in here is humming and I can *feel* it.',
    },
  },
  {
    name: 'Theo',
    emoji: '📖',
    line: 'Give me a warm corner where I can read until way past midnight.',
    requires: ['armchair'],
    wants: { pieces: ['lamp'], wall: ['#e2c4b0'] },
    dislikes: ['crt'],
    maxPieces: 6,
    answers: {
      hate: 'Televisions. I can hear them thinking.',
      need: 'Somewhere to sit. A proper chair, with arms.',
      clutter: 'Six pieces, tops. It’s a corner, not a den.',
    },
    reactions: {
      high: 'The chair. The glow. I’m never leaving.',
      mid: 'Cozy… though I’d kill for a proper reading lamp.',
      low: 'A chair, yes… but this corner isn’t *warm*, you know?',
      missing: 'I was promised a chair. There is no chair.',
      clutter: 'I only need one corner — this is every corner.',
      hated: 'There is a television. In my *reading room*.',
    },
  },
  {
    name: 'Wren',
    emoji: '🌷',
    line: 'Make it feel like my grandmother’s cottage — worn, woven, and a little alive.',
    requires: ['ironbed'],
    wants: { pieces: ['rocking', 'rug', 'fern'], wall: ['#ccd3bd'] },
    dislikes: ['inflatable', 'lava', 'crt', 'beanbag'],
    maxPieces: 8,
    answers: {
      hate: 'Plastic. Grandma never owned a single plastic thing.',
      need: 'An iron bed — the kind that creaks sweetly.',
      clutter: 'Eight things is a home. More is a shop.',
    },
    reactions: {
      high: 'Oh — it smells like bread in here somehow. How did you do that?',
      mid: 'Nearly home… it wants something woven underfoot, maybe?',
      low: 'It’s tidy! Grandma’s house was never tidy.',
      missing: 'No iron bed? Grandma would faint.',
      clutter: 'Cozy isn’t the same as crowded, dear.',
      hated: 'Grandma would not have owned *that*. Whatever it is.',
    },
  },
  {
    name: 'Kai',
    emoji: '💿',
    line: 'It’s 1999 and I finally got my own room. Make it LOUD.',
    requires: ['lava'],
    wants: { pieces: ['inflatable', 'crt', 'beanbag'], wall: [] },
    dislikes: ['ironbed', 'rocking', 'rug'],
    maxPieces: 8,
    answers: {
      hate: 'Old stuff. Anything woven, wooden, or wobbly.',
      need: 'The lava lamp. It’s the whole entire vibe.',
      clutter: 'Eight-ish? My room, my rules.',
    },
    reactions: {
      high: 'NO WAY. This is the coolest room in the entire cul-de-sac.',
      mid: 'Sick lamp… but where am I supposed to play my games?',
      low: 'This looks like my parents’ room. That’s not a compliment.',
      missing: 'You forgot the lava lamp?? That’s the whole POINT.',
      clutter: 'Okay even for me this is a lot.',
      hated: 'Ew, is that from an *antique store*??',
    },
  },
  {
    name: 'June',
    emoji: '🌤️',
    line: 'Sunlight, air, and almost nothing else. I mean it about the nothing.',
    requires: [],
    wants: { pieces: ['plant'], wall: ['#efe6d8'] },
    dislikes: [],
    maxPieces: 4,
    answers: {
      hate: 'Stuff. Stuff in general.',
      need: 'Nothing is *required*. That’s rather the point.',
      clutter: 'Four. And I’m being generous.',
    },
    reactions: {
      high: 'Room to breathe. You listened.',
      mid: 'Close! It just wants to be a little plainer.',
      low: 'It’s beautiful, it’s just… not the nothing I asked for.',
      missing: '',
      clutter: 'I said almost *nothing*. This is several somethings.',
      hated: 'Hm.',
    },
  },
];

BRIEFS.push(
  {
    name: 'Priya',
    emoji: '🪴',
    line: 'I don’t want a room. I want a greenhouse that happens to have furniture.',
    requires: ['plant'],
    wants: { pieces: ['fern', 'plant'], wall: ['#ccd3bd', '#efe6d8'] },
    dislikes: ['crt', 'lava'],
    maxPieces: 7,
    answers: {
      hate: 'Electronics. Plants can tell when there’s a screen on.',
      need: 'A tall plant. Non-negotiable. Two is better.',
      clutter: 'Seven things — and green things barely count.',
    },
    reactions: {
      high: 'They’re going to *thrive* in here. So will I.',
      mid: 'Good bones… but where is the rest of the jungle?',
      low: 'There’s not a single living thing in this room. Including, spiritually, me.',
      missing: 'You brought me a room with no plants. A desert.',
      clutter: 'Less furniture, more foliage. Always.',
      hated: 'Something electric is disturbing the ferns.',
    },
  },
  {
    name: 'Dee',
    emoji: '🎨',
    line: 'I want walls that say something — and somewhere to sit while they say it.',
    requires: ['poster'],
    wants: { pieces: ['armchair', 'rug'], wall: ['#e2c4b0'] },
    dislikes: [],
    maxPieces: 8,
    answers: {
      hate: 'Bare walls. A blank wall is a wasted argument.',
      need: 'Art. Hung, framed, considered. At least one piece.',
      clutter: 'Eight pieces — art doesn’t count as clutter, obviously.',
    },
    reactions: {
      high: 'The composition. The dialogue between the pieces. Yes.',
      mid: 'Promising… but one wall is still saying absolutely nothing.',
      low: 'This room has nothing to *say*.',
      missing: 'The walls are BARE. I specifically mentioned the walls.',
      clutter: 'It’s a gallery, not a storage unit.',
      hated: 'Hm.',
    },
  },
  {
    name: 'Marco',
    emoji: '🎬',
    line: 'Movie night HQ. Big screen energy, floor seating, zero overhead lighting.',
    requires: ['crt'],
    wants: { pieces: ['beanbag', 'poster'], wall: [] },
    dislikes: ['lamp'],
    maxPieces: 8,
    answers: {
      hate: 'Tall lamps. Glare on the screen ruins the third act.',
      need: 'A screen. The chunkier the better.',
      clutter: 'Eight things max — gotta leave floor room for snacks.',
    },
    reactions: {
      high: 'Shhh. It’s starting. This is perfect.',
      mid: 'Solid setup… but I’m not watching a three-hour movie on the floor.',
      low: 'Where’s… the screen? What are we watching, the wall?',
      missing: 'No TV?? What is this, a *conversation* room?',
      clutter: 'Too much stuff — you’re blocking the screen.',
      hated: 'That lamp is glaring right onto the screen. Unwatchable.',
    },
  },
);

export const QUESTIONS = [
  { id: 'hate', label: 'What do you hate?' },
  { id: 'need', label: 'What’s the one thing you need?' },
  { id: 'clutter', label: 'How much stuff is too much?' },
];

// --- Live interruptions while the player builds ---
// chattiness: how often a guest texts (0..1). texts: per-guest voice lines
// per category; tone is deliberately ambiguous. Generic pools fill the gaps.
export const GENERIC_TEXTS = {
  neutral: [
    'Interesting choice.',
    'Oh. Okay.',
    'Hm. Bold.',
    'That’s… certainly a decision.',
    'My friends are absolutely taking pictures in this room.',
    'I can’t tell if I love this yet.',
    'You’re not putting that *there*, right? …No, no, go on.',
  ],
  overLimit: [
    'It’s getting kind of full in here?',
    'Is all of this… staying?',
  ],
};

const GUEST_TEXTS = {
  Mara:  { chattiness: 0.6,  want: ['Oh — that’s exactly the soft I meant.', 'I could already fall asleep on that.'], dislike: ['Wait. Does that hum?', 'Does that… glow? At night?'] },
  Theo:  { chattiness: 0.45, want: ['Acceptable. Very acceptable.'], dislike: ['I can hear it thinking from here.'] },
  Wren:  { chattiness: 0.9,  want: ['Oh, grandma had one JUST like that!', 'It smells like Sunday mornings already.'], dislike: ['Wait. Is that plastic?', 'That did not come from a cottage.'] },
  Kai:   { chattiness: 0.9,  want: ['DUDE. Yes.', 'Okay okay okay it’s happening.'], dislike: ['Is that from, like, an estate sale?', 'Why does my room smell like grandma’s.'] },
  June:  { chattiness: 0.2,  want: ['Mm.'], dislike: ['…'] },
  Priya: { chattiness: 0.7,  want: ['Oh, she’s going to LOVE the light here.', 'Green friends!!'], dislike: ['That’s going to disturb the ferns.'] },
  Dee:   { chattiness: 0.8,  want: ['Now THAT is a statement.', 'The composition is starting to argue. Good.'], dislike: ['Hm. Derivative.'] },
  Marco: { chattiness: 0.75, want: ['Big screen energy. I feel it.', 'Snack zone is forming.'], dislike: ['Glare. GLARE.'] },
};

// Pick an interruption for a placement, or null to stay quiet.
// Ambiguity by design: sometimes a neutral line fires even on a loaded placement.
export function pickInterruption(brief, key, placedCount) {
  const voice = GUEST_TEXTS[brief.name] || { chattiness: 0.5 };
  if (Math.random() > voice.chattiness) return null;

  const pool = [];
  const wanted = brief.requires.includes(key) || brief.wants.pieces.includes(key);
  const hated = brief.dislikes.includes(key);
  const over = placedCount > brief.maxPieces;

  if (Math.random() < 0.25) pool.push(...GENERIC_TEXTS.neutral); // keep them guessing
  else if (hated && voice.dislike) pool.push(...voice.dislike);
  else if (wanted && voice.want) pool.push(...voice.want);
  else if (over) pool.push(...GENERIC_TEXTS.overLimit);
  else pool.push(...GENERIC_TEXTS.neutral);

  return pool[Math.floor(Math.random() * pool.length)] || null;
}

// --- Character quirks: one hardcoded, permanent pet-rule per guest ---
// Not revealed by the interview. The guest ALWAYS calls it out the moment
// the offending item is placed (quirk.tell), so the player can restart and
// repack — and because it's part of who they are, it never changes between
// attempts. Quirk items score like dislikes and block a perfect visit.
const QUIRKS = {
  Mara:  { forbid: ['poster'],               tell: 'Oh — no art over a nap spot. It stares.', reaction: 'I can’t sleep with something *watching* from the wall.' },
  Theo:  { forbid: ['inflatable', 'beanbag'], tell: 'I need a *proper* chair. Not… whatever that is.', reaction: 'You expected me to read in a puddle of vinyl?' },
  Wren:  { forbid: ['lamp'],                 tell: 'Electric light? In grandma’s cottage? Candles, dear.', reaction: 'That lamp is very modern. That is not a compliment.' },
  Kai:   { forbid: ['plant', 'fern'],        tell: 'Ew, plants? They’re so… organic.', reaction: 'There is soil. In my Y2K paradise. SOIL.' },
  June:  { forbid: ['rug'],                  tell: 'Rugs collect *things*. No.', reaction: 'The rug is holding dust and opinions. Both must go.' },
  Priya: { forbid: ['poster'],               tell: 'Walls are for climbing vines, not paper.', reaction: 'You gave my vine wall to… a rectangle.' },
  Dee:   { forbid: ['crt'],                  tell: 'A television is not art. Don’t argue.', reaction: 'There is a TELEVISION in my gallery.' },
  Marco: { forbid: ['armchair', 'rocking'],  tell: 'Chairs block the screen. FLOOR seating only.', reaction: 'Someone’s head would be in the picture the WHOLE time.' },
};

for (const brief of BRIEFS) brief.quirk = QUIRKS[brief.name];

// Returns the guaranteed callout line if this placement violates the guest's quirk.
export function quirkTell(brief, key) {
  return brief.quirk?.forbid.includes(key) ? brief.quirk.tell : null;
}

// Score a finished room against a brief.
// Returns { outcome, reactionKey, stars: 1-3, score, favoriteKey }
export function matchBrief(brief, { placedKeys, wall }) {
  const favoriteKey =
    [...brief.requires, ...brief.wants.pieces].find((k) => placedKeys.includes(k)) ||
    placedKeys[0] || null;

  if (brief.requires.some((r) => !placedKeys.includes(r))) {
    return { outcome: 'missing', reactionKey: 'missing', stars: 1, score: 0, favoriteKey };
  }

  let total = 0;
  let got = 0;
  for (const p of brief.wants.pieces) {
    total += 1;
    if (placedKeys.includes(p)) got += 1;
  }
  if (brief.wants.wall.length) {
    total += 1;
    if (wall && brief.wants.wall.includes(wall)) got += 1;
  }

  const base = total > 0 ? got / total : 1;
  const extras = Math.max(0, placedKeys.length - brief.maxPieces);
  const allDislikes = [...brief.dislikes, ...(brief.quirk?.forbid || [])];
  const disliked = placedKeys.filter((k) => allDislikes.includes(k)).length;
  const score = Math.max(0, base - extras * 0.2 - disliked * 0.3);

  if (extras >= 3) return { outcome: 'clutter', reactionKey: 'clutter', stars: 1, score, favoriteKey };

  let outcome = score >= 0.75 ? 'high' : score >= 0.45 ? 'mid' : 'low';
  // a disliked piece in the room always spoils perfection
  if (disliked >= 1 && outcome === 'high') outcome = 'mid';

  const quirkViolated = (brief.quirk?.forbid || []).some((k) => placedKeys.includes(k));
  const reactionKey = disliked >= 1 && outcome !== 'high' ? 'hated' : outcome;
  const stars = outcome === 'high' ? 3 : outcome === 'mid' ? 2 : 1;
  return { outcome, reactionKey, stars, score, favoriteKey, quirkViolated };
}
