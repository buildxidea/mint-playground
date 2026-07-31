// ── ROOM 1 · THE FORGOTTEN EXPERIMENT ────────────────────────────────────────
// Pure data + declarative examine specs. The engine (src/engine.js) renders every
// widget/visual type and applies every effect, so a whole new room is just another
// file shaped like this one.
//
// examine(state) → { title, body?, visual?, requires?, widget? }
//   visual : { kind:'clock'|'photo'|'page'|'note'|'poster', … }   a rendered document
//   widget : 'note' | 'lock2' | 'keypad' | 'order' | 'choice'
// use    : { item, effect }   clicking the object while `item` is EQUIPPED runs effect
// books  : { defs, order, answer, onSolve }   turns the object into the 3D arrange puzzle
// effect/onSolve/onUse payloads → { give, setFlag, reveal:{pos,value}, addClue, message, ending }
//
// state = { has(item), flag(name), solved(id) }

const PAGE_VISUAL = {
  kind: 'page',
  lines: ['Trial 23 was different.', 'The machine reacted to color.', 'Cold before heat.', 'Life before death.'],
  circled: '23',
};
const PHOTO_VISUAL = {
  kind: 'photo', date: 'Oct 14',
  back: ['The day everything changed.', 'If this works, I will be the first to cross.'],
};

