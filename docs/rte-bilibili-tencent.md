# RTE: Bilibili i Tencent Video

Analiza i weryfikacja: 4 października 2026 r. Zakres Tencent Video obejmuje
`v.qq.com`; Bilibili obejmuje domenę `bilibili.com` i jej subdomeny.

## Funkcje w interfejsie

| Funkcja | Bilibili | Tencent Video |
| --- | --- | --- |
| Tryb kinowy, odtwarzanie, głośność, przewijanie | HTML5; poprawiona obsługa skrótów | HTML5; wybór filmu zamiast pustego elementu zapasowego |
| Tytuł | Metadane bieżącego filmu | Tytuł odcinka bez dopisku reklamowego i nazwy serwisu |
| Napisy | Ścieżki JSON z API odtwarzacza, renderowane przez RTE | Natywne ścieżki HTML5, jeśli serwis je wystawia |
| Rozdziały | `view_points` z API odtwarzacza, jeśli dostępne | Nie potwierdzono formatu możliwego do importowania |
| Miniatury osi czasu | `videoshot`: arkusze obrazów i indeks czasowy | Nie potwierdzono formatu możliwego do importowania |
| Poprzedni/następny materiał | Dostępne przyciski odtwarzacza | Dostępny przycisk następnego odcinka |
| Mapa popularności | Nie zaimportowano | Nie zaimportowano |

Brak napisów lub rozdziałów dla konkretnego filmu nie oznacza błędu adaptera.
Bilibili może wymagać zalogowania do udostępnienia napisów. Napisy wypalone
w obrazie nie są ścieżkami HTML5 i nie można ich przełączać przez RTE.

## Bilibili

MAIN odczytuje `window.__INITIAL_STATE__`, identyfikatory `aid` i `cid`, tytuł
oraz czas trwania bieżącej części. Na żądanie RTE pobiera metadane z
`https://api.bilibili.com/x/player/v2` oraz
`https://api.bilibili.com/x/player/videoshot?index=1` w kontekście strony.
Do odczytu metadanych nie są potrzebne adresy strumieni wideo.

Do świata content trafiają wyłącznie tytuł, identyfikator materiału, opisy
ścieżek napisów, rozdziały i parametry miniaturek. Pola konta, adres IP
i adresy strumieni z odpowiedzi API nie trafiają do snapshotu RTE.

Miniatury wykorzystują `img_x_len`, `img_y_len`, `img_x_size`, `img_y_size`,
`image` i `index`. Zgodnie z kodem oryginalnego odtwarzacza pierwszy wpis
indeksu jest znacznikiem, a ostatni granicą końcową; nie są dodatkowymi
kafelkami. Powtarzające się znaczniki czasu w środku indeksu pozostają
zachowane. Parser obsługuje przejście między arkuszami obrazów.

Napisy wykorzystują `subtitle.subtitles`: `id`/`id_str`, `lan`, `lan_doc`
i `subtitle_url`. Format JSON `body[].from/to/content` zostaje przekształcony
na standardowe cue RTE. Pobieranie ograniczono do HTTPS i plików JSON
w katalogach napisów CDN `hdslb.com`. Rozdziały wykorzystują
`view_points[].from/to/content`.

Cache metadanych jest powiązany z `aid:cid` i ma krótki czas ważności.
Zmiana części filmu lub wyłączenie RTE unieważnia późne wyniki.
Asynchroniczny wynik Bilibili ma osobne zdarzenie, aby zachować szybkie
odpowiedzi istniejących adapterów.

W oryginalnym API odtwarzacza potwierdzono również `getSupportedQualityList`,
`requestQuality`, `setPlaybackRate`, `danmaku`, `prev` i `next`. Obecny
interfejs RTE już steruje szybkością przez HTML5 i używa przycisków nawigacji.
Wybór jakości i danmaku wymagałyby osobnego kontraktu komend i elementów UI;
nie są częścią tego wdrożenia.

## Tencent Video

