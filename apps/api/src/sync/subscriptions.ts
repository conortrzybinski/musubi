import { listSubscriptions, claimSubscription, commitSubscription, failSubscription } from "@musubi/db";
import { decryptToken } from "../tokenCrypto";
import { fetchFeed, FeedError } from "./ics_feed";

export const subscriptionAccounts = {
  provider: "ics",
  async listAccounts(userID: string) {
    return (await listSubscriptions(userID)).map(row => ({ id: row.id, label: row.name }));
  },
};

export async function syncSubscription(userID: string, id: string, force: boolean) {
  const source = await claimSubscription(userID, id, force);
  if (!source) return [];
  try {
    const snapshot = await fetchFeed(await decryptToken(source.encryptedURL), source);
    await commitSubscription(source, snapshot);
    // Refresh status even when the server returns 304 or the snapshot is equal.
    return [source.calendarID];
  } catch (error) {
    const message = error instanceof FeedError ? error.message : "The calendar import failed. The previous import was kept; please retry.";
    await failSubscription(source, message);
    throw new FeedError(message);
  }
}
