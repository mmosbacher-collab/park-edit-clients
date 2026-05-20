exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { park, date } = JSON.parse(event.body);

    // WDW destination ID — verified from ThemeParks.wiki
    const WDW_ID = 'e957da41-3552-4cf6-b636-5babc5cbc4e5';

    // Park name to entity ID map
    const PARK_IDS = {
      'Magic Kingdom':    '75ea578a-adc8-4116-a54d-dccb60765ef9',
      'EPCOT':            null,
      'Hollywood Studios': null,
      'Animal Kingdom':   null,
    };

    // If we don't have the ID cached, fetch children of WDW destination
    let entityId = PARK_IDS[park];

    if (!entityId) {
      const childRes = await fetch(`https://api.themeparks.wiki/v1/entity/${WDW_ID}/children`);
      const childData = await childRes.json();
      const children = childData.children || [];

      const match = children.find(c => {
        const name = (c.name || '').toLowerCase();
        const p = park.toLowerCase();
        return name.includes(p) ||
          (p === 'epcot' && name.includes('epcot')) ||
          (p === 'hollywood studios' && name.includes('hollywood')) ||
          (p === 'animal kingdom' && name.includes('animal'));
      });

      if (!match) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Park not found' }) };
      }
      entityId = match.id;
    }

    // Fetch schedule for this entity
    const schedRes = await fetch(`https://api.themeparks.wiki/v1/entity/${entityId}/schedule`);
    const schedData = await schedRes.json();

    // Find the entry matching our date
    const entries = schedData.schedule || [];
    const entry = entries.find(e => e.date === date);

    if (!entry) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No hours found for date' }) };
    }

    // Format times — API returns ISO strings
    function formatTime(iso) {
      if (!iso) return null;
      const d = new Date(iso);
      let h = d.getHours();
      const m = d.getMinutes();
      const ampm = h >= 12 ? 'pm' : 'am';
      h = h % 12 || 12;
      return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2,'0')}${ampm}`;
    }

    const open = formatTime(entry.openingTime);
    const close = formatTime(entry.closingTime);

    // Find Early Entry if present
    let earlyOpen = null;
    const special = entry.specialHours || [];
    const earlyEntry = special.find(s => (s.type || '').toLowerCase().includes('early'));
    if (earlyEntry) earlyOpen = formatTime(earlyEntry.openingTime);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ open, close, earlyOpen, entityId })
    };

  } catch (err) {
    console.error('park-hours error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
