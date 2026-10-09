# Nawigacja YouTube: kolejka jako główne źródło

Data badania: 2026-10-09. Poniższa diagnoza opisuje zachowanie przed zmianą oraz projekt rozwiązania. Implementacja powstała po zatwierdzeniu jej przez użytkownika; jej zakres opisano na końcu dokumentu.

## Wniosek

Obecne kontrolki zależą wyłącznie od przycisków playera YouTube. Panel kolejki/playlisty może dostarczać cele nawigacji oraz tytuły i miniatury niezależnie od widoczności tych przycisków. Rekomendacja: rozpoznawać aktywną kolejkę w pierwszej kolejności, a obecnego mechanizmu używać przy braku wiarygodnego rozstrzygnięcia z kolejki.

Nie potwierdzono konkretnego błędu JavaScript YouTube opisanego przez użytkownika. Potwierdzono mechanizm, przez który brak lub ukrycie przycisków playera usuwa akcje w rozszerzeniu, oraz działanie alternatywnej nawigacji z ukrytego panelu.

## Obecne zachowanie

- `src/providers/navigation/youtube.ts`: pobiera `.ytp-prev-button` i `.ytp-next-button`. Tytuł i obraz podglądu pochodzą z `data-tooltip-text` i `data-preview` tych przycisków.
- `src/providers/navigation/observed.ts`: odrzuca kontrolki z `disabled`, `aria-disabled="true"` lub własnym `display: none`. Samo schowanie nadrzędnego paska przez opacity/visibility nie jest powodem odrzucenia.
- `src/providers/navigation/factory.ts`: `activate()` wywołuje `.click()` natywnego przycisku. Wyszukiwanie zaczyna od kontenera playera; nie ma adaptera panelu YouTube, a obecność choćby jednego zebranego przycisku powstrzymuje rozszerzenie poszukiwania na cały dokument.
- `src/ui/controls.ts`: co 400 ms synchronizuje widoczność naszych kontrolek z dostępnością akcji. Nie próbuje odczytać kolejki, gdy przycisku brakuje.
- `src/ui/player-runtime.ts`: kliknięcia i skróty klawiaturowe korzystają z tych samych akcji. Przed aktywacją ponownie wyszukuje akcję. Istniejący protokół iframe potrafi przekazać dostępność i żądanie nawigacji do rodzica.
- `src/providers/youtube/presentation.css`: ukrywa panel i pasek YouTube przez `visibility`, `opacity` i `pointer-events`; pozostawia ich DOM. Nowy adapter musi akceptować niewidoczne pozycje panelu, zamiast przepuszczać je przez filtr widoczności przycisków playera.
- Brak tytułu lub obrazu w przycisku Previous jest obecnie heurystyką „powrót do początku”, a nie dowodem istnienia poprzedniej pozycji.

## Próba na żywym YouTube

