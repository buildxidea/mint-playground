// ── ROOM 2 · THE CORE ────────────────────────────────────────────────────────
// A walkable two-chamber escape: a control room and a reactor bay joined by a
// corridor sealed behind a powered bulkhead. Logic/colour/spatial puzzles (no
// arithmetic beyond spotting primes). Same data shape as room1.js — the engine
// renders every widget and applies every effect.
//
// Flow:  Power (primes) opens the bulkhead ─┐
//   control room: Cipher+UV → Coolant Rod,  Colour-sequence analyzer
//   reactor bay:  Beam (needs rod) charges Core → Mastermind lock,  Cryo-pod logic
//   Blast door:   arrange the four cradle colours (deduced from the pods) → finale

// floorplan cells
const A = { x0: -9, x1: -2, z0: -4, z1: 4 };     // control room
const C = { x0: -2, x1: 2, z0: -1.5, z1: 1.5 };  // corridor
const B = { x0: 2, x1: 10, z0: -4.5, z1: 4.5 };  // reactor bay

// the four cradle colours (used by the pods + the door)
const CRADLE = [
  { id: 'amber', label: 'Amber', color: '#d99a2b' },
  { id: 'green', label: 'Green', color: '#3fa34d' },
  { id: 'blue', label: 'Blue', color: '#2f6fb0' },
  { id: 'crimson', label: 'Crimson', color: '#b83b3b' },
];

