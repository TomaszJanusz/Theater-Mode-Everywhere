# RTE: Bilibili i Tencent Video

Analiza i weryfikacja: 4 października 2026 r., uzupełniona 5 października 2026 r.
Zakres Tencent Video obejmuje `v.qq.com` i międzynarodowy serwis `wetv.vip` (WeTV).
Chińskie Bilibili to wyłącznie `bilibili.com` i jej subdomeny. Międzynarodowy
serwis Bilibili.tv (`bilibili.tv`) ma osobny adapter i nie jest dopasowywany
przez matcher `bilibili.com`.

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

## Bilibili.tv

Bilibili.tv nie jest wariantem chińskiego Bilibili. Strona odcinka nie wystawia
`__INITIAL_STATE__`, `aid` ani `cid`. SSR zapisuje `window.__initialState`
oraz `window.__BSTAR__METADATA__`. Adres `/en/play/1053337` to `season_id`.
Bieżący odcinek jest w `__initialState.ogv.epId` (dla *The Last Summoner* E1:
`11371243`). SSR trzyma te pola jako zwykłe wartości. Po hydracji Vue
`ogv.epId`, `ogv.season`, `ogv.sectionsList` i `global.sLocale` są refami
(`__v_isRef`, `_value` i getter `value`). Tytuł sezonu jest w
`season.title`, a odcinki w `sectionsList[].episodes[]`. Odczyt obsługuje
obie postacie bez runtime Vue: najpierw getter `value`, a gdy rzuca albo nic
nie zwraca — zapisane `_value` / `_rawValue`.
`player.subtitleList` w tym stanie jest puste. Odtwarzacz to HTML5
(`bPlayer` / `dashPlayer`), więc sterowanie odtwarzaniem zostaje przy
istniejącym torze HTML5.

Zakres to strony odcinków OGV: `/{język}/play/{season_id}` oraz ten sam adres
z dodatkowym segmentem numeru odcinka. Strony materiałów użytkowników
(`/{język}/video/`) nie są zaimplementowane. Na takiej ścieżce adapter nie
bierze identyfikatora odcinka, a MAIN usuwa opublikowany atrybut.

Osobny provider `bilibiliIntl` korzysta z tego samego przełącznika Rich Theater
Experience. Wyłączenie RTE w starszej instalacji zostawia też tę integrację
wyłączoną. Wyłączenie w trakcie żądania, zmiana ścieżki albo zmiana `epId`
odrzuca spóźnioną odpowiedź i nie przywraca poprzedniego tytułu, napisów ani
miniaturek. Cache metadanych jest związany z parą odcinek i `s_locale`.

Świat content nie widzi `window.__initialState`. Na adresie samego sezonu,
`/en/play/1053337`, nie ma też segmentu odcinka. Atrybut
`data-te-bilibili-intl-episode` pojawia się dopiero wtedy, gdy MAIN wykona
sondę. Dlatego `load()` na obsługiwanej stronie OGV wysyła sondę MAIN także
wtedy, gdy content nie zna jeszcze identyfikatora. Wynik jest przyjmowany
dopiero, gdy opublikowany identyfikator zgadza się ze snapshotem, ścieżka i
ewentualny segment odcinka nie zmieniły się w trakcie oczekiwania, a RTE
nadal jest włączone. Atrybut zostawiony przez wcześniejszy sezon nie blokuje
metadanych bieżącej strony. Odpowiedź ze starym identyfikatorem, po zmianie
adresu albo po wyłączeniu RTE, jest odrzucana. Poprzednia lista napisów
zostaje tylko wtedy, gdy nowa odpowiedź jest na pewno tym samym odcinkiem i
sama nie zawiera ścieżek. Gdy adres zawiera segment odcinka różny od atrybutu,
identyfikatorem jest segment z adresu.

