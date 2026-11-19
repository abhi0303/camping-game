// Central animal configuration: how fast each chicken variety lays and how long one feeding lasts.
// The server reads these numbers over the catalog table (prices and egg values stay in the catalog table,
// see migration 5), so changing a chicken's timing means editing only this file and deploying the server.
//
//  eggMinutes   minutes for one egg. Every chicken has its own timer (they never share one).
//  feedMinutes  how long one feeding keeps a chicken laying. A feeding costs feedCost feed units per chicken.
//  nest         eggs a chicken keeps in its nest box until a player collects them. A full nest stops it
//               laying, so an untended farm never piles up endless eggs.
//
// Balance (catalog prices of migration 13; feed is ₹2 a unit, one unit per 2 h = ₹1 an hour), before the Market's
// demand (js/farm/progression.js: selling a lot at once pushes prices down) and the hens' care levels (+10 … 50 %):
//  Regular White  ₹60  · 5 eggs/h × ₹1 = ₹5/h   → pays back in ~15 h
//  Brown Desi     ₹250 · 4 eggs/h × ₹3 = ₹12/h  → ~23 h   (farm level 3)
//  Black          ₹600 · 3 eggs/h × ₹8 = ₹24/h  → ~26 h   (farm level 6)
//  Golden hen     30 gold · 2 eggs/h × ₹30 = ₹60/h        (farm level 10)
// A premium chicken earns more per place in the coop but takes longer to pay off; a farm grows by levels, not
// by a coop filling up in an afternoon.
export const CHICKENS = {
  chicken:       { variety: 'Regular White', eggMinutes: 12, feedMinutes: 120, feedCost: 1, nest: 24 },
  chicken_brown: { variety: 'Brown Desi',    eggMinutes: 15, feedMinutes: 120, feedCost: 1, nest: 24 },
  chicken_dark:  { variety: 'Black',         eggMinutes: 20, feedMinutes: 120, feedCost: 1, nest: 24 },
  chicken_gold:  { variety: 'Golden',        eggMinutes: 30, feedMinutes: 120, feedCost: 1, nest: 24 },
};

// catalog entry -> the same entry with this file's timing applied (rate = products per hour while fed)
export function withAnimalConfig(item, entry) {
  const a = CHICKENS[item];
  if (!a) return entry;
  return { ...entry, variety: a.variety, eggMinutes: a.eggMinutes, rate: 60 / a.eggMinutes, feedMinutes: a.feedMinutes, feedHours: a.feedMinutes / 60, feedCost: a.feedCost, nest: a.nest };
}
