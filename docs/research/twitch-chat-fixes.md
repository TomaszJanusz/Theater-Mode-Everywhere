# Poprawki czatu po PR #25

9 października 2026, gałąź `fix/twitch-chat-controls`, baza `dc22449`.

- **Alt+R / Option+R:** macOS potrafi wysłać `key: "®", code: "KeyR"`. Dopasowanie skrótów z Alt oraz edytor skrótów używają fizycznej litery. Modyfikatory nadal muszą pasować dokładnie; zwykłe wpisywanie i zdarzenia natywnego czatu zachowują dotychczasowe reguły.
- **Strzałka Twitcha:** natywna kontrolka rozwijania/zwijania jest niewidoczna tylko w theater. Pozostaje w DOM, więc kontroler nadal może otworzyć natywnie zwinięty panel. Po wyjściu przycisk wraca.
- **Motyw:** na stronie uruchomionej z ciemnym motywem Twitch generuje tylko ciemną paletę. Adapter nadal preferuje wygenerowaną klasę serwisu. Jeśli przeciwnej klasy brakuje, używa 243 deklaracji z natywnego CSS Twitcha: 180 różnic i 63 zależnych aliasów. Aliasy muszą być ponownie zadeklarowane lokalnie, bo odziedziczone wartości są już rozwiązane w motywie przodka. Most wymaga zgodności deklaracji aktualnej palety z przechwyconym CSS. Nierozpoznana zmiana CSS usuwa wymuszenie; odzyskanie zgodnej palety ponownie stosuje zapamiętany wybór.
- **Suwak:** pierwsza interakcja ze zmianą szerokości utrzymuje poziome położenie panelu ustawień. Czat i player zmieniają rozmiar na bieżąco, panel zostaje pod kursorem także po puszczeniu myszy. Zamknięcie lub resize okna zwalnia pozycję; kolejne otwarcie kotwiczy panel do aktualnego położenia przycisku. W czasie regulacji panel ma pełny obrys zamiast wycięcia dla przesuwającego się przycisku.

## Sprawdzenie

- 492/492 testy, 88 suites, bez pominięć, z limitem czterech równoległych plików testowych. Pierwszy przebieg z domyślną równoległością i równoczesnym buildem miał timeout testu Bilibili oraz jedno pominięcie. Izolowana powtórka testu Bilibili i pełny przebieg po buildzie przeszły.
- Typecheck, build Chrome/Firefox oraz weryfikacja samodzielności paczek: sukces.
- Nowe scenariusze Chromium i Firefox obejmują zdarzenie Option+R z `®`, rzeczywiste przeciąganie suwaka i geometrię panelu po pointerup oraz ponownym otwarciu. Fixture z samą ciemną paletą porównuje wszystkie 1002 natywne tokeny jasnego motywu, później zamontowany portal, przełączanie motywów, fallback po zmianie CSS, odzyskanie i przywrócenie wyglądu serwisu.
- [Pełny niezależny zapis palet](../../test/fixtures/twitch-chat-theme.css) pochodzi z CSSOM `https://www.twitch.tv/hasanabi`, 9 października 2026. W fixture zastąpiono wyłącznie wygenerowane nazwy klas.

Próba serwisowa używa rzeczywiście zainstalowanego dodatku i osobnego wylogowanego profilu:

```sh
pnpm build
xvfb-run --auto-servernum node docs/research/prototypes/twitch-chat-fixes.mjs chromium
xvfb-run --auto-servernum node docs/research/prototypes/twitch-chat-fixes.mjs firefox
```

[Raport Chromium](screenshots/current/twitch-chat-fixes-chromium.json) i [raport Firefox](screenshots/current/twitch-chat-fixes-firefox.json) potwierdzają ciemny start bez jasnej klasy, otwarcie natywnie zwiniętego czatu zdarzeniem `®`, fizyczne Alt+R, light → dark → light, regulację 590 → 290 → 600 px przy stałym położeniu menu oraz przywrócenie natywnego wyglądu po wyjściu. Zdarzenie `®` jest symulowane; próba nie działa na fizycznym macOS.
