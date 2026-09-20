# Gradska pozadina za parallax

12 poravnatih PNG slojeva, svaki **2172 × 724 px**, te 4 pojedinačne sive zgrade. Svi slojevi osim neba imaju prozirnu pozadinu. Kafić i kuća ostaju u boji; okolni grad prati zadanu sivu paletu.

Otvorite **preview.html** u pregledniku. Radi i bez servera: pokrenite animaciju, povlačite scenu, uključujte pojedine slojeve i mijenjajte njihove brzine. Gumb „Samo” prikazuje jedan sloj na šahovskoj podlozi. preview.png je statična početna kompozicija.

**background-without-landmarks.png** prikazuje samo nebo, okolni grad, prednje kuće i cestu, bez kafića, velike kuće i lampi. **sky-composite.png** je spoj neba, sunca i oblaka; njihovi zasebni slojevi također su uključeni.

## Redoslijed crtanja, od najdaljeg do najbližeg

| PNG | Sadržaj | Parallax |
| --- | --- | ---: |
| 01-sky | Nebo s gradijentom | 0 |
| 02-sun | Sunce | 0.025 |
| 03-clouds | Oblaci | 0.07 |
| 04-skyline-far | Daleki grad | 0.16 |
| 05-skyline-mid | Srednji grad | 0.34 |
| 06a-houses-back | Prednje kuće · stražnji red | 0.48 |
| 06b-houses-middle | Prednje kuće · srednji red | 0.55 |
| 06c-houses-front | Prednje kuće · prednji red | 0.62 |
| 07-house | Cijela kuća iza kafića | 0.69 |
| 08-cafe | Kafić s terasom i žardinjerama | 0.78 |
| 09-lamps | Ulične lampe | 0.82 |
| 10-road | Nogostup, rub i cesta | 1 |

Vrijednosti za kuću, kafić, dodatne redove kuća, lampe, sunce i oblake predložene su početne vrijednosti. Mogu se mijenjati neovisno.

## Za Hermes / integraciju

- Sve iz `layers/` postaviti na **x=0, y=0**, u redoslijedu iz `manifest.json`. Prozirni razmaci već određuju položaj objekata. Izbjegavati automatsko obrezivanje u uvozniku ili sačuvati njegove pomake.
- Brzina sloja je `cameraX × parallax`. `cameraX` je horizontalna udaljenost u koordinatama osnovnog platna. Brzine su relativne prema cesti, koja ima faktor 1.
- Sunce i oblaci već imaju traženu poluprozirnost u alfa kanalu. `globalAlpha = 1`: ne množiti njihove opacity vrijednosti još jednom.
- Svi aktivni slojevi koriste **normalno ponavljanje** osim fiksnog neba. Kuće u redovima imaju prozirne razmake i ne diraju rubove platna. Svaki red može se pomicati zasebno.
- Zgrade završavaju uz **y=595**; cesta kreće na **y=627**. Odabrati poziciju lika prema željenoj traci. Ovi asseti ne sadrže kolizije.
- `sprites/` sadrži obrezane slike velike kuće i kafića (`sprite.x/y/width/height` u manifestu), te **4 pojedinačne sive zgrade** (`buildingSprites` u manifestu). Svaki red kuća navodi vlastite pozicije u `buildings`. Možete koristiti gotove redove ili crtati svaku kuću zasebno i dodijeliti joj vlastiti parallax. Nemojte istodobno crtati sprite i njegov puni layer.
- Kuća i kafić imaju vlastito pomicanje i vlastiti položaj. S vremenom im se odnos mijenja. Za stalno zajedničko pozicioniranje dodijelite im isti parallax ili upravljajte njima kao lokalnom grupom.
- `parallax.js` je mali primjer za Canvas 2D koji ispravno ponavlja slojeve. U igri ga posluživati preko lokalnog/web servera.
- `variants/` čuva raniji **spojeni niz kuća** i njegovu zrcaljenu verziju. To je opcionalna alternativa trima aktivnim redovima; taj raniji niz treba naizmjenično normalno/zrcaljeno ponavljanje, za razliku od zadane nove kompozicije.

```js
import { loadParallax } from './parallax-city/parallax.js';
const background = await loadParallax('./parallax-city/');
// U postojećoj petlji igre, prije lika i predmeta:
background.draw(ctx, cameraX);
```

## Boje i izvori

Nebo: #c7cbca → #aeb4b5 → #858c8e, prijelaz na 50%. Sunce: rgba(242,240,225,0.38). Oblaci: rgba(235,237,233,0.55). Daleki grad: #969c9e. Srednji grad: #737a7c. Bliski grad: osnovni smjer #50575a. Cesta: #2f3436, rub #454b4d. Prozori srednjeg grada: rgba(210,213,210,0.32).

Kafić, velika kuća i pojedinačne sive zgrade izdvojeni su / rekonstruirani ugrađenim **imagegen** alatom prema odobrenoj panorami. Zaklonjena arhitektura je dopunjena, pa slojevi nisu identičan pikselni rez originala. Prednje kuće imaju nijanse i prozore generirane približno prema zadanoj paleti. Ostali slojevi izrađeni su kao jednostavni SVG oblici s točnim zadanim bojama i izvezeni u PNG. Izvorni PNG-ovi, SVG-ovi i korišteni promptovi nalaze se u `source/`.

Slike u `layers/` već su poravnate i spremne za uvoz. PNG koristi standardni RGBA; pri uključivanju mipmapova/atlasa koristite transparentni rub i odgovarajuće premultiplied-alpha postavke enginea da biste izbjegli rubne artefakte.
