const https = require('https');

// Id attuale di Claude Sonnet, da https://platform.claude.com/docs/en/models/overview
var MODEL = 'claude-sonnet-5-5';
// Il pensiero conta in max_tokens. Effort basso e niente pensiero iniziale:
// chat e quiz restano brevi e costano meno del default "high".
var MAX_TOKENS = 2048;
var MAX_BODY_BYTES = 100 * 1024;
var ANTHROPIC_VERSION = '2026-10-21';

var HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

var BANCA = 'Negli esempi pratici usa la banca immaginaria del percorso: un assistente interno che risponde agli operatori usando i manuali delle procedure (reset password, apertura conto, blocco carta).';

var PROMPT_DEFAULT = 'Sei un tutor AI per Andrea, che studia per diventare full stack LLM developer. Rispondi sempre in italiano. Sei conciso ma preciso. ' + BANCA;

var PROMPT_QUIZ_SYS = 'Sei un generatore di quiz tecnici. Rispondi SOLO con JSON valido, mai testo aggiuntivo.';

var PROMPT_QUIZ_MODULO_SYS = 'Sei un tutor AI che genera quiz per chi impara da zero. Crei domande chiare, ancorate ai concetti del modulo, con linguaggio semplice. Rispondi SOLO con JSON valido, nessun testo fuori dal JSON.';

var PROMPT_QUIZ_RETRY_SYS = 'Rispondi SOLO con JSON valido. Nessun testo fuori dal JSON. Nessun apostrofo nei valori stringa: usa solo virgole e punti.';

var PROMPT_ESERCIZIO_SYS = 'Sei un trainer tecnico. Crei esercizi pratici. Rispondi SOLO con JSON valido.';

var PROMPT_SPIEGA_SYS = 'Sei un tutor che aiuta chi impara AI e LLM da zero. Il tuo compito è aiutare lo studente a capire e rispondere a una domanda di quiz, senza mai rivelare la risposta corretta. Rispondi in italiano, tono amichevole, massimo 4-5 righe. Struttura: 1) spiega cosa chiede la domanda in parole semplici, 2) dai un suggerimento per ragionare ("pensa a...", "ricorda che..."). Non dire mai quale opzione è corretta.';

var PROMPT_ANALISI_SYS = 'Sei un tutor AI specializzato in AI e LLM che aiuta chi impara da zero. Generi documenti di approfondimento personalizzati basati sullo storico di studio dello studente. Usi sempre linguaggio semplice, esempi concreti della vita reale, tono incoraggiante. Mai gergo accademico. Rispondi in italiano. ' + BANCA;

function risposta(status, payload) {
  return {
    statusCode: status,
    headers: HEADERS,
    body: payload === '' ? '' : JSON.stringify(payload)
  };
}

function dettaglioSicuro(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value).slice(0, 500).replace(/sk-ant-[A-Za-z0-9_\-]+/g, '[redacted]');
}

function errore(status, messaggio, dettaglio) {
  console.error('[claude]', messaggio, dettaglioSicuro(dettaglio));
  return risposta(status, { error: messaggio });
}

function clip(value, max) {
  if (typeof value !== 'string') return '';
  var text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (text.length > max) text = text.slice(0, max);
  return text;
}

function messaggiChat(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 30) return null;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item || (item.role !== 'user' && item.role !== 'assistant')) return null;
    if (typeof item.content !== 'string') return null;
    var text = clip(item.content, 8000);
    if (!text) return null;
    out.push({ role: item.role, content: text });
  }
  return out;
}

function promptTutor(contesto) {
  return 'Sei il tutor personale di Andrea, uno studente che sta imparando AI e LLM da zero partendo da basi di programmazione. '
    + (contesto ? 'Contesto attuale dello studente: ' + contesto + ' ' : '')
    + 'Rispondi in italiano. '
    + 'Quando spieghi un concetto: vai in profondità, usa terminologia tecnica ma spiegala sempre la prima volta che appare, porta almeno un esempio pratico concreto della vita reale. '
    + 'Non essere superficiale: se il concetto è complesso, spiegalo per bene, anche in più paragrafi se serve. '
    + 'Se il concetto ha un\'analogia con qualcosa di quotidiano, usala. '
    + BANCA + ' '
    + 'Tono amichevole e incoraggiante, mai accademico o freddo. '
    + 'Puoi rispondere a qualsiasi domanda su AI, LLM, machine learning, coding o concetti collegati al percorso di studio. '
    + 'Se l\'utente ha un\'idea imprecisa, correggilo gentilmente con la spiegazione corretta.';
}

