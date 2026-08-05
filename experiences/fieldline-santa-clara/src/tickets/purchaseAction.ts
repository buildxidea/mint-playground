import type { Freshness, LiveEvent } from "../live/contracts";

const ALLOWED_TICKET_HOSTS = ["levisstadium.com", "ticketmaster.com"] as const;

export type PurchaseSelection = {
  label: string;
  exactSeatIdentifier: boolean;
};

export type PurchaseActionState = {
  href: string | null;
  label: string;
  accessibleLabel: string;
  eventTitle: string;
  selectionLabel: string;
  note: string;
  enabled: boolean;
};

function isAllowedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return ALLOWED_TICKET_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

/**
 * Outbound ticket destinations cross a browser trust boundary. Keep them HTTPS
 * and limited to the two providers represented by the live-data service.
 */
export function safeTicketUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !isAllowedHost(url.hostname)) return null;
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return null;
  }
}

function seatAvailabilityNote(selection: PurchaseSelection): string {
  return selection.exactSeatIdentifier
    ? "The selected view is carried as context. Exact seat availability and assignment are confirmed by the seller."
    : "This is a modeled chair position, not an exact ticket identifier. Choose the final seat with the seller.";
}

export function buildPurchaseAction(
  event: LiveEvent | null,
  selection: PurchaseSelection,
  eventFreshness: Freshness,
): PurchaseActionState {
  if (!event) {
    return {
      href: null,
      label: "Select an official event to buy tickets",
      accessibleLabel: "Select an official event before opening ticket listings",
      eventTitle: "No official event selected",
      selectionLabel: selection.label,
      note: seatAvailabilityNote(selection),
      enabled: false,
    };
  }

  const eventUrl = safeTicketUrl(event.url);
  const purchaseUrl = safeTicketUrl(event.purchaseUrl);
  const statusAllowsPurchase = event.status === "scheduled" || event.status === "rescheduled";
  const href = statusAllowsPurchase ? purchaseUrl ?? eventUrl : eventUrl;
  const freshnessWarning = eventFreshness === "stale"
    ? " Event data is stale; confirm the date and status on the destination page."
    : "";

  if (!href) {
    return {
      href: null,
      label: "Official ticket link unavailable",
      accessibleLabel: `Official ticket link unavailable for ${event.title}`,
      eventTitle: event.title,
      selectionLabel: selection.label,
      note: `No approved HTTPS ticket destination was supplied.${freshnessWarning}`,
      enabled: false,
    };
  }

  if (!statusAllowsPurchase) {
    return {
      href,
      label: "View official event status ↗",
      accessibleLabel: `View official status for ${event.title} in a new tab`,
      eventTitle: event.title,
      selectionLabel: selection.label,
      note: `Ticket purchase is not presented because this event is ${event.status}.${freshnessWarning}`,
      enabled: true,
    };
  }

  return {
    href,
    label: "Buy tickets for selected event ↗",
    accessibleLabel: `Buy tickets for ${event.title} in a new tab; selected view ${selection.label}`,
    eventTitle: event.title,
    selectionLabel: selection.label,
    note: `${seatAvailabilityNote(selection)}${freshnessWarning}`,
    enabled: true,
  };
}
