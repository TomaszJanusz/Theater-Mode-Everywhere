# RTE: Bilibili i Tencent Video

Analiza i weryfikacja: 4 października 2026 r. Zakres Tencent Video obejmuje
`v.qq.com` i międzynarodowy serwis `wetv.vip` (WeTV); Bilibili obejmuje domenę `bilibili.com` i jej subdomeny.

## Funkcje w interfejsie

| Funkcja | Bilibili | Tencent Video |
| --- | --- | --- |
| Tryb kinowy, odtwarzanie, głośność, przewijanie | HTML5; poprawiona obsługa skrótów | HTML5 oraz `<fake-iframe-video>` jądra WASM; wybór filmu zamiast pustego elementu zapasowego |
| Tytuł | Metadane bieżącego filmu | Tytuł odcinka bez dopisku reklamowego i nazwy serwisu |
| Napisy | Lista z protobuf `subtitle/web/view`, a gdy jest pusta — ze ścieżek JSON odtwarzacza; cue JSON, a w razie potrzeby SRT/WebVTT | Dostępne ścieżki SRT/WebVTT z `sfl.fi`, renderowane przez RTE; także natywne HTML5 |
| Rozdziały | `view_points` z API odtwarzacza, jeśli dostępne | Nie potwierdzono formatu możliwego do importowania |
| Miniatury osi czasu | `videoshot`: arkusze obrazów i indeks czasowy | Arkusze `vl.vi[].pl[].pd` z metadanych ThumbPlayer |
| Poprzedni/następny materiał | Dostępne przyciski odtwarzacza | Dostępny przycisk następnego odcinka |
| Mapa popularności | Seria `pbp` (高能进度条) rysowana na osi czasu RTE | Nie zaimportowano |

Brak napisów lub rozdziałów dla konkretnego filmu nie oznacza błędu adaptera.
Bilibili może wymagać zalogowania do udostępnienia napisów. Napisy wypalone
w obrazie nie są ścieżkami HTML5 i nie można ich przełączać przez RTE.

## Bilibili

MAIN odczytuje `window.__INITIAL_STATE__`, identyfikatory `aid` i `cid`, tytuł
oraz czas trwania bieżącej części. Na żądanie RTE pobiera metadane z
`https://api.bilibili.com/x/player/v2`,
`https://api.bilibili.com/x/player/videoshot?index=1`,
`https://api.bilibili.com/x/v2/subtitle/web/view` oraz
`https://bvc.bilivideo.com/pbp/data?r=loader` w kontekście strony.
Do odczytu metadanych nie są potrzebne adresy strumieni wideo.

Do świata content trafiają wyłącznie tytuł, identyfikator materiału, opisy
ścieżek napisów, rozdziały i parametry miniaturek. Pola konta, adres IP
i adresy strumieni z odpowiedzi API nie trafiają do snapshotu RTE.

Miniatury wykorzystują `img_x_len`, `img_y_len`, `img_x_size`, `img_y_size`,
`image` i `index`. Zgodnie z kodem oryginalnego odtwarzacza pierwszy wpis
indeksu jest znacznikiem, a ostatni granicą końcową; nie są dodatkowymi
kafelkami. Powtarzające się znaczniki czasu w środku indeksu pozostają
zachowane. Parser obsługuje przejście między arkuszami obrazów.

Napisy z `/x/player/v2` często wracają puste, także gdy film ma ścieżki.
Odtwarzacz bierze listę z protobufa `SubtitleViewReply` pod
`/x/v2/subtitle/web/view?oid={cid}&pid={aid}&type=1`. RTE czyta tylko
`SubtitleItem`: identyfikator, język, nazwę, adres i znacznik AI. Pola autora
są pomijane. Żądanie jest podpisywane tak jak w odtwarzaczu. Gdy ta lista
jest pusta, zostaje zapasowa lista JSON z `subtitle.subtitles`. Późniejszy
odczyt bez ścieżek nie usuwa listy już pokazanej dla tego samego `aid:cid`.
Chwilowe ścieżki HTML5 odtwarzacza nie wchodzą do menu, gdy lista Bilibili
już jest.