MAIN pobiera publiczne metadane bez ciasteczek. Nie woła
`/intl/gateway/web/playurl` i nie zapisuje adresów strumienia, konta ani
ciasteczek. Samo `episode_id` dostaje z `api.bilibili.tv` odpowiedź HTTP 412
(`text/html`). Oficjalny klient dokleja `s_locale` i `platform=web`.
`s_locale` bierze się z `global.sLocale` albo, gdy tego pola nie ma, z
segmentu języka w adresie. Nie jest czytane z adresów sieciowych. Mapa jest
tą z bundla strony: `en` → `en_US`, `zh` → `zh-Hant_HK`, `id` → `id_ID`,
`th` → `th_TH`, `ms` → `en_MY`, `vi` → `vi_VN`, `ar` → `ar_SA`. Nieznany
klucz schodzi do `en`. Dla napisów dokładany jest też stały
`spm_id=bstar-web.pgc-video-detail.0.0` oraz `from_spm_id` z parametru
`bstar_from`, ale tylko gdy jest krótkim tokenem; w przeciwnym razie zostaje
pusty. Miniatury używają wyłącznie `s_locale`, `platform` i `episode_id`,
tak jak `video/shot` w odtwarzaczu.

Dla strony angielskiej zapytanie napisów ma postać
`/intl/gateway/web/v2/subtitle?s_locale=en_US&platform=web&episode_id={epId}&spm_id=bstar-web.pgc-video-detail.0.0&from_spm_id=`,
a miniaturek
`/intl/gateway/web/v2/video/shot?s_locale=en_US&platform=web&episode_id={epId}`.

Odpowiedź napisów ma `data.subtitles[]` z polami `url`, `lang`, `lang_key`
i `subtitle_id`. Na E1 *The Last Summoner* jest siedem ścieżek. Sześć
pierwszych to ASS na `https://s.bstarstatic.com/ogv/subtitle/<skrót>.ass`
(podpis `auth_key`): English, ภาษาไทย, Tiếng Việt, Bahasa Indonesia,
Bahasa Melayu i 中文（繁体）. Ścieżka عربي jest JSON-em
`body[].from/to/content`. Kod strony zna też starszy kształt
`video_subtitle[].ass.url` / `srt.url`; parser przyjmuje oba, ale do snapshotu
trafia tylko adres z allowlisty HTTPS `s.bstarstatic.com/ogv/subtitle/`.
Ścieżka jest sprawdzana w postaci surowej, zanim parser `URL` usunie `..` albo
odkoduje `%2e%2e`. Adres, który dopiero po tej normalizacji wygląda jak plik
napisów, jest odrzucany — tak samo jak allowlista pobrania w świecie content.
Przekierowanie poza ten katalog jest odrzucane.

ASS jest sprowadzany do zwykłego tekstu: pola po przecinku zostają w tekście
cue, `{\\...}` (w tym `\\pos`) są usuwane, `\\N` i `\\n` stają się nowymi
liniami, a segment z `\\p1` (rysunek, nie `\\pos`) jest pomijany aż do `\\p0`.
Pozycjonowanie i style ASS nie są odtwarzane. Komendy rysowania pochodzą z
parsera `biliintl-player-dfb25af7.js`.

Miniatury z `/video/shot` mają `x_len`/`y_len`/`x_size`/`y_size` (dla E1:
10×10, kafelek 160×90, dwa arkusze JPEG na `pic.bstarstatic.com/videoshot/`)
oraz `pv_data` — plik `.bin` z wielobajtowymi znacznikami czasu uint16. Dla E1
indeks ma 189 wpisów, jest niemalejący, a ostatnia wartość to 1489 (granica
końcowa, nie kafelek). Ostatni przedział `[1464, 1489)` wybiera kafelek 186.
Oficjalne `Da` przy czasie poza każdym przedziałem `[times[n], times[n+1])`,
w tym dokładnie na granicy końcowej, zwraca indeks `times.length - 2` (tutaj
187). `Aa` narysuje tę komórkę, gdy na arkuszu jest miejsce. Dla E1 indeks 187
mieści się na drugim arkuszu 10×10. To nie jest kafelek z czasem, więc RTE przy
czasie równym granicy albo późniejszym zostawia ostatni prawdziwy kafelek
(`length - 3`) i nie adresuje indeksu bez obrazu arkusza. `Aa` i `Na` mają
siatkę 10×10 na sztywno; odpowiedź E1 też jest 10×10, a RTE bierze
`x_len` i `y_len` z odpowiedzi. Czasy przekazane do parsera muszą być
skończone i niemalejące.
Przycisk następnego odcinka to `.player-mobile-control-btn-next-episode
.ip-next-episode`; klasa `disabled` oznacza brak następnego odcinka. Osobnego
przycisku poprzedniego odcinka w tym odtwarzaczu nie ma. Zmiana adresu
odcinka odświeża metadane. Gdy odtwarzacz odłączy element `video` i wyśle
`emptied`, RTE powtarza wczytanie odcinka widocznego w adresie, także wtedy,
gdy w dokumencie nie ma już filmu.

