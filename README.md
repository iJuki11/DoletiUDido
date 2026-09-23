# Pivski let

Mobile-first 2D endless flyer browser igra. Golub leti kroz desaturirani grad, skuplja zlatne krigle pive i pokušava ostati u zraku što dulje.

## Lokalno pokretanje

Projekt nema dependencyje niti traži instalaciju paketa. Potreban je samo moderan browser i mali lokalni web server.

1. Otvori Terminal u mapi projekta.
2. Pokreni:

   ```bash
   python3 -m http.server 8080
   ```

3. U browseru otvori [http://localhost:8080](http://localhost:8080).

Za zaustavljanje servera pritisni `Ctrl+C` u Terminalu.

> Nemoj otvarati `index.html` putem `file://`: browser blokira ES module (`type="module"`) učitavanje s lokalne datoteke. Koristi lokalni server i otvori `http://localhost:8080`.

## Kontrole

- Mobitel: tap po prostoru igre
- Desktop: `Space`, strelica gore ili klik mišem
- Cilj: skupljaj pive i ne udari u gornji rub ili krovove grada

## Struktura

```text
index.html
styles/
  style.css
src/
  main.js
  game.js
  player.js
  collectibles.js
  input.js
  ui.js
assets/
  images/
  sounds/
```

Igra koristi SVG dijelove goluba, spriteove likova i PNG slojeve pozadine iz `assets/`. Canvas služi za sastavljanje scene, animaciju i rezervni prikaz kad se neki asset ne može učitati. `Player`, manageri entiteta, `GameUI` i zvuk odvojeni su u module pod `src/`.

Igra učitava `assets/backgrounds/background.runtime.json`, koji sadrži iste slojeve kao izvorni editorov `background.parallax.json`, ali bez praznih prozirnih rubova slika. Nakon izmjene pozadine u editoru ponovno izradi runtime datoteku naredbom `python3 tools/generate_runtime_background.py` (za tu razvojnu naredbu treba Pythonov paket Pillow). Izvorni editorov JSON ostaje netaknut.

Za lokalni pregled u kojem Jev upravlja golubom slijedi upute u [preview/README.md](./preview/README.md). API ključ ostaje na lokalnom serveru i ne treba ga unositi u browser.

Detaljna mapa modula, tko što čita/mutira i gdje cure granice — u [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). Čitaj to prije većih izmjena.

## GitHub Pages (kasniji korak)

Projekt koristi relativne putanje i ne treba build korak, pa se može objaviti izravno iz root mape repozitorija putem GitHub Pagesa. Za sada deployment nije konfiguriran.
