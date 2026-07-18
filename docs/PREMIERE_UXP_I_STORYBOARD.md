# Premiere UXP i Reporter Storyboard

## Storyboard MVP

Reporter slaže klipove, IN/OUT tačke i napomenu. `RoughCut` je verzioniran; `PUT` mora poslati trenutno poznatu verziju. Ako je neko već sačuvao noviju verziju API vraća 409 i ne prepisuje podatke. Submit šalje action-required notifikaciju dodijeljenom montažeru ili Producentu ako montažer nije dodijeljen.

Storyboard ne renderuje video, ne skriva original i nema efekte ili više traka. Montažer uvijek vidi cijele sirovine i reporterski prijedlog odvojeno.

### Operativni UI

- Workflow traka razdvaja redoslijed, rezove/napomene i slanje montaži.
- Lijevi panel je kompaktna sekvenca sa lazy thumbnail/scrub previewom i
  tastaturno dostupnim izborom klipa.
- Desni panel uređuje samo trenutno odabrani klip: veliki scrub preview,
  frame-step slider, precizne vrijednosti u sekundama/timecodeu i napomenu.
- Gornji pregled cjeline proporcionalno prikazuje trajanje svakog klipa.
- Nacrt se autosaveuje nakon 900 ms mirovanja. Ako korisnik nastavi pisati dok
  je save u toku, novija lokalna revizija ostaje dirty i čuva se u sljedećem
  prolazu.
- Novi Storyboard bez verzije može se odmah poslati: klijent prvo kreira
  verziju 1, a tek zatim poziva submit endpoint.
- `beforeunload` štiti nesačuvane izmjene, a server i dalje odbija zastarjelu
  verziju sa `409` bez prepisivanja tuđeg rada.

## Lokalni workspace

Tauri komanda priprema:

```text
<app-data>/workspaces/<jobId>/
  Media/
  OFF/
  Brief/brief.txt
  Exports/
  manifest.json
```

Fajlovi se skidaju native streamom; postojeći fajl se ne preuzima ponovo. `Exports` watcher čeka stabilnu veličinu fajla najmanje tri sekunde i šalje Windows obavijest da je final spreman za job.

## UXP panel

Panel u `apps/premiere-uxp` cilja Premiere 25.6+, UXP v8.1 kompatibilni API i manifest v5. Učitava workspace manifest, poziva `Project.importFiles`, pravi sequence sa `createSequenceFromMedia`, zatim koristi `Markers`, `TickTime` i jednu undoable transakciju za Storyboard markere. Starije Premiere verzije koriste isti folder i manifest ručno.

Prije enterprise CCX distribucije razvojni plugin ID mora se zamijeniti ID-em iz Adobe Developer Distribution portala. UXP Developer Tool koristi se za load/watch i packaging provjeru.

## Reference

- [Premiere UXP uvod](https://developer.adobe.com/premiere-pro/uxp/introduction/)
- [UXP manifest v5](https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/)
- [Project import i sequence API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project)
- [Markers API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/markers)
- [TickTime API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/ticktime)
- [UXP package/CCX](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/package/)
