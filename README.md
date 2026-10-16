# Commenti Facebook → Excel

Estensione Chrome Manifest V3: inserisci il permalink di un post e scarica un vero file `.xlsx` con **Username**, **Testo del commento** e **Timestamp**. La raccolta considera i commenti principali, escludendo le risposte riconoscibili dalla struttura della pagina o dal permalink.

## Installazione in Chrome

1. [Scarica lo ZIP dell’estensione](https://github.com/gel76email-cpu/main/raw/refs/heads/main/artifacts/facebook-commenti-excel.zip) ed estrailo in una cartella permanente. Non selezionare direttamente lo ZIP.
2. Apri `chrome://extensions` in Chrome su computer e attiva **Modalità sviluppatore**.
3. Premi **Carica estensione non pacchettizzata** e seleziona la cartella estratta, quella che contiene `manifest.json`.
4. Dal menu Estensioni di Chrome puoi fissare l’icona alla barra.

Se lavori dai sorgenti, dopo la compilazione seleziona invece la cartella `dist/`. Node.js non serve a chi installa il pacchetto già compilato.

### Aggiornamento alla 0.3.0

[Scarica la versione 0.3.0](https://github.com/gel76email-cpu/main/raw/refs/heads/main/artifacts/facebook-commenti-excel-0.3.0.zip) e estraila in una nuova cartella. Da `chrome://extensions` rimuovi la vecchia estensione, quindi usa **Carica estensione non pacchettizzata** sulla nuova cartella. Il popup deve riportare **Versione 0.3.0** in fondo. I commenti persi dalla versione precedente non possono essere recuperati: avvia una nuova raccolta dopo l’aggiornamento.

Questa versione corregge l’interruzione causata dagli eventi di caricamento di Facebook: se il documento resta attivo continua a raccogliere, e se lo stesso post viene ricaricato riprende dai commenti salvati nella sessione. Il conteggio non viene azzerato. Se la scheda viene chiusa o la raccolta si interrompe, **Scarica i commenti salvati** consente di esportare quanto già raccolto.

Il filtro **All comments / Tutti i commenti** viene confermato leggendo il valore effettivo dopo il clic. Se resta **Most relevant**, la raccolta degli altri blocchi si mette in pausa e il popup chiede la selezione manuale; quando il filtro cambia, riprende automaticamente. **View more comments** viene premuto a ogni blocco, aspettando i caricamenti e rileggendo il pulsante se Facebook lo ricrea. È possibile fermare ed esportare un risultato parziale.

Restano supportati il pulsante **Comments** nei video, i link `watch/?v=…` e `watch/live/?v=…`, i pannelli commenti laterali e le righe prive di `role="article"`. Se la lettura fallisce, **Mostra diagnostica** permette di copiare conteggi e informazioni strutturali, senza nomi, testi dei commenti o URL.

## Utilizzo

1. Accedi a Facebook in Chrome con il tuo account.
2. Apri un post e copia il collegamento dalla sua data/ora. Sono supportati permalink con `/posts/`, `/permalink/`, `/videos/`, `/reel/`, `story.php`, `permalink.php`, foto con `fbid` e video `watch/` o `watch/live/` con parametro `v`. Per link brevi `/share/…`, aprili prima e copia il permalink definitivo.
3. Clicca l’icona dell’estensione, incolla il link e premi **Raccogli ed esporta**.
4. Si apre una nuova scheda Facebook. Nei video l’estensione prova prima ad aprire **Comments/Commenti**, poi seleziona e verifica **Tutti i commenti**, espande il testo troncato e carica altri commenti principali premendo ripetutamente **View more comments**. Se il pannello resta chiuso, puoi premere manualmente **Comments** mentre la raccolta attende. Se il popup chiede **Tutti i commenti**, scegli **All comments** dal menu Facebook: la raccolta prosegue senza riavviarla. Non apre volontariamente le risposte e non pubblica nulla.
5. Il popup si può chiudere: riaprilo per leggere l’avanzamento o usare **Ferma e scarica i commenti raccolti**. Tieni aperta la scheda Facebook e, per favorire il caricamento, lasciala in primo piano.
6. Al termine Chrome propone il salvataggio del file Excel. Il foglio **Commenti** contiene le tre colonne richieste; **Informazioni** riporta post, ora dell’esportazione, filtro e motivo della fine della raccolta.

**Username** è il nome visualizzato dall’autore su Facebook, non necessariamente l’handle univoco del profilo. Per commenti contenenti soltanto un’immagine viene esportata la descrizione alternativa disponibile, senza scaricare l’immagine.

**Timestamp** usa una data ISO 8601 UTC quando il DOM contiene un orario esatto. Negli altri casi conserva la data o l’orario relativo mostrato da Facebook, per esempio `2 h`; resta vuoto quando non disponibile. Non converte un orario approssimativo in una data inventata.

## Limiti della raccolta

Questa prima versione legge la pagina aperta nel browser, senza API private o credenziali aggiuntive. La completezza **non è garantita**: commenti nascosti, eliminati, non accessibili al tuo account o non caricati da Facebook non possono essere esportati. Il conteggio di Facebook può includere le risposte e quindi differire dalle righe esportate.

Se il filtro non viene confermato, il popup avvisa e mette in pausa i caricamenti: seleziona manualmente **Tutti i commenti** nella scheda. Se Facebook non consente di selezionarlo, puoi fermare ed esportare i commenti visibili, contrassegnati come risultato parziale. I pulsanti di caricamento sono riconosciuti in italiano e inglese. Cambiamenti nell’interfaccia Facebook possono richiedere un aggiornamento dei selettori in `src/extract.js`, `src/page-controls.js` e `src/collector.js`.

La raccolta finisce dopo otto passaggi consecutivi senza cambiamenti, dopo un arresto manuale o dopo 15 minuti complessivi, inclusi i ricaricamenti. I caricamenti segnalati dalla pagina non vengono conteggiati come passaggi senza cambiamenti. Quando attende il filtro mantiene i commenti raccolti e non scorre la lista filtrata. In assenza di commenti attende fino a 24 passaggi prima di segnalare il problema. Il foglio Informazioni riporta l’esito; l’assenza di nuovi elementi non certifica che Facebook abbia reso disponibili tutti i commenti. I commenti sono deduplicati per ID; in assenza di ID si usa nome, testo e timestamp, quindi due commenti completamente identici senza ID potrebbero essere unificati.

Il ricaricamento dello stesso post riprende la raccolta dai commenti salvati. La chiusura della scheda o il passaggio a un altro post interrompono la raccolta, ma puoi scaricare i commenti già salvati. Il riavvio del browser, la disattivazione o la rimozione dell’estensione azzerano la sessione. Iniziare una nuova raccolta sostituisce la precedente. Dopo un download puoi usare **Scarica i commenti salvati** per esportare di nuovo senza rileggere Facebook.

## Dati e permessi

L’elaborazione e la creazione del file avvengono nel browser. Non vengono inviati commenti a server dell’estensione, né letti o esportati cookie o password. La pagina Facebook continua a effettuare le normali richieste necessarie a mostrare e caricare i commenti.

- Accesso a `https://www.facebook.com/*`: apertura e lettura del post richiesto. I link mobili vengono normalizzati a questo dominio.
- `scripting`: esecuzione del raccoglitore nella sola scheda aperta dall’estensione.
- `storage`: avanzamento e commenti già raccolti nella memoria della sessione Chrome, per consentire ripresa e download dopo un’interruzione. Non viene creato un archivio permanente; questi dati vengono sostituiti alla nuova raccolta o eliminati quando termina la sessione del browser o l’estensione viene disattivata/rimossa.
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

`npm test` verifica parsing dei link, selezione del post, esclusione delle risposte, testo/emoji, timestamp, struttura XLSX, pannelli video, 699 righe simulate, unione dei checkpoint e conferma effettiva del filtro. `npm run test:browser` esegue i bundle reali in Chromium su pagine dinamiche simulate, con **API Chrome simulate**: verifica popup, filtro, caricamento, espansione, esportazione, arresto, chiusura, apertura di Comments e diagnostica. Include eventi di caricamento senza sostituzione del documento, ricaricamento reale con un commento che scompare dal DOM, recupero del file dopo chiusura della scheda, messaggi di un vecchio documento, selezione del filtro non riuscita e più blocchi consecutivi da caricare. Usa `/usr/bin/chromium` oppure il percorso indicato da `CHROMIUM_PATH`. Non avvia servizi persistenti.

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
