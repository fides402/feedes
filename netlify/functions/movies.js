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
    const now  = new Date();
    // Ultimi 6 mesi — TMDB accumula voti lentamente per film recenti
    const from = new Date(now);
    from.setMonth(from.getMonth() - 6);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = now.toISOString().slice(0, 10);

    const base = 'https://api.themoviedb.org/3/discover';

    // Niente filtro provider: TMDB ha dati streaming Italia molto incompleti.
    // Selezioniamo film/serie popolari di qualità — Groq poi filtra per gusto.
    // without_genres esclude romance puro (10749) e family (10751) a monte.
    const commonQ = `api_key=${TMDB_KEY}&language=it-IT`
      + `&vote_average.gte=6.8&vote_count.gte=50`
      + `&without_genres=10749%2C10751`
      + `&sort_by=popularity.desc`;

    const [movRes, tvRes] = await Promise.all([
      fetch(`${base}/movie?${commonQ}&primary_release_date.gte=${fromStr}&primary_release_date.lte=${toStr}`),
      fetch(`${base}/tv?${commonQ}&first_air_date.gte=${fromStr}&first_air_date.lte=${toStr}`),
    ]);

    const movData = movRes.ok ? await movRes.json() : {};
    const tvData  = tvRes.ok  ? await tvRes.json()  : {};

    const candidates = [
      ...(movData.results || []).slice(0, 20).map(m => ({
        id:        `movie-${m.id}`,
        type:      'movie',
        mediaType: 'Film',
        title:     m.title || m.original_title,
        overview:  (m.overview || '').slice(0, 200),
        rating:    Math.round((m.vote_average || 0) * 10) / 10,
        poster:    m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
        date:      m.release_date,
        link:      `https://www.themoviedb.org/movie/${m.id}`,
      })),
      ...(tvData.results || []).slice(0, 20).map(t => ({
        id:        `tv-${t.id}`,
        type:      'movie',
        mediaType: 'Serie TV',
        title:     t.name || t.original_name,
        overview:  (t.overview || '').slice(0, 200),
        rating:    Math.round((t.vote_average || 0) * 10) / 10,
        poster:    t.poster_path ? `https://image.tmdb.org/t/p/w300${t.poster_path}` : null,
        date:      t.first_air_date,
        link:      `https://www.themoviedb.org/tv/${t.id}`,
      })),
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
          max_tokens: 250,
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
