# Aplikacija v2 Premiere UXP

Panel cilja Adobe Premiere 25.6+ i UXP manifest v5. Razvojno učitavanje ide kroz UXP Developer Tool 2.2+.

1. U desktop aplikaciji otvori job i pripremi Premiere workspace.
2. U Premiere panelu odaberi `manifest.json` iz tog workspacea.
3. Panel importuje `Media` fajlove, kreira sequence i dodaje Storyboard markere.
4. Starije Premiere verzije koriste isti `Media`, `OFF`, `Brief` i `Exports` folder bez plugina.

Za produkcijsku CCX distribuciju zamijeniti razvojni plugin ID ID-em iz Adobe Developer Distribution portala.

Reference:

- https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/markers
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/ticktime
