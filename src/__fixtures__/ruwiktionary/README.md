Real Russian Wiktionary pages (ru.wiktionary.org), saved on 2026-10-05 for
`src/wiktionary.test.js`. Each file is one page exactly as the MediaWiki API
returns it (`action=query&prop=revisions&rvprop=content&rvslots=main&formatversion=2`),
trimmed to its title and wikitext. Text is Wiktionary's own content
(CC BY-SA 4.0); kept here only so the parser can be tested without a network
call.

| File | Page | Why it's here |
| --- | --- | --- |
| `jesti-cyrillic.json` | `јести` | Serbian only; a label template and an example |
| `jesti-latin.json` | `jesti` | Latin title; Serbian among Bosnian, Slovene, Croatian |
| `lep.json` | `леп` | several meanings; Russian and Kazakh sections first |
| `lepota.json` | `лепота` | an example with a template nested inside it |
| `ruka.json` | `рука` | `{{as ru}}` — "same as the Russian word" |
| `uciti.json` | `учити` | page exists but has no Serbian section (Ukrainian only) |

To refresh them, fetch
`https://ru.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&titles=<title1>|<title2>|…`
in one request and save each entry of `query.pages` as `{ title, revisions }`.
