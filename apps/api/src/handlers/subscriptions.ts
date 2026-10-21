import type { Request, Response } from "express";
import { z } from "zod";
import { createSubscription, listSubscriptions, removeSubscription } from "@musubi/db";
import { BadRequestError } from "@musubi/types";
import { encryptToken } from "../tokenCrypto";
import { fetchFeed, feedHash, normalizeFeedURL, FeedError } from "../sync/ics_feed";
import { notifyCalendarMembers } from "./stream";

const inputSchema = z.object({ name: z.string().trim().min(1).max(100), url: z.string().trim().min(1).max(8192) }).strict();
export async function handlerListSubscriptions(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ subscriptions: await listSubscriptions(req.user!.id) });
}
export async function handlerCreateSubscription(req: Request, res: Response) {
  const input = inputSchema.safeParse(req.body);
  if (!input.success) throw new BadRequestError("Enter a calendar name and subscription link.");
  try {
    const url = normalizeFeedURL(input.data.url);
    const snapshot = await fetchFeed(url);
    const result = await createSubscription(req.user!.id, { name: input.data.name, urlHash: feedHash(url), encryptedURL: await encryptToken(url) }, snapshot);
    notifyCalendarMembers([req.user!.id], "external_sync", { calendars: [result.calendarId] });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof BadRequestError) throw error;
    throw new BadRequestError(error instanceof FeedError ? error.message : "The subscription could not be imported. No calendar was added.");
  }
}
export async function handlerRemoveSubscription(req: Request, res: Response) {
  const input = z.object({ id: z.uuid() }).strict().safeParse(req.body);
  if (!input.success) throw new BadRequestError("A subscription ID is required.");
  const calendarID = await removeSubscription(req.user!.id, input.data.id);
  notifyCalendarMembers([req.user!.id], "calendar_removed", { id: calendarID });
  res.sendStatus(204);
}