Ta integracja nie importuje rozdziałów ani mapy popularności. To ograniczenie
adaptera. Odpowiedź `/v2/ogv/play/episode` zawiera okna pominięcia czołówki
i napisów końcowych, a nie listę rozdziałów, i nie jest pokazywana jako
rozdziały. Czas trwania bierzemy z elementu `video`, gdy jest już znany
(dla E1 HTML5 podał 1504 s).

Gdy RTE rysuje własne napisy, ukrywa warstwy `.player-mobile-ass-subtitle` i
`.player-mobile-subtitle`. Opcja Off, gdy bieżący odcinek ma już zaimportowane
ścieżki, zostawia ten atrybut włączony: w trybie kinowym nie widać ani napisów
RTE, ani warstwy odtwarzacza. Wyjście z trybu kinowego, `dispose` albo
wyłączenie RTE zdejmuje atrybut i przywraca warstwę strony. Numer pokolenia
jest zapamiętywany przed oczekiwaniem na sondę i przed pobraniem treści
ścieżki. Off albo `dispose` w trakcie pierwszej sondy nie włącza napisów RTE
i nie ukrywa warstwy strony. Spóźniona treść po zmianie odcinka, Off albo
`dispose` jest odrzucana. Zgodny numer pokolenia nie zastępuje sprawdzenia
bieżącego `epId`. Nieudane wczytanie ścieżki zostawia warstwę odtwarzacza.
Kontroler po takim niepowodzeniu woła `activate(null)`; to sprzątanie nie
ukrywa warstwy strony. Kolejne, już samodzielne Off przy załadowanych
ścieżkach ukrywa obie warstwy. Natywne `textTracks` nie wchodzą do menu, gdy
lista Bilibili.tv już jest.

### Dowody

Testy jednostkowe, bez sieci: parser ASS/JSON, granica indeksu miniaturek,
allowlista adresów, locale z refu `global.sLocale` i z segmentu adresu,
odrzucenie `bstar_from` spoza tokenu, brak `playurl`, sonda sezonu bez
`__initialState` i bez atrybutu, stary atrybut innego sezonu, zmiana ścieżki
albo segmentu odcinka w trakcie sondy, Off i `dispose` w trakcie pierwszej
sondy oraz `activate(null)` po nieudanym włączeniu ścieżki.

Metadane na żywo, 5 października 2026 r., publiczna strona
`https://www.bilibili.tv/en/play/1053337` bez konta. Po hydracji
`ogv.epId` jest refem `11371243`, a `global.sLocale` refem `en`. Samo
`episode_id` wraca jako HTTP 412 i `text/html`. Zapytanie z parametrami
odtwarzacza wraca jako HTTP 200, `application/json`, `code` 0 i siedem
ścieżek. Miniatury z `s_locale=en_US&platform=web` wracają jako HTTP 200,
`code` 0, siatka 10×10 i dwa obrazy. To jest sprawdzenie odpowiedzi API,
nie interfejsu trybu kinowego.

Rozszerzenie z `dist/chrome-unpacked` przechodzi test runtime w Chromium
na tym samym adresie, z odpowiedziami API i plikami napisów podmienionymi
fiksturą. Identyfikator i tytuł są tylko w `window.__initialState`: E1 jako
refy, E2 jako zwykły obiekt. Przed pierwszym `[T]` nie ma atrybutu odcinka
ani sondy. Izolowany świat content rozszerzenia nie widzi stanu strony.
Pierwsze `[T]` pokazuje *The Last Summoner E1* oraz English i عربي. Wybór
ASS i JSON rysuje cue. Off zostawia tryb kinowy, ukrywa
`.player-mobile-ass-subtitle` i `.player-mobile-subtitle` i czyści napis RTE.
Escape zdejmuje `data-te-bilibili-intl-captions-hidden` i przywraca obie
warstwy. Przycisk następnego odcinka robi SPA na
`/en/play/1053337/11371316`, ustawia stan E2 i wysyła `timeupdate`, a w tym
samym obiegu usuwa `video` oraz `.player-mobile-ass-subtitle` i
`.player-mobile-subtitle`, po czym wysyła `emptied`. Nie ma nowego elementu
ani `durationchange`. RTE pokazuje *The Last Summoner E2*, ścieżkę Tiếng Việt
i jej cue. Escape zdejmuje `data-te-bilibili-intl-captions-hidden`. Warstwy
wstawione po wyjściu są widoczne.