Adresy `subtitle.bilibili.com` odtwarzacz odkodowuje na
`aisubtitle.hdslb.com` tym samym przekształceniem XOR, którego używa jego
własny kod. Ścieżki AI często nie mają końcówki `.json`, ale treść nadal jest
JSON-em `body[].from/to/content`. Pobieranie ograniczono do HTTPS i katalogów
napisów CDN `hdslb.com`. Plik SRT albo WebVTT jest parsowany tylko wtedy, gdy
odpowiedź nie jest JSON-em. Rozdziały wykorzystują `view_points[].from/to/content`.

Mapa popularności to seria z loadera `pbp`: `step_sec` i `events.default`.
RTE nie ładuje `script_src` z tej odpowiedzi. Wartości są normalizowane do
szczytu serii i, gdy metadane filmu są dłuższe niż seria, dopełniane zerami
tak jak pasek odtwarzacza. Wynik trafia na istniejącą warstwę heatmapy osi czasu.

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

Odtwarzacz ThumbPlayer/SuperPlayer wystawia także zapasowe elementy `video`.
Zapasowy element może zachować źródło i rozmiary z poprzedniego odtwarzania,
pozostając ukryty. Wybór odtwarzacza pomija teraz ukryte elementy wewnątrz
`.txp_videos_container`, aby `[T]` wskazywał właściwy film. Przy zmianie
jakości odtwarzacz może zamieniać dwa nadal podłączone elementy; RTE podąża
za widocznym filmem i usuwa obserwatory poprzedniego elementu.

Adapter RTE importuje identyfikator z bieżącego adresu, `VIDEO_INFO.vid`
lub danych strony WeTV oraz tytuł z metadanych lub dokumentu. Uwzględnia różne postacie tytułu przed i po uruchomieniu
odtwarzacza. Następny odcinek jest dostępny przez aktywny `.txp_btn_next_u`
lub `.txp_btn_next`, a na WeTV przez `[data-role="wetv-player-ctrl-next"]`;
ukryte i zablokowane przyciski są pomijane.

Kod oryginalnego odtwarzacza wykonuje odtwarzanie i przewijanie przy
`keyup`. RTE przechwytuje teraz także zdarzenia kończące skróty, których `keydown`
faktycznie obsłużyło. Niedostępna nawigacja odcinków pozostaje dostępna
dla strony, a `Escape` jest przechwytywany również przy zmienionym skrócie wyjścia.
`T` nie przełącza trybu wielokrotnie przy przytrzymaniu; jego `keyup` jest
przechwytywany również po wyjściu z trybu kinowego. Wpisywanie w polach
tekstowych i zdarzenia kompozycji IME pozostają obsługiwane przez stronę.

Dalsze badanie potwierdziło format napisów i miniaturek na WeTV oraz miniaturki
na `v.qq.com`. Bieżący adapter obsługuje oba serwisy. `getvinfo` przekazuje
napisy w `sfl.fi`: identyfikator, język, nazwę, `captionType`, `url` i adresy
zapasowe. Typ `3` oznacza WebVTT, typ `1` — SRT. Ścieżki oznaczone `lmt`
jako ograniczone oraz warianty wypalone w obraz nie są importowane.

Dla WebVTT oryginalny odtwarzacz zamienia końcówkę `.vtt.m3u8` na `.vtt`.
RTE stosuje tę samą regułę i swój istniejący parser napisów. Pobieranie
ograniczono do HTTPS, plików SRT/VTT i zaobserwowanych hostów CDN napisów.
WeTV nie wystawia tych ścieżek jako `video.textTracks`, więc sama obsługa
natywnego HTML5 nie wystarczała. Podczas używania napisów RTE własna warstwa
WebVTT odtwarzacza jest ukryta; wyjście z trybu kinowego przywraca jej
widoczność. Wyłączenie napisów w RTE nie pozostawia drugiej warstwy tekstu.

