# YouTube: złożoność niezależnego motywu czatu

**Wynik: niezależny motyw da się uzyskać patchem CSS opartym na natywnych tokenach obu palet.** PR #25 zawiera już adapter YouTube używający tego mechanizmu oraz wspólną obsługę motywu z Twitchem. [Aktualna implementacja, nowe zrzuty i walidacja](native-chat-validation.md) zastępują wcześniejszy wariant z nieaktywnym przełącznikiem YouTube. Nie trzeba pobierać przeciwnego arkusza, przeładowywać ramki ani podmieniać funkcji serwisu.

Dalsza część dokumentu zachowuje **historyczne pomiary prototypów**. Pierwszy odczyt CSSOM pominął aliasy w skrótowych deklaracjach CSS, takich jak `border-color`: wartości longhand mogą być puste przy `var()`. Pełne przeszukanie serializowanych deklaracji wykazało **68 używanych aliasów, z których 57 zmienia kolor**, zamiast wcześniejszych 47/38. Adapter obejmuje te 57 różnic; test porównuje wszystkie 68 z niezależnie odczytanymi natywnymi paletami. Wartości 38 i 47 poniżej opisują zakres dawnych eksperymentów, a nie pokrycie obecnego kodu.

Obecny adapter działa bez wywoływania metod serwisu w świecie strony: wspólna `ChatThemeSession` stosuje adapter do aktualnego dokumentu oryginalnej ramki i odtwarza jego własny snapshot przy wyborze `native`, wymianie dokumentu lub wyjściu z theater. Brak znanej kompletnej palety usuwa wymuszenie, zachowuje wybór użytkownika i pokazuje wyjaśnienie. Kod funkcji: `8b2dcfc`; [zrzuty ustawień odświeżone po poprawce strzałki](native-chat-validation.md) pochodzą z `4255228`.

## Historyczny pomiar na prawdziwym serwisie

