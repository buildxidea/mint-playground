import type { SelectionState } from "../ui/Hud";

/**
 * Builds a clearly labeled external search URL.
 * Does not claim live availability — inventory is separate from structural seat data.
 */
export function buildExternalListingUrl(selection: SelectionState): string {
  // Do not send modeled seat data or imply that the current selection is available.
  void selection;
  return "https://levisstadium.com/tickets/";
}

export const LISTING_DISCLAIMER =
  "Opening an external ticket search. This does not confirm that the selected seat is currently available.";
