# Credits for the README's pictures

The screenshots in this folder are made by code: the tests in `tests/shots/` (and `scripts/showcase/shots-desktop.mjs` for the desktop app), run by the `Screenshots` workflow on GitHub. Everything in them is one of the artworks below, or made by those tests in the app.

## Artworks

Public-domain works from [The Met's Open Access](https://www.metmuseum.org/about-the-met/policies-and-procedures/image-resources) programme, released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). The files in `scripts/showcase/art/` are smaller copies (about 600 px wide, the size The Met gives for the web). The Met does not endorse canvast; the works are shown only as examples of reference pictures. `scripts/showcase/art/art.json` holds the same list.

| Artist | Title | Date | Medium | Source | File |
| --- | --- | --- | --- | --- | --- |
| Katsushika Hokusai | Under the Wave off Kanagawa (Kanagawa oki nami ura), also known as The Great Wave, from the series Thirty-six Views of Mount Fuji (Fugaku sanjūrokkei) | ca. 1830–32 | Woodblock print | [The Met, 45434](https://www.metmuseum.org/art/collection/search/45434) | `hokusai-under_the_wave_off_kanagawa.jpg` |
| Katsushika Hokusai | Seaside Village in Winter, from Hokusai’s Album of Realistic Pictures (Hokusai shashin gafu) | 1814 | Print | [The Met, 37193](https://www.metmuseum.org/art/collection/search/37193) | `hokusai-seaside_village_in_winter_from.jpg` |
| Katsushika Hokusai | Basket of Flowers with Bamboo Blind | ca. 1799–1810 | Woodblock print | [The Met, 54303](https://www.metmuseum.org/art/collection/search/54303) | `hokusai-basket_of_flowers_with_bamboo.jpg` |
| Katsushika Hokusai | Still Life: Double Cherry-Blossom Branch, Telescope, Sweet Fish, and Tissue Case | ca. 1804–13 | Woodblock print | [The Met, 54435](https://www.metmuseum.org/art/collection/search/54435) | `hokusai-still_life_double_cherry_blossom.jpg` |
| Katsushika Hokusai | Mystical Bird (Karyōbinga) | 1820–33 | Print | [The Met, 54433](https://www.metmuseum.org/art/collection/search/54433) | `hokusai-mystical_bird.jpg` |
| Katsushika Hokusai | Rooster, Hen and Chicken with Spiderwort | ca. 1832 | Print | [The Met, 54305](https://www.metmuseum.org/art/collection/search/54305) | `hokusai-rooster_hen_and_chicken_with.jpg` |
| Edgar Degas | Dancer with a Fan | ca. 1880 | Drawing | [The Met, 436135](https://www.metmuseum.org/art/collection/search/436135) | `degas-dancer_with_a_fan.jpg` |
| Edgar Degas | Dancer Onstage | ca. 1877 | Drawing | [The Met, 436134](https://www.metmuseum.org/art/collection/search/436134) | `degas-dancer_onstage.jpg` |
| Edgar Degas | Dancer | 1880–85 | Drawing | [The Met, 438518](https://www.metmuseum.org/art/collection/search/438518) | `degas-dancer.jpg` |
| Edgar Degas | Dancer Adjusting Her Slipper | 1873 | Drawing | [The Met, 333942](https://www.metmuseum.org/art/collection/search/333942) | `degas-dancer_adjusting_her_slipper.jpg` |
| Eugène Delacroix | Study of a Horse | ca. 1824–29 | Drawing | [The Met, 747563](https://www.metmuseum.org/art/collection/search/747563) | `delacroix-study_of_a_horse.jpg` |
| Rosa Bonheur | Study for "The Horse Fair" | 19th century | Drawing | [The Met, 334339](https://www.metmuseum.org/art/collection/search/334339) | `bonheur-study_for_the_horse_fair.jpg` |
| Jacques de Gheyn II | Two studies of a saddled horse and of a horse with a boy astride; verso: Study of a bean plant | ca. 1602 | Drawing | [The Met, 382823](https://www.metmuseum.org/art/collection/search/382823) | `degheyn-two_studies_of_a_saddled_horse.jpg` |
| Anthonie Waterloo | Wooded Landscape | 1630–90 | Drawing | [The Met, 459335](https://www.metmuseum.org/art/collection/search/459335) | `waterloo-wooded_landscape.jpg` |
| Tobias Verhaecht | Mountainous Landscape | 1576–1631 | Drawing | [The Met, 343694](https://www.metmuseum.org/art/collection/search/343694) | `verhaecht-mountainous_landscape.jpg` |
| Jean-Baptiste Le Prince | Landscape with Peasants Fording a Stream | 1756 | Drawing | [The Met, 368419](https://www.metmuseum.org/art/collection/search/368419) | `leprince-landscape_with_peasants_fording.jpg` |
| Mary Delany | Botanical Study | ca. 1772–82 | Cut paper | [The Met, 360446](https://www.metmuseum.org/art/collection/search/360446) | `delany-botanical_study.jpg` |
| Anonymous, French, 19th century | Botanical Studies (recto); Botanical Studies (verso) | ca. 1820 | Drawing | [The Met, 362545](https://www.metmuseum.org/art/collection/search/362545) | `anonymous-botanical_studies.jpg` |
| Vincent van Gogh | Wheat Field with Cypresses | 1889 | Painting | [The Met, 436535](https://www.metmuseum.org/art/collection/search/436535) | `vangogh-wheat_field_with_cypresses.jpg` |

## Made by the scripts

| What | Where it comes from |
| --- | --- |
| Drawings, shapes, patterns, guides, lettered balloons, text and comic pages | Made by the tests through the app, as a person would |
| Notes, names, folders, tags and boards (study notes on The Great Wave, a made-up picture book) | Written by the tests; facts about an artwork come from its museum record (`art.json`); they describe no real person or project |
| The deep-zoom showcase | `showcase.canvast`, built by `scripts/showcase/build.mjs` |
| The PDF handout and the 3D vase in the viewer shots, the camera pan clip | Generated in code by `tests/shots/views.shot.ts` and `tests/shots/boards.shot.ts` (the clip with ffmpeg) |
| The art files (`.ora`, `.kra`) and the smaller copy for *Similar images* | Made from the artworks above |

## Fonts

| Font | Licence |
| --- | --- |
| Inter (the app's interface) | [SIL Open Font License 1.1](https://openfontlicense.org) |
| Comic Neue, Bangers, Caveat, Cormorant Garamond (lettering, titles, notes and labels in the pictures) | [SIL Open Font License 1.1](https://openfontlicense.org); licences in `scripts/showcase/fonts/` |
| Space Grotesk (in the font shots) | [SIL Open Font License 1.1](https://openfontlicense.org) |
