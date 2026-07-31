import { startRoom } from './engine.js';
import { room1 } from './rooms/room1.js';
import { room2 } from './rooms/room2.js';

// The room roster. Add a new room module here and it appears on the select screen.
const ROOMS = [room1, room2];

const menuEl = document.getElementById('menu');
const cardsEl = document.getElementById('roomcards');

const ACCENTS = ['#4fd1e0', '#b98cff', '#ffcf6b'];
const ICONS = ['⚗️', '🔬', '🧬'];

function launch(room) {
  menuEl.classList.remove('open');
  startRoom(room);
}

ROOMS.forEach((room, i) => {
  const m = room.menu || {};
  const card = document.createElement('div');
  card.className = 'roomcard playable';
  card.innerHTML = `
    <div class="banner">
      <div class="glow" style="background:${ACCENTS[i % ACCENTS.length]}"></div>
      <span class="num">${m.number || String(i + 1).padStart(2, '0')}</span>
      ${m.tag ? `<span class="tag">${m.tag}</span>` : ''}
      <span class="icon">${ICONS[i % ICONS.length]}</span>
    </div>
    <div class="rc-body">
      <h3>${room.title}</h3>
      <div class="rc-subtitle">${m.subtitle || ''}</div>
      <div class="rc-blurb">${m.blurb || ''}</div>
      <div class="rc-meta">${[m.time, m.difficulty].filter(Boolean).map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="rc-play">ENTER ROOM ▸</div>
    </div>`;
  card.addEventListener('click', () => launch(room));
  cardsEl.appendChild(card);
});

// A locked placeholder for the next room, so the roster reads as a series.
const locked = document.createElement('div');
locked.className = 'roomcard locked';
locked.innerHTML = `
  <div class="banner"><span class="num">03</span><span class="icon">🔒</span></div>
  <div class="rc-body">
    <h3>Room 03 — ??????</h3>
    <div class="rc-subtitle">Classified</div>
    <div class="rc-blurb">Recovery in progress. This room has not been declassified yet.</div>
    <div class="rc-meta"><span>coming soon</span></div>
    <div class="rc-play">LOCKED</div>
  </div>`;
cardsEl.appendChild(locked);

// Dev shortcuts (#play/#solve/#books/…) skip the menu and boot straight in.
// #room2 (or #walk) boots the walkable sandbox for movement testing.
if (/room2|walk/.test(location.hash)) launch(room2);
else if (/play|open|solve|swept|books/.test(location.hash)) launch(ROOMS[0]);
