# Commenti Facebook → Excel

Estensione Chrome Manifest V3: inserisci il permalink di un post e scarica un vero file `.xlsx` con **Username**, **Testo del commento** e **Timestamp**. La raccolta considera i commenti principali, escludendo le risposte riconoscibili dalla struttura della pagina o dal permalink.

## Installazione in Chrome

1. [Scarica lo ZIP dell’estensione](https://github.com/gel76email-cpu/main/raw/refs/heads/main/artifacts/facebook-commenti-excel.zip) ed estrailo in una cartella permanente. Non selezionare direttamente lo ZIP.
2. Apri `chrome://extensions` in Chrome su computer e attiva **Modalità sviluppatore**.
3. Premi **Carica estensione non pacchettizzata** e seleziona la cartella estratta, quella che contiene `manifest.json`.
4. Dal menu Estensioni di Chrome puoi fissare l’icona alla barra.

Se lavori dai sorgenti, dopo la compilazione seleziona invece la cartella `dist/`. Node.js non serve a chi installa il pacchetto già compilato.

## Utilizzo

1. Accedi a Facebook in Chrome con il tuo account.
2. Apri un post e copia il collegamento dalla sua data/ora. Sono supportati permalink con `/posts/`, `/permalink/`, `/videos/`, `/reel/`, `story.php`, `permalink.php` e foto con `fbid`. Per link brevi `/share/…`, aprili prima e copia il permalink definitivo.
3. Clicca l’icona dell’estensione, incolla il link e premi **Raccogli ed esporta**.
4. Si apre una nuova scheda Facebook. L’estensione prova a selezionare **Tutti i commenti**, espande il testo troncato e carica altri commenti principali. Non apre volontariamente le risposte e non pubblica nulla.
5. Il popup si può chiudere: riaprilo per leggere l’avanzamento o usare **Ferma e scarica i commenti raccolti**. Tieni aperta la scheda Facebook e, per favorire il caricamento, lasciala in primo piano.
6. Al termine Chrome propone il salvataggio del file Excel. Il foglio **Commenti** contiene le tre colonne richieste; **Informazioni** riporta post, ora dell’esportazione, filtro e motivo della fine della raccolta.

**Username** è il nome visualizzato dall’autore su Facebook, non necessariamente l’handle univoco del profilo. Per commenti contenenti soltanto un’immagine viene esportata la descrizione alternativa disponibile, senza scaricare l’immagine.

**Timestamp** usa una data ISO 8601 UTC quando il DOM contiene un orario esatto. Negli altri casi conserva la data o l’orario relativo mostrato da Facebook, per esempio `2 h`; resta vuoto quando non disponibile. Non converte un orario approssimativo in una data inventata.

## Limiti della raccolta

Questa prima versione legge la pagina aperta nel browser, senza API private o credenziali aggiuntive. La completezza **non è garantita**: commenti nascosti, eliminati, non accessibili al tuo account o non caricati da Facebook non possono essere esportati. Il conteggio di Facebook può includere le risposte e quindi differire dalle righe esportate.

Se il filtro non viene riconosciuto, il popup avvisa: seleziona manualmente **Tutti i commenti** nella scheda durante la raccolta. I pulsanti di caricamento sono riconosciuti in italiano e inglese. Cambiamenti nell’interfaccia Facebook possono richiedere un aggiornamento dei selettori in `src/extract.js` e `src/collector.js`.

La raccolta finisce dopo otto passaggi consecutivi senza cambiamenti, dopo un arresto manuale o dopo 15 minuti. Il foglio Informazioni indica queste condizioni; l’assenza di nuovi elementi non certifica che Facebook abbia reso disponibili tutti i commenti. I commenti sono deduplicati per ID; in assenza di ID si usa nome, testo e timestamp, quindi due commenti completamente identici senza ID potrebbero essere unificati.

La chiusura o il ricaricamento della scheda interrompe la raccolta. Il riavvio del browser azzera lo stato della sessione. Per una nuova esportazione si avvia nuovamente la raccolta; non è prevista la ripresa di una precedente sessione.

## Dati e permessi

L’elaborazione e la creazione del file avvengono nel browser. Non vengono inviati commenti a server dell’estensione, né letti o esportati cookie o password. La pagina Facebook continua a effettuare le normali richieste necessarie a mostrare e caricare i commenti.

- Accesso a `https://www.facebook.com/*`: apertura e lettura del post richiesto. I link mobili vengono normalizzati a questo dominio.
- `scripting`: esecuzione del raccoglitore nella sola scheda aperta dall’estensione.
- `storage`: stato di avanzamento nella sessione del browser. Il testo dei commenti non viene salvato in questo archivio.
- `downloads`: salvataggio del file Excel sul computer.

I valori delle celle sono stringhe Excel: un commento che inizia con `=` viene mantenuto come testo e non eseguito come formula. Non viene caricato codice da CDN.

## Sviluppo

Richiede Node.js 22 o successivo. Verificato nell’ambiente cloud con Node.js 24.19.0 e Chromium 154.

```sh
npm ci
npm test
npm run build
npm run test:browser
npm run package
```

`npm run build` ricrea `dist/`; dopo una modifica ricarica l’estensione da `chrome://extensions`. `npm run package` crea lo ZIP pronto da estrarre. La sola dipendenza inclusa nell’estensione è `fflate`, per il contenitore ZIP del formato XLSX. La licenza è nel pacchetto.

`npm test` verifica parsing dei link, selezione del post, esclusione delle risposte, testo/emoji, timestamp e struttura XLSX. `npm run test:browser` esegue i bundle reali in Chromium su una pagina dinamica simulata, con **API Chrome simulate**: verifica popup, messaggi, filtro, caricamento, espansione, esportazione, riapertura del popup, arresto e chiusura della scheda. Usa `/usr/bin/chromium` oppure il percorso indicato da `CHROMIUM_PATH`. Non avvia servizi persistenti.

Il Chromium di questo ambiente vieta l’installazione di estensioni tramite policy amministrativa. Il test con API native dell’estensione e un post Facebook reale autenticato resta da effettuare nel Chrome dell’utente. Non sono stati verificati né il Chrome Web Store né account Facebook reali. Prima dell’uso su molti commenti, confronta l’Excel con un piccolo post di prova, includendo una risposta annidata e un commento lungo.

## Struttura

```text
extension/          Manifest, popup HTML/CSS e istruzioni per l’utente
src/background.js   Coordinamento scheda, stato e download
src/collector.js    Caricamento progressivo e avanzamento
src/extract.js      Riconoscimento di post, commenti e risposte
src/workbook.js     Generazione locale del file XLSX
scripts/            Build, confezionamento e prova browser
test/               Test e pagina Facebook simulata
```
