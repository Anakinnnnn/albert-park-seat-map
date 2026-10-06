# Albert Park Seat Planner

An interactive seat map of every grandstand at Albert Park for the 2027 Formula 1 Australian Grand Prix (46,694 seats across 99 grandstands). Click seats to colour-code them, for example to plan where your group wants to sit.

Seats are drawn the same way as Ticketmaster's interactive seat map: same seat sizes, colours, hover shading, and grandstand covers that fade away when you open a stand.

## Using it

https://anakinnnnn.github.io/albert-park-seat-map/

Open `index.html` in a browser. It's a single self-contained file with no dependencies.

- Click a grandstand (or pick one from **Jump to grandstand**) to open it.
- Click a seat to colour it, and click again to clear it. Double-click colours the whole row.
- Hold <kbd>Shift</kbd> and drag, or turn on **Paint**, to colour seats as you drag.
- Keys <kbd>1</kbd> to <kbd>8</kbd> pick a colour and <kbd>0</kbd> picks the eraser.
- **Copy seat list** copies your picks as text. **Backup and restore** moves them between browsers.

Colours are saved in your browser's local storage. They're your own notes and say nothing about ticket availability.

## Building

The page is built from the files in `src/` and `data/`:

```bash
node build.mjs
```

- `src/page.html`: markup and styles
- `src/app.js`: map rendering and interaction
- `data/seats.json`: every grandstand, row and seat with its position
- `data/background.svg`: the circuit artwork
- `data/icons.json`: the VIP, resale and selected seat icons

## Data

The seat positions, circuit artwork and icons come from Ticketmaster's public seat map for the event. This project isn't affiliated with Ticketmaster, Formula 1 or the Australian Grand Prix Corporation.
