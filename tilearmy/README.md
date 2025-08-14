# TileArmy

TileArmy is a browser-based real-time resource-gathering game built with Node.js, Express and WebSockets. Each player controls a base and spawns vehicles to harvest resources spread across a large map.

## Running

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   node server.js
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Gameplay

- **Base & Resources** – You start with a base and some ore. Additional resources (ore, lumber and stone) are scattered around the world. Your goal is to gather them.
- **Vehicles** – Use the dashboard to spawn vehicles. Each type (scout, hauler, basic) has different speed, capacity, energy usage and cost.
- **Automatic harvesting** – Idle vehicles automatically seek the nearest unclaimed resource. If you click a resource tile, the selected vehicle will harvest it and then automatically chain to nearby resources of the same type within a search radius before considering other resources. Once full, vehicles return to your base to unload.
- **Manual commands** – Click on the map to move the selected vehicle. Use the dropdown to spawn different vehicle types.
- **Energy** – Movement consumes energy. Your energy reserve slowly regenerates over time.
- **Fog of war** – Only areas within range of your base and vehicles are visible. Explore the map to reveal resources and enemy units.
- **Camera** – Toggle the "Follow" button to keep the view centered on your selected vehicle, or use WASD/arrow keys to pan manually. Use `+`/`-` to zoom, `F` to toggle fullscreen, and press `H` to jump back to your base.

Happy harvesting!