Badano desktopowy Chromium bez logowania, na [pierwszej pozycji Essence of calculus](https://www.youtube.com/watch?v=WUvTyaaNkzM&list=PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr).

1. Panel `ytd-playlist-panel-renderer` zawierał 12 elementów `ytd-playlist-panel-video-renderer`, linki `/watch?...`, tytuły, miniatury i element oznaczony `[selected]`.
2. W kontekście strony `panel.data` zawierało `playlistId`, `currentIndex`, `localCurrentIndex`, `totalVideos`, `isInfinite` i `contents`. Pozycje miały `videoId`, `selected`, `playlistSetVideoId` i `navigationEndpoint.watchEndpoint.index`.
3. Po kliknięciu Collapse panel uzyskał `[collapsed]`, a `#items` dostało `display: none`. Wszystkie 12 pozycji DOM i dane panelu pozostały dostępne. Natywne przyciski playera nadal działały: samo zwinięcie nie odtworzyło zgłoszonego błędu.
4. Po celowym ustawieniu `display: none` na obu natywnych przyciskach skompilowany, niezmieniony `findPlaylistActions()` zwrócił pustą listę, mimo nadal dostępnego panelu. To kontrolowana symulacja brakujących kontrolek, nie spontaniczny błąd YouTube.
5. Przy zwiniętym panelu, z ukrytymi przyciskami i włączonym CSS YouTube z naszego rozszerzenia, `.click()` linku drugiej pozycji przełączył stronę na `9vKqVkMQHKk`, zachował `list` i ustawił `index=2`. Dane panelu potwierdziły `currentIndex=1`, a druga pozycja została zaznaczona. Panel pozostał zwinięty.

Oddzielnie utworzono kolejkę sesji przez Add to queue na stronie tego samego filmu bez `list` w URL. Po zakończeniu dodawania panel miał identyfikator `TLPQ…`, dwie pozycje DOM i `totalVideos=2`. Po zwinięciu obie pozycje pozostały w DOM, a kontener listy dostał `display: none`.

Ta kolejka ujawniła istotny przypadek: pierwszy wiersz reprezentował nadal odtwarzany `WUvTyaaNkzM`, miał tytuł, ale nie miał adresu ani `watchEndpoint`. Drugi wiersz reprezentował dodany `9vKqVkMQHKk`, miał adres i `[selected]`, mimo że aktualnym filmem był pierwszy. Jego `watchEndpoint.index` wynosił 0, a URL wskazywał `index=1`; jest to pierwsza właściwa pozycja nowej kolejki, poprzedzona pomocniczym wpisem aktualnego odtwarzania.

Programowe kliknięcie tego drugiego wiersza, po zwinięciu i włączeniu CSS trybu kinowego, przełączyło URL oraz `getVideoData().video_id` playera na `9vKqVkMQHKk`. Po przejściu dane panelu zawierały tylko właściwą pozycję kolejki (`totalVideos=1`, `currentIndex=0`), choć w momencie odczytu DOM nadal miał dwa wiersze. To dodatkowy dowód, że model i DOM mogą przejściowo różnić się zawartością.

Obie próby potwierdzają drogę nawigacji z panelu, ale nie są pełną weryfikacją cyklu sesji rozszerzenia ani wszystkich odmian YouTube. Nie odtworzono spontanicznego zanikania natywnych przycisków po zwinięciu.

Uruchomiono `pnpm exec tsx --test src/playlist-nav.test.ts`: 15/15 testów zakończyło się powodzeniem, w tym rzeczywiste testy DOM w Chromium. Obecne testy potwierdzają zależność od playera; nie obejmują jeszcze nowego adaptera kolejki.

## Proponowany adapter

### 1. Odczyt aktywnego panelu

Adapter YouTube powinien odczytywać panel z dokumentu strony, poza `#movie_player`, niezależnie od zwinięcia lub ukrycia przez tryb kinowy. Musi wybrać panel należący do aktualnego odtwarzania, a nie nieaktywną kopię mini-playera.

DOM wystarcza do prostego wariantu zapisanej playlisty, gdy wiersze nadal istnieją i ich zaznaczenie zgadza się z aktualnym filmem. Dla solidnej obsługi również kolejki sesji rekomendowany jest mały snapshot z MAIN world: aktualne ID filmu playera, model `panel.data`, identyfikator kolejki i zweryfikowane cele nawigacji, opublikowane istniejącym mechanizmem `publishHiddenJson`. Właściwości JavaScript strony nie są bezpośrednio dostępne z izolowanego content scriptu. W pierwszej wersji wystarczy publikować sąsiadów i stan rozstrzygnięcia, zamiast kopiować całą listę i endpointy YouTube.

Resolver musi rozpoznawać pomocniczy wpis odtwarzanego filmu poprzedzający właściwą kolejkę. Nie może traktować `[selected]` jako samodzielnego dowodu aktualnego odtwarzania ani mieszać indeksu wiersza DOM z `watchEndpoint.index`. Przejściowe rozbieżności wymagają ponownego odczytu albo fallbacku. Sam snapshot metadanych nie wystarczy do aktywacji: potrzebny jest również sprawdzony mechanizm nawigacji z istniejącego wiersza. Wariant bez wyrenderowanego wiersza pozostaje nierozstrzygnięty do czasu weryfikacji alternatywnej drogi aktywacji.

Nie opierać aktualnej kolejki wyłącznie na `ytInitialData`, które po nawigacji SPA może opisywać poprzednią stronę. Nie odrzucać kolejki tylko dlatego, że URL nie zawiera parametru `list`.

### 2. Rozstrzygnięcie osobno dla każdego kierunku

Dla Previous i Next adapter powinien zwracać jedno z trzech rozstrzygnięć:

- **Cel ustalony**: aktywna kolejka wskazuje konkretną, odtwarzalną pozycję. Ta akcja ma pierwszeństwo przed playerem.
- **Potwierdzona granica**: wiadomo, że nie istnieje kolejna/poprzednia pozycja w bieżącym trybie odtwarzania. Nie zastępować końca kolejki losową rekomendacją z natywnego Next.
- **Brak rozstrzygnięcia**: brak aktywnego panelu, niepełne dane, przejście SPA, nierozpoznane tasowanie lub brak sprawdzonej drogi aktywacji. Wtedy użyć obecnego fallbacku playera dla danego kierunku.

Nie wystarczy lista akcji i proste „brak Next w panelu → Next z playera”: brak danych o następnym elemencie i rzeczywisty koniec kolejki muszą być rozróżniane.

Identyfikować pozycję przez kolejkę i indeks/identyfikator wpisu; `videoId` nie wystarcza, ponieważ ten sam film może występować wielokrotnie. Zweryfikować zgodność wybranej pozycji z aktualnym filmem i odrzucać stare dane podczas nawigacji.

### 3. Aktywacja i podgląd

W pierwszej wersji aktywować rzeczywisty link konkretnej pozycji panelu przez `.click()`, jak w próbie. MAIN world może obsłużyć żądanie zawierające kierunek i oczekiwaną tożsamość odtwarzania, ponownie rozstrzygnąć cel oraz kliknąć aktualny wiersz. Pozwala to YouTube obsłużyć własną nawigację SPA oraz kontekst kolejki. Nie rozbudowywać URL samodzielnie przez `index + 1` i nie przeładowywać strony: kolejka sesji ma inny cykl życia niż zapisana playlista.

Przed kliknięciem ponownie odczytać aktywną kolejkę i cel. Zmiana kolejności, usunięcie pozycji lub zamknięcie kolejki musi unieważniać poprzedni wybór. Po wydaniu jednej akcji nie uruchamiać automatycznie drugiej ścieżki tylko dlatego, że asynchroniczna nawigacja nie zakończyła się natychmiast.

Podgląd brać z tej samej pozycji, którą aktywuje przycisk. Brak miniatury lub tytułu powinien usuwać tylko podgląd, nie prawidłową akcję nawigacji. Można zachować istniejący `PlaylistAction` / `PlaylistNavState`, UI, skróty i protokół iframe; trójstanowe rozstrzygnięcie pozostaje wewnątrz adaptera YouTube.

### 4. Zachowanie brzegowe

- „Poprzedni” z rozpoznanej kolejki powinien przechodzić do poprzedniej pozycji. Fallback może zachować obecne „powrót do początku”; to świadoma różnica zachowania, którą trzeba objąć testem.
- W próbie natywny Previous na pierwszej pozycji wskazywał ostatnią pozycję playlisty. Nie zakładać więc, że pierwszy wiersz automatycznie oznacza brak Previous ani że zawsze należy zapętlać listę.
- Tasowanie: sąsiad w widocznym panelu nie musi odpowiadać kolejności playera. Dopóki nie ma zweryfikowanej kolejności odtwarzania, używać fallbacku. `getPlaylist()` i `getPlaylistIndex()` były dostępne na badanym `#movie_player`, ale ich zachowanie na stronie watch wymaga osobnej weryfikacji; dokumentacja IFrame API nie gwarantuje kontraktu tej strony.
- Zapętlenie pojedynczego filmu i całej listy wymaga rozpoznania rzeczywistego trybu. Nie dodawać domyślnego zawijania indeksu.
- Długie listy i Mix mogą zawierać continuation lub tylko fragment kolejki. Brak sąsiada w aktualnym DOM nie dowodzi granicy; nie wykonywać pełnego skanowania JSON strony co 400 ms.
- Prywatne/usunięte pozycje wymagają rozpoznania odtwarzalności bez porównywania lokalizowanego tekstu i bez zgadywania następnego celu.
- Embed bez panelu oraz zwykły film bez kolejki zachowują obecne zachowanie playera.

## Zakres realizacji i weryfikacji

Rekomendowana wersja jest zmianą o średniej złożoności: resolver modelu kolejki i publikacja snapshotu w integracji YouTube MAIN world, odczyt i aktywacja w `src/providers/navigation/youtube.ts` lub sąsiednim module, pierwszeństwo rozstrzygnięć w `factory.ts` oraz testy w `playlist-nav.test.ts` i testy resolvera. Nie wymaga nowych uprawnień ani przebudowy paska kontrolek. Pełna obsługa tasowania, continuation i aktywacji bez wiersza DOM dodatkowo zwiększa zakres; przy nierozpoznanych wariantach pierwsza wersja może zachować obecny fallback.

Przed wdrożeniem sprawdzić: kolejkę sesji i playlistę rozwiniętą/zwiniętą; brak, ukrycie i `aria-disabled` przycisków playera; początek/środek/koniec; powrót do początku; duplikaty; zmianę kolejności i usuwanie pozycji; tasowanie i oba tryby zapętlenia; fragmentaryczną listę; niedostępne filmy; nawigację SPA i pozostanie w trybie kinowym; zwykły film oraz embed. Testy powinny weryfikować faktyczny cel kliknięcia i spójność podglądu, a nie tylko obecność przycisku. Integrację rozszerzenia sprawdzić w Chromium i Firefox.

## Wdrożona wersja

- `queue-main.ts` rozpoznaje aktualny panel i model kolejki w MAIN world, wiąże go z ID filmu, ID kolejki oraz kolejnością `getPlaylist()` / `getPlaylistIndex()`. Obsługuje także pomocniczy wpis bieżącego filmu w nowej kolejce sesji. Nie używa `ytInitialData`.
- `queue-bridge.ts` przekazuje mały snapshot na żądanie istniejącego odświeżania kontrolek. Identyfikator żądania odrzuca stare snapshoty. Zdarzenia używają tekstowego `detail` dla zgodności z izolacją Firefox. Nie dodano obserwatorów ani timerów.
- Adapter nawigacji YouTube nadaje pierwszeństwo rozstrzygnięciom kolejki osobno dla każdego kierunku. Brak miniatury usuwa tylko podgląd. Brak panelu, niejednoznaczny model, niewyrenderowany cel lub nieodtwarzalny wpis pozostawia dotychczasowy fallback.
- Na brzegach nie zgadujemy trybu zapętlenia: jeśli podgląd playera wskazuje inny wpis kolejki, aktywowany jest ten wpis. Rekomendacja spoza kompletnej, skończonej kolejki jest traktowana jako jej koniec. Nierozpoznane zachowanie, w tym restart bieżącego filmu, pozostaje obsługiwane przez player.
- Nowa kolejka z pomocniczym wpisem bieżącego filmu ma potwierdzony brak poprzedniej pozycji. W tym stanie ukrywamy Previous nawet wtedy, gdy YouTube błędnie pokazuje na nim podgląd pierwszego oczekującego filmu.
- Aktywacja ponownie sprawdza dokładną kolejkę, bieżące wystąpienie i docelowy film/wystąpienie. Weryfikuje rzeczywisty adres wpisu, w tym indeks endpointu, aby nie pomylić duplikatów. Klika aktualny link; nie buduje adresu i nie przeładowuje strony.
- Testy przeglądarkowe obejmują oba silniki, ukryty panel, brak natywnych kontrolek, kolejkę sesji, tasowanie, duplikaty, nieaktualne akcje, niespójny indeks linku, niepełną listę, niedostępny wpis, koniec, zapętlenie wskazywane przez player, restart i wyłączenie integracji. Osobny test Chromium sprawdza komunikację z rzeczywistym izolowanym kontekstem, z którego `panel.data` nie jest dostępne.
- Na żywym YouTube potwierdzono przełączenie filmu przez nowy resolver przy zwiniętym panelu i ukrytych przyciskach playera. Po `setShuffle(true)` podgląd Next odpowiadał rzeczywistemu następnemu ID z `getPlaylist()` mimo niezmienionej kolejności panelu. Tasowanie przywrócono po próbie.
- Osobno sprawdzono finalny resolver na kolejce sesji: przed kliknięciem dostępny był wyłącznie Next, po kliknięciu URL i player przeszły do pierwszej właściwej pozycji (`index=1`), a panel pozostał zwinięty.

## Źródła zewnętrzne

- [YouTube Help: Queue videos on YouTube](https://support.google.com/youtube/answer/9546304?hl=en): kolejka desktopowa służy bieżącej sesji i nie jest zachowywana po zamknięciu przeglądarki. To powód, by traktować ją oddzielnie od zapisanej playlisty.
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference): opisuje API osadzonych playerów. Nie stanowi dokumentacji wewnętrznych właściwości rendererów ani playera strony watch.