Metadane są przechwytywane z odpowiedzi `getvinfo`, także z callbacków JSONP.
Oryginalny callback zachowuje argumenty, kontekst i wynik; treść odpowiedzi
nie jest wykonywana przez RTE jako kod. WeTV pozwala także odczytać już
załadowane dane przez `player.getApiBridge().videoInfo.parseData`. Do świata
content trafiają wyłącznie dane funkcji interfejsu, bez pól konta, adresu IP
i adresów strumieni filmu. Dane poprzedniego odcinka i późne odpowiedzi
napisów są odrzucane.

Miniaturki opisują pola `c`, `r`, `w`, `h`, `cd`, `fn`, `url` oraz `lnk`.
Adres arkusza ma postać `{url}{lnk}.{fn}.{numer}.jpg/0`, a klatka odpowiada
`floor(czas / cd)`. Numeracja arkuszy zaczyna się od 1. RTE preferuje
wariant szerokości 160 px, obsługuje kolejne wiersze i arkusze oraz ogranicza
indeks na końcu filmu. Obrazy pochodzą z `video-caps.puui.qpic.cn` albo
`video-caps.wetvinfo.com`.

Nie potwierdzono osobnej listy rozdziałów z nazwami i czasami. Dane
pomijania czołówki i napisów końcowych nie są przedstawiane jako rozdziały.

### Odtwarzacz WASM

Na części odtwarzaczy `v.qq.com` i `wetv.vip` ThumbPlayer rysuje obraz przez
`<fake-iframe-video>` i płótno WASM, a nie przez element `<video>` w dokumencie
strony. W otwartym shadow roocie leży ramka
`vm.gtimg.cn/.../fake-video-element-iframe.html`. Grający stan (`paused`,
`currentTime`, `play()`, `pause()`) jest na elemencie w dokumencie strony.
`document.querySelectorAll('video')` i `document.querySelectorAll('iframe')`
tej powierzchni nie widzą. Wewnątrz ramki jest ukryte, puste `<video>`; nie
jest celem trybu kinowego.

Sonda z 5 października 2026 r. sprawdziła API po wstawieniu elementu
z `wasm-kernel.js` 1.70.0. W świecie strony są gettery, settery, `play()` /
`pause()`, zdarzenia odtwarzania i `buffered` jako obiekt z `length`, `start`
i `end`. W izolowanym świecie content scriptu Chromium te same nazwy są
`undefined`. Firefox nie został obciążony niepodpisanym rozszerzeniem MV3;
otoczki Xray ukrywają metody prototypu zdefiniowane przez stronę w ten sam
sposób. Brakuje też `objectFit`. `requestPictureInPicture` istnieje, ale
`supportPictureInPicture()` jest fałszywe przy ramce z innej domeny.
Wzmocnienie przez `volumeGain` i Web Audio nie jest używane.

Sterowanie idzie więc wąskim mostem tylko dla hosta Tencent: content script
wysyła komendę zdarzeniem z JSON-em, a skrypt świata strony wywołuje metodę
i odsyła zwykły snapshot, łącznie z zakresami bufora. Zegar `currentTime`
uzupełnia brakujące `timeupdate` albo `buffered` w tym jednym module i kończy
się przy pauzie, przewinięciu, zamianie i wyjściu. Nasłuchy mostu w świecie
strony schodzą razem z powierzchnią. Spacja ma jednego właściciela w świecie
strony i korzysta z `paused` oraz `play()` / `pause()`, bez wymagania źródła
HTML. Inny skrót pauzy zostaje w content scripcie, a pusty skrót niczego nie
wznawia. Przewijanie i głośność do 1 idą tym samym kontraktem.
Picture-in-Picture zostaje wyłączone, bo atrapa nie jest `HTMLMediaElement`.
Dopasowanie `object-fit`, wzmocnienie Web Audio i przeładowanie `crossOrigin`
zostają przy prawdziwym `<video>`.

Kolejność wyboru na hoście Tencent: prawdziwy przełączalny `<video>`, potem
używalny `<fake-iframe-video>` (podłączony, widoczny, co najmniej 80 px,
przecięcie z oknem, ramka WASM w otwartym shadow roocie), a na końcu dotychczasowy
`findBestVideo()`. W dokumencie ramki WASM ten ostatni krok zwraca `null`.

