import assert from "node:assert/strict";
import { test } from "node:test";
import { Matchmaker } from "./Matchmaker";

function createHarness(cooldownMs = 30_000) {
  const matches: Array<[string, string]> = [];
  const departures: Array<[string, string]> = [];
  let currentTime = 1_000;
  const matchmaker = new Matchmaker(
    {
      matched: (offerer, answerer) => matches.push([offerer, answerer]),
      partnerLeft: (socketId, reason) => departures.push([socketId, reason])
    },
    cooldownMs,
    () => currentTime
  );

  return {
    matchmaker,
    matches,
    departures,
    advance: (milliseconds: number) => { currentTime += milliseconds; }
  };
}

test("pairs two waiting sockets exactly once", () => {
  const { matchmaker, matches } = createHarness();
  matchmaker.join("a");
  matchmaker.join("b");
  matchmaker.join("b");

  assert.deepEqual(matches, [["b", "a"]]);
  assert.equal(matchmaker.getPartner("a"), "b");
  assert.equal(matchmaker.getPartner("b"), "a");
  assert.equal(matchmaker.getWaitingCount(), 0);
});

test("skip does not immediately rematch the same two sockets", () => {
  const { matchmaker, matches, departures } = createHarness();
  matchmaker.join("a");
  matchmaker.join("b");
  matchmaker.skip("b");

  assert.equal(matches.length, 1);
  assert.equal(matchmaker.isPaired("a"), false);
  assert.equal(matchmaker.isPaired("b"), false);
  assert.equal(matchmaker.getWaitingCount(), 2);
  assert.deepEqual(departures, [["a", "skipped"]]);

  matchmaker.join("c");
  assert.deepEqual(matches[1], ["c", "a"]);
  assert.equal(matchmaker.getPartner("c"), "a");
  assert.equal(matchmaker.getPartner("b"), undefined);
});

test("disconnect releases the remaining participant to the queue", () => {
  const { matchmaker, matches, departures } = createHarness();
  matchmaker.join("a");
  matchmaker.join("b");
  matchmaker.disconnect("a");

  assert.equal(matchmaker.getPartner("b"), undefined);
  assert.equal(matchmaker.getWaitingCount(), 1);
  assert.deepEqual(departures, [["b", "disconnected"]]);

  matchmaker.join("c");
  assert.deepEqual(matches[1], ["c", "b"]);
});

test("leaving removes a waiting socket and notifies a paired peer", () => {
  const { matchmaker, departures } = createHarness();
  matchmaker.join("a");
  matchmaker.leave("a");
  assert.equal(matchmaker.getWaitingCount(), 0);

  matchmaker.join("b");
  matchmaker.join("c");
  matchmaker.leave("c");
  assert.deepEqual(departures, [["b", "left"]]);
  assert.equal(matchmaker.isPaired("b"), false);
});

test("cooldown expires and allows a later rematch", () => {
  const { matchmaker, matches, advance } = createHarness(500);
  matchmaker.join("a");
  matchmaker.join("b");
  matchmaker.skip("a");
  matchmaker.leave("a");
  matchmaker.leave("b");
  advance(501);
  matchmaker.join("a");
  matchmaker.join("b");

  assert.deepEqual(matches[1], ["b", "a"]);
});

test("queue operations are idempotent", () => {
  const { matchmaker } = createHarness();
  matchmaker.join("a");
  matchmaker.join("a");
  assert.equal(matchmaker.getWaitingCount(), 1);
  matchmaker.leave("a");
  matchmaker.leave("a");
  assert.equal(matchmaker.getWaitingCount(), 0);
});
