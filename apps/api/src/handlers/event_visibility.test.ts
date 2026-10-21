import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { NotFoundError } from "@musubi/types";
import { createEventVisibilityHandlers } from "./event_visibility";

const eventId = "11111111-1111-4111-8111-111111111111";
function request(body: unknown = { eventId, hidden: true }) {
  return { user: { id: "viewer" }, body } as Request;
}
function response() {
  const result = { status: 0, cache: "", body: undefined as unknown };
  const res = {
    setHeader(_name: string, value: string) { result.cache = value; },
    status(code: number) { result.status = code; return res; },
    json(body: unknown) { result.body = body; return res; },
    end() { return res; },
  } as unknown as Response;
  return { res, result };
}
async function main() {
  const writes: unknown[] = [], messages: unknown[] = [];
  const handlers = createEventVisibilityHandlers({
    getDocument: async userID => { assert.equal(userID, "viewer"); return { hidden: [] }; },
    setVisibility: async (...args) => { writes.push(args); },
    notify: (...args) => { messages.push(args); },
  });
  const get = response();
  await handlers.getVisibility(request(), get.res);
  assert.deepEqual(get.result, { status: 200, cache: "private, no-store", body: { hidden: [] } });
  const put = response();
  await handlers.putVisibility(request(), put.res);
  assert.deepEqual(writes, [["viewer", { eventId, hidden: true }]]);
  assert.deepEqual(messages, [[["viewer"], "event_visibility_updated", {}]], "only the caller's devices learn the preference changed");
  assert.equal(put.result.status, 204);
  for (const body of [{ eventId }, { eventId, hidden: true, userID: "someone-else" }])
    await assert.rejects(handlers.putVisibility(request(body), response().res), /Body must/);
  assert.equal(writes.length, 1);
  const denied = createEventVisibilityHandlers({
    setVisibility: async () => { throw new NotFoundError("Event not found."); },
    notify: () => { throw new Error("must not publish a rejected preference"); },
  });
  await assert.rejects(denied.putVisibility(request(), response().res), NotFoundError);
  console.log("event visibility handler tests: OK");
}
void main();
