export type EditorTool = 'translate' | 'rotate' | 'scale';
export type EditorSpace = 'world' | 'local';

export type EditorEntitySummary = {
  id: string;
  label: string;
  kind: string;
  category: 'splats' | 'doorways' | 'gameplay' | 'spawns';
  roomId: string;
  selected: boolean;
  visible: boolean;
  valid: boolean;
  editable: boolean;
};

export type EditorSelectionDetails = {
  entityId: string;
  id: string;
  label: string;
  kind: string;
  roomId: string;
  editable: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  containment: string;
  mount: string;
  portalId?: string;
  /** Friendly room-to-room label; raw portal ids stay in data only. */
  doorwayLinkLabel?: string;
  doorwayLinkState?: 'linked' | 'linkable' | 'unlinked';
  keepSide?: 'positive' | 'negative';
  navigationArea?: number;
};

export type EditorValidationView = {
  errors: string[];
  warnings: string[];
  roomCount: number;
  portalCount: number;
  placementCount: number;
  outsideCount: number;
  connected: boolean;
  connectorCount: number;
  cutCount: number;
  trimCount: number;
};

export type EditorLayerSummary = {
  roomId: string;
  label: string;
  selected: boolean;
  hidden: boolean;
  locked: boolean;
  solo: boolean;
  editingWalkable: boolean;
  walkablePatchCount: number;
  navigationArea: number;
  gameplayItemCount: number;
  clips: Array<{
    entityId: string;
    label: string;
    kind: 'cut' | 'trim';
    selected: boolean;
  }>;
  walkablePatches: Array<{
    patchId: string;
    label: string;
    selected: boolean;
  }>;
};

export type EditorViewModel = {
  entities: EditorEntitySummary[];
  selection: EditorSelectionDetails | null;
  rooms: Array<{ id: string; label: string }>;
  layers: EditorLayerSummary[];
  validation: EditorValidationView;
  tool: EditorTool;
  space: EditorSpace;
  snap: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  playtesting: boolean;
  status: string;
  overlays: Record<string, boolean>;
  /** When editing walkables, hide other patch fills so overlaps are readable. */
  walkableFocusActive?: boolean;
  /** Corner reshape vs translate the whole walkable polygon. */
  walkableDragMode?: 'corner' | 'patch';
};

export type EditorUiActions = {
  onAction(action: string, value?: string): void;
  onSelect(id: string): void;
  onField(field: string, value: number): void;
  onRoom(roomId: string): void;
  onImport(text: string): void;
};

const CATEGORY_LABELS: Record<EditorEntitySummary['category'], string> = {
  splats: 'Trim planes',
  doorways: 'Doorways',
  gameplay: 'Gameplay',
  spawns: 'Zombie entry',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : '0.000';
}

