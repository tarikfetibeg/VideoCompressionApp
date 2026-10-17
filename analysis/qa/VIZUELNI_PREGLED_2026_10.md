# Dodatni vizuelni pregled sacuvanih QA snimaka

Datum: 11.10.2026. Snimci pripadaju finalnom aplikacijskom source/build
identitetu iz `2026-10-10T21-23-23-233Z-f152f2` i UI acceptance runa
`2026-10-10T21-25-49-674Z-648781`. Ovo je odabrani pregled, ne svih stanja.

Pregledano bez naknadnog mijenjanja slika:

- Archivist 320x568: header, statusi, naslov, refresh i prvi KPI red su citljivi;
  ne vide se sudari elemenata u ovom viewportu. Materijal tabela je ispod
  prvog ekrana i nije dokazana ovim snimkom.
- Editor 320x568: naslov, statusi, refresh/direct-final akcije i KPI red
  stanu u sirinu; nema vidljivog preklapanja. Sirovine/dialog nisu na slici.
- Realizator 320x568: duzi statusi i glavne akcije prelaze u nove redove;
  program selektor je dostupan. Stavke rundowna su ispod vidljivog dijela.
- Producer 1920x1080: navigacija, status bar, correction empty state i
  filteri imaju odvojene citljive zone. Ostalo je vise engleskih labela
  (My shows, Refresh, Air date, Content type, Search TV archive, Show rundown).
  To je otvoren lokalizacijski polish, ne potvrda kompletne BHS lokalizacije.

## Ranije ogranicenje native zoom slika

Pregledane `zoom-Reporter-1.25.png` i `zoom-Reporter-4.png` prikazuju samo
gornji/lijevi dio uvecanog sadrzaja. Native zoom JSON potvrduje stvarni
CSS viewport/DPR i overflow mjerenje, ali ovi PNG-ovi sami ne dokazuju
vizuelnu ispravnost citavog ekrana. Potreban je dodatni neodsijeceni capture;
ne pripisivati ovaj screenshot artefakt automatski frontend layoutu.

Ovo capture ogranicenje je popravljeno kroz CDP snimanje punog fizickog
viewporta i provjeru PNG dimenzija. Run11-33-07-270Z-4c1dfd prvi je pokazao
neodsijecen originalni header pri400%: zauzimao je oko75% visine.
Korisnik je odobrio aplikacijsku popravku, a ne samo crop slike.

## Potvrdjena header popravka

`2026-10-11T11-56-49-891Z-57f7fb`: dodatno pregledani Reporter4 initial i
scrolled PNG-ovi. Prvi je neodsijecen, sve header akcije i transfer brojaci
su citljivi. Drugi prikazuje radni sadrzaj bez headera preko njega.
JSON za svih7rola biljezi106CSSpx header u201CSSpx visine i static poziciju;
idle pocetni content prostor47,3%. Pri scrollu header potpuno izlazi.
Svi28native zoom koraka su prolazni, ukljucujuci provjere dostupnosti akcija,
idle height budzet, odsustvo page overflowa i fizicke PNG dimenzije.

Kompaktni stilovi vaze samo do400CSSpx visine. Tehnicka polling napomena
i sekundarni opis role tada nisu prikazani; funkcije i svi transfer brojaci
ostaju. Visoki viewport zadrzava sticky poziciju. P2 header nalaz je zatvoren
na osnovu ove provjere; to nije tvrdnja da su pregledana sva dialog/transfer
stanja u svakom zoom/viewport spoju.

Poznati rani session screenshot tokom MUI Fade tranzicije ostaje historijski
ogranicen dokaz. Novi capture ceka opacity1 aktivnog dialoga i njegovog
backdropa; skriveni navigacijski backdrop ne smije biti predmet tog cekanja.
