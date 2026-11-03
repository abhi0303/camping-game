// Central animal configuration: how fast each chicken variety lays and how long one feeding lasts.
// The server reads these numbers over the catalog table (prices and egg values stay in the catalog table,
// see migration 5), so changing a chicken's timing means editing only this file and deploying the server.
//
//  eggMinutes   minutes for one egg. Every chicken has its own timer (they never share one).
//  feedMinutes  how long one feeding keeps a chicken laying. A feeding costs feedCost feed units per chicken.
//  nest         eggs a chicken keeps in its nest box until a player collects them. A full nest stops it
//               laying, so an untended farm never piles up endless eggs.
//
// Balance (with the catalog prices of migration 5; feed is ₹2 a unit, one unit per 2 h):
//  Regular White  ₹40  · 12 eggs/h × ₹1 = ₹12/h  → pays back in ~3.5 h
//  Brown Desi     ₹180 · 8.6 eggs/h × ₹3 = ₹26/h → pays back in ~7 h
//  Black          ₹450 · 6.7 eggs/h × ₹7 = ₹47/h → pays back in ~10 h
// A premium chicken earns more per place in the coop (6 places per coop) but takes longer to pay off.
export const CHICKENS = {
  chicken:       { variety: 'Regular White', eggMinutes: 5, feedMinutes: 120, feedCost: 1, nest: 24 },
  chicken_brown: { variety: 'Brown Desi',    eggMinutes: 7, feedMinutes: 120, feedCost: 1, nest: 24 },
  chicken_dark:  { variety: 'Black',         eggMinutes: 9, feedMinutes: 120, feedCost: 1, nest: 24 },
};

// catalog entry -> the same entry with this file's timing applied (rate = products per hour while fed)
export function withAnimalConfig(item, entry) {
  const a = CHICKENS[item];
  if (!a) return entry;
  return { ...entry, variety: a.variety, eggMinutes: a.eggMinutes, rate: 60 / a.eggMinutes, feedMinutes: a.feedMinutes, feedHours: a.feedMinutes / 60, feedCost: a.feedCost, nest: a.nest };
}