export const room1 = {
  id: 'room1',
  title: 'The Forgotten Experiment',
  code: '7148',
  codeSources: ['bottles', 'computer', 'cells', 'final'],

  // shown on the room-select screen
  menu: {
    number: '01',
    subtitle: 'Abandoned Laboratory',
    tag: 'SECTOR 7',
    time: '15–25 min',
    difficulty: 'Easy–Medium',
    blurb: 'Dr. Elias Vale vanished mid-experiment. Reconstruct his work, find the four-digit release code, and get out — before the machine finishes waking up.',
  },

  intro: {
    tag: 'ABANDONED LABORATORY · SECTOR 7',
    speaker: 'DR. ELIAS VALE — RECOVERED RECORDING',
    lines: [
      'If you are hearing this, the experiment has failed.',
      'The laboratory has entered emergency lockdown.',
      'I separated the exit code into four stages, so no one could activate the machine accidentally.',
      'Follow my work. Find the code. And whatever you do… do not restart the experiment.',
    ],
    button: 'Wake up',
  },

  ending: {
    lines: ['Wait.', 'You finished the sequence.', 'That means the machine is active again.', 'Please… don’t leave me here.'],
    speaker: 'DR. VALE — DISTORTED',
    escaped: 'ESCAPED',
    sting: 'SUBJECT 02 DETECTED',
  },

  // ── Interactable objects ───────────────────────────────────────────────────
  objects: [
    // ── EXIT DOOR ────────────────────────────────────────────────────────────
    {
      id: 'door', label: 'Exit Door', glbKey: 'door',
      mount: 'floor', pos: [2.92, 0, 0.2], rotY: -Math.PI / 2, targetSize: 2.2,
      size: [1.3, 2.2, 0.14], color: 0xdfe4ea,
      examine: (s) => ({
        title: 'Emergency Exit',
        body: s.flag('escaped')
          ? 'The bolts have released. The way out is open.'
          : 'A heavy blast door. A keypad glows beside it:\n\nEMERGENCY LOCKDOWN\nENTER FOUR-DIGIT RELEASE CODE',
        widget: s.flag('escaped') ? null : {
          type: 'keypad', answer: '7148', screen: 'LOCKDOWN',
          onSolve: { setFlag: 'escaped', message: 'RELEASE CODE ACCEPTED. Bolts disengaging…', ending: true },
        },
      }),
    },

    // ── WALL CLOCK (code-built, readable face frozen at 8:25) ─────────────────
    {
      id: 'clock', label: 'Wall Clock', build: 'clock',
      mount: 'wall', pos: [-2.94, 2.05, -1.7], rotY: Math.PI / 2, targetSize: 0.5,
      examine: () => ({
        title: 'Wall Clock',
        body: 'The clock has stopped.',
        visual: { kind: 'clock' },
        widget: { type: 'note' },
      }),
    },

    // ── BULLETIN BOARD (pinned note) ─────────────────────────────────────────
    {
      id: 'bulletin', label: 'Bulletin Board', build: 'bulletin',
      mount: 'wall', pos: [-2.92, 1.55, 0.95], rotY: Math.PI / 2, targetSize: 1.0,
      examine: () => ({
        title: 'Bulletin Board',
        body: 'A note is pinned to the cork:',
        visual: { kind: 'note', text: 'The experiment always begins when time stops.' },
        widget: { type: 'note' },
      }),
    },

    // ── POSTER (the book-order clue, on the wall by the shelf) ────────────────
    {
      id: 'poster', label: 'Poster', build: 'poster',
      mount: 'wall', pos: [-1.75, 1.75, -2.94], rotY: 0, targetSize: 1.0,
      examine: () => ({
        title: 'Faded Poster',
        body: 'A poster pinned to the wall beside the shelf:',
        visual: { kind: 'poster' },
        widget: { type: 'note' },
      }),
    },

    // ── DESK + DRAWER ────────────────────────────────────────────────────────
    {
      id: 'desk', label: 'Research Desk', glbKey: 'desk',
      mount: 'floor', pos: [-1.5, 0, 2.15], rotY: Math.PI, targetSize: 1.5,
      size: [1.5, 0.75, 0.7], color: 0xf2f4f7,
      examine: (s) => s.flag('drawerOpen')
        ? { title: 'Desk Drawer', body: 'The note that was tucked in the drawer:', visual: { kind: 'note', text: 'What’s hidden here isn’t gone. It’s only buried under dust.' }, widget: { type: 'note' } }
        : {
            title: 'Desk Drawer',
            body: 'A small two-digit lock holds the drawer shut.',
            widget: {
              type: 'lock2', answer: '85',
              onSolve: {
                setFlag: 'drawerOpen', give: ['sweeper', 'key'],
                addClue: { title: 'Note from the drawer', text: 'What’s hidden here isn’t gone. It’s only buried under dust.', visual: { kind: 'note', text: 'What’s hidden here isn’t gone. It’s only buried under dust.' } },
                message: 'The drawer slides open: a dust sweeper, a small key, and a note.',
              },
            },
          },
    },

    // ── COMPUTER ─────────────────────────────────────────────────────────────
    {
      id: 'computer', label: 'Computer Terminal', glbKey: 'computer',
      mount: 'surface', pos: [-1.95, 0.75, 2.2], rotY: Math.PI, targetSize: 0.55,
      size: [0.5, 0.45, 0.4], color: 0xe8ebf0,
      examine: (s) => s.flag('computerUnlocked')
        ? {
            title: 'Computer — Files',
            body: 'EXPERIMENT NOTES\n“The machine requires four power cells. Only one configuration is stable.”\n\nASSISTANT MESSAGE\n“Elias, you keep forgetting the sequence. Start with the smallest value. End with the largest.”\n\nEMERGENCY PROTOCOL\nSECOND EXIT DIGIT: 1',
            widget: { type: 'note' },
          }
        : {
            title: 'Computer Terminal',
            body: 'PASSWORD REQUIRED — four digits.\n\n(A date was written on the back of something the box was hiding.)',
            widget: {
              type: 'keypad', answer: '1014', screen: 'LOCKED',
              onSolve: {
                setFlag: 'computerUnlocked', reveal: { pos: 1, value: '1' },
                addClue: { title: 'Assistant’s message', text: 'Start with the smallest value. End with the largest. — the power cells.', visual: { kind: 'note', text: 'Start with the smallest value. End with the largest.' } },
                message: 'ACCESS GRANTED. SECOND EXIT DIGIT: 1. Something latches open beneath the desk lamp.',
              },
            },
          },
    },

    // ── DESK LAMP (flavor + micro-hint after computer unlock) ────────────────
    {
      id: 'lamp', label: 'Desk Lamp', glbKey: 'lamp',
      mount: 'surface', pos: [-1.05, 0.75, 2.2], rotY: Math.PI, targetSize: 0.5,
      size: [0.25, 0.5, 0.25], color: 0xf2f4f7,
      examine: (s) => s.flag('computerUnlocked')
        ? { title: 'Desk Lamp', body: 'The compartment beneath the base has sprung open — empty, but for dust and old scratches.', widget: { type: 'note' } }
        : { title: 'Desk Lamp', body: 'An articulated task lamp, bolted to the desk. Something is latched beneath the base, but it won’t release yet.', widget: { type: 'note' } },
    },

    // ── BOOKSHELF (dust → 3D drag-to-reorder puzzle) ─────────────────────────
    {
      id: 'shelf', label: 'Bookshelf', glbKey: 'shelf', build: 'books',
      mount: 'floor', pos: [-2.55, 0, -0.6], rotY: Math.PI / 2, targetSize: 1.8,
      size: [0.5, 1.8, 1.0], color: 0xeef1f5,
      // equip the sweeper and click the shelf to clear the dust
      use: {
        item: 'sweeper',
        effect: { setFlag: 'booksSwept', message: 'You sweep away years of dust. Four book spines, now legible.' },
      },
      // the 3D book minigame; solving it awards the journal page
      books: {
        defs: {
          psych: { subject: 'Psychology', color: '#8f5fae' }, // the mind
          bio: { subject: 'Biology', color: '#5f9a55' },      // the body
          chem: { subject: 'Chemistry', color: '#c0743c' },   // matter
          astro: { subject: 'Astronomy', color: '#4f74a8' },  // the stars
        },
        order: ['bio', 'astro', 'psych', 'chem'], // initial (scrambled) left→right
        answer: ['psych', 'bio', 'chem', 'astro'], // mind, body, matter, stars
        onSolve: {
          setFlag: 'booksSolved',
          addClue: { title: 'Torn journal page', text: 'Trial 23 was different. The machine reacted to color. Cold before heat. Life before death.', visual: PAGE_VISUAL },
          message: 'The spines align. A compartment clicks open — a torn journal page inside.',
        },
      },
      examine: (s) => {
        if (s.flag('booksSolved')) return { title: 'Bookshelf', body: 'The torn journal page from the compartment:', visual: PAGE_VISUAL, widget: { type: 'note' } };
        if (!s.flag('booksSwept')) return { title: 'Bookshelf', body: 'It’s kind of dusty in here — you can’t make out the books at all.', widget: { type: 'note' } };
        return { title: 'Bookshelf', body: 'Four books, free of dust.', widget: { type: 'note' } };
      },
    },

    // ── LAB TABLE + CHEMICAL BOTTLES ─────────────────────────────────────────
    {
      id: 'table', label: 'Lab Table', glbKey: 'table',
      mount: 'floor', pos: [1.7, 0, 0.5], rotY: 0, targetSize: 1.6,
      size: [1.6, 0.9, 0.8], color: 0xe6e9ee,
      build: 'bottles',
      examine: (s) => {
        if (s.flag('bottlesSolved')) return { title: 'Chemical Bottles', body: 'The bottles sit in their accepted order. The control panel still reads: FIRST EXIT DIGIT: 7.', widget: { type: 'note' } };
        if (!s.flag('booksSolved')) return { title: 'Chemical Bottles', body: 'Four sealed bottles — blue, red, green, black. Without the intended order, arranging them does nothing.', widget: { type: 'note' } };
        return {
          title: 'Chemical Bottles',
          body: 'Four sealed bottles. Set them in order.',
          widget: {
            type: 'order',
            options: [
              { id: 'blue', label: 'Blue', color: '#3a86ff' },
              { id: 'red', label: 'Red', color: '#ff4d5e' },
              { id: 'green', label: 'Green', color: '#38b000' },
              { id: 'black', label: 'Black', color: '#2b2d33' },
            ],
            answer: ['blue', 'red', 'green', 'black'],
            onSolve: { setFlag: 'bottlesSolved', reveal: { pos: 0, value: '7' }, message: 'SAMPLE ORDER ACCEPTED. FIRST EXIT DIGIT: 7' },
          },
        };
      },
    },

    // ── METAL LOCKBOX (equip the key to open) ────────────────────────────────
    {
      id: 'lockbox', label: 'Metal Lockbox', glbKey: 'lockbox',
      mount: 'surface', pos: [1.55, 0.9, 0.85], rotY: -0.4, targetSize: 0.32,
      size: [0.32, 0.2, 0.24], color: 0xb8bcc4,
      use: {
        item: 'key',
        effect: {
          setFlag: 'boxOpen', give: ['fuse'],
          addClue: { title: 'Photograph', text: 'Dr. Vale and his assistant. On the back: October 14 — “The day everything changed.” “If this works, I will be the first to cross.”', visual: PHOTO_VISUAL },
          message: 'The key turns. Inside: a photograph and a fuse.',
        },
      },
      examine: (s) => s.flag('boxOpen')
        ? { title: 'Metal Lockbox', body: 'The photograph you found inside:', visual: PHOTO_VISUAL, widget: { type: 'note' } }
        : { title: 'Metal Lockbox', body: 'The box is locked. It needs a small key — if you have one, equip it and use it here.', widget: { type: 'note' } },
    },

    // ── EXPERIMENT MACHINE (equip fuse to power; then cells; then final) ──────
    {
      id: 'machine', label: 'Experiment Machine', glbKey: 'machine',
      mount: 'floor', pos: [0, 0, -2.35], rotY: 0, targetSize: 2.0,
      size: [1.6, 2.0, 0.9], color: 0xdfe4ea,
      use: {
        item: 'fuse',
        effect: { setFlag: 'fuseInserted', message: 'The machine shudders and hums awake. Four power cells light up.' },
      },
      examine: (s) => {
        if (s.flag('cellsSolved') && !s.flag('finalAnswered')) {
          return {
            title: 'Experiment Machine',
            body: 'The monitor asks a question, as if it already knows:\n\nWHAT HAPPENED TO DR. VALE?',
            widget: {
              type: 'choice',
              options: [
                { id: 'escaped', label: 'He escaped.' },
                { id: 'killed', label: 'He was killed.' },
                { id: 'entered', label: 'He entered the machine.' },
              ],
              answer: 'entered',
              onSolve: { setFlag: 'finalAnswered', reveal: { pos: 3, value: '8' }, message: 'CORRECT. SUBJECT VALE: LOCATION UNKNOWN. FINAL EXIT DIGIT: 8' },
            },
          };
        }
        if (s.flag('finalAnswered')) return { title: 'Experiment Machine', body: 'The chamber glows a faint, patient blue. It is waiting for something.', widget: { type: 'note' } };
        if (s.flag('fuseInserted') && !s.flag('cellsSolved')) {
          return {
            title: 'Experiment Machine — Power Cells',
            body: 'Four power cells wait to be activated.',
            widget: {
              type: 'order',
              options: [
                { id: 'a', label: 'Cell A', color: '#8ea2b5', tag: '6' },
                { id: 'b', label: 'Cell B', color: '#8ea2b5', tag: '2' },
                { id: 'c', label: 'Cell C', color: '#8ea2b5', tag: '8' },
                { id: 'd', label: 'Cell D', color: '#8ea2b5', tag: '4' },
              ],
              answer: ['b', 'd', 'a', 'c'], // 2,4,6,8
              onSolve: { setFlag: 'cellsSolved', reveal: { pos: 2, value: '4' }, message: 'POWER RESTORED. THIRD EXIT DIGIT: 4' },
            },
          };
        }
        return { title: 'Experiment Machine', body: 'The machine has no power. A fuse port sits empty in the console.\n\n(If you have a fuse, equip it and use it here.)', widget: { type: 'note' } };
      },
    },
  ],

  // ── Inventory items (click to equip, then click an object to use) ───────────
  items: {
    sweeper: { label: 'Dust Sweeper', glyph: '🧹', note: 'A stiff brush for clearing away dust.' },
    key: { label: 'Small Key', glyph: '🗝️', note: 'A small key. It opens more than a drawer.' },
    fuse: { label: 'Fuse', glyph: '🔋', note: 'A power fuse. The machine is missing one.' },
  },

  // ── Hint system: 3 tiers per puzzle ────────────────────────────────────────
  hints: [
    { id: 'p1', name: 'The locked drawer', tiers: [
      'Look for something in the room that has stopped.',
      'The clock shows two useful numbers — an hour and a minute mark.',
      'Enter 85 on the desk drawer’s two-digit lock.',
    ] },
    { id: 'p2', name: 'The books', tiers: [
      'Something on the shelf is buried in dust — you’ll need to clear it. Equip the sweeper and use it on the shelf.',
      'The poster by the shelf gives the order: the mind, the body, matter, the stars.',
      'Drag the books into: Psychology, Biology, Chemistry, Astronomy.',
    ] },
    { id: 'p3', name: 'The bottles', tiers: [
      'The journal page describes colors without naming them.',
      'Cold is blue, heat is red; life is green, death is black.',
      'Select the bottles: Blue, Red, Green, Black. First digit is 7.',
    ] },
    { id: 'p4', name: 'The lockbox & computer', tiers: [
      'Equip the key from the drawer and use it on the metal box; then check the photo.',
      'The date on the photograph is the computer password.',
      'The computer password is 1014. Second digit is 1.',
    ] },
    { id: 'p5', name: 'The machine', tiers: [
      'Equip the fuse from the box and use it on the machine, then read the computer’s files.',
      'Activate the power cells from the smallest value to the largest.',
      'Order the cells 2, 4, 6, 8. Third digit is 4. Then answer the machine honestly — he entered it. Fourth digit is 8.',
    ] },
  ],
};