function promptApprofondisci(titolo, argomento) {
  return 'Sei un tutor AI specializzato in AI e LLM. '
    + 'L\'utente sta approfondendo il modulo "' + (titolo || 'modulo') + '" (argomento: ' + (argomento || 'AI e LLM') + '). '
    + 'Rispondi in italiano. Quando spieghi un concetto: vai in profondità, usa terminologia tecnica ma spiegala sempre quando appare, porta almeno un esempio pratico concreto della vita reale. '
    + 'Non essere superficiale: se il concetto è complesso, spiegalo per bene. '
    + 'Tono incoraggiante, mai accademico o freddo. '
    + 'Se l\'utente ha un\'idea imprecisa, correggilo gentilmente con la spiegazione corretta. '
    + BANCA;
}

function promptQuiz(argomento) {
  return 'Genera esattamente 3 domande a risposta multipla (A/B/C/D) per testare la comprensione di: ' + argomento + '. '
    + 'Rispondi SOLO con JSON valido, nessun testo prima o dopo, in questo formato esatto: '
    + '{"questions":[{"q":"testo domanda","options":["A) testo","B) testo","C) testo","D) testo"],"correct":0,"explanation":"perché la risposta è corretta"}]}. '
    + 'correct è l\'indice 0-3 della risposta corretta. Le domande devono essere pratiche e concrete, non banali.';
}

function promptQuizModulo(argomento) {
  return 'Argomento del modulo: ' + argomento + '.\n\n'
    + 'Crea un mini-ripasso flash (3 bullet) e 3 domande quiz sui concetti di questo modulo.\n'
    + 'Le domande devono essere comprensibili a chi impara AI e LLM da zero.\n\n'
    + 'Rispondi SOLO con JSON valido, senza apostrofi nei valori stringa:\n'
    + '{"ripasso":["bullet1","bullet2","bullet3"],"questions":[{"q":"domanda","options":["A) testo","B) testo","C) testo","D) testo"],"correct":0,"explanation":"spiegazione breve"}]}';
}

function promptQuizRetry(argomento) {
  return 'Argomento: ' + argomento + '. Crea 3 bullet ripasso e 3 domande quiz. JSON: {"ripasso":["bullet1","bullet2","bullet3"],"questions":[{"q":"domanda","options":["A) ...","B) ...","C) ...","D) ..."],"correct":0,"explanation":"spiegazione","external":false,"concetto_base":""}]}';
}

function promptEsercizio(titolo, argomento) {
  return 'Crea un esercizio pratico sul modulo "' + (titolo || 'esercizio') + '", argomento: ' + argomento + '. '
    + 'Contesto: developer in una banca immaginaria che costruisce un assistente AI interno per gli operatori, basato sui manuali delle procedure.\n\n'
    + 'Rispondi SOLO con JSON valido in questo formato:\n'
    + '{"scenario":"descrizione situazione concreta max 3 righe","steps":["step 1 cosa fare","step 2","step 3","step 4"],"prompt_da_copiare":"il prompt esatto da incollare su Claude per fare questo esercizio","suggerimento":"cosa osservare o imparare"}\n\n'
    + 'I passi devono essere pratici e fattibili su claude.ai. Il prompt deve essere pronto da copiare-incollare.';
}

function promptAnalisi(contesto, contenuto) {
  return 'Lo studente ha fatto questa sessione di studio (storico completo):\n\n'
    + 'MODULI TOCCATI: ' + (contesto || 'nessuno') + '\n\n'
    + 'DETTAGLIO ATTIVITA:\n' + contenuto + '\n\n'
    + 'Genera un documento di approfondimento personalizzato. '
    + 'Per ogni concetto dove ha fatto fatica (errore quiz o click lampada): '
    + 'spiegalo da zero con linguaggio semplice e almeno un esempio pratico della vita reale. '
    + 'Collega i concetti tra loro dove ha senso. '
    + 'Alla fine dai 2-3 consigli su cosa studiare dopo. '
    + 'Tono amichevole, mai accademico. Lunghezza: completo e dettagliato, ma resta entro circa 900 token. '
    + BANCA;
}

function promptSpiega(domanda) {
  return 'Domanda del quiz: ' + domanda + '\n\nAiutami a capire cosa chiede e come ragionare per rispondere, senza dirmi la risposta.';
}

