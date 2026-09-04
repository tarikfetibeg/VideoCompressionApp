# Finalni master: zastita, integritet i retencija

## 1. Cilj

Ovaj dokument opisuje zastitu kompletnih finalnih emisija. Zastita je
aplikacijska i integritetska: kontrola pristupa, nepromjenjive verzije,
checksum, proxy-only pregled, karantin, odgodjeni purge i trajni audit.

Nisu uvedeni BitLocker, per-file enkripcija, DRM ni zabrana screen capturea.
Ko moze gledati autorizovani proxy tehnicki moze snimiti ekran.

## 2. Lanac ingesta

Za svaki master sistem radi sljedece:

1. cita izvor i racuna SHA-256;
2. kopira u `storage/program-finals/masters/<programFinalId>/`;
3. racuna SHA-256 kopije;
4. registruje verziju tek kada se hash podudara;
5. cuva relativnu putanju unutar storage root-a;
6. pokrece zaseban proxy queue;
7. uklanja upload temp ili premjesta watched izvor tek nakon verifikacije.

Master bajtovi se ne transkodiraju i ne mijenjaju. Nova isporuka za isto
izdanje povecava `versionNumber`; ne prepisuje prethodni fajl.

Isti SHA-256 za isto izdanje je idempotentni duplikat. Isti SHA-256 u drugom
izdanju moze dijeliti fizicki master, ali svako izdanje ima vlastitu verziju,
proxy, status i audit trag.

## 3. Proxy-only pristup

Javni pregled koristi samo:

- HLS 720p/480p;
- access H.264/AAC MP4 sa Range podrskom;
- thumbnail;
- scrub JPG frameove.

Master nema HTTP stream ni download rutu. Kratkotrajni
`ProgramFinalMediaTicket` cuva samo hash tokena i vezu korisnik-final-verzija.
Ticket se provjerava za manifest, segment i MP4 Range zahtjev.
Default TTL je 120 minuta. Player trazi novi ticket prije isteka, a server
ogranicava upis `useCount/lastUsedAt` na najvise jednom u 60 sekundi po
ticketu kako HLS segmenti ne bi pravili nepotrebne MongoDB write operacije.

Ako verzija pripada Media Edgeu, isti ticket se servira na potpisanoj Edge
HLS ruti. Edge ponavlja provjeru ticket zapisa, korisnika, statusa finala,
verzije i sigurne relativne putanje za svaki manifest, segment ili MP4 Range
zahtjev. Originalni master nije dio tog routea.

Provjere obuhvataju:

- TTL;
- postojanje korisnika i podrzanu rolu;
- pravo na archived ili pending verziju;
- pripadnost verzije finalu;
- dozvoljen status verzije;
- containment unutar `program-final-previews`;
- odbijanje path traversal putanja.

Karantin odmah prekida i ranije izdate tickete jer status verzije vise nije
dozvoljen.

## 4. Fixity

SHA-256 je dokaz da se trenutni bajtovi podudaraju sa hashom zabiljezenim pri
ingestu. Nije dokaz autorskog porijekla niti zamjena za backup.

Scheduler van radnog vremena bira jednu najstarije neprovjerenu aktivnu,
spremnu ili superseded verziju dnevno. Default prozor je
`PROGRAM_FINAL_FIXITY_HOUR=3`. Admin moze pokrenuti jednu provjeru rucno.
U hybrid instalaciji postaviti `PROGRAM_FINAL_FIXITY_OWNER=edge`; API tada ne
pokrece isti dnevni posao, pa nema dvostrukog citanja velikog mastera.

Rezultati:

- `ok`: hash se podudara;
- `mismatch`: hash je drugaciji i verzija ide u karantin;
- `missing`: master nedostaje i verzija ide u karantin;
- `error`: provjera nije zavrsena; fajl se ne brise.

Mismatch emituje critical notifikaciju Arhivisti i Adminu i upisuje Audit
Log. Rolling pristup je namjerno blag prema ogranicenom hardveru. Vece kuce
mogu povecati frekvenciju tek nakon mjerenja I/O opterecenja.

## 5. Karantin

Samo Admin moze staviti verziju u karantin. Razlog od najmanje pet znakova je
obavezan.

- Nedijeljeni master se atomarno premjesta u
  `storage/program-finals-quarantine/<versionId>/`.
- Dijeljeni master se kopira u karantin; druge reference ostaju netaknute.
- Originalna relativna putanja se cuva za restore.
- Aktivni final dobija status `quarantined`.
- Proxy prestaje biti dostupan kroz ticket.
- `purgeEligibleAt` je default 30 dana nakon karantina.

Restore ponovo provjerava da su karantinska i eventualna dijeljena kopija
jednake evidentiranom SHA-256 prije uklanjanja viska i vracanja statusa.

## 6. Purge i tombstone

Purge je dozvoljen samo kada:

- verzija je u karantinu;
- istekao je `PROGRAM_FINAL_QUARANTINE_DAYS`, default 30;
- Admin ponovo unese razlog;
- potvrda tacno odgovara ID-u ili naslovu finala.

