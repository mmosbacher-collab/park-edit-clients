#!/usr/bin/env node
/**
 * generate-park-edit.js
 * Session 3 · The Park Edit automation
 *
 * Takes an intake JSON file, runs the schedule builder, then
 * performs a string-replace pass over park-edit-shell.html
 * to produce a deployable client Park Edit file.
 *
 * Usage:
 *   node generate-park-edit.js path/to/intake.json
 *
 * Output:
 *   /[lastname]/park-edit/[lastname]-park-edit-v1.html
 *
 * Rules:
 *   - All ride/character copy comes from library.json. Missing entry → throw.
 *   - CSS and JS architecture in the shell are never modified.
 *   - HTML structure must match the shell exactly.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Paths ────────────────────────────────────────────────────────────────────
const __dir = '/home/claude';
const SHELL_PATH   = path.join(__dir, 'park-edit-shell.html');
const LIBRARY_PATH = path.join(__dir, 'library.json');
const WK_PATH      = path.join(__dir, 'wk-library.json');
const SCHED_PATH   = path.join(__dir, 'schedule-builder.js');

// ─── Park metadata ────────────────────────────────────────────────────────────
const PARK_META = {
  MK:  { emoji: '🏰', name: 'Magic Kingdom',      short: 'Magic Kingdom' },
  EP:  { emoji: '🌍', name: 'EPCOT',              short: 'EPCOT'         },
  DHS: { emoji: '🎬', name: 'Hollywood Studios',  short: 'Hollywood'     },
  AK:  { emoji: '🦁', name: 'Animal Kingdom',     short: 'Animal K.'     },
};

const PARK_CODE = {
  'Magic Kingdom':    'MK',
  'EPCOT':            'EP',
  'Hollywood Studios': 'DHS',
  'Animal Kingdom':   'AK',
};

// Short weekday + month labels
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Google Maps SVG icon ─────────────────────────────────────────────────────
const MAPS_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="var(--sky)" opacity="0.25"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

const MAPS_SVG_SM = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="var(--sky)" opacity="0.25"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Escape single quotes for inline JS strings. */
function jsEsc(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Camel-case a kebab id: ep-frozen-ever-after → epFrozenEverAfter */
function camelKey(id) {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Parse a date string like "2026-05-19" into a Date (UTC). */
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format "May 19" from a date string. */
function fmtMonthDay(str) {
  const d = parseDate(str);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Format "Tue" from a date string. */
function fmtWeekday(str) {
  return WEEKDAYS[parseDate(str).getUTCDay()];
}

/** Convert "9am" → "9:00a", "8:15a" → "8:15a". Handles schedule-builder output. */
function normalizeTime(t) {
  if (!t) return '';
  return t; // schedule-builder already outputs short format
}

/** Build a Maps URL: comgooglemaps://?q= */
function mapsUrl(query) {
  return `comgooglemaps://?q=${encodeURIComponent(query).replace(/%20/g, '+')}`;
}

/** iconClass for a drawer entry based on type and tags. */
function iconClass(entry) {
  if (!entry) return 'icon-sky';
  if (entry.type === 'character')  return 'icon-sky';
  if (entry.type === 'dining')     return 'icon-gold';
  if ((entry.tags || []).includes('top-pick')) return 'icon-tc';
  if ((entry.tags || []).includes('optional')) return 'icon-sky';
  return 'icon-tc';
}

/** Detect infant or toddler in party (under 18 months or under 2 years). */
function hasInfantOrToddler(intake) {
  return intake.people.some(p => {
    if (p.ageUnit === 'months') {
      const mo = parseInt(p.age, 10);
      return !isNaN(mo) && mo < 24;
    }
    if (p.ageUnit === 'weeks') return true;
    if (p.ageUnit === 'years') {
      const yr = parseInt(p.age, 10);
      return !isNaN(yr) && yr < 2;
    }
    return false;
  });
}

/** Bag list: infant/toddler vs standard. */
function buildBagList(intake) {
  const infant = hasInfantOrToddler(intake);
  const parks = (intake.parkDays || []).map(d => d.park || '');
  const hasWetRide = parks.some(p => p === 'Magic Kingdom' || p === 'Animal Kingdom');
  const wetRideText = hasWetRide
    ? 'Gallon trash bags, one per person — skip the ponchos for rain, and wear them on ' +
      (parks.includes('Magic Kingdom') && parks.includes('Animal Kingdom')
        ? "Tiana's Bayou Adventure and Kali River Rapids"
        : parks.includes('Magic Kingdom')
          ? "Tiana's Bayou Adventure"
          : "Kali River Rapids")
    : 'Gallon trash bags, one per person — skip the ponchos; these do the same job for Florida rain';
  if (infant) {
    return [
      'Diapers (at least 2 per park hour)',
      'Wipes',
      'Change of clothes for baby',
      'Extra outfit for you (blowouts happen)',
      'Portable diaper mat',
      'Sunscreen — reef-safe, baby formula',
      'Baby carrier',
      'Pacifier (x2)',
      'Snacks for baby',
      'Formula or breast milk with ice pack',
      'Portable fan',
      'Hat for baby',
      'Small toy or teether',
      'Plastic bags (diaper disposal)',
      'Phone charger or battery pack',
      'Sunglasses',
      'Cash and cards',
      'ID',
    ];
  } else {
    // Standard adult list — confirmed by Meredith, Session 3
    return [
      'Sunscreen and SPF chapstick — reapply mid-day',
      'Water bottles',
      'Snacks — you can bring anything into the parks',
      'Portable charger — MDE running all day drains your phone fast',
      'Sanitizing wipes',
      'One change of clothes per kid — within reach, not at the bottom',
      'Neck fan — one per adult minimum',
      'Ear protection for the kids — rides are genuinely loud',
      'Bandaids — specifically for blisters, keep them at the top',
      'Cash or card easily accessible',
      '2 Ziploc bags — somehow always necessary with small children',
      wetRideText,
    ];
  }
}

// ─── Name extraction ──────────────────────────────────────────────────────────

/** Build CLIENT_TITLE from last name(s) of adult party members.
 *  Only includes people with multi-word names (i.e., have a last name).
 *  Deduplicates last names (e.g., a family sharing a surname). */
function clientTitle(intake) {
  const adults = intake.people.filter(p => p.role !== 'Child');
  const lastNames = [...new Set(
    adults
      .map(p => {
        const parts = (p.name || '').trim().split(' ');
        // Skip single-word names (babysitters listed as first name only)
        if (parts.length < 2) return null;
        return parts[parts.length - 1];
      })
      .filter(Boolean)
  )];
  // If no multi-word names found, fall back to first adult's first name
  if (!lastNames.length) {
    const first = adults[0];
    return first ? (first.name || '').trim().split(' ')[0] : 'Client';
  }
  return lastNames.join(' ');
}

/** BRAND_FAMILY: "The [LastName(s)] Family" */
/** BRAND_FAMILY: primary client names (role "" or "Child").
 *  Rendered in the DM Mono terracotta label above the logo.
 *  e.g. "Silvia, George & Isabella"
 */
function brandFamily(intake) {
  const people = intake.people || [];

  const isCompanion = p =>
    p.role === 'Extended family' ||
    p.role === 'Babysitter' ||
    (p.likes || '').toLowerCase().includes('babysitter');

  const primary = people.filter(p => !isCompanion(p));
  const firstName = p => (p.name || '').trim().split(' ')[0];
  const names = primary.map(firstName).filter(Boolean);

  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
}

/** BRAND_TAGLINE: traveling companions line below the logo.
 *  "with Ana & Nemanja" — empty string if no companions.
 */
function brandTagline(intake) {
  const people = intake.people || [];

  const isCompanion = p =>
    p.role === 'Extended family' ||
    p.role === 'Babysitter' ||
    (p.likes || '').toLowerCase().includes('babysitter');

  const companions = people.filter(p => isCompanion(p));
  if (!companions.length) return '';

  // Adults (no age or age >= 18) before children
  const isAdult = p => !p.age || (p.ageUnit === 'years' && parseInt(p.age, 10) >= 18);
  const sorted = [
    ...companions.filter(p => isAdult(p)),
    ...companions.filter(p => !isAdult(p)),
  ];

  const firstName = p => (p.name || '').trim().split(' ')[0];
  const names = sorted.map(firstName).filter(Boolean);

  const formatted = names.length <= 1
    ? names[0]
    : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];

  return `with ${formatted}`;
}

// ─── Boarding-pass copy ───────────────────────────────────────────────────────

/** Per-park boarding-pass summary from hand-curated reference or fallback. */
const BP_COPY = {
  // These are generated from the Mosbacher reference — in full automation
  // they'll be pulled from intake intel notes or a copy library.
  // For now, a fallback that is clearly a generator placeholder.
  _fallback: {
    dayName: (park) => `Day at ${park}`,
    summary: (park) => `Your personalized ${park} guide. Tap any item for details.`,
  },
};

/**
 * Build bp-day-name and bp-summary from intel global notes.
 * In the absence of a per-park copy block, extracts the first
 * two sentences of the rope drop notes for that park.
 */
function bpCopy(parkCode, parkDay, intake, dayIndex) {
  // Attempt to extract from intel global notes
  const globalNotes = (intake.intelligence && intake.intelligence.globalNotes) || '';
  const parkFull = { MK: 'Magic Kingdom', EP: 'EPCOT', DHS: 'DHS', AK: 'AK' }[parkCode] || parkCode;

  // Pull the block for this park from global notes
  const parkBlocks = globalNotes.split(/\n\n/).filter(Boolean);
  const block = parkBlocks.find(b => b.toLowerCase().startsWith(parkFull.toLowerCase()) || b.toLowerCase().startsWith(parkCode.toLowerCase()));

  let dayName = `Day ${['One','Two','Three','Four'][dayIndex] || dayIndex + 1} · ${PARK_META[parkCode].name}`;
  let summary = `Tap any item for details and directions.`;

  if (block) {
    const lines = block.split('\n').filter(Boolean);
    // Try rope drop notes line
    const rdLine = lines.find(l => l.toLowerCase().startsWith('rope drop notes:'));
    if (rdLine) {
      summary = rdLine.replace(/^rope drop notes:\s*/i, '').trim();
    }
    // Try to build a catchy day name from LL line
    const llLine = lines.find(l => l.toLowerCase().startsWith('ll adjustments:'));
    if (llLine) {
      dayName = dayName; // keep park-based name; headline is curated, not generated
    }
  }

  return { dayName, summary };
}

// ─── Timeline HTML ────────────────────────────────────────────────────────────

/** Build the Google Maps dir-btn HTML. */
function dirBtn(query) {
  return `<button class="dir-btn" onclick="event.stopPropagation();window.location='${mapsUrl(query)}';">${MAPS_SVG}</button>`;
}

/** Render a single tl-item. */
function renderTLItem(item, dayIndex) {
  const fixed    = item.fixed;
  const cls      = fixed ? 'fixed' : 'optional';
  const stepBtns = fixed
    ? `<div class="stepper"><button class="step-btn" disabled>↑</button><div class="step-divider"></div><button class="step-btn" disabled>↓</button></div>`
    : `<div class="stepper"><button class="step-btn" onclick="event.stopPropagation()">↑</button><div class="step-divider"></div><button class="step-btn" onclick="event.stopPropagation()">↓</button></div>`;
  const fixedLabel = fixed ? `<div class="fixed-label">Fixed</div>` : '';
  const timeStr  = item.time ? normalizeTime(item.time) : '';
  const dotCls   = item.dotClass || 'dot-opt';
  const tagsHtml = (item.tags || [])
    .map(t => `<span class="tag ${t.cls}">${t.text}</span>`)
    .join('');
  const drawerKey = item.drawerKey || camelKey(item.id || '');

  return `          <div class="tl-item ${cls}" id="${item.id}" onclick="openDrawer('${drawerKey}')"><div class="tl-time">${timeStr}</div><div class="tl-dot ${dotCls}"></div><div class="tl-content"><div class="tl-title-row"><div class="tl-title">${escHtml(item.title)}</div><div class="dir-icons">${dirBtn(item.mapsQuery || item.title)}</div></div><div class="tl-tags">${tagsHtml}</div></div>${fixedLabel}${stepBtns}<div class="done-check">✓</div></div>`;
}

/** Render a time-break row. */
function renderTimeBreak(label) {
  return `          <div class="time-break"><div class="time-break-label">${escHtml(label)}</div><div class="time-break-line"></div></div>`;
}

/** Escape HTML characters. */
function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Drawer activities object ──────────────────────────────────────────────────

/**
 * Build the activities{} object entries from schedule items.
 * Each entry: key → {icon, iconClass, title, time, tags, body, rowId}
 * Body comes from library.json — never generated inline.
 */
function buildActivitiesObject(schedule, library, intake) {
  const entries = {};
  const errors  = [];

  for (const day of schedule) {
    for (const item of day.items) {
      if (item.type === 'time-break') continue;

      const key = item.drawerKey;

      // Arrival block
      if (item.type === 'arrival' || (item.id && item.id.includes('arrival'))) {
        const hotel = intake.fields.hotelName || 'hotel';
        const parkFull = day.park;
        const parkCode = PARK_CODE[parkFull] || day.parkCode;
        const timeLabel = item.time ? `${item.time} · From ${hotel}` : `From ${hotel}`;
        entries[key] = {
          icon: '🚗',
          iconClass: 'icon-sky',
          title: item.title,
          time: timeLabel,
          tags: buildTagsHtml(item.tags || []),
          body: buildArrivalBody(parkCode, parkFull, intake, day.dayIndex),
          rowId: item.id,
        };
        continue;
      }

      // Dining block
      if (item.type === 'dining') {
        const dining = intake.dining.find(d => d.name === item.title || item.title.includes(d.name));
        const timeLabel = dining ? `${dining.time || ''} · ${dining.name || ''}` : item.title;
        entries[key] = {
          icon: '🍽️',
          iconClass: 'icon-gold',
          title: item.title,
          time: timeLabel,
          tags: buildTagsHtml(item.tags || []),
          body: buildDiningBody(dining, intake),
          rowId: item.id,
        };
        continue;
      }

      // Library-backed ride or character entry
      const libEntry = library[item.libraryId];
      if (!libEntry) {
        errors.push(`Missing library entry: "${item.libraryId}" (day ${day.dayIndex}, item "${item.title}")`);
        continue;
      }

      const iClass = iconClass(libEntry);
      const timeStr = buildDrawerTimeStr(libEntry, item);
      const tagsHtml = buildTagsHtml(item.tags || []);

      entries[key] = {
        icon: libEntry.icon || '🎢',
        iconClass: iClass,
        title: libEntry.title,
        time: timeStr,
        tags: tagsHtml,
        body: libEntry.body || '',
        rowId: item.id,
      };
    }
  }

  if (errors.length) {
    const msg = errors.map(e => `  [ERROR] ${e}`).join('\n');
    throw new Error(`Library entries missing — cannot generate inline copy:\n${msg}`);
  }

  // ── Index tab drawers ────────────────────────────────────────────────────
  const fields   = intake.fields    || {};
  const sels     = intake.selections || {};
  const dining   = intake.dining    || [];
  const hotel    = fields.hotelName || 'your resort';
  const resType  = fields.resortType || '';

  // idxLightningLane — LL strategy by park day
  const hasMulti  = (sels.llmp || '').toLowerCase().includes('yes') ||
                    (sels.llmp || '').toLowerCase().includes('purchasing');
  const hasSingle = (sels.llsp || '').toLowerCase().includes('yes') ||
                    (sels.llsp || '').toLowerCase().includes('purchasing');
  const multiNotes   = fields.llMultiNotes   || sels.llMultiNotes   || '';
  const singleTargets= fields.llSingleTargets|| sels.llSingleTargets|| '';
  const window7      = fields.llWindow7      || '';
  const window3      = fields.llWindow3      || '';
  const bookingWindow= resType.toLowerCase().includes('deluxe') ? 7 : 3;
  const windowDate   = bookingWindow === 7 ? window7 : window3;

  let llBody = '';
  if (hasMulti || hasSingle) {
    if (windowDate) {
      llBody += `<div class="prose-p"><strong>Booking day: ${jsEsc(windowDate)}</strong><br>Open My Disney Experience at 7:00am ET. Book all three park days in one session — date-based tickets let you select different parks at once. Do not close the app between parks.</div><div class="section-divider"></div>`;
    }
    if (hasMulti) {
      llBody += `<div class="prose-p"><strong>Lightning Lane Multi Pass</strong><br>`;
      schedule.forEach(day => {
        llBody += `${(PARK_META[day.parkCode] || {}).emoji || ''} ${day.park}: `;
      });
      if (multiNotes) {
        llBody += `</div><div class="section-divider"></div><div class="prose-p">${jsEsc(multiNotes)}</div>`;
      } else {
        llBody += `See Your Lightning Lane card above for park-by-park selections.</div>`;
      }
    }
    if (hasSingle && singleTargets) {
      llBody += `<div class="section-divider"></div><div class="prose-p"><strong>Lightning Lane Single Pass</strong><br>${jsEsc(singleTargets)}. Purchase individually in MDE. No booking window — available 7am park-open day.</div>`;
    }
    llBody += `<div class="callout"><div class="callout-label">Throwaway trick</div><div class="callout-text">If you have three Multi Pass pre-books, consider booking a low-tier ride as your third slot. Tap into it at rope drop, tier restrictions drop immediately, and you can book any ride for your next selection. Label: Tap Now · Ride Later.</div></div>`;
  } else {
    llBody = `<div class="prose-p">No Lightning Lane purchased for this trip. All attractions are standby queue only.</div>`;
  }

  entries['idxLightningLane'] = {
    icon: '⚡', iconClass: 'icon-sky',
    title: 'Lightning Lane',
    time: hasMulti && hasSingle ? 'Multi Pass + Single Pass' : hasMulti ? 'Multi Pass' : hasSingle ? 'Single Pass' : 'No LL',
    tags: '',
    body: llBody,
    rowId: '',
  };

  // idxRiderSwap
  entries['idxRiderSwap'] = {
    icon: '🎢', iconClass: 'icon-sky',
    title: 'Rider Swap',
    time: 'For mixed height or ability groups',
    tags: '',
    body: '<div class="prose-p">Rider Swap lets one adult wait with a child who can\'t ride while the rest of the group rides. The waiting adult then rides without waiting in the full queue again.</div><div class="section-divider"></div><div class="prose-p"><strong>How it works:</strong> Tell the cast member at the ride entrance that you need Rider Swap. They scan your MagicBands and give the waiting adult a Rider Swap pass. After the first group rides, the waiting adult uses the pass to board in the Lightning Lane entrance with up to two others.</div><div class="callout"><div class="callout-label">Worth knowing</div><div class="callout-text">The Rider Swap pass is valid for the rest of the day on that ride. You don\'t have to use it immediately.</div></div>',
    rowId: '',
  };

  // idxRolling
  entries['idxRolling'] = {
    icon: '🔄', iconClass: 'icon-sky',
    title: 'Rolling Bookings',
    time: 'In the park, after tap-in',
    tags: '',
    body: '<div class="prose-p">Once you tap into your first Lightning Lane, you can book your next Multi Pass selection immediately — you don\'t have to wait for the two-hour window. This is called rolling.</div><div class="section-divider"></div><div class="prose-p"><strong>The sequence:</strong> Tap in at ride entrance → open MDE immediately → book next selection. The faster you tap in and book, the more selections you can stack before the park fills up.</div><div class="callout"><div class="callout-label">Key rule</div><div class="callout-text">You can only hold one Multi Pass selection at a time. Tap in to unlock the next booking. Keep moving through your list.</div></div>',
    rowId: '',
  };

  // idxWhereToEat — table service reservations only
  if (dining.length > 0) {
    let whereBody = '<div class="prose-p">Your table service reservations across all park days, in order.</div><div class="section-divider"></div>';
    dining.forEach(r => {
      const dateStr = r.date ? fmtMonthDay(r.date) : '';
      whereBody += `<div class="prose-p"><strong>${jsEsc(r.name)}</strong><br>${dateStr}${r.time ? ' · ' + jsEsc(r.time) : ''}<br>Check My Disney Experience for your confirmation number. Arrive 5 minutes early.</div><div class="section-divider"></div>`;
    });
    entries['idxWhereToEat'] = {
      icon: '🍴', iconClass: 'icon-gold',
      title: 'Where to Eat',
      time: `${dining.length} reservation${dining.length !== 1 ? 's' : ''} across your trip`,
      tags: '',
      body: whereBody,
      rowId: '',
    };
  }

  // idxGroceries — resort delivery instructions
  const isPolynesian = hotel.toLowerCase().includes('polynesian');
  const isFourSeasons = hotel.toLowerCase().includes('four seasons');
  const isGrandFloridan = hotel.toLowerCase().includes('grand floridian');
  let groceryBody = '';
  if (isPolynesian || isGrandFloridan) {
    groceryBody = `<div class="prose-p">Garden Grocer and Amazon Fresh both deliver to ${jsEsc(hotel)}. For Garden Grocer, select Bell Services delivery — they hold it refrigerated until you arrive. Amazon Fresh delivers to the resort front entrance; Bell Services will hold it if you\'re not there.</div><div class="callout"><div class="callout-label">Bell Services tip</div><div class="callout-text">Call Bell Services after ordering and let them know a grocery delivery is coming. They'll hold cold items in their refrigerator at no charge.</div></div>`;
  } else if (isFourSeasons) {
    groceryBody = `<div class="prose-p">Garden Grocer and Amazon Fresh deliver to the Four Seasons Orlando. Deliveries go to the main entrance concierge — call ahead to let them know a grocery delivery is arriving. They will hold refrigerated items until you're ready.</div><div class="callout"><div class="callout-label">Concierge tip</div><div class="callout-text">The Four Seasons concierge is proactive about this. Let them know the delivery window and they'll handle the rest.</div></div>`;
  } else {
    groceryBody = `<div class="prose-p">Garden Grocer and Amazon Fresh both deliver to most Disney-area resorts. Check delivery instructions for ${jsEsc(hotel)} specifically — Bell Services or the front desk typically holds grocery deliveries.</div>`;
  }
  entries['idxGroceries'] = {
    icon: '🛒', iconClass: 'icon-sky',
    title: 'Groceries & Delivery',
    time: hotel,
    tags: '',
    body: groceryBody,
    rowId: '',
  };

  return entries;
}

/** Build drawer time string from library entry and schedule item. */
function buildDrawerTimeStr(libEntry, item) {
  // Library entries don't yet have a time field in most cases;
  // fall back to a generic location hint.
  const parkNames = { MK: 'Magic Kingdom', EP: 'EPCOT', DHS: 'Hollywood Studios', AK: 'Animal Kingdom' };
  const park = parkNames[libEntry.park] || libEntry.park || '';
  if (libEntry.heightReq) {
    return `${park} · ${libEntry.heightReq}" height requirement`;
  }
  return park || 'Walt Disney World';
}

/** Render tags as HTML span strings. */
function buildTagsHtml(tags) {
  return tags.map(t => `<span class="tag ${t.cls}">${t.text}</span>`).join('');
}

/** Build an arrival drawer body. */
function buildArrivalBody(parkCode, parkFull, intake, dayIndex) {
  const hotel     = intake.fields.hotelName || 'your hotel';
  const carrier   = (intake.selections.carrier || '').toLowerCase().includes('yes');
  const stroller  = (intake.selections.strollerYN || '').toLowerCase().includes('renting');
  const transport = ((intake.parkDays[dayIndex] || {}).resortTransport || 'Rideshare').toLowerCase();

  const isMonorail = transport.includes('monorail');
  const isBus      = transport.includes('bus');
  const isBoat     = transport.includes('boat') || transport.includes('water');

  const rideshareMin = { MK: '~20 min', EP: '~8 min', DHS: '~12 min', AK: '~15 min' };
  const monorailMin  = { MK: '~5 min',  EP: '~5 min' };

  let body;

  if (isMonorail) {
    const travelTime = monorailMin[parkCode] || '~5 min';
    body  = `<div class="prose-p">Board the monorail at ${hotel} — the station is inside the resort lobby. It's about ${travelTime} to ${parkFull} and drops you right at the main entrance.</div>`;
    body += `<div class="section-divider"></div>`;
    body += `<div class="prose-p">Aim to be tapped in by 8:45am. Give yourself time to reach your first ride position before cast members let people through.</div>`;
  } else if (isBus) {
    body  = `<div class="prose-p">Disney buses to ${parkFull} run from the main bus stop at ${hotel}. Allow extra time — buses run on Disney's schedule, not yours.</div>`;
    body += `<div class="section-divider"></div>`;
    body += `<div class="prose-p">Aim to be tapped in by 8:45am. Give yourself time to reach your first ride position before cast members let people through.</div>`;
  } else if (isBoat) {
    body  = `<div class="prose-p">The boat to ${parkFull} departs from the dock at ${hotel}. Scenic and efficient — no traffic, no parking lot.</div>`;
    body += `<div class="section-divider"></div>`;
    body += `<div class="prose-p">Aim to be tapped in by 8:45am. Give yourself time to reach your first ride position before cast members let people through.</div>`;
  } else {
    // Default: rideshare
    const driveTime = rideshareMin[parkCode] || '~10 min';
    body  = `<div class="prose-p">Order the rideshare by 8:00am. From ${hotel} it's about ${driveTime} to ${parkFull}, and you'll get dropped right at the main entrance with no tram or parking lot to cross.</div>`;
    body += `<div class="section-divider"></div>`;
    body += `<div class="prose-p">Aim to be tapped in by 8:45am. Give yourself time to reach your first ride position before cast members let people through.</div>`;
  }

  if (carrier && stroller && dayIndex === 0) {
    body += `<div class="callout"><div class="callout-label">Carrier vs stroller</div><div class="callout-text">Use the carrier for the rope-drop sprint. Pick up the rented stroller after your first fixed ride when the pace slows down.</div></div>`;
  }

  return body;
}

/** Build a dining drawer body. */
function buildDiningBody(dining, intake) {
  if (!dining) return '<div class="prose-p">Your dining reservation. See My Disney Experience for confirmation details.</div>';
  const name = dining.name || 'Dining reservation';
  const time = dining.time || '';
  const date = dining.date || '';
  return `<div class="prose-p"><strong>${escHtml(name)}</strong>${time ? ' at ' + escHtml(time) : ''}${date ? ' · ' + fmtMonthDay(date) : ''}.</div><div class="section-divider"></div><div class="prose-p">Check My Disney Experience for your confirmation number and party size. Arrive 5 minutes early — character dining runs on a rotation schedule and late arrivals can miss characters.</div>`;
}

// ─── Characters data (per-day) ────────────────────────────────────────────────

function buildCharsData(schedule, library, intake) {
  return schedule.map((day, i) => {
    const charItems = day.items.filter(it => it.type === 'character');
    const parkMeta  = PARK_META[day.parkCode] || {};
    const title     = 'Characters';
    const sub       = charItems.length
      ? `${charItems.map(c => c.title).join(' · ')} · ${parkMeta.name || day.park}`
      : `No character meets found for ${parkMeta.name || day.park}`;

    const note = charItems.length
      ? `Check My Disney Experience for current meet locations and wait times.`
      : `No character meets are currently scheduled for this park day.`;

    const rows = charItems.map(c => {
      const entry = library[c.libraryId] || {};
      return {
        name: c.title,
        loc:  entry.location || parkMeta.name || day.park,
        text: (entry.body || '').replace(/<[^>]+>/g, '').substring(0, 160).trim(),
      };
    });

    return { title, sub, note, rows };
  });
}

// ─── Entertainment data (per-day) ─────────────────────────────────────────────

function buildEntData(schedule, library, intake) {
  return schedule.map((day, i) => {
    const showItems = day.items.filter(it => it.type === 'show');
    const parkMeta  = PARK_META[day.parkCode] || {};
    const title     = 'Entertainment';
    const sub       = `Shows & street acts · ${parkMeta.name || day.park}`;
    const note      = showItems.length
      ? `Showtimes vary — check the My Disney Experience app under "Entertainment" for today's schedule.`
      : `Check the My Disney Experience app for today's show schedule and times.`;

    const rows = showItems.map(s => {
      const entry = library[s.libraryId] || {};
      return {
        name: s.title,
        loc:  parkMeta.name || day.park,
        text: (entry.body || '').replace(/<[^>]+>/g, '').substring(0, 160).trim(),
      };
    });

    return { title, sub, note, rows };
  });
}

// ─── Worth Knowing data ───────────────────────────────────────────────────────

function buildWKData(schedule, wkLib, intake) {
  return schedule.map(day => {
    const parkEntry = wkLib[day.parkCode];
    if (!parkEntry) {
      return {
        intro: `Worth Knowing content for ${day.park} — check back after next content update.`,
        groups: [],
      };
    }
    return {
      intro:  parkEntry.intro  || '',
      groups: parkEntry.groups || [],
    };
  });
}

// ─── Day tabs HTML ────────────────────────────────────────────────────────────

function buildDayTabs(schedule) {
  return schedule.map((day, i) => {
    const parkMeta = PARK_META[day.parkCode] || {};
    const active   = i === 0 ? ' active' : '';
    const weekday  = fmtWeekday(day.date);
    const monthDay = fmtMonthDay(day.date);
    return `    <div class="day-tab${active}" onclick="switchDay(${i})"><div style="font-size:13px;text-align:center;">${parkMeta.emoji || '🎡'}</div><div class="day-tab-label">${weekday}</div><div class="day-tab-day">${monthDay}</div></div>`;
  }).join('\n');
}

// ─── Day panels HTML ──────────────────────────────────────────────────────────

function buildDayPanels(schedule, library, intake) {
  return schedule.map((day, i) => {
    const parkMeta  = PARK_META[day.parkCode] || {};
    const active    = i === 0 ? ' active' : '';
    const { dayName, summary } = bpCopy(day.parkCode, intake.parkDays[i], intake, i);
    const parkOpen  = (intake.parkDays[i] || {}).parkOpen || '9am';
    const transport = (intake.parkDays[i] || {}).resortTransport || '';
    const depart    = (intake.parkDays[i] || {}).targetDepart || intake.fields[`pdDepart${i + 1}`] || '';
    const hotel     = intake.fields.hotelName || 'hotel';

    // Boarding-pass logistics line: date · transport · depart
    const dateStr     = fmtMonthDay(day.date);
    const transportStr = transport ? ` · ${transport}` : '';
    const departStr   = depart ? ` · Out by ${depart}` : '';
    const bpParkLine  = `${dateStr}${transportStr}${departStr}`;

    // Chars pill sub-label
    const charItems = day.items.filter(it => it.type === 'character');
    const charSub   = charItems.length
      ? charItems.map(c => c.title.split(' ').slice(0, 2).join(' ')).join(' · ')
      : 'No meets today';

    // Ent pill sub-label
    const showItems = day.items.filter(it => it.type === 'show');
    const entSub    = showItems.length
      ? showItems.map(s => s.title).join(' · ')
      : 'Check MDE for shows';

    // Bag pill sub
    const bagSub = hasInfantOrToddler(intake) ? 'Baby & park essentials' : 'Park day essentials';

    // dir-legend: Google Maps only (per spec — no MDE icon)
    const dirLegend = `        <div class="dir-legend">
          <div class="dir-legend-label">Getting Around</div>
          <div class="dir-legend-row">
            <div class="dir-legend-item">${MAPS_SVG_SM}<span class="dir-legend-text">Google Maps</span></div>
          </div>
        </div>`;

    // Timeline HTML
    const timelineRows = day.items.map(item => {
      if (item.type === 'time-break') return renderTimeBreak(item.label);
      return renderTLItem(item, i);
    }).join('\n');

    return `    <div class="day-panel${active}" id="day-${i}">
      <div class="boarding-pass">
        <div class="bp-top">
          <div class="park-name-row">
            <span class="park-emoji">${parkMeta.emoji || '🎡'}</span>
            <span class="park-name">${parkMeta.name || day.park}</span>
            <span class="park-day-label">Day ${i + 1}</span>
          </div>
          <div class="bp-day-name">${escHtml(dayName)}</div>
          <div class="bp-park">${escHtml(bpParkLine)}</div>
          <div class="bp-summary">${escHtml(summary)}</div>
        </div>
        <div class="bp-divider">
          <div class="bp-notch bp-notch-l"></div>
          <div class="bp-dash"></div>
          <div class="bp-notch bp-notch-r"></div>
        </div>
        <div class="bp-bottom">
          <div class="pill-row">
            <div class="bp-pill" id="charsPill-${i}" onclick="openCharsDrawer(${i})">
              <span class="bp-pill-icon">👋</span>
              <div class="bp-pill-text">
                <span class="bp-pill-label">Characters</span>
                <span class="bp-pill-sub">${escHtml(charSub)}</span>
              </div>
              <span class="bp-pill-chev">›</span>
            </div>
            <div class="bp-pill" id="entPill-${i}" onclick="openEntDrawer(${i})">
              <span class="bp-pill-icon">🎭</span>
              <div class="bp-pill-text">
                <span class="bp-pill-label">Entertainment</span>
                <span class="bp-pill-sub">${escHtml(entSub)}</span>
              </div>
              <span class="bp-pill-chev">›</span>
            </div>
          </div>
          <div class="bag-row-top" id="bagRowTop-${i}" onclick="openBagDrawer(${i})">
            <span style="font-size:18px;">🎒</span>
            <div class="bag-row-top-title">Your park bag</div>
            <div class="bag-row-top-label">Pack before you leave</div>
          </div>
          <div class="schedule-header">
            <span class="schedule-label">Your Day</span>
            <button class="edit-btn" onclick="event.stopPropagation();toggleEdit(${i})">Edit order</button>
            <button class="done-edit-btn" onclick="event.stopPropagation();toggleEdit(${i})">Done</button>
          </div>
          <div class="edit-banner" id="editBanner-${i}">Tap ↑ ↓ to reorder · Fixed items cannot be moved</div>
${dirLegend}
          <div id="timeline-${i}">
${timelineRows}
          </div>
        </div>
      </div>
    </div>`;
  }).join('\n');
}

// ─── WK tabs HTML ─────────────────────────────────────────────────────────────

function buildWKTabs(schedule) {
  return schedule.map((day, i) => {
    const parkMeta = PARK_META[day.parkCode] || {};
    const active   = i === 0 ? ' active' : '';
    return `    <div class="wk-park-tab${active}" onclick="switchWKPark(${i},this)">${parkMeta.emoji || '🎡'} ${parkMeta.short || day.park}</div>`;
  }).join('\n');
}

// ─── Storage key ──────────────────────────────────────────────────────────────

function storageKey(intake) {
  // Derive from last name of first adult
  const firstAdult = intake.people.find(p => p.role !== 'Child');
  const lastName   = firstAdult
    ? (firstAdult.name || '').trim().split(' ').pop().toLowerCase()
    : 'client';
  return `park-edit-${lastName}-v1`;
}

// ─── Serialise to JS literal ──────────────────────────────────────────────────

/** Serialise an activities object to a JS object literal string. */
function serialiseActivities(activities) {
  return Object.entries(activities).map(([key, val]) => {
    const icon      = jsEsc(val.icon || '');
    const iClass    = jsEsc(val.iconClass || 'icon-sky');
    const title     = jsEsc(val.title || '');
    const time      = jsEsc(val.time || '');
    const tags      = jsEsc(val.tags || '');
    const body      = jsEsc(val.body || '');
    const rowId     = jsEsc(val.rowId || '');
    return `  ${key}:{icon:'${icon}',iconClass:'${iClass}',title:'${title}',time:'${time}',tags:'${tags}',body:'${body}',rowId:'${rowId}'}`;
  }).join(',\n');
}

/** Serialise wkData array to a JS array literal string. */
function serialiseWKData(wkData) {
  return wkData.map(park => {
    if (park.dining) {
      const items = (park.items || []).map(item => {
        return `{e:'${jsEsc(item.e)}',park:'${jsEsc(item.park)}',name:'${jsEsc(item.name)}',desc:'${jsEsc(item.desc)}'}`;
      }).join(',');
      return `  {dining:true,note:'${jsEsc(park.note)}',items:[${items}]}`;
    }
    const intro  = jsEsc(park.intro || '');
    const groups = (park.groups || []).map(g => {
      const tips = (g.tips || []).map(t =>
        `{e:'${jsEsc(t.e)}',t:'${jsEsc(t.t)}',d:'${jsEsc(t.d)}'}`
      ).join(',');
      return `{label:'${jsEsc(g.label)}',tips:[${tips}]}`;
    }).join(',');
    return `  {intro:'${intro}',groups:[${groups}]}`;
  }).join(',\n');
}

/** Serialise bagItems array to a JS array literal string. */
function serialiseBagItems(items) {
  return items.map(item => `  '${jsEsc(item)}'`).join(',\n');
}

/** Serialise charsData or entData array. */
function serialisePerDayData(data) {
  return data.map(day => {
    const rows = (day.rows || []).map(r =>
      `{name:'${jsEsc(r.name)}',loc:'${jsEsc(r.loc)}',text:'${jsEsc(r.text)}'}`
    ).join(',');
    return `  {title:'${jsEsc(day.title)}',sub:'${jsEsc(day.sub)}',note:'${jsEsc(day.note)}',rows:[${rows}]}`;
  }).join(',\n');
}

// ─── Index tab data ───────────────────────────────────────────────────────────

/**
 * Build the indexData object that gets injected into the shell as __INDEX_DATA__.
 * Covers: trip summary, LL strategy, dining reservations, babyToddler flag.
 */
function buildIndexData(schedule, intake) {
  const fields    = intake.fields    || {};
  const sels      = intake.selections || {};
  const dining    = intake.dining    || [];
  const infant    = hasInfantOrToddler(intake);

  // ── Trip summary ────────────────────────────────────────────
  const parks = schedule.map(d => ({
    emoji:   (PARK_META[d.parkCode] || {}).emoji || '🎡',
    name:    d.park,
    date:    fmtMonthDay(d.date),
    weekday: fmtWeekday(d.date),
  }));

  // ── LL strategy ─────────────────────────────────────────────
  const hasMulti  = (sels.llmp || '').toLowerCase().includes('yes') ||
                    (sels.llmp || '').toLowerCase().includes('purchasing');
  const hasSingle = (sels.llsp || '').toLowerCase().includes('yes') ||
                    (sels.llsp || '').toLowerCase().includes('purchasing');

  // Build per-day LL lines from callNotes (source of truth for LL strategy)
  // callNotes contains the full narrative; parse LL Multi Pass section per park
  const multiNotes   = fields.llMultiNotes   || sels.llMultiNotes   || '';
  const singleTargets= fields.llSingleTargets|| sels.llSingleTargets|| '';
  const window7      = fields.llWindow7      || '';
  const window3      = fields.llWindow3      || '';
  const bookingWindow= fields.resortType === 'Disney Deluxe Resort' ? 7 : 3;
  const windowDate   = bookingWindow === 7 ? window7 : window3;

  // Per-day LL build — derived from schedule park order and known strategy
  const byDay = schedule.map((day, i) => {
    const parkCode = day.parkCode;
    // Multi Pass picks per park — populated from multiNotes if present,
    // otherwise surfaced as "See Your Lightning Lane notes below"
    return {
      parkEmoji: (PARK_META[parkCode] || {}).emoji || '🎡',
      park:      day.park,
      date:      fmtMonthDay(day.date),
      multiNotes: multiNotes || '',
      singleTargets: singleTargets || '',
    };
  });

  // ── Dining ──────────────────────────────────────────────────
  const reservations = dining.map(r => ({
    e:    diningEmoji(r.name),
    name: r.name || 'Dining reservation',
    sub:  [r.date ? fmtMonthDay(r.date) : '', r.time || ''].filter(Boolean).join(' · '),
    type: diningType(r.name),
  }));

  return {
    trip: {
      resort:   fields.hotelName  || '',
      checkIn:  fields.checkIn  ? fmtMonthDay(fields.checkIn)  : '',
      checkOut: fields.checkOut ? fmtMonthDay(fields.checkOut) : '',
      parks,
    },
    ll: {
      multiPass:     hasMulti,
      singlePass:    hasSingle,
      multiNotes,
      singleTargets,
      windowDate,
      bookingWindow,
      byDay,
    },
    dining: {
      count: reservations.length,
      reservations,
    },
    babyToddler: infant,
  };
}

function diningEmoji(name) {
  if (!name) return '🍽️';
  const n = name.toLowerCase();
  if (n.includes('bibbidi') || n.includes('boutique')) return '👑';
  if (n.includes('royal table') || n.includes('castle')) return '🏰';
  if (n.includes('ohana') || n.includes("'ohana")) return '🌺';
  if (n.includes('space 220')) return '🚀';
  if (n.includes('hacienda')) return '🌮';
  if (n.includes('tiffins')) return '🍷';
  if (n.includes('sci-fi') || n.includes('sci fi')) return '🚗';
  if (n.includes('ravello') || n.includes('four seasons')) return '🌴';
  return '🍽️';
}

function diningType(name) {
  if (!name) return 'Table Service';
  const n = name.toLowerCase();
  if (n.includes('bibbidi')) return 'Experience';
  if (n.includes('royal table') || n.includes("'ohana") || n.includes('ravello') ||
      n.includes('tiffins') || n.includes('space 220') || n.includes('sci-fi') ||
      n.includes('hacienda') || n.includes('castle')) return 'Character Dining';
  return 'Table Service';
}

/**
 * Build the HTML for the Index panel (injected as {{INDEX_PANEL}}).
 * Three at-a-glance cards at top, then drawer sections.
 */
function buildIndexPanel(indexData) {
  const { trip, ll, dining, babyToddler } = indexData;

  // ── Your Trip card ──────────────────────────────────────────
  const parkRows = trip.parks.map(p =>
    `<div class="aag-row"><div class="aag-row-icon">${p.emoji}</div><div><div class="aag-row-value">${escHtml(p.name)}</div><div class="aag-row-sub">${escHtml(p.weekday)} ${escHtml(p.date)}</div></div></div>`
  ).join('');

  const tripCard = `
    <div class="aag-card">
      <div class="aag-card-header">
        <div class="aag-card-icon">🗓️</div>
        <div class="aag-card-meta">
          <span class="aag-card-label">Your Trip</span>
          <div class="aag-card-title">${escHtml(trip.resort)}</div>
        </div>
      </div>
      <div class="aag-card-body">
        <div class="aag-row"><div class="aag-row-icon">🏨</div><div><div class="aag-row-value">${escHtml(trip.resort)}</div><div class="aag-row-sub">${escHtml(trip.checkIn)} – ${escHtml(trip.checkOut)}</div></div></div>
        ${parkRows}
      </div>
    </div>`;

  // ── Your Lightning Lane card ────────────────────────────────
  const llStatusText = ll.multiPass && ll.singlePass
    ? 'Multi Pass + Single Pass'
    : ll.multiPass ? 'Multi Pass' : ll.singlePass ? 'Single Pass only' : 'No Lightning Lane';

  const windowRow = ll.windowDate
    ? `<div class="aag-row"><div class="aag-row-icon">📅</div><div><div class="aag-row-value">Book on ${escHtml(ll.windowDate)}</div><div class="aag-row-sub">${ll.bookingWindow}-day resort window · 7:00am ET</div><span class="aag-tag aag-tag-ll">Book all park days in one session</span></div></div>`
    : '';

  const singleRow = ll.singlePass && ll.singleTargets
    ? `<div class="aag-row"><div class="aag-row-icon">⚡</div><div><div class="aag-row-value">${escHtml(ll.singleTargets)}</div><div class="aag-row-sub">Single Pass target${ll.singleTargets.includes(',') ? 's' : ''}</div><span class="aag-tag aag-tag-sp">Individual LL</span></div></div>`
    : '';

  const multiRow = ll.multiPass && ll.multiNotes
    ? `<div class="aag-row"><div class="aag-row-icon">⚡</div><div><div class="aag-row-value">Multi Pass notes</div><div class="aag-row-sub">${escHtml(ll.multiNotes)}</div></div></div>`
    : '';

  const llCard = `
    <div class="aag-card">
      <div class="aag-card-header">
        <div class="aag-card-icon">⚡</div>
        <div class="aag-card-meta">
          <span class="aag-card-label">Your Lightning Lane</span>
          <div class="aag-card-title">${escHtml(llStatusText)}</div>
        </div>
      </div>
      <div class="aag-card-body">
        ${windowRow}
        ${singleRow}
        ${multiRow}
      </div>
    </div>`;

  // ── Your Dining card ────────────────────────────────────────
  const diningRows = dining.reservations.map(r =>
    `<div class="aag-row"><div class="aag-row-icon">${r.e}</div><div><div class="aag-row-value">${escHtml(r.name)}</div><div class="aag-row-sub">${escHtml(r.sub)}</div><span class="aag-tag aag-tag-food">${escHtml(r.type)}</span></div></div>`
  ).join('');

  const diningCard = dining.count > 0 ? `
    <div class="aag-card">
      <div class="aag-card-header">
        <div class="aag-card-icon">🍽️</div>
        <div class="aag-card-meta">
          <span class="aag-card-label">Your Dining</span>
          <div class="aag-card-title">${dining.count} reservation${dining.count !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="aag-card-body">
        ${diningRows}
      </div>
    </div>` : '';

  // ── LL & Queues section ─────────────────────────────────────
  const llDrawers = `
    <div class="idx-section">
      <div class="idx-section-label">⚡ LL &amp; Queues</div>
      <div class="idx-drawer-row" onclick="openDrawer('idxLightningLane')"><div class="idx-drawer-icon">⚡</div><div class="idx-drawer-label">Lightning Lane</div><div class="idx-drawer-chev">›</div></div>
      <div class="idx-drawer-row" onclick="openDrawer('idxRiderSwap')"><div class="idx-drawer-icon">🎢</div><div class="idx-drawer-label">Rider Swap</div><div class="idx-drawer-chev">›</div></div>
      <div class="idx-drawer-row" onclick="openDrawer('idxRolling')"><div class="idx-drawer-icon">🔄</div><div class="idx-drawer-label">Rolling Bookings</div><div class="idx-drawer-chev">›</div></div>
    </div>`;

  // ── Logistics section ───────────────────────────────────────
  const whereToEatRow = dining.count > 0
    ? `<div class="idx-drawer-row" onclick="openDrawer('idxWhereToEat')"><div class="idx-drawer-icon">🍴</div><div class="idx-drawer-label">Where to Eat</div><div class="idx-drawer-chev">›</div></div>`
    : '';

  const logisticsDrawers = `
    <div class="idx-section">
      <div class="idx-section-label">🗺️ Logistics</div>
      ${whereToEatRow}
      <div class="idx-drawer-row" onclick="openDrawer('idxGroceries')"><div class="idx-drawer-icon">🛒</div><div class="idx-drawer-label">Groceries &amp; Delivery</div><div class="idx-drawer-chev">›</div></div>
    </div>`;

  // ── Baby & Toddler section (conditional) ───────────────────
  const babyDrawers = babyToddler ? `
    <div class="idx-section">
      <div class="idx-section-label">🍼 Baby &amp; Toddler</div>
      <div class="idx-drawer-row" onclick="openDrawer('idxStroller')"><div class="idx-drawer-icon">🚼</div><div class="idx-drawer-label">Stroller Logistics</div><div class="idx-drawer-chev">›</div></div>
      <div class="idx-drawer-row" onclick="openDrawer('idxNursing')"><div class="idx-drawer-icon">🤱</div><div class="idx-drawer-label">Nursing &amp; Feeding</div><div class="idx-drawer-chev">›</div></div>
      <div class="idx-drawer-row" onclick="openDrawer('idxBabyCare')"><div class="idx-drawer-icon">🏥</div><div class="idx-drawer-label">Baby Care Centers</div><div class="idx-drawer-chev">›</div></div>
      <div class="idx-drawer-row" onclick="openDrawer('idxNap')"><div class="idx-drawer-icon">😴</div><div class="idx-drawer-label">Nap Strategy</div><div class="idx-drawer-chev">›</div></div>
      <div class="idx-drawer-row" onclick="openDrawer('idxSnacks')"><div class="idx-drawer-icon">🍌</div><div class="idx-drawer-label">Snacks</div><div class="idx-drawer-chev">›</div></div>
      <div class="idx-drawer-row" onclick="openDrawer('idxGear')"><div class="idx-drawer-icon">🎒</div><div class="idx-drawer-label">Gear</div><div class="idx-drawer-chev">›</div></div>
    </div>` : '';

  return `
  <div class="aag-cards">
    ${tripCard}
    ${llCard}
    ${diningCard}
  </div>
  ${llDrawers}
  ${logisticsDrawers}
  ${babyDrawers}`;
}

/** Serialise indexData object to a JS object literal string for shell injection. */
function serialiseIndexData(data) {
  return `trip:${JSON.stringify(data.trip)},ll:${JSON.stringify(data.ll)},dining:${JSON.stringify(data.dining)},babyToddler:${data.babyToddler}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const intakePath = process.argv[2];
  if (!intakePath) {
    console.error('Usage: node generate-park-edit.js path/to/intake.json');
    process.exit(1);
  }

  // ── Load inputs ────────────────────────────────────────────────────────────
  const intake  = JSON.parse(fs.readFileSync(intakePath, 'utf8'));
  const libFile = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
  const library = libFile.entries;
  const wkLib   = JSON.parse(fs.readFileSync(WK_PATH, 'utf8'));
  let   shell   = fs.readFileSync(SHELL_PATH, 'utf8');

  // ── Run schedule builder ──────────────────────────────────────────────────
  console.log('Running schedule builder...');
  let scheduleJson;
  try {
    scheduleJson = execSync(`node "${SCHED_PATH}" "${intakePath}"`, { encoding: 'utf8' });
  } catch (err) {
    console.error('[schedule-builder stderr]', err.stderr || err.message);
    process.exit(1);
  }
  const schedule = JSON.parse(scheduleJson);

  // Label time-break items (schedule builder may emit label-less breaks)
  for (const day of schedule) {
    for (const item of day.items) {
      if (!item.label && item.type === 'time-break') {
        item.label = '·';
      }
    }
  }

  // ── Derive client metadata ────────────────────────────────────────────────
  const title     = clientTitle(intake);
  const family    = brandFamily(intake);
  const tagline   = brandTagline(intake);
  const sKey      = storageKey(intake);

  // ── Build HTML markers ────────────────────────────────────────────────────
  const dayTabsHtml   = buildDayTabs(schedule);
  const dayPanelsHtml = buildDayPanels(schedule, library, intake);
  const wkTabsHtml    = buildWKTabs(schedule);
  const indexDataObj  = buildIndexData(schedule, intake);
  const indexPanelHtml = buildIndexPanel(indexDataObj);

  // ── Build JS data ─────────────────────────────────────────────────────────
  const activities = buildActivitiesObject(schedule, library, intake);
  const wkData     = buildWKData(schedule, wkLib, intake);
  const bagItems   = buildBagList(intake);
  const charsData  = buildCharsData(schedule, library, intake);
  const entData    = buildEntData(schedule, library, intake);

  // ── Inject into shell — HTML markers ─────────────────────────────────────
  shell = shell.replace('{{CLIENT_TITLE}}',  title);
  shell = shell.replace('{{BRAND_FAMILY}}',  family);
  shell = shell.replace('{{BRAND_TAGLINE}}', tagline);
  shell = shell.replace('{{DAY_TABS}}',      dayTabsHtml);
  shell = shell.replace('{{DAY_PANELS}}',    dayPanelsHtml);
  shell = shell.replace('{{WK_TABS}}',       wkTabsHtml);
  shell = shell.replace('{{INDEX_PANEL}}',   indexPanelHtml);

  // ── Inject into shell — JS markers ───────────────────────────────────────
  shell = shell.replace("'__STORAGE_KEY__'",           `'${sKey}'`);
  shell = shell.replace('/* __WK_DATA__ */',           serialiseWKData(wkData));
  shell = shell.replace('/* __ACTIVITIES_OBJECT__ */', serialiseActivities(activities));
  shell = shell.replace('/* __BAG_ITEMS__ */',         serialiseBagItems(bagItems));
  shell = shell.replace('/* __CHARS_DATA__ */',        serialisePerDayData(charsData));
  shell = shell.replace('/* __ENT_DATA__ */',          serialisePerDayData(entData));
  shell = shell.replace('/* __INDEX_DATA__ */',        serialiseIndexData(indexDataObj));

  // ── Verify all markers resolved ───────────────────────────────────────────
  const remaining = shell.match(/\{\{[A-Z_]+\}\}|\/\* __[A-Z_]+__ \*\//g);
  if (remaining) {
    console.error('[WARN] Unresolved markers in output:', remaining);
  }

  // ── Write output ──────────────────────────────────────────────────────────
  const lastName   = title.split(' ').pop().toLowerCase();
  const outDir     = path.join(path.dirname(intakePath), '..', `${lastName}`, 'park-edit');
  const outDirAbs  = path.resolve(outDir);
  const outFile    = `${lastName}-park-edit-v1.html`;
  const outPath    = path.join(outDirAbs, outFile);

  fs.mkdirSync(outDirAbs, { recursive: true });
  fs.writeFileSync(outPath, shell, 'utf8');

  console.log(`\n✓  Park Edit generated:`);
  console.log(`   ${outPath}`);
  console.log(`\n   ${schedule.length} park day(s) · ${Object.keys(activities).length} drawer entries`);
  if (remaining) {
    console.log(`\n[WARN] ${remaining.length} marker(s) not resolved — review output.`);
  }
}

main();
