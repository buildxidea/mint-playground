import type { FocusTarget } from "../stadium/sightlineEngine";

export type EventConfigId = "football" | "soccer" | "concert-end" | "concert-round";

export type EventConfig = {
  id: EventConfigId;
  label: string;
  surface: "field" | "stage-end" | "stage-round";
  focusTargets: FocusTarget[];
  activeOccluderCategories: string[];
  unavailableSections: string[];
  floorSeating: boolean;
  videoBoardsActive: Array<"north" | "south">;
  defaultDurationHours: number;
  metricsNote: string;
};

export const EVENT_CONFIGS: Record<EventConfigId, EventConfig> = {
  football: {
    id: "football",
    label: "American football",
    surface: "field",
    focusTargets: [
      "midfield",
      "near-goal",
      "far-goal",
      "home-sideline",
      "away-sideline",
      "north-board",
      "south-board",
    ],
    activeOccluderCategories: [
      "rail",
      "fascia",
      "tunnel",
      "overhang",
      "video-board",
      "suite-tower",
      "column",
      "goalpost",
    ],
    unavailableSections: [],
    floorSeating: false,
    videoBoardsActive: ["north", "south"],
    defaultDurationHours: 3.5,
    metricsNote: "Football sightline cache — not reused for concerts.",
  },
  soccer: {
    id: "soccer",
    label: "Soccer",
    surface: "field",
    focusTargets: [
      "midfield",
      "near-goal",
      "far-goal",
      "home-sideline",
      "away-sideline",
      "north-board",
      "south-board",
    ],
    activeOccluderCategories: [
      "rail",
      "fascia",
      "tunnel",
      "overhang",
      "video-board",
      "suite-tower",
      "column",
    ],
    unavailableSections: [],
    floorSeating: false,
    videoBoardsActive: ["north", "south"],
    defaultDurationHours: 2.5,
    metricsNote: "Soccer configuration recalculates without football goalpost emphasis.",
  },
  "concert-end": {
    id: "concert-end",
    label: "Concert (end stage)",
    surface: "stage-end",
    focusTargets: ["near-goal", "north-board", "south-board", "midfield"],
    activeOccluderCategories: [
      "rail",
      "fascia",
      "tunnel",
      "overhang",
      "video-board",
      "suite-tower",
      "column",
      "stage",
      "rigging",
    ],
    unavailableSections: ["101", "102"],
    floorSeating: true,
    videoBoardsActive: ["north"],
    defaultDurationHours: 3,
    metricsNote: "Concert metrics require recalculation — football cache invalid.",
  },
  "concert-round": {
    id: "concert-round",
    label: "Concert (in the round)",
    surface: "stage-round",
    focusTargets: ["midfield", "north-board", "south-board"],
    activeOccluderCategories: [
      "rail",
      "fascia",
      "tunnel",
      "overhang",
      "video-board",
      "suite-tower",
      "column",
      "stage",
      "rigging",
    ],
    unavailableSections: [],
    floorSeating: true,
    videoBoardsActive: ["north", "south"],
    defaultDurationHours: 3,
    metricsNote: "In-the-round stage alters center focus and floor seating.",
  },
};