export class EditorUI {
  readonly root = document.createElement('section');
  private model: EditorViewModel | null = null;
  private query = '';
  private category = 'all';
  private inspectedEntityId: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly actions: EditorUiActions,
  ) {
    this.root.className = 'zombies-editor';
    this.root.setAttribute('aria-label', 'Zombies splat editor');
    this.root.innerHTML = this.markup();
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onInput);
    this.root
      .querySelector<HTMLInputElement>('#editor-import-file')
      ?.addEventListener('change', this.onImportFile);
    parent.append(this.root);
  }

  render(model: EditorViewModel): void {
    this.model = model;
    this.renderToolbar(model);
    this.renderLayers(model.layers);
    this.renderEntities(model.entities);
    this.renderInspector(model);
    this.renderValidation(model);
    this.revealSelection(model.selection?.entityId ?? null);
  }

  focusSearch(): void {
    this.root.querySelector<HTMLInputElement>('#editor-search')?.focus();
  }

  openImportPicker(): void {
    this.root.querySelector<HTMLInputElement>('#editor-import-file')?.click();
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('change', this.onInput);
    this.root
      .querySelector<HTMLInputElement>('#editor-import-file')
      ?.removeEventListener('change', this.onImportFile);
    this.root.remove();
  }

  private renderToolbar(model: EditorViewModel): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      '[data-editor-tool]',
    )) {
      button.classList.toggle(
        'is-active',
        button.dataset.editorTool === model.tool,
      );
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      '[data-editor-space]',
    )) {
      button.classList.toggle(
        'is-active',
        button.dataset.editorSpace === model.space,
      );
    }
    const snap = this.root.querySelector<HTMLSelectElement>('#editor-snap');
    if (snap) snap.value = String(model.snap);
    const undo = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-action="undo"]',
    );
    const redo = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-action="redo"]',
    );
    const save = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-action="save"]',
    );
    const playtest = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-action="playtest"]',
    );
    const discard = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-action="discard-draft"]',
    );
    if (undo) undo.disabled = !model.canUndo;
    if (redo) redo.disabled = !model.canRedo;
    if (save) {
      save.disabled =
        model.saving ||
        model.playtesting ||
        !model.dirty;
      save.textContent = model.saving ? 'Saving…' : 'Save changes';
      save.title =
        model.validation.errors.length > 0
          ? `Save with ${model.validation.errors.length} validation issue(s). Playtest remains unavailable until they are repaired.`
          : model.dirty
            ? 'Save changes to project files (Ctrl/⌘S)'
            : 'All changes are saved to project files';
      save.setAttribute('aria-keyshortcuts', 'Control+S Meta+S');
    }
    if (discard) {
      discard.disabled = model.saving || model.playtesting || !model.dirty;
    }
    if (playtest) {
      playtest.disabled =
        model.saving ||
        model.playtesting ||
        model.validation.errors.length > 0;
      playtest.textContent = model.playtesting
        ? 'Launching…'
        : 'Playtest';
      playtest.setAttribute(
        'aria-busy',
        model.playtesting ? 'true' : 'false',
      );
    }
    const dirty = this.root.querySelector<HTMLElement>('#editor-dirty');
    if (dirty) {
      dirty.textContent = model.dirty ? 'DRAFT AUTO-SAVED' : 'PROJECT SYNCED';
      dirty.classList.toggle('is-dirty', model.dirty);
    }
    const status = this.root.querySelector<HTMLElement>('#editor-status-copy');
    if (status) status.textContent = model.status;
    const actionFeedback = this.root.querySelector<HTMLElement>(
      '#editor-action-feedback',
    );
    if (actionFeedback) actionFeedback.textContent = model.status;
    for (const input of this.root.querySelectorAll<HTMLInputElement>(
      '[data-editor-overlay]',
    )) {
      input.checked = model.overlays[input.dataset.editorOverlay ?? ''] ?? false;
    }
    const deleteCut = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-action="delete-cut"]',
    );
    if (deleteCut) {
      deleteCut.disabled =
        model.selection?.kind !== 'cut-volume' ||
        !model.selection.editable;
    }
    const connectiveFrom = this.root.querySelector<HTMLSelectElement>(
      '#editor-connective-from',
    );
    const connectiveTo = this.root.querySelector<HTMLSelectElement>(
      '#editor-connective-to',
    );
    const roomOptions = model.rooms
      .map(
        (room) =>
          `<option value="${escapeHtml(room.id)}">${escapeHtml(room.label)}</option>`,
      )
      .join('');
    for (const [select, fallbackIndex] of [
      [connectiveFrom, 0],
      [connectiveTo, 1],
    ] as const) {
      if (!select) continue;
      const previous = select.value;
      if (select.options.length !== model.rooms.length) {
        select.innerHTML = roomOptions;
      }
      select.value = model.rooms.some((room) => room.id === previous)
        ? previous
        : model.rooms[fallbackIndex]?.id ?? model.rooms[0]?.id ?? '';
    }
    const deleteConnective = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-action="delete-connective"]',
    );
    if (deleteConnective) {
      deleteConnective.disabled = model.selection?.kind !== 'connective-tissue';
    }
    const scale = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-tool="scale"]',
    );
    const rotate = this.root.querySelector<HTMLButtonElement>(
      '[data-editor-tool="rotate"]',
    );
    if (scale) {
      scale.disabled =
        model.selection?.kind === 'trim-plane' ||
        Boolean(
          model.selection &&
            !['splat', 'cut-volume', 'doorway'].includes(
              model.selection.kind,
            ),
        );
    }
    if (rotate) {
      rotate.disabled =
        model.selection?.kind === 'player-start' ||
        model.selection?.kind === 'zombie-spawn';
    }
  }

  private renderLayers(layers: EditorLayerSummary[]): void {
    const root = this.root.querySelector<HTMLElement>('#editor-layer-list');
    if (!root) return;
    root.innerHTML = layers
      .map(
        (layer) => `
          <section class="editor-layer ${layer.selected ? 'is-selected' : ''} ${layer.solo ? 'is-solo' : ''} ${layer.hidden ? 'is-hidden' : ''}">
            <div class="editor-layer-row">
              <button class="editor-layer-name ${layer.selected ? 'is-selected' : ''}" data-editor-entity="splat:${escapeHtml(layer.roomId)}" title="Select ${escapeHtml(layer.label)} splat">
                <span class="editor-entity-dot kind-splat" aria-hidden="true"></span>
                <strong>${escapeHtml(layer.label)}</strong>
                <small>${layer.navigationArea.toFixed(1)} m² · ${layer.gameplayItemCount} items · ${layer.clips.length} clips</small>
              </button>
              <button data-editor-action="layer-visible" data-value="${escapeHtml(layer.roomId)}" aria-pressed="${!layer.hidden}" title="${layer.hidden ? 'Show' : 'Hide'} ${escapeHtml(layer.label)}">${layer.hidden ? 'HIDE' : 'VIS'}</button>
              <button data-editor-action="layer-lock" data-value="${escapeHtml(layer.roomId)}" aria-pressed="${layer.locked}" title="${layer.locked ? 'Unlock' : 'Lock'} ${escapeHtml(layer.label)}">${layer.locked ? 'LOCK' : 'EDIT'}</button>
              <button data-editor-action="layer-solo" data-value="${escapeHtml(layer.roomId)}" aria-pressed="${layer.solo}" title="Solo ${escapeHtml(layer.label)}">SOLO</button>
              <div class="editor-layer-commands">
                <button class="editor-layer-add is-cube" data-editor-action="add-cut" data-value="${escapeHtml(layer.roomId)}" ${layer.locked ? 'disabled' : ''} title="Add a cut cube owned only by ${escapeHtml(layer.label)}">+ CUBE</button>
                <button class="editor-layer-add is-door" data-editor-action="add-door-cut" data-value="${escapeHtml(layer.roomId)}" ${layer.locked ? 'disabled' : ''} title="Add a Gaussian-safe door cut on ${escapeHtml(layer.label)}, seated above the floor">+ DOOR</button>
                <button class="editor-layer-add is-plane" data-editor-action="add-trim" data-value="${escapeHtml(layer.roomId)}" ${layer.locked ? 'disabled' : ''} title="Add a trim plane owned only by ${escapeHtml(layer.label)}">+ PLANE</button>
                <button class="editor-layer-add is-walk" data-editor-action="add-walkable-patch" data-value="${escapeHtml(layer.roomId)}" ${layer.locked ? 'disabled' : ''} title="Add another green walkable patch on ${escapeHtml(layer.label)} (multiple allowed)">+ WALK</button>
              </div>
            </div>
            ${
              layer.clips.length > 0
                ? `<div class="editor-layer-clips">${layer.clips
                    .map(
                      (clip) => `<button
                        class="${clip.selected ? 'is-selected' : ''}"
                        data-editor-entity="${escapeHtml(clip.entityId)}"
                        title="${escapeHtml(clip.label)}"
                      ><i class="editor-entity-dot kind-${clip.kind === 'trim' ? 'trim-plane' : 'cut-volume'}" aria-hidden="true"></i>${escapeHtml(clip.label)}</button>`,
                    )
                    .join('')}</div>`
                : ''
            }
            ${
              layer.walkablePatches.length > 0 || layer.editingWalkable
                ? `<div class="editor-layer-clips editor-layer-walkables">${layer.walkablePatches
                    .map(
                      (patch) => `<button
                        class="${patch.selected ? 'is-selected' : ''}"
                        data-editor-action="edit-walkable-patch"
                        data-value="${escapeHtml(patch.patchId)}"
                        title="Edit ${escapeHtml(patch.label)}"
                        ${layer.locked ? 'disabled' : ''}
                      ><i class="editor-entity-dot kind-walkable-boundary" aria-hidden="true"></i>${escapeHtml(patch.label)}</button>`,
                    )
                    .join('')}
                    ${
                      layer.editingWalkable
                        ? `<button class="editor-layer-add is-walk" data-editor-action="finish-walkable" data-value="${escapeHtml(layer.roomId)}" title="Finish walkable edit (Esc)">DONE</button>`
                        : ''
                    }
                  </div>`
                : ''
            }
          </section>`,
      )
      .join('');
  }

  private renderEntities(entities: EditorEntitySummary[]): void {
    const list = this.root.querySelector<HTMLElement>('#editor-entity-list');
    if (!list) return;
    const normalized = this.query.trim().toLowerCase();
    const filtered = entities.filter(
      (entity) =>
        entity.kind !== 'splat' &&
        (this.category === 'all' || entity.category === this.category) &&
        (!normalized ||
          entity.label.toLowerCase().includes(normalized) ||
          entity.id.toLowerCase().includes(normalized) ||
          entity.roomId.toLowerCase().includes(normalized)),
    );
    const byCategory = new Map<
      EditorEntitySummary['category'],
      EditorEntitySummary[]
    >();
    for (const entity of filtered) {
      const entries = byCategory.get(entity.category) ?? [];
      entries.push(entity);
      byCategory.set(entity.category, entries);
    }
    const categories = (
      Object.keys(CATEGORY_LABELS) as EditorEntitySummary['category'][]
    ).sort((left, right) => {
      const leftSelected = (byCategory.get(left) ?? []).some(
        (entity) => entity.selected,
      );
      const rightSelected = (byCategory.get(right) ?? []).some(
        (entity) => entity.selected,
      );
      return Number(rightSelected) - Number(leftSelected);
    });
    list.innerHTML = categories
      .flatMap((category) => {
        const entries = [...(byCategory.get(category) ?? [])].sort(
          (left, right) => Number(right.selected) - Number(left.selected),
        );
        if (entries.length === 0) return [];
        return [
          `<section class="editor-tree-group">
            <h3>${CATEGORY_LABELS[category]} <span>${entries.length}</span></h3>
            ${entries
              .map(
                (entity) => `
                  <button
                    class="editor-tree-item ${entity.selected ? 'is-selected' : ''} ${entity.valid ? '' : 'is-invalid'}"
                    data-editor-entity="${escapeHtml(entity.id)}"
                    title="${escapeHtml(entity.id)}"
                  >
                    <i class="editor-entity-dot kind-${escapeHtml(entity.kind)}" aria-hidden="true"></i>
                    <span><strong>${escapeHtml(entity.label)}</strong><small>${escapeHtml(entity.roomId.replace('world-zombies-arena', 'Hub') || 'Hub')}</small></span>
                    <em>${entity.editable ? 'EDIT' : 'VIEW'}</em>
                  </button>`,
              )
              .join('')}
          </section>`,
        ];
      })
      .join('');
    if (!list.innerHTML) {
      list.innerHTML =
        '<p class="editor-empty">No placements match this filter.</p>';
    }
  }

  private renderInspector(model: EditorViewModel): void {
    const root = this.root.querySelector<HTMLElement>('#editor-inspector');
    if (!root) return;
    const selection = model.selection;
    if (!selection) {
      this.inspectedEntityId = null;
      root.innerHTML = `
        <div class="editor-inspector-empty">
          <span aria-hidden="true">⌁</span>
          <strong>Select a splat or placement</strong>
          <p>Click a marker in the world or choose an entry from the scene tree.</p>
        </div>`;
      return;
    }
    const selectionChanged = this.inspectedEntityId !== selection.id;
    const activeElement = document.activeElement as HTMLElement | null;
    const preserveFieldScroll =
      !selectionChanged &&
      Boolean(
        activeElement &&
          root.contains(activeElement) &&
          activeElement.dataset.editorField,
      );
    const previousScrollTop = root.scrollTop;
    this.inspectedEntityId = selection.id;
    const fields = (
      group: 'position' | 'rotation' | 'scale',
      values: [number, number, number],
      step: number,
      editableAxes: ReadonlyArray<'x' | 'y' | 'z'> = ['x', 'y', 'z'],
    ) => `
      <fieldset class="editor-vector">
        <legend>${group}</legend>
        ${(['x', 'y', 'z'] as const)
          .map(
            (axis, index) => `
              <label><span>${axis}</span><input
                type="number"
                step="${step}"
                value="${fixed(values[index]!)}"
                data-editor-field="${group}.${axis}"
                ${
                  selection.editable && editableAxes.includes(axis)
                    ? ''
                    : 'disabled'
                }
              ></label>`,
          )
          .join('')}
      </fieldset>`;
    const positionAxes: ReadonlyArray<'x' | 'y' | 'z'> =
      selection.kind === 'doorway' ||
      selection.kind === 'player-start' ||
      selection.kind === 'zombie-spawn' ||
      selection.kind === 'walkable-boundary'
        ? ['x', 'z']
        : ['x', 'y', 'z'];
    const rotationAxes: ReadonlyArray<'x' | 'y' | 'z'> =
      selection.kind === 'trim-plane'
        ? ['x', 'y', 'z']
        : selection.kind === 'player-start' ||
            selection.kind === 'zombie-spawn' ||
            selection.kind === 'connective-tissue' ||
            selection.kind === 'walkable-boundary'
          ? []
          : ['y'];
    const scaleAxes: ReadonlyArray<'x' | 'y' | 'z'> =
      selection.kind === 'splat' || selection.kind === 'cut-volume'
        ? ['x', 'y', 'z']
        : selection.kind === 'doorway'
          ? ['x', 'y']
          : [];
    const canReassignRoom =
      selection.kind === 'cut-volume' ||
      selection.kind === 'trim-plane' ||
      (![
        'splat',
        'doorway',
        'connective-tissue',
        'barrier',
        'zombie-spawn',
        'walkable-boundary',
      ].includes(selection.kind) &&
        selection.editable);
    root.innerHTML = `
      <header class="editor-selection-heading">
        <span class="editor-entity-dot kind-${escapeHtml(selection.kind)}" aria-hidden="true"></span>
        <span><small>${escapeHtml(selection.kind)}</small><strong>${escapeHtml(selection.label)}</strong></span>
      </header>
      <dl class="editor-metadata">
        <div><dt>ID</dt><dd>${escapeHtml(selection.id)}</dd></div>
        <div><dt>Containment</dt><dd class="${selection.containment === 'inside' ? 'is-valid' : 'is-invalid'}">${escapeHtml(selection.containment)}</dd></div>
        <div><dt>Mount</dt><dd>${escapeHtml(selection.mount)}</dd></div>
        ${
          selection.kind === 'cut-volume' || selection.kind === 'connective-tissue'
            ? `<div><dt>Doorway</dt><dd class="${
                selection.doorwayLinkState === 'linked'
                  ? 'is-valid'
                  : selection.doorwayLinkState === 'linkable'
                    ? ''
                    : 'is-invalid'
              }">${escapeHtml(
                selection.doorwayLinkLabel ??
                  (selection.doorwayLinkState === 'linkable'
                    ? 'Overlaps a nearby cut — Link doorway'
                    : 'Not linked'),
              )}</dd></div>`
            : ''
        }
      </dl>
      <label class="editor-room-field"><span>Room ownership</span>
        <select id="editor-room-select" ${!selection.editable || !canReassignRoom ? 'disabled' : ''}>
          ${model.rooms
            .map(
              (room) =>
                `<option value="${escapeHtml(room.id)}" ${room.id === selection.roomId ? 'selected' : ''}>${escapeHtml(room.label)}</option>`,
            )
            .join('')}
        </select>
      </label>
      ${fields('position', selection.position, 0.1, positionAxes)}
      ${fields('rotation', selection.rotation, 0.017453, rotationAxes)}
      ${
        scaleAxes.length === 0
          ? ''
          : fields('scale', selection.scale, 0.05, scaleAxes)
      }
      ${
        selection.kind === 'connective-tissue'
          ? `<div class="editor-trim-actions editor-connective-actions">
              <button data-editor-action="unlink-doorway" title="Remove the doorway link but keep both cut cubes">Unlink doorway</button>
              <button data-editor-action="delete-connective" title="Remove this link, its two sockets, and paired splat openings (Backspace or Delete)">Remove connective tissue</button>
            </div>
            <p class="editor-trim-note">Unlink keeps the cut cubes. Remove connective tissue also deletes the paired cuts; Undo restores the complete link.</p>`
          : ''
      }
      ${
        selection.kind === 'splat'
          ? `<p class="editor-surface-note">Explorable surface: ${(selection.navigationArea ?? 0).toFixed(1)} m² (collider bake + walkable patches). Use <strong>+ WALK</strong> to extend the green mesh into door cuts, then Save.</p>`
          : ''
      }
      ${
        selection.kind === 'walkable-boundary'
          ? `<div class="editor-walkable-drag-mode" role="group" aria-label="Walkable drag mode">
              <button type="button" data-editor-action="set-walkable-drag-mode" data-value="corner" class="${
                model.walkableDragMode !== 'patch' ? 'is-active' : ''
              }" title="Drag one corner to reshape the walkable">Corners</button>
              <button type="button" data-editor-action="set-walkable-drag-mode" data-value="patch" class="${
                model.walkableDragMode === 'patch' ? 'is-active' : ''
              }" title="Drag any handle to slide the entire walkable section">Whole patch</button>
            </div>
            <div class="editor-trim-actions">
              <button data-editor-action="add-boundary-point" ${selection.editable ? '' : 'disabled'}>Insert point</button>
              <button data-editor-action="add-walkable-patch" data-value="${escapeHtml(selection.roomId)}" title="Add another walkable patch on this room">Add another patch</button>
              <button data-editor-action="toggle-walkable-focus" title="${model.walkableFocusActive === false ? 'Hide other patch fills (focus active patch)' : 'Show every patch fill and outline'}">${model.walkableFocusActive === false ? 'Focus patch' : 'Show all patches'}</button>
              <button data-editor-action="finish-walkable" title="Leave walkable edit mode (Esc)">Done editing</button>
              <button data-editor-action="delete-walkable-patch" title="Remove the active walkable patch (Backspace or Delete)">Delete patch <kbd>⌫</kbd></button>
            </div>
            <p class="editor-trim-note">${
              model.walkableDragMode === 'patch'
                ? 'Whole-patch mode (blue handles): drag any point to slide the entire section on X/Z.'
                : 'Corner mode (green handles): drag one point to reshape. Switch to Whole patch to move the section.'
            } <kbd>⌫</kbd> deletes the whole patch · <kbd>⇧⌫</kbd> deletes one corner. Save before play.</p>`
          : ''
      }
      ${
        selection.kind === 'trim-plane'
          ? `<div class="editor-trim-actions">
              <button data-editor-action="flip-trim" ${selection.editable ? '' : 'disabled'}>Flip kept side</button>
              <button data-editor-action="delete-trim" title="Delete selected trim plane (Backspace or Delete)" ${selection.editable ? '' : 'disabled'}>Delete trim plane</button>
            </div>
            <p class="editor-trim-note">Infinite plane · keeping ${escapeHtml(selection.keepSide ?? 'negative')} side. The red arrow points toward the removed side.</p>`
          : ''
      }
      ${
        selection.kind === 'cut-volume'
          ? `<div class="editor-trim-actions editor-doorway-actions">
              <button data-editor-action="link-doorway" ${
                selection.editable && selection.doorwayLinkState === 'linkable'
                  ? ''
                  : 'disabled'
              } title="Pair this cut with the nearest overlapping opposite-room cut">Link doorway</button>
              <button data-editor-action="unlink-doorway" ${
                selection.editable && selection.doorwayLinkState === 'linked'
                  ? ''
                  : 'disabled'
              } title="Remove the doorway link but keep both cut cubes">Unlink</button>
              <button data-editor-action="delete-cut" title="Delete selected cut cube (Backspace or Delete)" ${selection.editable ? '' : 'disabled'}>Delete cut</button>
            </div>
            <p class="editor-trim-note">${
              selection.doorwayLinkState === 'linked'
                ? 'Linked cuts form room connectivity. Cut footprints auto-extend green nav into the opening.'
                : 'Overlap an opposite-room cut (~≤4.5 m) to auto-pair a walkable doorway, or press Link doorway.'
            }</p>`
          : ''
      }
      <div class="editor-inspector-actions">
        <button data-editor-action="frame-selection">Frame selected <kbd>F</kbd></button>
        <button data-editor-action="revert-selection" ${selection.editable ? '' : 'disabled'}>Revert selected</button>
      </div>`;
    root.scrollTop = preserveFieldScroll ? previousScrollTop : 0;
  }

  private revealSelection(id: string | null): void {
    if (!id) return;
    requestAnimationFrame(() => {
      const targets = Array.from(
        this.root.querySelectorAll<HTMLElement>('[data-editor-entity]'),
      ).filter((element) => element.dataset.editorEntity === id);
      for (const target of targets) {
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    });
  }

  private renderValidation(model: EditorViewModel): void {
    const { validation } = model;
    const badge = this.root.querySelector<HTMLElement>('#editor-validation-badge');
    if (badge) {
      badge.className = `editor-validation-badge ${
        validation.errors.length > 0 ? 'is-error' : 'is-valid'
      }`;
      badge.textContent =
        validation.errors.length > 0
          ? `${validation.errors.length} PLAYTEST ISSUES`
          : 'VALID';
    }
    const summary = this.root.querySelector<HTMLElement>(
      '#editor-validation-summary',
    );
    if (summary) {
      summary.innerHTML = `
        <span><strong>${validation.roomCount}</strong> splats</span>
        <span><strong>${validation.portalCount}</strong> cut doorways</span>
        <span><strong>${validation.placementCount}</strong> placements</span>
        <span class="${validation.outsideCount > 0 ? 'is-invalid' : ''}"><strong>${validation.outsideCount}</strong> outside</span>
        <span class="${validation.connected ? '' : 'is-invalid'}"><strong>${validation.connected ? 'YES' : 'NO'}</strong> connected</span>
        <span class="${validation.connectorCount === 0 ? '' : 'is-invalid'}"><strong>${validation.connectorCount}</strong> hallways</span>`;
      summary.insertAdjacentHTML(
        'beforeend',
        `<span><strong>${validation.cutCount}</strong> cut cubes</span>`,
      );
      summary.insertAdjacentHTML(
        'beforeend',
        `<span><strong>${validation.trimCount}</strong> trim planes</span>`,
      );
    }
    const issues = this.root.querySelector<HTMLElement>('#editor-validation-issues');
    if (issues) {
      const entries = [
        ...validation.errors.map((message) => ({ role: 'error', message })),
        ...validation.warnings.map((message) => ({ role: 'warning', message })),
      ];
      issues.innerHTML =
        entries
          .slice(0, 8)
          .map(
            ({ role, message }) =>
              `<li class="is-${role}">${escapeHtml(message)}</li>`,
          )
          .join('') ||
        '<li class="is-valid">All containment and doorway checks pass.</li>';
    }
  }

  private markup(): string {
    return `
      <header class="editor-topbar">
        <div class="editor-brand">
          <span class="editor-brand-mark" aria-hidden="true"></span>
          <span><small>Protocol Z // Development tool</small><strong>Splat Placement Editor</strong></span>
        </div>
        <div class="editor-toolbar" role="toolbar" aria-label="Transform tools">
          <div class="editor-tool-group">
            <button data-editor-action="tool" data-editor-tool="translate" data-value="translate" title="Move (W)">Move <kbd>W</kbd></button>
            <button data-editor-action="tool" data-editor-tool="rotate" data-value="rotate" title="Rotate (E)">Rotate <kbd>E</kbd></button>
            <button data-editor-action="tool" data-editor-tool="scale" data-value="scale" title="Scale (R)">Scale <kbd>R</kbd></button>
          </div>
          <div class="editor-tool-group">
            <button data-editor-action="space" data-editor-space="world" data-value="world">World</button>
            <button data-editor-action="space" data-editor-space="local" data-value="local">Local</button>
            <label class="editor-snap-control">Snap
              <select id="editor-snap" data-editor-action="snap">
                <option value="0">Off</option>
                <option value="0.1">0.1 m</option>
                <option value="0.25">0.25 m</option>
                <option value="0.5">0.5 m</option>
                <option value="1">1 m</option>
              </select>
            </label>
          </div>
          <div class="editor-tool-group">
            <button data-editor-action="undo" title="Undo">↶ <kbd>⌘Z</kbd></button>
            <button data-editor-action="redo" title="Redo">↷ <kbd>⇧⌘Z</kbd></button>
          </div>
          <div class="editor-tool-group">
            <button data-editor-action="view" data-value="perspective">Perspective</button>
            <button data-editor-action="view" data-value="top">Top</button>
            <button data-editor-action="frame-all">Frame all</button>
          </div>
          <div class="editor-tool-group editor-cut-tools">
            <button data-editor-action="add-cut" title="Create and frame a pink cut cube on the selected splat or doorway">Add cut cube</button>
            <button class="editor-door-cut" data-editor-action="add-door-cut" title="Create a Gaussian-safe door cut (6.5 m wide × 3.6 m tall), seated above the floor">Add door</button>
            <button data-editor-action="delete-cut" title="Delete selected cut cube (Backspace or Delete)">Delete cut</button>
          </div>
        </div>
        <div class="editor-project-actions">
          <span id="editor-dirty">PROJECT SYNCED</span>
          <span id="editor-action-feedback" aria-live="polite">Editor ready</span>
          <button data-editor-action="export">Export JSON</button>
          <button data-editor-action="import">Import</button>
          <button data-editor-action="discard-draft">Discard draft</button>
          <button class="editor-save" data-editor-action="save" aria-keyshortcuts="Control+S Meta+S">Save changes <kbd>⌘S</kbd></button>
          <button data-editor-action="playtest">Playtest</button>
          <button class="editor-exit" data-editor-action="exit">Exit</button>
          <input id="editor-import-file" type="file" accept="application/json,.json" hidden>
        </div>
      </header>

      <aside class="editor-panel editor-scene-panel">
        <header><span><small>Scene index</small><strong>All editor objects</strong></span></header>
        <div class="editor-search-row">
          <input id="editor-search" type="search" placeholder="Search ID, room, or item…" aria-label="Search editor entities">
          <select id="editor-category" aria-label="Filter editor category">
            <option value="all">All</option>
            <option value="splats">Trim planes</option>
            <option value="doorways">Doorways</option>
            <option value="gameplay">Gameplay</option>
            <option value="spawns">Zombie entry</option>
          </select>
        </div>
        <div class="editor-overlay-toggles" aria-label="Editor overlays">
          <label><input type="checkbox" data-editor-overlay="splats"> Splats</label>
          <label><input type="checkbox" data-editor-overlay="navigation"> Navigation</label>
          <label><input type="checkbox" data-editor-overlay="doorways"> Doorways</label>
          <label><input type="checkbox" data-editor-overlay="connective"> Connective tissue</label>
          <label><input type="checkbox" data-editor-overlay="trims"> Trims</label>
          <label><input type="checkbox" data-editor-overlay="placements"> Items</label>
          <label><input type="checkbox" data-editor-overlay="labels"> Labels</label>
          <label><input type="checkbox" data-editor-overlay="grid"> Grid</label>
        </div>
        <section class="editor-connective-panel" aria-label="Connective tissue authoring">
          <header><strong>Connective tissue</strong><small>ROOM ↔ ROOM</small></header>
          <div>
            <label>From <select id="editor-connective-from" aria-label="Connective tissue source room"></select></label>
            <label>To <select id="editor-connective-to" aria-label="Connective tissue destination room"></select></label>
          </div>
          <div>
            <button data-editor-action="add-connective" title="Create one room link with two sockets and paired splat openings">Add link</button>
            <button data-editor-action="delete-connective" title="Remove selected connective tissue (Backspace or Delete)">Remove selected</button>
          </div>
        </section>
        <section class="editor-layers-panel" aria-label="Splat layers">
          <header><span>Per-splat layers</span><small>VIS · LOCK · SOLO</small></header>
          <div id="editor-layer-list"></div>
        </section>
        <div class="editor-entity-list" id="editor-entity-list"></div>
      </aside>

      <aside class="editor-panel editor-inspector-panel">
        <header><span><small>Authoritative transform</small><strong>Inspector</strong></span></header>
        <div id="editor-inspector"></div>
        <section class="editor-validation">
          <header><strong>Live validation</strong><span class="editor-validation-badge" id="editor-validation-badge">VALID</span></header>
          <div class="editor-validation-summary" id="editor-validation-summary"></div>
          <ul id="editor-validation-issues"></ul>
        </section>
      </aside>

      <footer class="editor-statusbar">
        <span id="editor-status-copy">Ready</span>
        <span><kbd>W/E</kbd> trim <kbd>F</kbd> frame <kbd>Esc</kbd> cancel <kbd>⌘C/⌘V</kbd> clip <kbd>⌫</kbd> delete <kbd>⌘Z</kbd> undo</span>
      </footer>`;
  }

  private readonly onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const entity = target.closest<HTMLElement>('[data-editor-entity]');
    if (entity?.dataset.editorEntity) {
      this.actions.onSelect(entity.dataset.editorEntity);
      return;
    }
    const actionTarget = target.closest<HTMLElement>('[data-editor-action]');
    if (
      !actionTarget ||
      (actionTarget instanceof HTMLButtonElement && actionTarget.disabled)
    ) {
      return;
    }
    const action = actionTarget.dataset.editorAction ?? '';
    if (action === 'add-connective') {
      const from = this.root.querySelector<HTMLSelectElement>(
        '#editor-connective-from',
      )?.value;
      const to = this.root.querySelector<HTMLSelectElement>(
        '#editor-connective-to',
      )?.value;
      this.actions.onAction(action, `${from ?? ''}|${to ?? ''}`);
      return;
    }
    this.actions.onAction(action, actionTarget.dataset.value);
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === 'editor-search') {
      if (event.type !== 'input') return;
      this.query = target.value;
      if (this.model) this.renderEntities(this.model.entities);
      return;
    }
    if (target.id === 'editor-category') {
      if (event.type !== 'change') return;
      this.category = target.value;
      if (this.model) this.renderEntities(this.model.entities);
      return;
    }
    if (target.id === 'editor-room-select') {
      if (event.type !== 'change') return;
      this.actions.onRoom(target.value);
      return;
    }
    const field = target.dataset.editorField;
    if (field) {
      if (event.type !== 'input') return;
      const value = Number(target.value);
      if (Number.isFinite(value)) this.actions.onField(field, value);
      return;
    }
    const overlay = target.dataset.editorOverlay;
    if (overlay && target instanceof HTMLInputElement) {
      if (event.type !== 'change') return;
      this.actions.onAction(
        'overlay',
        `${overlay}:${target.checked ? 'on' : 'off'}`,
      );
      return;
    }
    if (target.id === 'editor-snap') {
      if (event.type !== 'change') return;
      this.actions.onAction('snap', target.value);
    }
  };

  private readonly onImportFile = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => this.actions.onImport(text));
    input.value = '';
  };
}