export const room2 = {
  id: 'room2',
  title: 'The Core',
  code: '',                 // no digit-reveal lock; the door uses colour + choice
  codeSources: [],

  movement: 'walk',
  floorplan: {
    height: 3.4,
    fog: { near: 12, far: 34 },
    emergency: [6, 2.2, -2.7],
    cells: [A, C, B],
    walls: [
      [A.x0, A.z0, A.x0, A.z1], [A.x0, A.z0, A.x1, A.z0], [A.x0, A.z1, A.x1, A.z1],
      [A.x1, A.z0, A.x1, C.z0], [A.x1, C.z1, A.x1, A.z1],
      [C.x0, C.z1, C.x1, C.z1], [C.x0, C.z0, C.x1, C.z0],
      [B.x0, B.z0, B.x0, C.z0], [B.x0, C.z1, B.x0, B.z1],
      [B.x1, B.z0, B.x1, B.z1], [B.x0, B.z0, B.x1, B.z0], [B.x0, B.z1, B.x1, B.z1],
    ],
  },
  spawn: { x: -7, z: 1.6, yaw: 1.7 },

  menu: {
    number: '02',
    subtitle: 'Containment Core · Sub-Level 7',
    tag: 'SECTOR 7',
    time: '30–45 min',
    difficulty: 'Hard',
    blurb: 'Below the lab, the Core is failing. Restore power, work the two chambers, and read Vale’s ciphers, colours and logic to blow the blast door — before you learn why it remembers your face.',
  },

  intro: {
    tag: 'CONTAINMENT CORE · SUB-LEVEL 7',
    speaker: 'DR. ELIAS VALE — FRAGMENTED LOG',
    lines: [
      'If you came this far down, then you opened my lab. Clever.',
      'The code up there was mercy. Down here, I stopped being kind.',
      'The Core is failing. I scattered the release across the bays — power it, and see.',
      'One thing, Subject 02. You’ll want to know why the door remembers your face.',
    ],
    button: 'Descend',
  },

  ending: {
    lines: [
      'Release accepted.',
      'You were never here to escape, 02.',
      'You were here to remember.',
      'The next one is already waking.',
    ],
    speaker: 'THE CORE — VALE’S VOICE',
    escaped: 'ESCAPED',
    sting: 'SUBJECT 03 — AWAKENING',
  },

  // ── Objects ────────────────────────────────────────────────────────────────
  objects: [
    // ═══ CONTROL ROOM ═══════════════════════════════════════════════════════
    // Power relay — engage the prime relays to wake the bus + open the bulkhead.
    {
      id: 'relay', label: 'Relay Bank', glbKey: 'console',
      mount: 'floor', pos: [-3.4, 0, -2.9], rotY: 0.35, targetSize: 1.3,
      size: [1.2, 1.1, 0.7], color: 0xdfe4ea,
      examine: (s) => s.flag('powered')
        ? { title: 'Relay Bank', body: 'The bus hums, live. Power restored across the wing.', widget: { type: 'note' } }
        : {
            title: 'Relay Bank',
            body: 'Nine relays, 1–9, all open. A scratched plate reads:\n\n“The bus closes only for the numbers that answer to nothing but themselves.”',
            widget: {
              type: 'toggle', label: 'ENGAGE',
              options: ['1','2','3','4','5','6','7','8','9'].map((n) => ({ id: n, label: n })),
              answer: ['2', '3', '5', '7'],
              failMessage: 'The bus trips and resets — wrong relays.',
              onSolve: { setFlag: 'powered', openObj: 'lasers', message: 'Bus restored. Corridor lockdown dropping…' },
            },
          },
    },

    // Records desk — the cipher clipboard + the UV penlight to take.
    {
      id: 'desk', label: 'Records Desk', glbKey: 'desk',
      mount: 'floor', pos: [-8.1, 0, -1.6], rotY: -Math.PI / 2, targetSize: 1.6,
      size: [1.5, 0.75, 0.7], color: 0xf2f4f7,
      examine: () => ({
        title: 'Records Desk',
        body: 'A clipboard, scrawled in Vale’s shorthand:\n\n◈   ◆   ❖   ✦\n\n“Reads plainly enough — if you’ve found the light for it.”',
        widget: { type: 'note' },
      }),
    },

    // Wall chronometer — shine the UV light on it to reveal the cipher legend.
    {
      id: 'clock', label: 'Master Chronometer', build: 'clock',
      mount: 'wall', pos: [-5.5, 2.1, -3.94], rotY: 0, targetSize: 0.5,
      use: {
        item: 'uvlight',
        effect: {
          setFlag: 'legendRevealed',
          addClue: { title: 'Cipher legend (UV)', text: '◇=0  ❖=1  ◈=2  ✧=7  ✦=8  ◆=5', visual: { kind: 'note', text: '◇ = 0    ❖ = 1    ◈ = 2\n✧ = 7    ✦ = 8    ◆ = 5' } },
          message: 'Invisible ink blooms across the clock face — a cipher legend.',
        },
      },
      examine: (s) => s.flag('legendRevealed')
        ? { title: 'Master Chronometer', body: 'Under UV, the legend glows on the glass:', visual: { kind: 'note', text: '◇ = 0    ❖ = 1    ◈ = 2\n✧ = 7    ✦ = 8    ◆ = 5' }, widget: { type: 'note' } }
        : { title: 'Master Chronometer', body: 'Stopped. Under the glass, faint marks catch the light — unreadable in this lighting. (Something might make them glow.)', widget: { type: 'note' } },
    },

    // Specimen cabinet — the decoded 4-digit code; holds the Coolant Rod.
    {
      id: 'cabinet', label: 'Specimen Cabinet', glbKey: 'shelf',
      mount: 'floor', pos: [-7.6, 0, 3.55], rotY: Math.PI, targetSize: 2.0,
      size: [0.5, 1.9, 1.1], color: 0xeef1f5,
      examine: (s) => s.flag('cabinetOpen')
        ? { title: 'Specimen Cabinet', body: 'Open and empty now — the Coolant Rod is in your pack.', widget: { type: 'note' } }
        : {
            title: 'Specimen Cabinet',
            body: 'A four-digit cryo-lock.\n\n(The clipboard symbols spell it — once you can read them.)',
            widget: {
              type: 'keypad', answer: '2518', screen: 'SEALED',
              onSolve: {
                setFlag: 'cabinetOpen', give: ['coolant'],
                addClue: { title: 'Coolant Rod', text: 'A coolant rod, still frost-cold. Something in the reactor bay runs too hot without it.' },
                message: 'The cabinet unseals: a Coolant Rod inside.',
              },
            },
          },
    },

    // Lab table — chromatography colour-sequence analyzer.
    {
      id: 'analyzer', label: 'Spectral Analyzer', glbKey: 'table',
      mount: 'floor', pos: [-5, 0, 1.6], rotY: 0, targetSize: 1.7,
      size: [1.6, 0.9, 0.8], color: 0xe6e9ee,
      examine: (s) => s.flag('seqDone')
        ? { title: 'Spectral Analyzer', body: 'Calibrated. Control systems read STABLE.', widget: { type: 'note' } }
        : {
            title: 'Spectral Analyzer',
            body: 'A brass plate, etched: “Set them as the prism bends them, sharpest first — and leave the two it could never cast.”',
            widget: {
              type: 'order',
              options: [
                { id: 'green', label: 'Green', color: '#3fa34d' },
                { id: 'magenta', label: 'Magenta', color: '#c0338f' },
                { id: 'red', label: 'Red', color: '#d23b2e' },
                { id: 'violet', label: 'Violet', color: '#8e44ad' },
                { id: 'orange', label: 'Orange', color: '#e07b2b' },
                { id: 'pink', label: 'Pink', color: '#e88fb0' },
                { id: 'blue', label: 'Blue', color: '#2f6fb0' },
                { id: 'yellow', label: 'Yellow', color: '#e8c53b' },
              ],
              answer: ['violet', 'blue', 'green', 'yellow', 'orange', 'red'],
              onSolve: { setFlag: 'seqDone', message: 'Spectrum resolved. Control systems: STABLE.' },
            },
          },
    },

    // ═══ CORRIDOR ═══════════════════════════════════════════════════════════
    // Laser barrier — a tripwire lattice sealing the corridor until power is cut.
    {
      id: 'lasers', label: 'Laser Barrier', build: 'lasers',
      mount: 'floor', pos: [0, 0, 0], rotY: 0, span: 1.25, block: 1.7,
      examine: () => ({ title: 'Laser Barrier', body: 'A lattice of red tripwire beams seals the corridor — emergency lockdown. Nothing crosses this until the lockdown loses power.', widget: { type: 'note' } }),
    },

    // ═══ REACTOR BAY ════════════════════════════════════════════════════════
    // The Core — centrepiece; flavour.
    {
      id: 'core', label: 'The Core', glbKey: 'machine',
      mount: 'floor', pos: [6, 0, -2.7], rotY: 0, targetSize: 2.4,
      size: [1.6, 2.0, 0.9], color: 0xdfe4ea,
      examine: (s) => s.has('uvlight')
        ? { title: 'The Core', body: 'Vale’s machine, grown vast down here. It pulses, patient, waiting to be fed.', widget: { type: 'note' } }
        : { title: 'The Core', body: 'Vale’s machine, grown vast down here. Clipped to the console lip and long forgotten: a slim UV penlight.', widget: { type: 'action', label: 'Take the UV penlight', onSolve: { setFlag: 'uvTaken', give: ['uvlight'], message: 'UV penlight taken.' } } },
    },

    // Optics array — cool it with the rod, then route the beam to the Core.
    {
      id: 'optics', label: 'Optics Array', glbKey: 'optics',
      mount: 'floor', pos: [3.7, 0, -3.1], rotY: 0.5, targetSize: 1.5,
      size: [1.0, 1.1, 0.9], color: 0xdfe4ea,
      use: { item: 'coolant', effect: { setFlag: 'rodInserted', message: 'The rod seats with a clunk; the emitter cools and powers up.' } },
      examine: (s) => {
        if (!s.flag('rodInserted')) return { title: 'Optics Array', body: 'A beam emitter, lens dark — the housing runs too hot to configure, and a coolant port sits open and empty.', widget: { type: 'note' } };
        if (s.flag('beamAligned')) return { title: 'Optics Array', body: 'The beam holds steady on the Core’s sensor. Charge climbing.', widget: { type: 'note' } };
        return {
          title: 'Optics Array — Beam',
          body: 'The beam drops in from the top. Bend it into the Core’s charge sensor.',
          widget: {
            type: 'beam', cols: 5, rows: 5,
            emitter: { x: 1, y: 0, dir: 'S' }, target: { x: 3, y: 4 },
            cells: [
              { x: 1, y: 2, type: 'mirror', mirror: '/', fixed: false },
              { x: 3, y: 2, type: 'mirror', mirror: '/', fixed: false },
              { x: 0, y: 4, type: 'mirror', mirror: '\\', fixed: true },
              { x: 2, y: 0, type: 'wall' },
              { x: 4, y: 1, type: 'wall' },
            ],
            onSolve: { setFlag: 'beamAligned', message: 'Beam aligned. The Core is charging.' },
          },
        };
      },
    },

    // Containment lock — Mastermind colour code (needs the Core charged first).
    {
      id: 'lock', label: 'Containment Lock', glbKey: 'console',
      mount: 'floor', pos: [7.7, 0, -2.4], rotY: -0.5, targetSize: 1.3,
      size: [1.2, 1.1, 0.7], color: 0xdfe4ea,
      examine: (s) => {
        if (!s.flag('beamAligned')) return { title: 'Containment Lock', body: 'The colour lock is dead. The Core has no charge to give it.', widget: { type: 'note' } };
        if (s.flag('coreCracked')) return { title: 'Containment Lock', body: 'Containment lock: CRACKED. The Core steadies.', widget: { type: 'note' } };
        return {
          title: 'Containment Lock',
          body: 'A four-slot colour lock.\n\nContainment log: “the sequence opens with VIOLET.”\n\nGuess and read the feedback — ● right colour & slot, ○ right colour, wrong slot.',
          widget: {
            type: 'mastermind', slots: 4, maxGuesses: 8,
            colors: [
              { id: 'red', color: '#c0392b', label: 'Red' },
              { id: 'blue', color: '#2f6fb0', label: 'Blue' },
              { id: 'green', color: '#3fa34d', label: 'Green' },
              { id: 'amber', color: '#d99a2b', label: 'Amber' },
              { id: 'violet', color: '#8e44ad', label: 'Violet' },
              { id: 'teal', color: '#16a3a3', label: 'Teal' },
            ],
            answer: ['violet', 'teal', 'amber', 'red'],
            onSolve: { setFlag: 'coreCracked', message: 'Containment lock CRACKED. Down the bay, the cryo cradles hum awake.' },
          },
        };
      },
    },

    // Four cryo pods — dark until the containment lock (Mastermind) powers them;
    // gating them keeps their colour clues from being mistaken for the lock's.
    {
      id: 'pod1', label: 'Cryo-Pod', glbKey: 'cryopod',
      mount: 'floor', pos: [3.6, 0, 3.4], rotY: Math.PI, targetSize: 1.9,
      size: [0.9, 2.0, 0.7], color: 0xeef1f5,
      examine: (s) => s.flag('coreCracked')
        ? { title: 'Cryo-Pod', body: 'The cradle glows to life. A tag lights on the frame:\n\n“GREEN occupies the far-left cradle.”', widget: { type: 'note' } }
        : { title: 'Cryo-Pod', body: 'Dark and frost-blind. No charge reaches the cradle yet — the bay’s systems are still sealed.', widget: { type: 'note' } },
    },
    {
      id: 'pod2', label: 'Cryo-Pod', glbKey: 'cryopod',
      mount: 'floor', pos: [5.1, 0, 3.4], rotY: Math.PI, targetSize: 1.9,
      size: [0.9, 2.0, 0.7], color: 0xeef1f5,
      examine: (s) => s.flag('coreCracked')
        ? { title: 'Cryo-Pod', body: 'The cradle hums awake. A tag:\n\n“AMBER rests directly left of BLUE.”', widget: { type: 'note' } }
        : { title: 'Cryo-Pod', body: 'Dark and frost-blind. No charge reaches the cradle yet — the bay’s systems are still sealed.', widget: { type: 'note' } },
    },
    {
      id: 'pod3', label: 'Cryo-Pod', glbKey: 'cryopod',
      mount: 'floor', pos: [6.6, 0, 3.4], rotY: Math.PI, targetSize: 1.9,
      size: [0.9, 2.0, 0.7], color: 0xeef1f5,
      examine: (s) => s.flag('coreCracked')
        ? { title: 'Cryo-Pod', body: 'The cradle glows to life. A tag:\n\n“CRIMSON is not in the far-right cradle.”', widget: { type: 'note' } }
        : { title: 'Cryo-Pod', body: 'Dark and frost-blind. No charge reaches the cradle yet — the bay’s systems are still sealed.', widget: { type: 'note' } },
    },
    {
      id: 'pod4', label: 'Cryo-Pod', glbKey: 'cryopod',
      mount: 'floor', pos: [8.1, 0, 3.4], rotY: Math.PI, targetSize: 1.9,
      size: [0.9, 2.0, 0.7], color: 0xeef1f5,
      examine: (s) => s.flag('coreCracked')
        ? { title: 'Cryo-Pod', body: 'A control log lights on the frame:\n\n“Four subjects, four colours, four cradles — left to right. The blast door wants their colours in cradle order.”', widget: { type: 'note' } }
        : { title: 'Cryo-Pod', body: 'Dark and frost-blind. No charge reaches the cradle yet — the bay’s systems are still sealed.', widget: { type: 'note' } },
    },

    // Blast door — gated on the three systems; colour order, then the finale.
    {
      id: 'door', label: 'Blast Door', glbKey: 'door',
      mount: 'floor', pos: [9.85, 0, 0], rotY: -Math.PI / 2, targetSize: 2.4,
      size: [1.3, 2.4, 0.14], color: 0xdfe4ea, block: 0.5,
      examine: (s) => {
        if (s.flag('escaped')) return { title: 'Blast Door', body: 'The bolts are blown. The way out is open.', widget: { type: 'note' } };
        if (!(s.flag('seqDone') && s.flag('beamAligned') && s.flag('coreCracked'))) {
          const bad = [];
          if (!s.flag('seqDone')) bad.push('· CONTROL ANALYZER — unstable');
          if (!s.flag('beamAligned')) bad.push('· OPTICS / CORE CHARGE — offline');
          if (!s.flag('coreCracked')) bad.push('· CONTAINMENT LOCK — sealed');
          return { title: 'Blast Door', body: 'EMERGENCY RELEASE — offline.\nSystems still unstable:\n\n' + bad.join('\n'), widget: { type: 'note' } };
        }
        if (!s.flag('doorReleased')) {
          return {
            title: 'Blast Door — Release Panel',
            body: 'Four colour dials. Set them to the cradle colours, in cradle order (left → right).',
            widget: {
              type: 'order', options: CRADLE,
              answer: ['green', 'crimson', 'amber', 'blue'],
              onSolve: { setFlag: 'doorReleased', message: 'Correct. Bolts disengaging…' },
            },
          };
        }
        if (!s.flag('finalAnswered')) {
          return {
            title: 'Blast Door',
            body: 'The Core stirs. A question crawls across the panel:\n\nWHO WALKS OUT OF SUB-LEVEL 7?',
            widget: {
              type: 'choice',
              options: [
                { id: 'sub02', label: 'Subject 02' },
                { id: 'vale', label: 'Elias Vale' },
                { id: 'noone', label: 'No one — seal it' },
              ],
              answer: 'sub02',
              onSolve: { setFlag: 'finalAnswered', message: '…Yes. You were never here to escape.', ending: true },
            },
          };
        }
        return { title: 'Blast Door', body: 'The door grinds open.', widget: { type: 'note' } };
      },
    },
  ],

  // ── Inventory ──────────────────────────────────────────────────────────────
  items: {
    uvlight: { label: 'UV Penlight', glyph: '🔦', note: 'A UV penlight. It makes invisible ink glow.' },
    coolant: { label: 'Coolant Rod', glyph: '🧊', note: 'A frost-cold coolant rod. Something in the reactor runs too hot.' },
  },

  // ── Hints: cryptic nudges only — no object names, no answers ───────────────
  hints: [
    { id: 'h0', name: 'The power relays', tiers: [
      'The plate wants numbers that keep no company but one and themselves.',
      'The indivisible few, somewhere between 1 and 9.',
    ] },
    { id: 'h1', name: 'The shorthand', tiers: [
      'Symbols are noise without their key — and some ink only answers to the right kind of light.',
      'Vale left the key on a face that stopped keeping time. Read the shorthand through it.',
    ] },
    { id: 'h2', name: 'The spectral analyzer', tiers: [
      'A prism plays favourites — it throws some colours harder than others.',
      'Not every colour here is one a prism could ever make; the rest go by their bend.',
    ] },
    { id: 'h3', name: 'The optics beam', tiers: [
      'Only the glowing mirrors turn — and they want to agree with each other.',
      'Lean them the same way to walk the beam down, across, then down again.',
    ] },
    { id: 'h4', name: 'The containment lock', tiers: [
      'It opens on the colour the log already named. The lock answers every guess — learn to read it.',
      'A filled mark is right and placed; a hollow one is right but misplaced. Nothing repeats.',
    ] },
    { id: 'h5', name: 'The blast door', tiers: [
      'The cradles carry the order — read every pod before you touch the dials.',
      'One anchors the left, one is barred from the right, and two are bound as neighbours.',
    ] },
  ],
};