Brise se samo master koji nema drugu aktivnu referencu i proxy folder te
verzije. Program Final metadata ostaje sa tombstone zapisom: vrijeme, Admin,
razlog i checksum. Audit Log se ne brise.

Purge nije backup politika. Produkcija mora imati zaseban backup/replication
plan za master storage i MongoDB.

## 7. Putanje i filesystem granice

Sve trajne DB putanje su relativne prema storage root-u. Prije citanja,
premjestanja ili brisanja koriste se canonical resolve i containment provjera.
Symlink ili `../` ne smiju izvesti operaciju iz dozvoljenog root-a.

Folderi:

```text
storage/program-finals/masters/
storage/program-final-previews/
storage/program-finals-quarantine/
```

Inbox nije trajni arhivski master i cisti se samo kroz uspjesan watched import
ili eksplicitnu operativnu akciju.

## 8. Verzije i aktivacija

`pendingVersion` je nova verzija koja jos ceka pregled.
`activeVersion` je jedina verzija koju sve role vide u arhivi.

Arhivska potvrda:

1. zahtijeva confirmed air, checksum, proxy i najmanje jedan credit;
2. staru aktivnu verziju oznacava `superseded`;
3. pending oznacava `active`;
4. cuva ko i kada je aktivirao verziju;
5. cuva warning override i razlog;
6. emituje domain event i Audit Log.

Superseded verzija se ne brise automatski.

## 9. Operativni odgovor na incident

### Checksum mismatch

1. Ne vracati verziju bez istrage.
2. Provjeriti fizicki disk, filesystem i backup.
3. Uporediti originalni ingest zapis i eventualnu drugu SHA-identicnu kopiju.
4. Ako je zdrava kopija potvrdena, vratiti ili ingestovati novu verziju.
5. Evidentirati razlog i rezultat u incident logu.

### Master nedostaje

1. Provjeriti mount/Media Edge dostupnost prije zakljucka da je fajl obrisan.
2. Ne mijenjati DB putanju rucno.
3. Vratiti iz backupa ili ponovo ingestovati kao novu verziju.

### Pogresan final

Ne prepisivati aktivni master. Uploadovati ispravan fajl kao novu verziju,
pregledati proxy i aktivirati ga arhivskom potvrdom. Staru verziju po potrebi
staviti u karantin.

## 10. Retencija

Trenutna politika:

- active i superseded masteri: bez automatskog brisanja;
- HLS/access/thumbnail/scrub: bez automatskog brisanja;
- quarantine: minimalno 30 dana prije rucnog purgea;
- tombstone, checksum i Audit Log: trajno;
- media ticket dokument: TTL uklanjanje po isteku.

Cold proxy cleanup i automatska dugorocna retencija nisu ukljuceni. Prije
njihovog uvodjenja treba definisati pravnu, urednicku i backup politiku TV
kuce.

## 11. Ogranicenja i prijetnje

Sistem stiti od slucajnog prepisivanja, neovlastenog aplikacijskog downloada,
path traversala, neprimijecene promjene bajtova i trenutnog destruktivnog
brisanja.

Sistem sam ne stiti od:

- kompromitovanog Admin naloga ili host OS-a;
- direktnog filesystem pristupa izvan aplikacije;
- gubitka jedinog diska;
- ransomwarea;
- screen capturea autorizovanog proxyja;
- pravno pogresne retencijske odluke.

Zato su odvojeni OS pristup, backup, antimalware, disk monitoring i povremeni
restore test obavezni produkcijski slojevi.

## 12. QA

- Namjerno promijeniti kopiju testnog mastera i potvrditi mismatch + karantin.
- Potvrditi da ticket izdat prije karantina vise ne radi.
- Restore dijeljenog mastera ne smije obrisati master druge verzije.
- Purge prije 30 dana mora vratiti konflikt bez filesystem promjene.
- Pogresna tekstualna potvrda purgea mora biti odbijena.
- Path traversal i symlink izlaz moraju biti odbijeni.
- Failed/purged verzija ne smije biti checksum izvor za deduplikaciju.
- Proxy build failure mora sacuvati prethodnu aktivnu verziju i master.
- Audit mora sadrzati checksum, verziju, korisnika, razlog i rezultat.

## 13. Reference

- [PREMIS Data Dictionary 3.0](https://www.loc.gov/standards/premis/v3/premis-3-0-final.pdf):
  fixity, event, agent i preservation metadata.
- [Library of Congress: File Fixity and Data Integrity](https://blogs.loc.gov/thesignal/2014/04/protect-your-data-file-fixity-and-data-integrity/):
  periodicke provjere, zapis rezultata i reakcija na mismatch.
- [PBCore Instantiation](https://pbcore.org/elements/pbcoreinstantiation.html):
  zasebne fizicke/digitalne instancije jednog programskog izdanja.
- [EBUCore 1.8](https://tech.ebu.ch/docs/tech/tech3293v1_8.pdf):
  broadcast metadata i contributor/role koncepti.
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal):
  canonical path i containment provjere.
- [NIST Secure Hash Standard FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final):
  SHA-256 tehnicka osnova.