function costruisci(body) {
  var mode = clip(body.mode, 40);
  var title = clip(body.title, 200);
  var topic = clip(body.topic, 1500);
  var context = clip(body.context, 4000);
  var content = clip(body.content, 12000);

  if (mode === 'default') {
    var chat = messaggiChat(body.messages);
    if (!chat) return { errore: 'Scrivi un messaggio.' };
    return { system: PROMPT_DEFAULT, messages: chat };
  }
  if (mode === 'tutor') {
    var tutorChat = messaggiChat(body.messages);
    if (!tutorChat) return { errore: 'Scrivi un messaggio.' };
    return { system: promptTutor(context), messages: tutorChat };
  }
  if (mode === 'approfondisci') {
    var approChat = messaggiChat(body.messages);
    if (!approChat) return { errore: 'Scrivi un messaggio.' };
    if (!title && !topic) return { errore: 'Manca l\'argomento.' };
    return { system: promptApprofondisci(title, topic), messages: approChat };
  }
  if (mode === 'quiz') {
    if (!topic) return { errore: 'Manca l\'argomento.' };
    return { system: PROMPT_QUIZ_SYS, messages: [{ role: 'user', content: promptQuiz(topic) }] };
  }
  if (mode === 'quiz_modulo') {
    if (!topic) return { errore: 'Manca l\'argomento.' };
    return { system: PROMPT_QUIZ_MODULO_SYS, messages: [{ role: 'user', content: promptQuizModulo(topic) }] };
  }
  if (mode === 'quiz_modulo_retry') {
    if (!topic) return { errore: 'Manca l\'argomento.' };
    return { system: PROMPT_QUIZ_RETRY_SYS, messages: [{ role: 'user', content: promptQuizRetry(topic) }] };
  }
  if (mode === 'esercizio') {
    if (!topic) return { errore: 'Manca l\'argomento.' };
    return { system: PROMPT_ESERCIZIO_SYS, messages: [{ role: 'user', content: promptEsercizio(title, topic) }] };
  }
  if (mode === 'analisi') {
    if (!content) return { errore: 'Manca il testo.' };
    return { system: PROMPT_ANALISI_SYS, messages: [{ role: 'user', content: promptAnalisi(context, content) }] };
  }
  if (mode === 'spiega_domanda') {
    if (!content) return { errore: 'Manca il testo.' };
    return { system: PROMPT_SPIEGA_SYS, messages: [{ role: 'user', content: promptSpiega(content) }] };
  }
  return { errore: 'Richiesta non valida.' };
}

function chiamaAnthropic(payload) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve({ status: res.statusCode, body: data }); });
    });
    req.setTimeout(20000, function() { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function corpoRichiesta(event) {
  var raw = event.body || '';
  if (event.isBase64Encoded && raw) {
    raw = Buffer.from(raw, 'base64').toString('utf8');
  }
  return raw;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return risposta(200, '');
  }
  if (event.httpMethod !== 'POST') {
    return errore(405, 'Metodo non consentito.', event.httpMethod);
  }

  var raw = corpoRichiesta(event);
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return errore(413, 'Richiesta troppo grande.', 'bytes=' + Buffer.byteLength(raw, 'utf8'));
  }

  var body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    return errore(400, 'Richiesta non valida.', 'json');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errore(400, 'Richiesta non valida.', 'body');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'system')) {
    console.error('[claude] system dal client ignorato');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return errore(500, 'Servizio non disponibile.', 'ANTHROPIC_API_KEY assente');
  }

  var built = costruisci(body);
  if (built.errore) {
    return errore(400, built.errore, 'mode=' + clip(body.mode, 40));
  }

  var payload = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: built.system,
    messages: built.messages,
    output_config: { effort: 'low' },
    thinking: { type: 'between_tools' }
  });

  var response;
  try {
    response = await chiamaAnthropic(payload);
  } catch (err) {
    return errore(502, 'Non riesco a rispondere ora. Riprova tra poco.', err && err.message);
  }

  if (!response.status || response.status < 200 || response.status >= 300) {
    return errore(502, 'Non riesco a rispondere ora. Riprova tra poco.', 'status=' + response.status + ' body=' + String(response.body || '').slice(0, 500));
  }

  try {
    JSON.parse(response.body);
  } catch (err) {
    return errore(502, 'Risposta non disponibile.', 'json upstream');
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: response.body
  };
};
