import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOP_ITEMS, BACKGROUND_STYLES, wallet, itemById, isOwned, canBuy } from "../src/gamification/shop.ts";

test("каталог: id уникальны, цены положительные, у всех есть имя и значение", () => {
  const ids = SHOP_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const i of SHOP_ITEMS) {
    assert.ok(i.price > 0, i.id);
    assert.ok(i.name.length > 1, i.id);
    assert.ok(i.value.length > 0, i.id);
  }
});

test("у каждого фона из каталога есть стиль, и лишних стилей нет", () => {
  const bgIds = SHOP_ITEMS.filter((i) => i.kind === "background").map((i) => i.value);
  assert.deepEqual(Object.keys(BACKGROUND_STYLES).sort(), bgIds.sort());
});

test("кошелёк: заработок минус траты, не ниже нуля", () => {
  assert.equal(wallet(100, 30), 70);
  assert.equal(wallet(100, 0), 100);
  assert.equal(wallet(20, 50), 0);
  assert.equal(wallet(50, -10), 50); // битое значение трат не даёт монет из воздуха
});

test("itemById / isOwned", () => {
  assert.equal(itemById("av-fox")?.value, "🦊");
  assert.equal(itemById("нет-такого"), undefined);
  assert.equal(isOwned(["av-fox"], "av-fox"), true);
  assert.equal(isOwned([], "av-fox"), false);
});

test("canBuy: не куплено и хватает монет; повторно не продаётся", () => {
  const fox = itemById("av-fox")!;
  assert.equal(canBuy(fox, [], 30), true);
  assert.equal(canBuy(fox, [], 29), false);
  assert.equal(canBuy(fox, ["av-fox"], 1000), false);
});