Test wykonano 8 października 2026 na [Lofi Girl Live](https://www.youtube.com/watch?v=1-LpQekNa9g), w graficznym Chromium 153 przez Playwright/Xvfb. Osobny profil był wylogowany i miał zainstalowane rozszerzenie z commita `05fb0022c1e32d96475864d26e01b16f9a11dac1`. Nie korzystano z konta użytkownika. Przeglądarka T3 nie otrzymała działającego czatu od YouTube; pomiary dotyczą osobnego Chromium.

Obie palety pozyskano przez rzeczywiste menu Appearance YouTube w tymczasowym profilu. W tym etapie serwis sam wymienia dokument i arkusz czatu. Dopiero potem testowano niezależne przełączanie przez prototyp w pojedynczym istniejącym dokumencie. To dwa różne etapy.

| Element bieżącego arkusza | Pomiar |
| --- | --- |
| Wygenerowane aliasy kolorów w każdym motywie | 133 |
| Aliasy o różnych wartościach wynikowych light/dark | 116 |
| Aliasy, do których odwołuje się załadowany CSS | 47 |
| Różniące się aliasy używane przez ten CSS | 38 |
| Patch tych 38 aliasów | jasny: 1202 B; ciemny: 1229 B |
| Patch wszystkich 116 różnic palety | jasny: 3599 B; ciemny: 3629 B |
| Reguła prototypu | jedna `:root:root:root` |

Liczba odwołań dotyczy arkuszy, także komponentów jeszcze niewidocznych. Nie jest liczbą elementów na ekranie ani dowodem pokrycia wszystkich funkcji.

YouTube łączy semantyczne zmienne przełączane przez `html[dark]` z wygenerowanymi aliasami `--t…`, których wartości są skompilowane dla motywu przy ładowaniu arkusza. Samo `setGlobalDarkTheme` nie wymienia drugiej grupy. Prototyp wywołuje istniejącą metodę i dodaje wartości aliasów odczytane z rzeczywistego przeciwnego motywu.

Pierwsza próba z regułą `:root` pozostawiła jasne obramowanie Top fans. Natywny arkusz ma dodatkową regułę `:root:root` z sześcioma nadpisaniami. Odczyt ostatniej deklaracji z CSSOM nie wystarcza: paletę trzeba zebrać przez `getComputedStyle`. Po uwzględnieniu kaskady i silniejszej reguły różnica zniknęła. Nie użyto `!important`, filtrów odwracania obrazu ani własnych kolorów poszczególnych rendererów.

## Wyniki prototypu

- Przełączenie light → dark i dark → light zachowało przeciwny motyw głównego dokumentu. Wymuszanie nie zmieniało preferencji YouTube.
- Kolory tła, tekstu, obramowania, fill i stroke dziesięciu obecnych punktów pomiaru zgadzały się z natywnym motywem. Badano renderer, nagłówek, Top chat, obszar logowania, Top fans, zwykłą wiadomość, autora, ikonę, menu filtra i komunikat serwisu. To próbka komponentów.
- Menu Top chat otwierało się w obu motywach. Później otwarte More options miało natywne ciemne tło `rgb(40, 40, 40)` i jasny tekst pozycji `rgb(241, 241, 241)`. Dostępne były Participants, Reactions, Popout chat i Send feedback; nie uruchamiano tych działań.
- Wykonano 20 kolejnych zmian motywu i łącznie dziesięć cykli schowaj/pokaż przez TME. Ten sam iframe, dokument i źródło; dodatkowe zdarzenia `load`: 0.
- Usunięcie arkusza i przywrócenie flagi odtworzyło zmierzone kolory początkowego motywu w obu kierunkach. Natywnej metody nie podmieniano.
- Wariant 116 różnic również zgadzał się z ciemnym punktem odniesienia. Pokrywa więcej tokenów, lecz nie dowodzi działania nieotwartych formularzy.
- Załączony helper uruchomiono na tym samym żywym czacie. Przełączenie i przywrócenie również nie miały różnic w badanych punktach.

[Pomiary JSON](prototypes/youtube-chat-theme-results.json) zawierają źródła arkuszy, kolory i sprawdzenia. [Kod prototypu](prototypes/youtube-chat-theme.mjs) ma 77 linii i nie trafia do paczki rozszerzenia. Funkcje `capturePalette` i `applyPalettePrototype` można wykonać przez `frame.evaluate` w świecie strony; uchwyt umożliwia `setTheme` oraz `restore`. Wymaga dwóch wcześniej pozyskanych natywnych palet z tej samej wersji CSS. Nie pobiera ich dla użytkownika.

Zrzuty przedstawiają **eksperymentalny CSS w istniejącym czacie**, a nie funkcję w ustawieniach TME. Są wycinkami ramki z prawdziwej strony. Odtwarzanie wideo nie było przedmiotem tego pomiaru.

![Prototyp: wymuszony ciemny czat i natywne Top chat](screenshots/youtube-chat-prototype-dark-menu.png)

![Prototyp: wymuszony jasny czat i natywne Top chat](screenshots/youtube-chat-prototype-light-menu.png)

![Prototyp: później otwarte More options w ciemnej palecie](screenshots/youtube-chat-prototype-dark-more.png)

## Uzupełnienie: most do semantycznych tokenów

W tym samym `live_chat_base` są zarówno jasne, jak i ciemne definicje `--yt-sys-color-baseline--*`. Reguły wariantu `color-version=v2_0` mają po 207 deklaracji, w tym 203 tokeny tego systemu. Dostępne są między innymi `base-background`, `text-primary`, `text-secondary`, `menu-background`, `outline`, kolory akcji, statusów oraz klawiatury emoji. Natywne selektory wybierają paletę zależnie od `html[dark]`.

Można ponownie połączyć skompilowane aliasy z tymi zmiennymi:

```css
:root:root:root {
  --t3e41d7b17b187f69: var(--yt-sys-color-baseline--base-background);
  --tffc2fd3a644f6275: var(--yt-sys-color-baseline--text-primary);
  --t08a7c6c176cbc5c2: var(--yt-sys-color-baseline--menu-background);
}
```

Porównanie wcześniejszych natywnych par light/dark pozwoliło dopasować 34 z 38 używanych różnic do par tokenów. W 13 przypadkach kilka różnych ról ma tę samą parę kolorów; dopasowanie wartości nie dowodzi znaczenia semantycznego. Pozostałe cztery aliasy odzwierciedlają dodatkowe nadpisania arkusza. Prototyp obsłużył je natywnymi tokenami z regułami zależnymi od `dark`, a obramowania przez `color-mix` z kryciem 20%. Nie wpisano do tego mostu własnych wartości RGB/hex.

[Most CSS](prototypes/youtube-chat-theme-token-bridge.css) ma 3057 B. Nowy test na prawdziwym, wylogowanym YouTube w graficznym Chromium 153 wykonał native light → forced dark → forced light → restore. W czasie przełączania nie pobierał przeciwnego arkusza i nie zmieniał ustawień YouTube. Wszystkie 38 aliasów w obu motywach zgadzało się z wcześniejszym natywnym punktem odniesienia po porównaniu wartości RGBA. Menu Top chat otwierało się w obu motywach. Ten sam iframe i dokument, dodatkowe `load`: 0; natywna metoda niepodmieniona, pierwotne wartości aliasów przywrócone, błędy strony: 0.

Surowe porównanie właściwości badanych węzłów wykazało tylko różny zapis obramowania Top fans: `color(srgb … / 0.2)` zamiast `rgba(…, 0.2)`, z identycznym kolorem po normalizacji. [Wyniki i kandydaci mapowania](prototypes/youtube-chat-theme-token-results.json) zachowują tę różnicę, zamiast traktować równość ciągów CSS jako równość kolorów.

To zmniejsza trudność względem pierwszej oceny: druga paleta semantyczna już jest w dokumencie, więc jej pobieranie nie musi być częścią rozwiązania. Mapę przygotowano jednak badawczo na podstawie obu poprzednio zmierzonych natywnych motywów. Nie opracowano automatycznego, jednoznacznego mapowania nieznanej wersji. Most nadal zawiera wygenerowane nazwy aliasów oraz cztery specjalne powiązania. `color-mix` sprawdzono w Chromium 153; zgodność pozostałych przeglądarek i fallback wymagają kwalifikacji. Zalogowany edytor pozostaje niezweryfikowany.

## Historyczna ocena złożoności wdrożenia i utrzymania

| Warstwa | Ocena | Powód |
| --- | --- | --- |
| Korekta kolorów dla poznanej wersji | mała | Jedna reguła, 38–116 deklaracji, istniejąca metoda serwisu. |
| Cykl życia w rozszerzeniu | średnia | Świat strony, gotowość komponentu, wymiana dokumentu, własność CSS, przywracanie i odrzucanie spóźnionych wyników. |
| Powiązanie aliasów z natywnymi tokenami | średnia/duża, do kwalifikacji | Obie palety semantyczne są dostępne; niejednoznaczne role i dodatkowe nadpisania wymagają mapowania oraz walidacji. |
| Odporność na aktualizacje i eksperymenty | duża | Tokeny, warianty i priorytety nie mają publicznego kontraktu; potrzebne sprawdzanie kompletności i powrót do natywnego wyglądu. |
| Wspólne UI i układ Twitch/YouTube | mała dodatkowa zmiana | Kontroler ma motyw, widoczność, szerokość i cykl życia. Strategia YouTube może współdzielić ten interfejs. |

Wklejenie 38 hashy do kodu będzie małe, ale uzależni funkcję od obecnego builda. Patch 116 różnic jest ostrożniejszy wobec później ładowanych komponentów. Oba wymagają pary palet dla właściwej wersji i wariantu CSS.

Nie ustalono stabilnego sposobu otrzymania przeciwnego arkusza z bieżącego dokumentu, ale most do natywnych tokenów pozwala uniknąć tego kroku dla zbadanej mapy. Adres arkusza generuje serwis; zależy także od wariantu konfiguracji. Ręczna modyfikacja bitów URL, zmiana preferencji YouTube w tle albo przeładowanie oryginalnej ramki nie spełnia celu zachowania sesji. Dopasowanie aliasów po samym kolorze pozostaje niejednoznaczne.

**Ocena z etapu prototypu:** `ChatController` i UI mogą pozostać wspólne. Adapter YouTube potrzebowałby mapy aliasów lub dostawcy palet, sprawdzenia wersji/kompletności, obsługi świata strony oraz sesji konkretnego dokumentu. Po nieznanym buildzie lub błędzie powinien zachować natywny motyw i pokazać rzeczywistą dostępność opcji. Nie wymaga własnego klienta wiadomości.

**Rekomendacja z etapu prototypu:** pozostawić natywny motyw YouTube do czasu wdrożenia i walidacji mostu do semantycznych tokenów. Obecny PR #25 zawiera już ten adapter oraz aktywne, niezależne przełączanie motywu; jego zakres i wyniki opisuje [aktualna walidacja](native-chat-validation.md).

Przed wydaniem nadal potrzebna jest kwalifikacja zalogowanego edytora, emoji, moderacji, monetyzacji, replay i wariantów przeglądarek. Sesja wylogowana nie udostępniła rzeczywistego edytora; kolor wpisywanego tekstu sprawdzają fixtures, a nie ten pomiar serwisowy. Otwarcie menu nie potwierdza przepływu zmiany filtra ani wszystkich funkcji.
