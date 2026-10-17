# QA na stvarnim uredjajima

Aktuelni izolovani run: `2026-10-10T20-20-25-120Z-eba6ec`.
URL: `http://192.168.0.5:5114`. Ne koristiti port 5000 niti produkcijske racune.
Hash koda/builda je u `run-identity.json` ovog runa.
Privremeni racuni su samo u ignorisanom `.qa-private/`; ovaj izvjestaj nema lozinku.

## Nacin biljezenja

Za svaki korak upisati uredjaj, OS/browser verziju, datum, rezultat i dokaz.
Korisnikova potvrda je `user-reported`, ne automatski instrumentovani rezultat.
Nedostupan uredjaj/mreza je `blocked`, ne `passed`.

Korisnik je 10.10.2026. potvrdio uspjesne rezultate za Android i desktop.
Telefon je Xiaomi 14; na oba uredjaja koristi Mozilla Firefox. Browser/OS
verzije nisu navedene. Dogovorene osnovne provjere su user-reported success,
ne zasebno instrumentovani dokazi svake role/kontrole. Testiranje je zavrseno;
QA helper je ugasen i 5114/27114 su slobodni. Kasnija z-index izmjena
re-login dijaloga provjerena je zasebnom automatizovanom mobilnom regresijom.

| ID | Scenario / ocekivanje | Android | LAN racunar |
| --- | --- | --- | --- |
| D01 | URL/login | user-reported success; wrong-password branch nije izdvojena | user-reported success; wrong-password branch nije izdvojena |
| D02 | Osnovna navigacija i otvaranje joba | user-reported success; svaki comment/append korak nije izdvojen | isto |
| D03 | Preview/detalji i seek | user-reported success; svi category/marker koraci nisu izdvojeni | isto |
| D04 | Download: sacuvani fajl i SPA navigacija dok traje | user-reported success | user-reported success |
| D05 | Realizator rundown i prijava s timestampom | nije posebno potvrdeno | nije posebno potvrdeno |
| D06 | Touch/portrait-landscape, dijalog/drawer | osnovni tok user-reported; kompletna focus matrica nije potvrdena | osnovni tok user-reported; kompletna focus matrica nije potvrdena |
| D07 | Android file picker/upload malog testnog videa | user-reported success | nije primjenjivo |
| D08 | Admin Storage/media alati | nije posebno potvrdeno | nije posebno potvrdeno |

## Blokirano ili posebno

- Druga mreza: korisnik ima samo postojeci pristup portu 5000. Taj pristup
  nije preusmjeren na QA; ne dokazuje aktuelni QA build. Potreban je zaseban
  odobren tunnel/VPN ili privremeni pristup QA portu.
- iPhone/Safari: korisnik je potvrdio Android, ne iPhone. WebKit emulator nije
  zamjena za fizicki Safari playback/file picker.
- Firefox: lokalni Playwright engine nije pokrenut. Korisnik je dao zaseban
  uspjesan user-reported rezultat svog instaliranog Firefoxa na oba uredjaja.
- Ne mijenjati firewall pravila, port forwarding ili produkcijski server
  bez zasebnog dogovora. Neuspjelo otvaranje 5114 biljezi se kao mreza/okruzenje
  dok se ne utvrdi uzrok, ne automatski kao greska aplikacije.