Wejście przypina atrapę do okna klasą `html.theater-everywhere-tencent-stage`.
Chrom odtwarzacza znika przez `visibility`, nie przez `display: none`, więc
przycisk następnego odcinka nadal przechodzi `isHostStepUsable()`. Wyjście
zdejmuje kontrolki, nasłuchy, napisy, pełny ekran, łapacz kliknięć i obserwator
zamiany także wtedy, gdy element nie jest `<video>`. Zamiana atrapy nie woła
`switchTheaterVideo()` ani `load()`.

Po kliknięciu obrazu fokus jest w ramce WASM. Ramka wysyła `FRAME_HOST_TOGGLE`
z akcją `toggle` albo `fullscreen` zamiast włączać tryb kinowy u siebie.
Rodzic przyjmuje komunikat tylko wtedy, gdy okno nadawcy jest ramką wewnątrz
shadow root `<fake-iframe-video>`, origin zgadza się ze `src`, adres to znany
dokument WASM, a strona jest hostem Tencent. Sesja nie musi jeszcze istnieć.
Ta ramka nie wchodzi do zwykłych okien potomnych, a `FRAME_ENTER` z niej nie
otwiera trybu kinowego. Po wejściu fokus wraca do dokumentu strony. Łapacz
kliknięć leży nad obrazem i pod paskiem: klik przełącza odtwarzanie, podwójne
kliknięcie przełącza pełny ekran dokumentu. Zwykłe `<video>` i zwykła ramka
zostają na dotychczasowej ścieżce.

### Materiały do powtarzalnych prób

