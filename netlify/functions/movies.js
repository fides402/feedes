'use strict';

// ============================================================
//  /api/movies — Nuove uscite streaming filtrate da Groq
//  secondo il profilo cinematografico di John Frusciante
// ============================================================

const TMDB_KEY = '85395f1f04d886e7ad3581f64d886026';
const GROQ_KEY = process.env.GROQ_API_KEY || '';

// Cache in-memory Lambda: protegge quota Groq per accessi ravvicinati
// Se ?bust=1 viene passato, la ignora (usato dal pulsante Aggiorna)
let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL = 4 * 3600 * 1000; // 4 ore

// Profilo Frusciante (titoli rappresentativi, limitati per non sprecare token Groq)
const FRUSCIANTE_PROFILE = `Profilo cinematografico dedotto dai titoli consigliati da questo cinefilo:
Titoli amati (campione): Nosferatu, The Substance, Heretic, Vermiglio, Emilia Pérez, Anora, Poor Things, Drive My Car, Perfect Days, Fallen Leaves, Anatomy of a Fall, The Zone of Interest, Conclave, Flow, The Boy and the Heron, The Wild Robot, Look Back, The Colors Within, Longlegs, MaXXXine, In a Violent Nature, Infested, When Evil Lurks, Presence, Bring Her Back, Sinners, Terrifier 3, Kinds of Kindness, Megalopolis, Mad God, Beau Is Afraid, Asteroid City, Queer, The Killer, Decision to Leave, Monster, Crimes of the Future, X, Pearl, Infinity Pool, Talk to Me, Kill, The Northman, Oppenheimer, Dune, Civil War, The Apprentice, The Shrouds.

Caratteristiche del gusto: cinema auteur europeo e asiatico, horror elevato e body horror, film sperimentali e surreali, animazione poetica, thriller psicologico oscuro, fantascienza autoriale, cinema italiano d'autore, film che sfidano lo spettatore. NON gradisce: commedia romantica generica, blockbuster d'azione privi di spessore, film familiari convenzionali.`;

