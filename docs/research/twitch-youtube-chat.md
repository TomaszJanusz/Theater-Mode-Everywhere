# Integracja czatów Twitch i YouTube w Theater Mode Everywhere

Wpis: [TME-18](https://linear.app/privacybrand/issue/TME-18/czaty-twitch-i-youtube-natywna-integracja-chowanie-i-zachowanie-pelnej). Notion: [opracowanie — prywatny szkic](https://app.notion.com/p/3f219f2ad8388114b21cd09bdc089573?pvs=204).

## Aktualny zakres i obsługa

Stan na 8 października 2026: [PR #25](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/pull/25) jest otwarty do review, poza trybem draft. Implementacja jest dostępna na jego gałęzi; nie stanowi jeszcze wydanej funkcji wersji 1.5.0. Kod funkcji odpowiada `8b2dcfc`, a galeria została odświeżona w `4255228`.

TME zachowuje istniejący czat na stronach Twitch i YouTube. Po wejściu do theater przycisk czatu na pasku pokazuje lub chowa panel. W ustawieniach playera dostępne są szerokość bocznego panelu oraz motyw **Jasny / Ustawienia serwisu / Ciemny**. Domyślna szerokość to 360 px, zakres 280–600 px. Od 900 px szerokości okna czat znajduje się po prawej; w węższym oknie pod wideo, bez suwaka szerokości. Motyw można zmieniać także przy schowanym czacie. Suwak jest wtedy nieaktywny. Gdy strona nie udostępnia wykrywalnego czatu, kontrolki czatu nie są pokazywane.

Widoczność, szerokość i motyw są zapisywane osobno dla Twitcha i YouTube. Bez wcześniejszego wyboru TME respektuje zastaną widoczność i motyw serwisu. Chowanie, zmiana szerokości i motywu nie przenoszą kontenera ani nie zastępują ramki. Nie zmieniają filtra Top chat/Live chat. Przy niedostępnej palecie TME zachowuje natywny wygląd z wyjaśnieniem i zapamiętuje żądany motyw. [Instrukcja i szczegóły aktualnej implementacji](native-chat-validation.md) zawierają także zapis preferencji, lifecycle, zrzuty i dowody.

| Zakres | Stan |
| --- | --- |
| Układ, chowanie, niezależny motyw Twitch/YouTube | Zaimplementowane; sprawdzone na wylogowanych stronach live w Chromium z zainstalowanym rozszerzeniem. |
| Klawiatura, szkic/IME, wymiana dokumentu, zapis przy wyjściu/reload, warstwy menu | Pokryte testami; rzeczywisty edytor i szkic sprawdzono na Twitchu, zalogowany edytor YouTube pozostaje do kwalifikacji. |
| Replay/Premiere, funkcje konta, moderacja, monetyzacja, pełny przebieg filtra i responsywny YouTube, live Firefox | Detekcja uwzględnia replay, lecz pełna kwalifikacja tych funkcji przed wydaniem nadal pozostaje do wykonania. |
| Fullscreen i PiP | Przy widocznym czacie odmowa fullscreen dokumentu pozostawia theater z komunikatem; video PiP obejmuje wideo. Fullscreen na rzeczywistych serwisach pozostaje do kwalifikacji. |
| Dowolne strony zewnętrzne, nowe oficjalne embedy, osobne flagi czatu | Dalszy zakres projektu; obecny PR nie dodaje tworzenia embedów ani osobnych flag czatu. |

Ostatnia pełna walidacja kodu `8b2dcfc`: **479/479 testów, bez pominięć**, w tym **29/29 testów czatu i lokalizacji (26 czatu)**; typecheck, build, weryfikacja paczek i Chromium smoke z `CI=true` przeszły. [Raport walidacji](native-chat-validation.md) rozdziela sprawdzone zachowania od pozostałych kryteriów wydania. Gotowość PR do review nie oznacza zakończenia kwalifikacji wszystkich funkcji serwisów.

## Pierwotne założenia projektu

Poniższe porównania, plan i kryteria odbioru zachowują opracowanie dla bazowego commita `a79a541`. Opisy brakujących kontraktów, planowanych flag i obserwatorów dotyczą tamtego etapu. Aktualny kontrakt [ChatSurface i ChatState](../../src/chat/types.ts) oraz [kontroler](../../src/chat/controller.ts) są już zaimplementowane; lifecycle jest podłączony przez `startNativeChatSession` / `stopNativeChatSession` w runtime playera. Statusy proponowane niżej nie są polami obecnego `ChatSurface`.

## Rekomendacja

Zachować istniejący, natywny czat Twitcha i YouTube oraz jego sesję. TME powinno sterować geometrią playera, panelem czatu i przyciskiem pokaż/schowaj, pozostawiając renderowanie wiadomości, logowanie, moderację i transakcje serwisowi. Na stronach zewnętrznych preferować już istniejący czat; nowy oficjalny embed dopuszczać jako osobny, sprawdzony wariant live.

To rekomendacja architektoniczna wynikająca z kodu i dokumentacji, nie potwierdzenie działania prototypu. Warunkiem wydania jest brak regresji względem funkcji dostępnych na tej samej stronie, koncie, transmisji i przeglądarce bez TME. Nie można zagwarantować wszystkich przyszłych funkcji ani odporności na dowolną zmianę DOM. Można ograniczyć obszar zależności i zapewnić powrót do natywnego widoku.

## Podstawa pierwotnego opracowania

Data: 2026-10-08. Repozytorium: Theater-Mode-Everywhere, wersja package.json 1.5.0, commit a79a5417b42ec6ea27b5f339afbd16714b14bee3. Wykonano analizę statyczną lokalnego kodu oraz sprawdzenie oficjalnej dokumentacji. Nie przeprowadzono testów zalogowanych sesji, moderacji ani zakupów na działających czatach.

Istniejące zadania: [TME-7 — YouTube Integration v2](https://linear.app/privacybrand/issue/TME-7/youtube-integration-v2) i [TME-8 — Twitch Integration v2](https://linear.app/privacybrand/issue/TME-8/twitch-integration-v2). Oba obejmują live i VOD. To opracowanie definiuje wspólną architekturę i kryteria odbioru.

## Co wymagało zmiany w bazowym TME

- [YouTube presentation.css](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/providers/youtube/presentation.css#L1) ukrywa zarówno #chat, jak i #secondary. Przywrócenie widoczności samego czatu nie wystarczy: opacity: 0 na przodku nadal ukrywa cały poddrzewo. Wyjątek musi obejmować kontener czatu, jego potrzebnych przodków oraz wymagane natywne dialogi.
- [Twitch presentation.css](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/providers/twitch/presentation.css#L1) rozciąga .persistent-player na viewport i ukrywa .right-column oraz right-column-chat-bar. Potrzebny jest warunkowy układ z miejscem na prawą kolumnę.
- [content.css](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/content.css#L33) i [player-runtime.ts](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/ui/player-runtime.ts#L421) niezależnie wymuszają 100vw/100vh oraz min/max rozmiary. Wszystkie te reguły muszą korzystać z tego samego prostokąta obszaru wideo, inaczej player zasłoni czat.
- [root.ts](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/ui/root.ts#L59) montuje kontrolki TME w Shadow DOM. Zachować tę izolację dla kontrolek rozszerzenia; oryginalnego czatu nie przenosić do Shadow DOM TME.
- [controls.ts](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/ui/controls.ts#L716) uruchamia fullscreen dokumentu, ale po błędzie próbuje fullscreen samego wideo. Ten drugi wariant może zgubić czat.
- [player-runtime.ts](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/ui/player-runtime.ts#L1050) już ignoruje wiele pól edycji, lecz czat obejmuje także menu, przyciski i dialogi. Potrzebne są wyjątki również w MAIN-world obsłudze skrótów i koordynacji ramek.
- [ProviderStage](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/core/provider-presentation.ts#L16), [PlayerSession](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/core/player-session.ts) i [PlayerUiStore](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/blob/a79a5417b42ec6ea27b5f339afbd16714b14bee3/src/ui/store.ts) oferują miejsca do integracji, ale nie mają obecnie kontraktu czatu.

## Porównanie podejść

**Natywny czat pozostający w miejscu w DOM — wariant podstawowy.** Największa szansa zachowania aktualnych i nowych funkcji: pozostają komponenty, połączenia, sesja konta oraz integracje strony. Koszt utrzymania dotyczy odnajdywania kontenera, CSS, warstw i zdarzeń. Nie jest to publiczny kontrakt DOM, więc potrzebne są walidacja i bezpieczna degradacja.

**Oficjalny iframe — wariant warunkowy dla live na innych stronach.** Udokumentowany sposób osadzania ogranicza zależność od wnętrza czatu. Nie daje dowodu pełnej zgodności funkcjonalnej z główną stroną; dochodzą cookies, polityki osadzania, pop-upy i domena rodzica. Istniejącego natywnego czatu nie zastępować embedem automatycznie.

**Własny klient przez API — nie spełnia celu pełnej zgodności.** Twitch oferuje EventSub i API, a YouTube zasoby liveChatMessages. Otrzymanie danych o wiadomościach, Super Chat lub ankiecie nie oznacza dostępności całego UI, zakupów ani wszystkich zachowań serwisu. Własny klient wymaga odtwarzania funkcji, uprawnień i utrzymania nowych funkcji. API YouTube dotyczy aktywnego wydarzenia i nie zastępuje natywnego replay. Źródła: [Twitch Chat](https://dev.twitch.tv/docs/chat/), [YouTube LiveChatMessages](https://developers.google.com/youtube/v3/live/docs/liveChatMessages).

**Natywny pop-out — droga awaryjna.** Zapewnia osobne okno czatu, gdy strona taką funkcję oferuje. Nie spełnia wtedy wymogu panelu obok playera; należy wyraźnie pokazać ograniczenie i zapewnić powrót do widoku serwisu.

## Różnice między platformami i widokami

**Twitch, strona kanału live:** zachować oryginalną prawą kolumnę z czatem i potrzebne portale/dialogi. Nie odczytywać wiadomości ani React Fiber na potrzeby samej integracji układu.

**Twitch, VOD:** zachować natywny replay, jeśli strona go udostępnia, oraz jego synchronizację z odtwarzaczem. Oficjalny Twitch Embed nie obsługuje replay czatu. Nie zastępować go bieżącym czatem kanału — to inna rozmowa. Źródło: [Twitch Everything](https://dev.twitch.tv/docs/embed/everything/).

**YouTube, watch/live/Premiere:** zachować istniejący kontener i iframe czatu wraz z jego src oraz sesją. Kandydatami do detekcji są struktura ytd-live-chat-frame, istniejące #chat i iframe o ścieżce live_chat/live_chat_replay; selektory te wymagają weryfikacji na aktualnych wariantach strony. Nie przełączać Top chat na Live chat bez decyzji użytkownika.

**YouTube, archiwum:** używać istniejącego replay, jeśli jest dostępny. Brak czatu może być prawidłowym stanem transmisji. YouTube wskazuje między innymi brak live chat dla treści przeznaczonych dla dzieci i brak replay po edycji streamu w edytorze; ankiety live nie występują w replay. TME nie powinno próbować odtwarzać niedostępnej funkcji. Źródło: [YouTube — Learn about Live Chat](https://support.google.com/youtube/answer/15268877?hl=en).

**Zewnętrzna strona z playerem:** sam player nie dowodzi obecności czatu. Najpierw identyfikować istniejący czat przypisany do aktywnego kanału/videoId. Nowy embed tworzyć dopiero po włączeniu funkcji przez użytkownika i zweryfikowaniu identyfikatora oraz możliwości osadzania. Nie dodawać czatu do przypadkowego filmu ani odgadywać go z tytułu.

Twitch chat URL: `https://www.twitch.tv/embed/{channel}/chat?parent={hostname}`. Przy zagnieżdżeniu potrzebne są parent dla domen łańcucha osadzania, bez schematu i ścieżki. Jeśli używany jest sandbox, Twitch wymaga allow-storage-access-by-user-activation, allow-scripts, allow-same-origin, allow-popups, allow-popups-to-escape-sandbox i allow-modals. Źródło: [Twitch Chat Embed](https://dev.twitch.tv/docs/embed/chat/).

YouTube live chat URL: `https://www.youtube.com/live_chat?v={videoId}&embed_domain={hostname}`. Domena musi odpowiadać stronie osadzającej; ten sposób nie jest dostępny w mobile web. URL nie jest publicznym API sterowania czatem. Źródło: [YouTube — Embed a Live Chat](https://support.google.com/youtube/answer/2524549?hl=en).

Nowy embed zależy także od CSP strony, zasad frame-ancestors/X-Frame-Options serwisu, referrera oraz dostępu do sesji. Uprawnienia host_permissions rozszerzenia nie znoszą tych ograniczeń. Nie obchodzić blokad. Wariant zewnętrzny kwalifikować osobno w Chrome i Firefox z blokowaniem cookies. Źródło: [MDN — third-party cookies](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies).

## Pierwotny projekt architektury i UI

1. **Adapter czatu na platformę.** Proponowany kontrakt ChatSurface: provider, contentKey, kind (live/replay), root, iframe?, status oraz dispose. Statusy: wykrywanie, dostępny, niedostępny z powodu serwisu, integracja nieobsługiwana. Flagi mają opisywać możliwości potwierdzone; nie wnioskować o uprawnieniach konta z samej obecności iframe.
2. **Kontroler przypisany do PlayerSession.** Używać epoch i DisposableScope do odpinania obserwatorów, zamykania poprzednich powiązań i odrzucania spóźnionych wyników po nawigacji. ChatSurface pozostaje osobnym kontraktem obok PlaybackSurface.
3. **Jeden obszar wideo.** Wspólne zmienne/geometria sterują wideo, kontenerem hosta, toolbarami, napisami i HUD. Domyślnie panel z prawej, regulowana szerokość; propozycja startowa 360 px, z ograniczeniem przez dostępne miejsce i minimum natywnego UI. Na wąskim oknie panel pod wideo, bez przykrywania obrazu. Po schowaniu player wykorzystuje cały dostępny obszar.
4. **Oryginalny DOM zostaje u serwisu.** Pozycjonować zewnętrzny kontener CSS-em. Nie klonować czatu, nie przepinać rodziców i nie zmieniać src iframe podczas toggle/resize. Zwykłe appendChild/insertBefore mogą resetować iframe; moveBefore zachowuje więcej stanu, ale ma ograniczoną dostępność i nadal nie gwarantuje zgodności z lifecycle komponentów serwisu. Źródło: [MDN — moveBefore](https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore).
5. **Chowanie bez odmontowania przez TME.** Przełączać własną klasę kontenera, widoczność i możliwość fokusu; używać inert dla schowanego regionu, bez obejmowania playera. Przed schowaniem przenieść fokus na przycisk. Po pokazaniu zachować istniejący draft i scroll, o ile zachowuje je sam serwis. Nie klikać natywnego „zamknij”, jeśli odmontowuje komponent. Ukryta ramka może ograniczać aktywność — nie obiecywać nieprzerwanego odbierania czy wysyłania w tle.
6. **Sterowanie.** Przycisk „Pokaż czat / Schowaj czat”, aria-expanded i aria-controls, stale osiągalny przy schowanym czacie. Domyślnie respektować stan zastany; zapamiętywać wybór TME i szerokość osobno dla platform. Nie przechowywać wiadomości ani danych konta.
7. **Zdarzenia i warstwy.** Kontrolki playera działają w obszarze wideo. Cały czat i jego natywne menu/dialogi mają pierwszeństwo dla kliknięć, scrolla, skrótów, IME i Escape. Pomijać dokumenty ramek czatu w globalnym przechwytywaniu skrótów TME. Zachować istniejące zabezpieczenia origin/source/nonce dla komunikacji rozszerzenia; nie przekazywać treści wiadomości czatu.
8. **Fullscreen i PiP.** Fullscreen obejmuje wspólny dokument/istniejącego przodka playera, czatu i potrzebnych dialogów. Dla playera w iframe nadrzędny dokument musi zarządzać układem, jeśli czat jest jego rodzeństwem. W razie braku uprawnień pozostać w theater i pokazać ograniczenie; nie przełączać po cichu na fullscreen samego wideo. Zwykłe video PiP obejmuje wideo; czat pozostaje na stronie. Źródło: [MDN — requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen).

Twitch wymaga HTTPS, prawidłowego parent i niezasłaniania oficjalnych embedów; niewidoczność może wyłączyć wysyłanie wiadomości. W wariancie nowego embedu umieszczać własne kontrolki poza oficjalną ramką i respektować minimum rozmiaru, zamiast przykrywać jego UI. Odrębnie kwalifikować taki widok względem natywnego playera. Źródło: [Twitch — Embedded Experiences Requirements](https://dev.twitch.tv/docs/embed/).

## Odporność na aktualizacje

Detekcja musi być ograniczona do platformy, aktywnego contentKey i zestawu kandydatów. Preferować kontener komponentu, semantykę i oficjalny URL istniejącej ramki; unikać tekstów zależnych od języka, nth-child oraz wygenerowanych klas. Selektory data-a-target także nie są gwarantowanym API.

MutationObserver ograniczyć do zmian struktury kontenera i nawigacji; nie obserwować każdego dopisanego komunikatu. ResizeObserver śledzi geometrię. Grupować odświeżenia, zapewnić idempotencję i usuwać obserwatory na wyjściu.

Przechowywać własność zmienianych klas, atrybutów i właściwości CSS. Przy wyjściu odtworzyć tylko modyfikacje TME, zachowując późniejsze zmiany serwisu. Sprawdzać pozycję, rozmiar, widoczność przodków i trafianie kliknięć, a nie tylko isConnected.

Jeśli nie można pewnie połączyć czatu z playerem lub odsłonić niezbędnego dialogu, przywrócić natywną prezentację i podać powód. Nie wstawiać automatycznie uproszczonego czatu w miejsce natywnego. Feature flag osobno dla Twitch, YouTube i nowych embedów umożliwia szybkie wyłączenie problematycznego wariantu.

## Kryteria odbioru i weryfikacja

Każdy wynik porównywać z natywną stroną bez TME na tym samym koncie i materiale. Funkcje niedostępne w punkcie odniesienia oznaczać jako N/A z powodem, nie jako sukces.

- **Wspólne:** odczyt i wysyłanie, emoji, wzmianki, linki, menu użytkownika, historia/scroll, draft, ustawienia, logowanie i powrót z pop-upu; brak pauzy playera po kliknięciu czatu; poprawne działanie klawiatury, Tab, IME i czytnika ekranu.
- **Twitch:** emotes/badges, Bits/Cheers, suby i prezenty, channel points/nagrody, ankiety/predykcje oraz shared chat tam, gdzie są dostępne; funkcje moderatora, timeout/ban, usuwanie i tryby ograniczonego pisania. Osobno natywny replay przy seek, pauzie i zmianie prędkości.
- **YouTube:** Top chat/Live chat, przypięte wiadomości, ankiety, Q&A, reakcje, Super Chat/Super Stickers, członkostwa i prezenty; funkcje moderatora i dostępne tryby ograniczeń; replay, seek i zmiana prędkości bez zmiany rozmowy.
- **Stan:** wielokrotne pokaż/schowaj i resize nie zmieniają tożsamości oryginalnego węzła, rodzica ani src iframe; TME nie powoduje dodatkowego load/odmontowania. Zachowane konto, draft i scroll w zakresie zachowania serwisu.
- **Widoki:** Chrome i Firefox, live/Premiere/VOD, użytkownik zalogowany i wylogowany, uprawnienia moderatora, fullscreen, małe okno i zoom 200%, różne języki, nawigacja SPA/kolejny kanał, raid/zakończenie streamu oraz już osadzony player z czatem na stronie zewnętrznej.
- **Błędy:** usunięty selektor, opóźniony czat, zamiana iframe przez serwis, zablokowane cookies/CSP, brak czatu, brak parent/embed_domain i odmowa fullscreen. Oczekiwany wynik: zachowany player i czytelny powrót do natywnego czatu/widoku.
- **Monetyzacja:** sprawdzić dostępność i poprawną prezentację natywnych formularzy bez niezamówionego zakupu. Faktyczny przepływ płatności wymaga oddzielnego, kontrolowanego testu; bez niego nie deklarować weryfikacji transakcji.
- **Automatyzacja:** testy kontraktu i lifecycle oraz fixtures browser dla hide/restore, fokusów, nawigacji i ramek; uzupełnić kontrolowanymi testami na żywych serwisach. Fixture nie dowodzi działania serwisowej funkcji ani logowania.

## Pierwotna kolejność realizacji

1. Spike natywnego czatu na Twitch i YouTube: kontener, przodkowie, warstwy, najtrudniejsze dialogi oraz fullscreen. Rozstrzygnąć wykonalność przed deklaracją pełnej zgodności.
2. Wspólny ChatSurface i kontroler sesji, jeden prostokąt wideo, toggle i preferencje; integracja w TME-7 oraz TME-8.
3. Kwalifikacja live/Premiere i osobno VOD/replay, macierz regresji i fallback. Włączenie za flagami dopiero po spełnieniu kryteriów.
4. Istniejące czaty na stronach zewnętrznych, następnie opcjonalne nowe oficjalne embedy live. Jeśli osadzanie ogranicza funkcje, dokumentować różnicę i oferować natywną stronę/pop-out.

## Stan realizacji

Implementacja znajduje się na [PR #25, gotowym do review](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/pull/25). Aktualny zakres opisano na początku tego dokumentu, a [raport walidacji](native-chat-validation.md) zawiera dowody i pozostałą kwalifikację przed wydaniem. Pierwotny zakres docelowy jest szerszy niż ten PR.
