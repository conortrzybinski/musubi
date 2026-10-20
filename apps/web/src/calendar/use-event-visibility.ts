import type { EventVisibilityRequest, HiddenEvent } from "@musubi/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getEventVisibility, putEventVisibility } from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

export type EventVisibilityControl = {
  hidden: HiddenEvent[];
  set: (request: EventVisibilityRequest) => Promise<void>;
};

/** Personal presentation preferences never mutate the event or its delivery. */
export function useEventVisibility(userId: string) {
  const client = useQueryClient();
  const queryKey = queryKeys.eventVisibility(getServerOrigin(), userId);
  const query = useQuery({
    enabled: typeof window !== "undefined" && userId !== "anonymous",
    queryKey,
    queryFn: ({ signal }) => getEventVisibility(signal),
    refetchOnMount: "always",
  });
  const mutation = useMutation({
    mutationFn: putEventVisibility,
    onSuccess: async () => {
      // Cancel any read begun before the write, then confirm the saved document.
      await client.cancelQueries({ queryKey });
      await client.invalidateQueries({ queryKey }, { throwOnError: true });
    },
    onError: () => { void client.invalidateQueries({ queryKey }); },
  });
  return { query, set: mutation.mutateAsync };
}
