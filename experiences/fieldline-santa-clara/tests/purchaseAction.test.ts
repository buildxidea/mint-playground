import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/live/contracts";
import { buildPurchaseAction, safeTicketUrl } from "../src/tickets/purchaseAction";

const event: LiveEvent = {
  id: "ticketmaster:event-a",
  title: "49ers vs. Seahawks",
  localDate: "2026-11-29",
  localTime: "13:25",
  endLocalDate: null,
  endLocalTime: null,
  timeZone: "America/Los_Angeles",
  url: "https://levisstadium.com/event/49ers-seahawks/",
  purchaseUrl: "https://www.ticketmaster.com/event/event-a",
  eventConfigHint: "football",
  status: "scheduled",
};

const exactSelection = {
  label: "Section P234 · Row 7 · Seat 8",
  exactSeatIdentifier: true,
};

describe("selected-event purchase action", () => {
  it("uses the selected event seller URL and preserves exact-seat context", () => {
    const action = buildPurchaseAction(event, exactSelection, "fresh");
    expect(action).toMatchObject({
      enabled: true,
      href: "https://www.ticketmaster.com/event/event-a",
      label: "Buy tickets for selected event ↗",
      eventTitle: "49ers vs. Seahawks",
      selectionLabel: "Section P234 · Row 7 · Seat 8",
    });
    expect(action.accessibleLabel).toContain("49ers vs. Seahawks");
    expect(action.accessibleLabel).toContain("Section P234 · Row 7 · Seat 8");
    expect(action.note).toContain("Exact seat availability and assignment are confirmed by the seller");
  });

  it("falls back to an event-specific official page when no seller URL is supplied", () => {
    const action = buildPurchaseAction({ ...event, purchaseUrl: null }, exactSelection, "fresh");
    expect(action.href).toBe("https://levisstadium.com/event/49ers-seahawks/");
    expect(action.enabled).toBe(true);
  });

  it("does not imply a modeled chair is an exact purchasable seat", () => {
    const action = buildPurchaseAction(event, {
      label: "Section 401 · Row M08 · Modeled position 12",
      exactSeatIdentifier: false,
    }, "fresh");
    expect(action.note).toContain("modeled chair position, not an exact ticket identifier");
    expect(action.note).not.toContain("Exact seat availability");
  });

  it("keeps cancelled and postponed events informational", () => {
    for (const status of ["cancelled", "postponed", "unknown"] as const) {
      const action = buildPurchaseAction({ ...event, status }, exactSelection, "fresh");
      expect(action.enabled).toBe(true);
      expect(action.label).toBe("View official event status ↗");
      expect(action.note).toContain(status);
      expect(action.label).not.toContain("Buy");
    }
  });

  it("disables the action until an official event is selected", () => {
    expect(buildPurchaseAction(null, exactSelection, "unknown")).toMatchObject({
      enabled: false,
      href: null,
      eventTitle: "No official event selected",
    });
  });

  it("warns when the selected event datum is stale", () => {
    expect(buildPurchaseAction(event, exactSelection, "stale").note).toContain(
      "Event data is stale",
    );
  });
});

describe("ticket URL boundary", () => {
  it("accepts only HTTPS Levi's Stadium and Ticketmaster hosts", () => {
    expect(safeTicketUrl("https://levisstadium.com/event/a/")).toBe(
      "https://levisstadium.com/event/a/",
    );
    expect(safeTicketUrl("https://verified.ticketmaster.com/event/a")).toBe(
      "https://verified.ticketmaster.com/event/a",
    );
    expect(safeTicketUrl("http://ticketmaster.com/event/a")).toBeNull();
    expect(safeTicketUrl("javascript:alert(1)")).toBeNull();
    expect(safeTicketUrl("data:text/html,unsafe")).toBeNull();
    expect(safeTicketUrl("https://ticketmaster.com.evil.example/event/a")).toBeNull();
    expect(safeTicketUrl("https://example.com/event/a")).toBeNull();
  });

  it("disables an event whose URLs do not pass the boundary", () => {
    const action = buildPurchaseAction({
      ...event,
      url: "https://example.com/event/a",
      purchaseUrl: "javascript:alert(1)",
    }, exactSelection, "fresh");
    expect(action).toMatchObject({ enabled: false, href: null });
    expect(action.note).toContain("No approved HTTPS ticket destination");
  });
});