exports.handler = async (event) => {
  const bust = event.queryStringParameters?.bust === '1';
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': bust ? 'no-store' : 'public, max-age=10800',
  };

  // Usa cache in-memory solo se NON è una richiesta di aggiornamento forzato
  if (!bust && _cache && Date.now() - _cacheTime < CACHE_TTL) {
    return { statusCode: 200, headers: corsHeaders, body: _cache };
  }

  try {
    const now    = new Date();
    const toStr  = now.toISOString().slice(0, 10);

    // Fascia A: ultimi 6 mesi, soglie qualità standard
    const from6m = new Date(now); from6m.setMonth(from6m.getMonth() - 6);
    const from6mStr = from6m.toISOString().slice(0, 10);

    // Fascia B: ultime 8 settimane, nessuna soglia voto (titoli freschi come
    // DTF St. Louis che non hanno ancora accumulato voti su TMDB)
    const from8w = new Date(now); from8w.setDate(from8w.getDate() - 56);
    const from8wStr = from8w.toISOString().slice(0, 10);

    const base     = 'https://api.themoviedb.org/3/discover';
    const noRomFam = `&without_genres=10749%2C10751`; // no romance puro, no family

    // Fascia A: qualità verificata da voti, popolarità ordinante
    const qA = `api_key=${TMDB_KEY}&language=it-IT&vote_average.gte=6.8&vote_count.gte=50${noRomFam}&sort_by=popularity.desc`;
    // Fascia B: uscite recenti — solo popolarità minima, nessun filtro voto (Groq decide)
    const qB = `api_key=${TMDB_KEY}&language=it-IT&vote_count.gte=5&popularity.gte=10${noRomFam}&sort_by=popularity.desc`;

    // Fascia B: prendiamo anche pagina 2 perché titoli come DTF St. Louis
    // hanno popolarità ~20 e finiscono oltre i primi 20 risultati
    const [movARes, tvARes, movBRes, tvBRes, movB2Res, tvB2Res] = await Promise.all([
      fetch(`${base}/movie?${qA}&primary_release_date.gte=${from6mStr}&primary_release_date.lte=${toStr}`),
      fetch(`${base}/tv?${qA}&first_air_date.gte=${from6mStr}&first_air_date.lte=${toStr}`),
      fetch(`${base}/movie?${qB}&primary_release_date.gte=${from8wStr}&primary_release_date.lte=${toStr}&page=1`),
      fetch(`${base}/tv?${qB}&first_air_date.gte=${from8wStr}&first_air_date.lte=${toStr}&page=1`),
      fetch(`${base}/movie?${qB}&primary_release_date.gte=${from8wStr}&primary_release_date.lte=${toStr}&page=2`),
      fetch(`${base}/tv?${qB}&first_air_date.gte=${from8wStr}&first_air_date.lte=${toStr}&page=2`),
    ]);

    const toItem = (x, mediaType, dateKey) => ({
      id:        `${mediaType === 'Film' ? 'movie' : 'tv'}-${x.id}`,
      type:      'movie',
      mediaType,
      title:     x.title || x.name || x.original_title || x.original_name,
      overview:  (x.overview || '').slice(0, 200),
      rating:    Math.round((x.vote_average || 0) * 10) / 10,
      poster:    x.poster_path ? `https://image.tmdb.org/t/p/w300${x.poster_path}` : null,
      date:      x[dateKey],
      link:      `https://www.themoviedb.org/${mediaType === 'Film' ? 'movie' : 'tv'}/${x.id}`,
    });

    const seen = new Set();
    const addUniq = (arr) => arr.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });

    const movA  = movARes.ok  ? (await movARes.json()).results  || [] : [];
    const tvA   = tvARes.ok   ? (await tvARes.json()).results   || [] : [];
    const movB1 = movBRes.ok  ? (await movBRes.json()).results  || [] : [];
    const tvB1  = tvBRes.ok   ? (await tvBRes.json()).results   || [] : [];
    const movB2 = movB2Res.ok ? (await movB2Res.json()).results || [] : [];
    const tvB2  = tvB2Res.ok  ? (await tvB2Res.json()).results  || [] : [];

    const candidates = [
      ...addUniq(movA.slice(0, 20)).map(x => toItem(x, 'Film',     'release_date')),
      ...addUniq(tvA.slice(0,  20)).map(x => toItem(x, 'Serie TV', 'first_air_date')),
      ...addUniq([...movB1, ...movB2].slice(0, 25)).map(x => toItem(x, 'Film',     'release_date')),
      ...addUniq([...tvB1,  ...tvB2].slice(0,  25)).map(x => toItem(x, 'Serie TV', 'first_air_date')),
    ];

    if (candidates.length === 0) {
      const empty = JSON.stringify([]);
      _cache = empty; _cacheTime = Date.now();
      return { statusCode: 200, headers: corsHeaders, body: empty };
    }

    // Groq: lista compatta per non sprecare token
    const listText = candidates
      .map((m, i) => `${i + 1}.[${m.id}] ${m.title} (${(m.date || '').slice(0, 4)}) — ${m.overview}`)
      .join('\n');

    let selected = new Set();
    try {
      const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.1,
          max_tokens: 350,
          messages: [
            {
              role: 'system',
              content: `${FRUSCIANTE_PROFILE}\n\nSei un filtro LARGO di raccomandazioni. Tutti i titoli in lista hanno già voto TMDB ≥7, quindi il voto alto è garanzia di qualità sufficiente. Il tuo compito è ESCLUDERE solo i titoli palesemente incompatibili col profilo (commedie romantiche banali, film per bambini convenzionali, blockbuster d'azione puri senza spessore). Tutto il resto — anche se non perfettamente nel profilo — INCLUDILO. Assicurati di includere varietà di generi: non solo horror, ma anche thriller, drama, animazione, fantascienza, commedia nera, ecc. Meglio includere qualcosa in più che perdere titoli buoni. Rispondi SOLO con un array JSON di ID, es: ["movie-123","tv-456"]. Zero altro testo.`,
            },
            {
              role: 'user',
              content: `Nuove uscite (tutte con voto ≥7):\n${listText}\n\nArray JSON degli ID da tenere (escludi solo l'ovviamente incompatibile, mantieni varietà di generi):`,
            },
          ],
        }),
      });
      if (gr.ok) {
        const gd  = await gr.json();
        const raw = gd.choices?.[0]?.message?.content || '';
        const m   = raw.match(/\[[\s\S]*?\]/);
        if (m) JSON.parse(m[0]).forEach(id => selected.add(String(id)));
      }
    } catch (e) {
      console.warn('Groq error (fallback to all):', e.message);
    }

    // Fallback: se Groq non risponde, restituisci tutto
    const filtered = selected.size > 0
      ? candidates.filter(c => selected.has(c.id))
      : candidates;

    const body = JSON.stringify(filtered.sort((a, b) => b.rating - a.rating));
    _cache = body; _cacheTime = Date.now();
    return { statusCode: 200, headers: corsHeaders, body };

  } catch (err) {
    console.error('movies fn error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
