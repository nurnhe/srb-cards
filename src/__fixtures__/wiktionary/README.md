Real Wiktionary pages, reduced to their Serbo-Croatian section, saved on
2026-09-21 for `src/wiktionary.test.js`. Text is Wiktionary's own content
(CC BY-SA); kept here only so the parsers can be tested without a network call.

To refresh a word or add a new one, run a short script that fetches
`https://en.wiktionary.org/api/rest_v1/page/html/<word>`, keeps only the
element with id `Serbo-Croatian` (via `.closest('section')`), and saves that
as `<word>.html` in this folder.