Na stronie testowej odtwarzacz ThumbPlayer/SuperPlayer wystawiał dwa elementy
`video`: jeden ze źródłem i pusty element zapasowy. Istniejący mechanizm
wyboru odtwarzacza odrzuca zapasowy element i poprawnie rozszerza film.

Adapter RTE importuje identyfikator z `VIDEO_INFO.vid` i tytuł z metadanych
lub dokumentu. Uwzględnia różne postacie tytułu przed i po uruchomieniu
odtwarzacza. Następny odcinek jest dostępny przez aktywny `.txp_btn_next_u`
lub `.txp_btn_next`; ukryte i zablokowane przyciski są pomijane.

Kod oryginalnego odtwarzacza wykonuje odtwarzanie i przewijanie przy
`keyup`. RTE przechwytuje teraz także zdarzenia kończące obsługiwane skróty.
`T` nie przełącza trybu wielokrotnie przy przytrzymaniu; jego `keyup` jest
przechwytywany również po wyjściu z trybu kinowego. Wpisywanie w polach
tekstowych i zdarzenia kompozycji IME pozostają obsługiwane przez stronę.

Import niestandardowych napisów, rozdziałów i miniaturek Tencent pozostaje
kierunkiem dalszej integracji. Na badanym materiale nie potwierdzono danych
umożliwiających taki import. Wymaga to weryfikacji kolejnych materiałów,
w tym materiału wystawiającego wybór języka i podglądy osi czasu.

## Ustawienia i etykiety

Oba adaptery korzystają ze wspólnego przełącznika Rich Theater Experience.
Nowe flagi zachowują wyłączony RTE w starszych instalacjach. Zaktualizowano
opisy w ustawieniach, teksty zastępcze i katalogi wszystkich 13 języków.
Tencent nie jest wymieniany jako serwis z obsługiwanymi miniaturkami.

## Weryfikacja i źródła

- Testy parserów: napisy, granice indeksu miniaturek, duplikaty czasu,
  kolejne arkusze, nieprawidłowe dane i dozwolone adresy CDN.
- Testy adapterów i ustawień: dobór domen, wyłączenie RTE, zmiana `cid`,
  odrzucanie spóźnionych odpowiedzi i oczyszczanie tytułu Tencent.
- Testy uruchomieniowe: `T`, powtórzenie `keydown`, przechwytywanie `keyup`
  przy wejściu i wyjściu, Space oraz Escape. Test Chromium korzysta
  z rozszerzenia; diagnostyczny test Firefox wstrzykuje oba zbudowane skrypty.
- Próby na żywo z kodem zbudowanego rozszerzenia w podglądzie T3:
  [Bilibili](https://www.bilibili.com/video/BV1xx411c7mu/) oraz
  [Tencent Video](https://v.qq.com/x/cover/mzc00200803dr6b/c4102g9a01t.html).
  Potwierdzono rozmiar obrazu równy oknu, tytuły i podgląd miniaturek Bilibili.
  Film Bilibili nie udostępniał napisów ani rozdziałów bez logowania;
  te formaty zweryfikowano testami parserów, a nie sesją zalogowanego konta.

Źródła techniczne odczytane z aktualnych odtwarzaczy:
[Bilibili core](https://s1.hdslb.com/bfs/static/player/main/core.ba67b466.js),
[Bilibili preview](https://s1.hdslb.com/bfs/static/player/main/widgets/npd.911.a6141530.js),
[Tencent SuperPlayer](https://vm.gtimg.cn/thumbplayer/superplayer/1.74.0/superplayer-txv-light.js).
Adresy tych plików i prywatne formaty metadanych mogą zmieniać się wraz
z aktualizacjami serwisów.

Uruchomienie developerskie: `pnpm dev --host 0.0.0.0`.
Budowanie rozszerzeń: `pnpm build`; wynik w `dist/chrome-unpacked`
i `dist/firefox-unpacked` oraz archiwach ZIP w `dist`.
