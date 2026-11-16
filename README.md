# Studio LLM

Dashboard di studio per un percorso di circa sei mesi su AI e LLM: spiegazioni, quiz, esercizi e un tutor. È una pagina statica (`index.html`) più una funzione Netlify che chiama Claude.

I prompt del tutor stanno solo sul server. Il browser invia la modalità (`mode`) e il contenuto dell'utente (domanda, argomento, titolo o contesto di studio). Un eventuale `system` mandato dal client viene ignorato.

## Netlify

`netlify.toml` pubblica la root del repository e le funzioni in `netlify/functions`.

1. Collega questo repository a un sito Netlify.
2. In **Site configuration → Environment variables** aggiungi solo `ANTHROPIC_API_KEY`, la chiave dell'API Anthropic. Non servono altre variabili.
3. Fai il deploy. La funzione risponde su `/.netlify/functions/claude`.

La chiave non va nel codice, nella pagina e nemmeno in git. `.gitignore` esclude i file `.env`.

La funzione usa il modello `claude-sonnet-5-5`. Il CORS resta quello di prima: `Access-Control-Allow-Origin: *`. Nessun filtro sull'origine e nessun codice di accesso.

## Firebase

Il progresso (fasi sbloccate, moduli segnati come studiati, log della sessione) è salvato su Cloud Firestore. La configurazione del progetto è già nella pagina: questo cambiamento non la tocca e non aggiunge variabili d'ambiente Firebase. Quella configurazione è il config web del progetto già in uso, non la chiave Anthropic.

## Quiz e chiamate a Claude

All'apertura della pagina non parte nessuna chiamata a Claude. I quiz di sblocco sono HTML statico. Il quiz della fase 1 (token, temperatura, embedding) sblocca la fase RAG con almeno 2 risposte su 3. Se non si supera, dopo qualche secondo si ripropongono le stesse domande.

«Genera quiz» dentro i moduli, il tutor, approfondisci, gli esercizi e «Analizza il mio studio» chiamano Claude solo quando li usi.