| Materiał | Adres | Wynik w sesji bez logowania |
| --- | --- | --- |
| Three-Body, odcinek 1 | [WeTV EP1](https://wetv.vip/en/play/h31rop8wfso9jnh/h0045v8ky1m-EP1%3A_Three-Body) | 12 języków napisów plus opcja wyłączenia, angielska ścieżka zawiera 617 cue; arkusze miniaturek |
| Three-Body, odcinek 2 | [WeTV EP2](https://wetv.vip/en/play/h31rop8wfso9jnh/x0045o8w903-EP2%3A_Three-Body) | 12 języków, 444 cue w angielskiej ścieżce; arkusze miniaturek |
| 兰香如故, odcinek 1 | [Tencent Video](https://v.qq.com/x/cover/mzc00200803dr6b/c4102g9a01t.html) | Film odtwarza się; metadane miniaturek są dostępne; chińska ścieżka napisów ma `lmt: 1`, więc nie jest importowana |
| Young Sheldon, sezon 1, odcinek 1 | [Tencent Video](https://v.qq.com/x/cover/mzc00200o04csm0/b0042lllo0k.html) | Blokada regionalna w środowisku testowym, błąd `70013080.1`; brak oceny napisów tego odcinka |

Dostępność materiałów i funkcji może zależeć od regionu oraz konta.
Pierwsze dwa odcinki WeTV nadawały się do testowania bez konta VIP.

## Ustawienia i etykiety

Oba adaptery korzystają ze wspólnego przełącznika Rich Theater Experience.
Nowe flagi zachowują wyłączony RTE w starszych instalacjach i pozostają
zachowane przy aktualizacji ustawień innych dostawców. Zaktualizowano
opisy w ustawieniach, teksty zastępcze i katalogi wszystkich 13 języków.
Etykiety Tencent Video / WeTV uwzględniają teraz import napisów i miniaturek.

## Weryfikacja i źródła

- Testy parserów: napisy, granice indeksu miniaturek, duplikaty czasu,
  kolejne arkusze, nieprawidłowe dane i dozwolone adresy CDN.
- Testy adapterów i ustawień: dobór domen, wyłączenie RTE, zmiana `cid`,
  odrzucanie spóźnionych odpowiedzi i oczyszczanie tytułu Tencent.
- Testy uruchomieniowe: `T`, powtórzenie `keydown`, przechwytywanie `keyup`
  przy wejściu i wyjściu, Space, Escape przy zmienionym skrócie wyjścia,
  nieobsłużony skrót następnego filmu oraz dwukrotną zamianę wideo ThumbPlayer.
  Test Chromium korzysta
  z rozszerzenia; diagnostyczny test Firefox wstrzykuje oba zbudowane skrypty.
- Próby na żywo z kodem zbudowanego rozszerzenia w podglądzie T3:
  [Bilibili](https://www.bilibili.com/video/BV1xx411c7mu/) oraz
  [Tencent Video](https://v.qq.com/x/cover/mzc00200803dr6b/c4102g9a01t.html).
  Potwierdzono rozmiar obrazu równy oknu, tytuły i podgląd miniaturek Bilibili.
  Film Bilibili nie udostępniał napisów ani rozdziałów bez logowania;
  te formaty zweryfikowano testami parserów, a nie sesją zalogowanego konta.


- Dalsze próby na żywo z zainstalowanym rozszerzeniem w Chromium: oba podane
  odcinki WeTV oraz `兰香如故` na Tencent Video. Potwierdzono 12 języków,
  aktywację angielskich i hiszpańskich napisów, rzeczywiste wyświetlenie cue
  angielskiej ścieżki, wyłączenie obu warstw napisów przez opcję Off,
  odtworzenie widoczności napisów strony po Escape, tytuły i podglądy osi czasu
  oraz przejście przyciskiem RTE z EP1 do EP2 z aktualizacją tytułu.
  Arkusz WeTV faktycznie ładował się jako obraz 800 × 450 px. Na Tencent
  zaimportowano miniaturki, a ścieżkę `lmt: 1` poprawnie pominięto.
- Sonda API `<fake-iframe-video>` z 5 października 2026 r.: metody są w świecie
  strony, a w izolowanym świecie content scriptu Chromium pozostają
  `undefined`. Test rozszerzenia na atrapie `v.qq.com` z ramką
  `vm.gtimg.cn` potwierdza `T` ze strony i z ramki, pauzę Spacją raz na
  naciśnięcie, przewinięcie strzałką raz na naciśnięcie, `F` bez wyjścia
  z trybu kinowego, wyjście `Escape`, dwukrotną zamianę elementu i powrót
  do zwykłego `<video>` na innej stronie. Na żywej stronie odcinka testowego
  w tym środowisku jądro WASM się nie wybiera (`SharedArrayBuffer` niedostępne,
  `crossOriginIsolated` fałszywe), więc płótna WASM nie sprawdzono na
  odtwarzaczu produkcyjnym. `T` na tej stronie włączyło tryb kinowy na zwykłym
  `<video>` i nie dodało klasy sceny WASM.
- Końcowe kontrole poprzedniego wdrożenia RTE: `pnpm typecheck`, 276 testów,
  `pnpm build`, `pnpm verify:bundles` i `pnpm smoke`. Ta zmiana: `pnpm typecheck`,
  `pnpm build` i 320 testów, w tym test rozszerzenia dla atrapy WASM.

Źródła techniczne odczytane z aktualnych odtwarzaczy:
[Bilibili core](https://s1.hdslb.com/bfs/static/player/main/core.ba67b466.js),
[Bilibili preview](https://s1.hdslb.com/bfs/static/player/main/widgets/npd.911.a6141530.js),
[Tencent SuperPlayer](https://vm.gtimg.cn/thumbplayer/superplayer/1.74.0/superplayer-txv-light.js),
[WeTV player](https://static.wetvinfo.com/libs/wetv-player/2.8.66/unified-wetv-player.js),
[WeTV plugins](https://static.wetvinfo.com/libs/wetv-player/2.8.66/plugin-list.js).
Adresy tych plików i prywatne formaty metadanych mogą zmieniać się wraz
z aktualizacjami serwisów.

Uruchomienie developerskie: `pnpm dev --host 0.0.0.0`.
Budowanie rozszerzeń: `pnpm build`; wynik w `dist/chrome-unpacked`
i `dist/firefox-unpacked` oraz archiwach ZIP w `dist`.
