import { getEventVisibilityDocument, setEventVisibility } from "@musubi/db";
import { BadRequestError, EventVisibilityRequestSchema } from "@musubi/types";
import type { Request, Response } from "express";
import { notifyCalendarMembers } from "./stream";

type VisibilityDependencies = {
  getDocument?: typeof getEventVisibilityDocument;
  setVisibility?: typeof setEventVisibility;
  notify?: typeof notifyCalendarMembers;
};

export function createEventVisibilityHandlers(dependencies: VisibilityDependencies = {}) {
  const getDocument = dependencies.getDocument ?? getEventVisibilityDocument;
  const setVisibility = dependencies.setVisibility ?? setEventVisibility;
  const notify = dependencies.notify ?? notifyCalendarMembers;
  return {
    async getVisibility(req: Request, res: Response) {
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).json(await getDocument(req.user!.id));
    },
    async putVisibility(req: Request, res: Response) {
      const parsed = EventVisibilityRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError("Body must contain eventId, hidden, and optionally originalStart.");
      // Membership and recurrence authorization are inside the write transaction.
      await setVisibility(req.user!.id, parsed.data);
      notify([req.user!.id], "event_visibility_updated", {});
      res.setHeader("Cache-Control", "private, no-store");
      res.status(204).end();
    },
  };
}

const handlers = createEventVisibilityHandlers();
export const handlerGetEventVisibility = handlers.getVisibility;
export const handlerPutEventVisibility = handlers.putVisibility;
