// Barrel module — re-exports every enemy manager so game.js can pull them
// from a single import path. New enemy managers (bird, future boss, etc.)
// get a one-line re-export here.
//
// This file did not exist on disk previously; game.js already imported
// { AirplaneManager } from "./enemies.js", so any spawner code under that
// path silently failed to load. Creating this barrel fixes that broken
// import and adds BirdManager in the same place.

export { AirplaneManager } from "./spawner_airplane.js";
export { BirdManager } from "./spawner_enemybird.js";