Osobna próba na prawdziwej stronie wstrzyknęła zbudowane `mainWorld.js`,
`content.js` i `content.css` do świata MAIN. To nie jest zainstalowane
rozszerzenie ani izolowany content. W tej próbie `[T]` pokazało tytuł E1
i siedem języków, English (ASS) cue „Every object has its spirit.”, عربي
(JSON) cue „لكل شيء روحه الخاصة.”, miniaturę oraz Off ukrywające obie warstwy
hosta. Aktualizacja tytułu po E2 i Escape nie zostały tam dokończone.

Ta sama zainstalowana paczka, 5 października 2026 r., headless Chromium,
żywa strona bez podmiany ruchu i bez konta. Izolowany świat content
rozszerzenia bierze tytuł i ścieżki z sondy MAIN. E1 pokazuje *The Last Summoner E1*,
atrybut `11371243` i siedem ścieżek. Następny odcinek ustawia
`/en/play/1053337/11371316?bstar_from=bstar-web.pgc-video-detail.episode.manual`
oraz tytuł dokumentu E2. MAIN publikuje `11371316` i *The Last Summoner E2*
z siedmioma ścieżkami: `en`, `th`, `vi`, `id`, `ms`, `zh-Hant`, `ar`. RTE
pokazuje ten tytuł i te ścieżki. English ma 415 cue, od 14,85 s do 1443,16 s.
Strona po przejściu wyświetla ścianę Premium, usuwa `video` i obie warstwy
napisów i nie wstawia nowego elementu, więc odtwarzanie się nie toczy.
`emptied` na odłączonym elemencie zeruje czas przed pierwszym cue. Ustawienie
czasu tego elementu na 57,8 s i `timeupdate` rysuje „And try my best”.
Escape zdejmuje tryb kinowy i `data-te-bilibili-intl-captions-hidden`.
Warstwy hosta pozostają nieobecne, bo strona ich nie wstawia ponownie.

Źródła parametrów i parsera, odczytane z aktualnej strony:
[index-f905d25c.js](https://p.bstarstatic.com/fe-static/bstar-web-new/client/assets/index-f905d25c.js),
[vendor-bc097aa0.js](https://p.bstarstatic.com/fe-static/bstar-web-new/client/assets/vendor-bc097aa0.js),
[useSpm-f2fdcb51.js](https://p.bstarstatic.com/fe-static/bstar-web-new/client/assets/useSpm-f2fdcb51.js),
[useError-0a7809da.js](https://p.bstarstatic.com/fe-static/bstar-web-new/client/assets/useError-0a7809da.js),
[ogv-player](https://p.bstarstatic.com/fe-static/bstar-web-new/client/assets/ogv-player.vue_vue_type_script_setup_true_lang-54dd2d71.js),
[biliintl-player-dfb25af7.js](https://p.bstarstatic.com/fe-static/bstar-web-new/client/assets/biliintl-player-dfb25af7.js),
[dash-player-69d7377c.js](https://p.bstarstatic.com/fe-static/bstar-web-new/client/assets/dash-player-69d7377c.js).
Adresy tych plików mogą zmienić się wraz z aktualizacją serwisu. Strony
`/video/` nie są zaimplementowane. Nie sprawdzono sesji zalogowanej. Napisy
wypalone w obrazie nie są ścieżkami do przełączenia.

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

Adaptery Bilibili (`bilibili.com`), Bilibili.tv i Tencent Video korzystają ze wspólnego przełącznika Rich Theater Experience. Etykieta chińskiego Bilibili w ustawieniach wskazuje domenę `bilibili.com`.
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
- Bilibili.tv: `pnpm typecheck`, 344 testów, `pnpm build` i
  `pnpm verify:bundles`. Próba API na żywej stronie jest opisana w sekcji
  Bilibili.tv i nie obejmuje pełnego trybu kinowego.

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
