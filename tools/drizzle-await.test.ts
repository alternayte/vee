// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { unawaitedWrites } from "./drizzle-await";

test("a void write and an arrow that returns a write are refused", () => {
  expect(unawaitedWrites("onPress={() => void db.delete(t).where(x)}")).toEqual([1]);
  expect(unawaitedWrites("const revoke = (id) =>\n  db\n    .update(t)\n    .set(x);")).toEqual([1]);
  expect(unawaitedWrites("const f = () => db.insert(t).values(v);")).toEqual([1]);
});

test("awaited writes and reads pass", () => {
  expect(unawaitedWrites("const f = async (id) =>\n  await db.update(t).set(x);")).toEqual([]);
  expect(unawaitedWrites("await db.delete(t);")).toEqual([]);
  expect(unawaitedWrites("const rows = () => db.select().from(t);")).toEqual([]);
});
