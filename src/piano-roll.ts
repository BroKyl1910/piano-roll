import * as Tone from "tone";
import "./style.css";

type NoteName = "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";

type LoopedNote = {
  note: string;
  velocity: number;
  tick: number;
  durationTicks: number;
};

type DragMode = "add" | "remove";
type BeatDivision = "1/4" | "1/8" | "1/16" | "triplet";

type GridSlot = {
  step: number;
  tick: number;
  durationTicks: number;
  subdivision: number;
  parts: number;
};

type ChordSegment = {
  label: string;
  startColumn: number;
  span: number;
  startsBar: boolean;
};

type ChordTemplate = {
  suffix: string;
  intervals: number[];
};

type SavedRoll = {
  version: 1;
  bars: number;
  beatsPerBar: number;
  bpm: number;
  events: LoopedNote[];
  stepDivisions: Array<[number, BeatDivision]>;
  rolledSteps: number[];
};

interface FourBarMidiLooper {
  bars: number;
  beatsPerBar: number;
  bpm: number;
  isPlaying: boolean;
  rolledSteps: Set<number>;
  selectedStep: number | null;
  stepDivisions: Map<number, BeatDivision>;
  events: LoopedNote[];
  start(): Promise<void>;
  stop(): void;
  clear(): void;
  addBar(): void;
  insertBar(barIndex: number): void;
  removeBar(barIndex: number): void;
  cueBar(barIndex: number): void;
  selectStep(step: number): void;
  setSelectedBeatDivision(division: BeatDivision): void;
  setBpm(bpm: number): void;
  previewNote(note: string): void;
  addNoteAtTick(note: string, tick: number, durationTicks: number, render?: boolean): void;
  hasHeldNoteAtTick(note: string, tick: number): boolean;
  splitNoteAtTick(note: string, tick: number, durationTicks: number): void;
  removeNoteAtTick(note: string, tick: number, durationTicks: number, render?: boolean): void;
  toggleRollStep(step: number): void;
  toggleSelectedStepRoll(): void;
}

const noteNames: NoteName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const octaveRange = [1, 2, 3, 4, 5, 6, 7];
const pianoRollNotes = octaveRange
  .flatMap((octave) => noteNames.map((note) => `${note}${octave}`))
  .reverse();

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App mount point is missing.");
}

app.innerHTML = `
  <section class="app" aria-label="MIDI looper">
    <aside class="controls">
      <div>
        <p class="eyebrow">Tone.js Transport</p>
        <section class="beat-editor" aria-label="Selected beat controls">
          <span class="meta-label">Selected Beat</span>
          <strong class="selected-beat" id="selectedBeatLabel">No beat selected</strong>
          <div class="division-buttons" id="divisionButtons" aria-label="Beat length"></div>
          <button class="secondary-button roll-selected-button" id="rollSelectedButton" type="button">Roll selected beat</button>
        </section>
        <div class="button-row">
          <button class="primary-button" id="playButton" type="button">Start</button>
          <button class="secondary-button" id="clearButton" type="button">Clear</button>
        </div>
        <div class="utility-row">
          <button class="secondary-button" id="midiButton" type="button">Enable MIDI</button>
          <button class="secondary-button" id="saveButton" type="button">Save Roll</button>
          <button class="secondary-button" id="loadButton" type="button">Load Roll</button>
        </div>
      </div>

      <div class="meta" aria-live="polite">
        <div class="meta-item">
          <span class="meta-label">Tempo</span>
          <label class="tempo-control">
            <input id="tempoInput" type="number" min="40" max="240" step="1" value="90" />
            <span id="bpmValue">BPM</span>
          </label>
        </div>
        <div class="meta-item">
          <span class="meta-label">Placed</span>
          <span class="meta-value" id="eventCount">0 notes</span>
        </div>
      </div>
    </aside>

    <section class="surface">
      <section class="piano-roll" aria-label="Piano roll note grid">
        <div class="roll-scroll" id="rollScroll">
          <div class="bar-header" id="barHeader"></div>
          <div class="chord-header" id="chordHeader"></div>
          <div class="roll-header" id="rollHeader"></div>
          <div class="roll-grid" id="rollGrid"></div>
        </div>
      </section>

      <div class="events" id="statusText">Piano loading. Click any cell to preview its pitch.</div>
    </section>
  </section>
`;

const playButton = queryButton("#playButton");
const clearButton = queryButton("#clearButton");
const midiButton = queryButton("#midiButton");
const saveButton = queryButton("#saveButton");
const loadButton = queryButton("#loadButton");
const tempoInput = queryElement<HTMLInputElement>("#tempoInput");
const barHeader = queryElement<HTMLDivElement>("#barHeader");
const chordHeader = queryElement<HTMLDivElement>("#chordHeader");
const rollHeader = queryElement<HTMLDivElement>("#rollHeader");
const rollGrid = queryElement<HTMLDivElement>("#rollGrid");
const rollScroll = queryElement<HTMLDivElement>("#rollScroll");
const statusText = queryElement<HTMLDivElement>("#statusText");
const eventCount = queryElement<HTMLElement>("#eventCount");
const bpmValue = queryElement<HTMLElement>("#bpmValue");
const selectedBeatLabel = queryElement<HTMLElement>("#selectedBeatLabel");
const divisionButtons = queryElement<HTMLDivElement>("#divisionButtons");
const rollSelectedButton = queryButton("#rollSelectedButton");

const piano = new Tone.Sampler({
  urls: {
    C3: "C3.mp3",
    "D#3": "Ds3.mp3",
    "F#3": "Fs3.mp3",
    A3: "A3.mp3",
    C4: "C4.mp3",
    "D#4": "Ds4.mp3",
    "F#4": "Fs4.mp3",
    A4: "A4.mp3",
    C5: "C5.mp3",
    "D#5": "Ds5.mp3",
    "F#5": "Fs5.mp3",
    A5: "A5.mp3"
  },
  baseUrl: "https://tonejs.github.io/audio/salamander/",
  release: 1.2,
  onload: () => {
    statusText.textContent = "Piano loaded. Click to preview, double-click to place a note.";
  }
}).toDestination();

const beatTicks = Tone.Transport.PPQ;
const barLengthTicks = Tone.Transport.PPQ * 4;
const beatDivisionOptions: Array<{ value: BeatDivision; label: string; ticks: number; parts: number }> = [
  { value: "1/4", label: "1/4", ticks: beatTicks, parts: 1 },
  { value: "1/8", label: "1/8", ticks: beatTicks / 2, parts: 2 },
  { value: "1/16", label: "1/16", ticks: beatTicks / 4, parts: 4 },
  { value: "triplet", label: "Triplet", ticks: beatTicks / 3, parts: 3 }
];
const pitchClassNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const chordTemplates: ChordTemplate[] = [
  { suffix: "13sus4", intervals: [0, 2, 5, 7, 9, 10] },
  { suffix: "maj13", intervals: [0, 2, 4, 7, 9, 11] },
  { suffix: "m13", intervals: [0, 2, 3, 7, 9, 10] },
  { suffix: "13", intervals: [0, 2, 4, 7, 9, 10] },
  { suffix: "m11", intervals: [0, 2, 3, 5, 7, 10] },
  { suffix: "11", intervals: [0, 2, 4, 5, 7, 10] },
  { suffix: "maj9", intervals: [0, 2, 4, 7, 11] },
  { suffix: "mMaj9", intervals: [0, 2, 3, 7, 11] },
  { suffix: "m9", intervals: [0, 2, 3, 7, 10] },
  { suffix: "9sus4", intervals: [0, 2, 5, 7, 10] },
  { suffix: "7b9", intervals: [0, 1, 4, 7, 10] },
  { suffix: "7#9", intervals: [0, 3, 4, 7, 10] },
  { suffix: "9", intervals: [0, 2, 4, 7, 10] },
  { suffix: "6/9", intervals: [0, 2, 4, 7, 9] },
  { suffix: "m6/9", intervals: [0, 2, 3, 7, 9] },
  { suffix: "maj7#11", intervals: [0, 4, 6, 7, 11] },
  { suffix: "add9", intervals: [0, 2, 4, 7] },
  { suffix: "madd9", intervals: [0, 2, 3, 7] },
  { suffix: "maj7", intervals: [0, 4, 7, 11] },
  { suffix: "mMaj7", intervals: [0, 3, 7, 11] },
  { suffix: "m7b5", intervals: [0, 3, 6, 10] },
  { suffix: "dim7", intervals: [0, 3, 6, 9] },
  { suffix: "m7", intervals: [0, 3, 7, 10] },
  { suffix: "7sus4", intervals: [0, 5, 7, 10] },
  { suffix: "7b5", intervals: [0, 4, 6, 10] },
  { suffix: "7#5", intervals: [0, 4, 8, 10] },
  { suffix: "7", intervals: [0, 4, 7, 10] },
  { suffix: "6", intervals: [0, 4, 7, 9] },
  { suffix: "m6", intervals: [0, 3, 7, 9] },
  { suffix: "maj7(no5)", intervals: [0, 4, 11] },
  { suffix: "mMaj7(no5)", intervals: [0, 3, 11] },
  { suffix: "m7(no5)", intervals: [0, 3, 10] },
  { suffix: "7(no5)", intervals: [0, 4, 10] },
  { suffix: "", intervals: [0, 4, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
  { suffix: "dim", intervals: [0, 3, 6] },
  { suffix: "aug", intervals: [0, 4, 8] },
  { suffix: "sus2", intervals: [0, 2, 7] },
  { suffix: "sus4", intervals: [0, 5, 7] },
  { suffix: "(no5)", intervals: [0, 4] },
  { suffix: "m(no5)", intervals: [0, 3] }
];
const transportPulseTicks = beatTicks / 12;
const savedRollStorageKey = "midi-looper.saved-roll";
let totalSteps = 16;
let progressAnimationId = 0;
let previewClickTimer = 0;
let dragMode: DragMode | null = null;
let dragNote: string | null = null;
let suppressNextDoubleClick = false;
const draggedCells = new Set<string>();
let lastLeftClickCell = "";
let lastLeftClickTime = 0;
let autoScrollAnimationId = 0;
let lastPointerClientX = 0;
let lastPointerClientY = 0;

const looper: FourBarMidiLooper = {
  bars: 4,
  beatsPerBar: 4,
  bpm: 90,
  isPlaying: false,
  rolledSteps: new Set<number>(),
  selectedStep: null,
  stepDivisions: new Map<number, BeatDivision>(),
  events: ["C3", "E3", "G3"].map((note) => ({
    note,
    velocity: 0.88,
    tick: 0,
    durationTicks: barLengthTicks
  })),
  async start() {
    await Tone.start();
    await Tone.loaded();
    Tone.Transport.ticks = getCurrentTick();
    Tone.Transport.start();
    this.isPlaying = true;
    playButton.textContent = "Stop";
    statusText.textContent = `Playing ${this.bars} ${this.bars === 1 ? "bar" : "bars"}.`;
    renderProgress();
  },
  stop() {
    this.isPlaying = false;
    Tone.Transport.stop();
    Tone.Transport.ticks = 0;
    cancelAnimationFrame(progressAnimationId);
    playButton.textContent = "Start";
    statusText.textContent = "Stopped.";
    clearPlayhead();
  },
  clear() {
    this.events = [];
    updateEventCount();
    renderChordHeader();
    renderRoll();
    statusText.textContent = "Pattern cleared.";
  },
  addBar() {
    this.insertBar(this.bars);
  },
  insertBar(barIndex: number) {
    if (this.isPlaying) {
      this.stop();
    }

    const clampedBarIndex = Math.min(this.bars, Math.max(0, barIndex));
    const barTicks = this.beatsPerBar * beatTicks;
    const insertTick = clampedBarIndex * barTicks;
    const insertStep = clampedBarIndex * this.beatsPerBar;

    this.events = this.events.map((event) => shiftEventAroundInsertedBar(event, insertTick, barTicks));
    this.stepDivisions = shiftStepMapAfterInsertedBar(this.stepDivisions, insertStep);
    this.rolledSteps = shiftStepSetAfterInsertedBar(this.rolledSteps, insertStep);
    this.selectedStep = getShiftedSelectedStepAfterInsert(this.selectedStep, insertStep);
    this.bars += 1;
    totalSteps = this.bars * this.beatsPerBar;
    Tone.Transport.loopEnd = `${this.bars}m`;
    Tone.Transport.ticks = 0;
    clearPlayhead();
    renderBeatEditor();
    renderTimeline();
    statusText.textContent = `Added bar ${clampedBarIndex + 1}.`;
  },
  removeBar(barIndex: number) {
    if (this.bars <= 1) {
      statusText.textContent = "The loop needs at least one bar.";
      return;
    }

    if (this.isPlaying) {
      this.stop();
    }

    const barTicks = this.beatsPerBar * beatTicks;
    const removeStartTick = barIndex * barTicks;
    const removeEndTick = removeStartTick + barTicks;
    const removeStartStep = barIndex * this.beatsPerBar;
    const removeEndStep = removeStartStep + this.beatsPerBar;

    this.events = this.events.flatMap((event) => cutEventAroundRemovedBar(event, removeStartTick, removeEndTick, barTicks));
    this.stepDivisions = shiftStepMapAfterRemovedBar(this.stepDivisions, removeStartStep, removeEndStep);
    this.rolledSteps = shiftStepSetAfterRemovedBar(this.rolledSteps, removeStartStep, removeEndStep);
    this.selectedStep = getShiftedSelectedStep(this.selectedStep, removeStartStep, removeEndStep);
    this.bars -= 1;
    totalSteps = this.bars * this.beatsPerBar;
    Tone.Transport.loopEnd = `${this.bars}m`;
    Tone.Transport.ticks = 0;
    clearPlayhead();
    renderBeatEditor();
    renderTimeline();
    updateEventCount();
    statusText.textContent = `Removed bar ${barIndex + 1}.`;
  },
  cueBar(barIndex: number) {
    if (this.isPlaying) {
      return;
    }

    const step = barIndex * this.beatsPerBar;
    Tone.Transport.ticks = step * beatTicks;

    if (barIndex === 0) {
      clearPlayhead();
      statusText.textContent = "Cue reset to bar 1.";
      return;
    }

    renderProgress();
    statusText.textContent = `Cue set to bar ${barIndex + 1}.`;
  },
  selectStep(step: number) {
    if (step < 0 || step >= totalSteps) {
      return;
    }

    this.selectedStep = step;
    renderRollHeader();
    renderBeatEditor();
    statusText.textContent = `${formatStep(step)} selected.`;
  },
  setSelectedBeatDivision(division: BeatDivision) {
    if (this.selectedStep === null) {
      statusText.textContent = "Select a beat header first.";
      return;
    }

    this.stepDivisions.set(this.selectedStep, division);
    renderBeatEditor();
    renderTimeline();
    statusText.textContent = `${formatStep(this.selectedStep)} set to ${getBeatDivisionLabel(division)}.`;
  },
  setBpm(bpm: number) {
    const clampedBpm = clampBpm(bpm);
    this.bpm = clampedBpm;
    Tone.Transport.bpm.value = clampedBpm;
    tempoInput.value = String(clampedBpm);
    statusText.textContent = `Tempo set to ${clampedBpm} BPM.`;
  },
  previewNote(note: string) {
    playNote(note, 0.88, "8n");
    statusText.textContent = `Previewing ${note}.`;
  },
  addNoteAtTick(note: string, tick: number, durationTicks: number, render = true) {
    const alreadyPlaced = this.events.some((event) => event.note === note && tick >= event.tick && tick < event.tick + event.durationTicks);

    if (alreadyPlaced) {
      statusText.textContent = `${note} is already on ${formatTick(tick)}.`;
      return;
    }

    const previousEvent = this.events.find((event) => event.note === note && event.tick + event.durationTicks === tick);
    const nextEvent = this.events.find((event) => event.note === note && event.tick === tick + durationTicks);

    if (previousEvent && nextEvent) {
      previousEvent.durationTicks += durationTicks + nextEvent.durationTicks;
      this.events.splice(this.events.indexOf(nextEvent), 1);
    } else if (previousEvent) {
      previousEvent.durationTicks += durationTicks;
    } else if (nextEvent) {
      nextEvent.tick = tick;
      nextEvent.durationTicks += durationTicks;
    } else {
      this.events.push({
        note,
        velocity: 0.88,
        tick,
        durationTicks
      });
    }

    statusText.textContent = `${note} placed on ${formatTick(tick)}.`;
    updateEventCount();
    renderChordHeader();
    if (render) {
      renderRoll();
    } else {
      updateRollRow(note);
    }
  },
  hasHeldNoteAtTick(note: string, tick: number) {
    return this.events.some((event) => {
      return event.note === note && tick > event.tick && tick < event.tick + event.durationTicks;
    });
  },
  splitNoteAtTick(note: string, tick: number, durationTicks: number) {
    const event = this.events.find((item) => item.note === note && tick > item.tick && tick < item.tick + item.durationTicks);

    if (!event) {
      this.addNoteAtTick(note, tick, durationTicks);
      return;
    }

    const originalEndTick = event.tick + event.durationTicks;
    event.durationTicks = tick - event.tick;
    this.events.push({
      note,
      velocity: event.velocity,
      tick,
      durationTicks: originalEndTick - tick
    });
    statusText.textContent = `${note} retriggers on ${formatTick(tick)}.`;
    updateEventCount();
    renderChordHeader();
    renderRoll();
  },
  removeNoteAtTick(note: string, tick: number, durationTicks: number, render = true) {
    const existingIndex = this.events.findIndex((event) => event.note === note && tick >= event.tick && tick < event.tick + event.durationTicks);

    if (existingIndex < 0) {
      statusText.textContent = `${note} is not on ${formatTick(tick)}.`;
      return;
    }

    const event = this.events[existingIndex];
    const eventEndTick = event.tick + event.durationTicks;

    if (event.durationTicks === durationTicks) {
      this.events.splice(existingIndex, 1);
    } else if (tick === event.tick) {
      event.tick += durationTicks;
      event.durationTicks -= durationTicks;
    } else if (tick + durationTicks === eventEndTick) {
      event.durationTicks -= durationTicks;
    } else {
      const rightDurationTicks = eventEndTick - (tick + durationTicks);

      event.durationTicks = tick - event.tick;
      this.events.push({
        note,
        velocity: event.velocity,
        tick: tick + durationTicks,
        durationTicks: rightDurationTicks
      });
    }

    statusText.textContent = `${note} removed from ${formatTick(tick)}.`;
    updateEventCount();
    renderChordHeader();
    if (render) {
      renderRoll();
    } else {
      updateRollRow(note);
    }
  }
  ,
  toggleRollStep(step: number) {
    if (this.rolledSteps.has(step)) {
      this.rolledSteps.delete(step);
      statusText.textContent = `Roll off for ${formatStep(step)}.`;
    } else {
      this.rolledSteps.add(step);
      statusText.textContent = `Roll on for ${formatStep(step)}.`;
    }

    renderRollHeader();
    renderBeatEditor();
  },
  toggleSelectedStepRoll() {
    if (this.selectedStep === null) {
      statusText.textContent = "Select a beat header first.";
      return;
    }

    this.toggleRollStep(this.selectedStep);
  }
};

Tone.Transport.bpm.value = looper.bpm;
Tone.Transport.loop = true;
Tone.Transport.loopStart = 0;
Tone.Transport.loopEnd = "4m";
bpmValue.textContent = "BPM";
tempoInput.value = String(looper.bpm);

Tone.Transport.scheduleRepeat((time) => {
  if (!looper.isPlaying) {
    return;
  }

  const tick = getCurrentTick(time);
  const step = getStepFromTick(tick);
  const dueEvents = looper.events
    .filter((event) => event.tick === tick)
    .sort((left, right) => Tone.Frequency(left.note).toMidi() - Tone.Frequency(right.note).toMidi());

  dueEvents.forEach((event, index) => {
    const rollOffset = looper.rolledSteps.has(step) ? index * 0.035 : 0;
    piano.triggerAttackRelease(event.note, ticksToSeconds(event.durationTicks), time + rollOffset, event.velocity);
  });
}, `${transportPulseTicks}i`);

renderBarHeader();
renderChordHeader();
renderRollHeader();
renderBeatEditor();

rollGrid.addEventListener("click", (event) => {
  const target = getRollCell(event.target);

  if (!target || event.detail > 1) {
    return;
  }

  const note = target.dataset.note ?? "C4";
  window.clearTimeout(previewClickTimer);
  previewClickTimer = window.setTimeout(() => {
    looper.previewNote(note);
  }, 220);
});

rollGrid.addEventListener("dblclick", (event) => {
  const target = getRollCell(event.target);

  if (!target) {
    return;
  }

  if (suppressNextDoubleClick) {
    suppressNextDoubleClick = false;
    return;
  }

  window.clearTimeout(previewClickTimer);
  looper.splitNoteAtTick(target.dataset.note ?? "C4", Number(target.dataset.tick), Number(target.dataset.durationTicks));
});

rollHeader.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-step]");

  if (!target) {
    return;
  }

  looper.selectStep(Number(target.dataset.step));
});

barHeader.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-bar-index]");

  if (!target || looper.isPlaying) {
    return;
  }

  looper.cueBar(Number(target.dataset.barIndex));
});

rollGrid.addEventListener("contextmenu", (event) => {
  const target = getRollCell(event.target);

  if (!target) {
    return;
  }

  event.preventDefault();
});

rollGrid.addEventListener("pointerdown", (event) => {
  const target = getRollCell(event.target);

  if (!target) {
    return;
  }

  const cellId = getCellId(target);
  const isSecondClickHold = cellId === lastLeftClickCell && performance.now() - lastLeftClickTime < 450;

  if (event.button === 0 && (event.detail >= 2 || isSecondClickHold)) {
    const note = target.dataset.note ?? "C4";
    const tick = Number(target.dataset.tick);
    const durationTicks = Number(target.dataset.durationTicks);

    if (looper.hasHeldNoteAtTick(note, tick)) {
      event.preventDefault();
      window.clearTimeout(previewClickTimer);
      suppressNextDoubleClick = true;
      looper.splitNoteAtTick(note, tick, durationTicks);
      return;
    }

    startDrag("add", target, event);
    return;
  }

  if (event.button === 2) {
    startDrag("remove", target, event);
  }
});

rollGrid.addEventListener("pointerup", (event) => {
  const target = getRollCell(event.target);

  if (!target || event.button !== 0 || dragMode) {
    return;
  }

  lastLeftClickCell = getCellId(target);
  lastLeftClickTime = performance.now();
});

window.addEventListener("pointermove", (event) => {
  lastPointerClientX = event.clientX;
  lastPointerClientY = event.clientY;
  const target = getRollCell(document.elementFromPoint(event.clientX, event.clientY));

  if (!target || !dragMode || !dragNote || target.dataset.note !== dragNote) {
    return;
  }

  applyDragToCell(target);
});

window.addEventListener("pointerup", stopDrag);
window.addEventListener("pointercancel", stopDrag);

playButton.addEventListener("click", () => {
  togglePlayback();
});

clearButton.addEventListener("click", () => {
  looper.clear();
});

barHeader.addEventListener("click", (event) => {
  const insertTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-insert-bar-index]");
  const removeTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-remove-bar-index]");

  if (insertTarget) {
    event.stopPropagation();
    looper.insertBar(Number(insertTarget.dataset.insertBarIndex));
    return;
  }

  if (!removeTarget) {
    return;
  }

  event.stopPropagation();
  looper.removeBar(Number(removeTarget.dataset.removeBarIndex));
});

divisionButtons.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-division]");

  if (!target) {
    return;
  }

  looper.setSelectedBeatDivision(target.dataset.division as BeatDivision);
});

rollSelectedButton.addEventListener("click", () => {
  looper.toggleSelectedStepRoll();
});

tempoInput.addEventListener("change", () => {
  looper.setBpm(Number(tempoInput.value));
});

tempoInput.addEventListener("input", () => {
  const nextBpm = Number(tempoInput.value);

  if (Number.isFinite(nextBpm)) {
    looper.bpm = clampBpm(nextBpm);
    Tone.Transport.bpm.value = looper.bpm;
  }
});

midiButton.addEventListener("click", () => {
  void enableMidi();
});

saveButton.addEventListener("click", () => {
  saveRoll();
});

loadButton.addEventListener("click", () => {
  loadRoll();
});

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;

  if (event.code === "Escape" && !looper.isPlaying) {
    looper.cueBar(0);
    return;
  }

  if (event.code !== "Space" || isTyping) {
    return;
  }

  event.preventDefault();
  togglePlayback();
});

renderRoll();
updateEventCount();
updateRollColumns();
scrollRollToOctave(4);

function queryElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}

function queryButton(selector: string): HTMLButtonElement {
  return queryElement<HTMLButtonElement>(selector);
}

function togglePlayback(): void {
  if (looper.isPlaying) {
    looper.stop();
    return;
  }

  void looper.start();
}

function saveRoll(): void {
  const savedRoll: SavedRoll = {
    version: 1,
    bars: looper.bars,
    beatsPerBar: looper.beatsPerBar,
    bpm: looper.bpm,
    events: looper.events.map((event) => ({ ...event })),
    stepDivisions: Array.from(looper.stepDivisions.entries()),
    rolledSteps: Array.from(looper.rolledSteps)
  };

  try {
    localStorage.setItem(savedRollStorageKey, JSON.stringify(savedRoll));
    statusText.textContent = `Saved ${looper.bars} ${looper.bars === 1 ? "bar" : "bars"} at ${looper.bpm} BPM.`;
  } catch {
    statusText.textContent = "Could not save this roll in the browser.";
  }
}

function loadRoll(): void {
  const savedRoll = getSavedRoll();

  if (!savedRoll) {
    statusText.textContent = "No saved roll found.";
    return;
  }

  if (looper.isPlaying) {
    looper.stop();
  }

  looper.bars = savedRoll.bars;
  looper.beatsPerBar = savedRoll.beatsPerBar;
  looper.bpm = savedRoll.bpm;
  looper.events = savedRoll.events;
  looper.stepDivisions = new Map(savedRoll.stepDivisions);
  looper.rolledSteps = new Set(savedRoll.rolledSteps);
  looper.selectedStep = null;
  totalSteps = looper.bars * looper.beatsPerBar;
  Tone.Transport.loopEnd = `${looper.bars}m`;
  Tone.Transport.ticks = 0;
  Tone.Transport.bpm.value = looper.bpm;
  tempoInput.value = String(looper.bpm);
  clearPlayhead();
  renderBeatEditor();
  renderTimeline();
  updateEventCount();
  scrollRollToOctave(4);
  statusText.textContent = `Loaded ${looper.bars} ${looper.bars === 1 ? "bar" : "bars"} at ${looper.bpm} BPM.`;
}

function getSavedRoll(): SavedRoll | null {
  const savedRollText = localStorage.getItem(savedRollStorageKey);

  if (!savedRollText) {
    return null;
  }

  try {
    const parsedRoll = JSON.parse(savedRollText) as Partial<SavedRoll>;

    if (!isSavedRoll(parsedRoll)) {
      return null;
    }

    return parsedRoll;
  } catch {
    return null;
  }
}

function isSavedRoll(value: Partial<SavedRoll>): value is SavedRoll {
  return value.version === 1
    && Number.isInteger(value.bars)
    && typeof value.bars === "number"
    && value.bars > 0
    && value.bars <= 64
    && value.beatsPerBar === 4
    && Number.isFinite(value.bpm)
    && Array.isArray(value.events)
    && value.events.every(isSavedNote)
    && Array.isArray(value.stepDivisions)
    && value.stepDivisions.every(isSavedDivisionEntry)
    && Array.isArray(value.rolledSteps)
    && value.rolledSteps.every((step) => Number.isInteger(step));
}

function isSavedNote(event: LoopedNote): event is LoopedNote {
  return typeof event.note === "string"
    && pianoRollNotes.includes(event.note)
    && Number.isFinite(event.velocity)
    && Number.isFinite(event.tick)
    && Number.isFinite(event.durationTicks)
    && event.tick >= 0
    && event.durationTicks > 0;
}

function isSavedDivisionEntry(entry: [number, BeatDivision]): entry is [number, BeatDivision] {
  return Array.isArray(entry)
    && entry.length === 2
    && Number.isInteger(entry[0])
    && beatDivisionOptions.some((option) => option.value === entry[1]);
}

function getRollCell(target: EventTarget | null): HTMLButtonElement | null {
  return (target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-note][data-tick]") ?? null;
}

function getCellId(target: HTMLButtonElement): string {
  return `${target.dataset.note ?? "C4"}:${target.dataset.tick ?? "0"}`;
}

function startDrag(mode: DragMode, target: HTMLButtonElement, event: PointerEvent): void {
  event.preventDefault();
  window.clearTimeout(previewClickTimer);
  dragMode = mode;
  dragNote = target.dataset.note ?? null;
  suppressNextDoubleClick = mode === "add";
  lastLeftClickCell = "";
  lastLeftClickTime = 0;
  lastPointerClientX = event.clientX;
  lastPointerClientY = event.clientY;
  draggedCells.clear();
  applyDragToCell(target);
  startAutoScroll();
}

function stopDrag(): void {
  dragMode = null;
  dragNote = null;
  draggedCells.clear();
  stopAutoScroll();
}

function startAutoScroll(): void {
  if (autoScrollAnimationId) {
    return;
  }

  const tick = () => {
    if (!dragMode) {
      autoScrollAnimationId = 0;
      return;
    }

    const rect = rollScroll.getBoundingClientRect();
    const edgeSize = 80;
    const maxSpeed = 18;
    let deltaX = 0;

    if (lastPointerClientX > rect.right - edgeSize) {
      deltaX = Math.ceil(((lastPointerClientX - (rect.right - edgeSize)) / edgeSize) * maxSpeed);
    } else if (lastPointerClientX < rect.left + edgeSize) {
      deltaX = -Math.ceil((((rect.left + edgeSize) - lastPointerClientX) / edgeSize) * maxSpeed);
    }

    if (deltaX !== 0) {
      rollScroll.scrollLeft += deltaX;
      const target = getRollCell(document.elementFromPoint(lastPointerClientX, lastPointerClientY));

      if (target && target.dataset.note === dragNote) {
        applyDragToCell(target);
      }
    }

    autoScrollAnimationId = requestAnimationFrame(tick);
  };

  autoScrollAnimationId = requestAnimationFrame(tick);
}

function stopAutoScroll(): void {
  if (!autoScrollAnimationId) {
    return;
  }

  cancelAnimationFrame(autoScrollAnimationId);
  autoScrollAnimationId = 0;
}

function applyDragToCell(target: HTMLButtonElement): void {
  if (!dragMode) {
    return;
  }

  const note = target.dataset.note ?? "C4";
  const tick = Number(target.dataset.tick);
  const durationTicks = Number(target.dataset.durationTicks);
  const cellId = `${note}:${tick}`;

  if (draggedCells.has(cellId)) {
    return;
  }

  draggedCells.add(cellId);

  if (dragMode === "add") {
    looper.addNoteAtTick(note, tick, durationTicks, false);
    return;
  }

  looper.removeNoteAtTick(note, tick, durationTicks, false);
}

function updateRollRow(note: string): void {
  rollGrid.querySelectorAll<HTMLButtonElement>(`.roll-cell[data-note="${CSS.escape(note)}"]`).forEach((cell) => {
    const tick = Number(cell.dataset.tick);
    const activeEvent = looper.events.find((event) => {
      return event.note === note && tick >= event.tick && tick < event.tick + event.durationTicks;
    });
    const isActive = Boolean(activeEvent);
    const isStart = activeEvent?.tick === tick;

    cell.classList.toggle("is-active", isActive);
    cell.classList.toggle("is-note-start", Boolean(isStart));
    cell.classList.toggle("is-note-hold", isActive && !isStart);
    cell.setAttribute("aria-pressed", String(isActive));
  });
}

function getCurrentStep(): number {
  return getStepFromTick(getCurrentTick());
}

function getCurrentTick(time?: Tone.Unit.Time): number {
  const loopTicks = getLoopLengthTicks();
  const transportTicks = time === undefined ? Tone.Transport.ticks : Tone.Transport.getTicksAtTime(time);
  const tick = ((transportTicks % loopTicks) + loopTicks) % loopTicks;

  return Math.floor(Math.round(tick) / transportPulseTicks) * transportPulseTicks;
}

function getStepFromTick(tick: number): number {
  return Math.floor((tick % getLoopLengthTicks()) / beatTicks) % totalSteps;
}

function getLoopLengthTicks(): number {
  return totalSteps * beatTicks;
}

function getStepDivision(step: number): BeatDivision {
  return looper.stepDivisions.get(step) ?? "1/4";
}

function getBeatDivisionTicks(division: BeatDivision): number {
  return beatDivisionOptions.find((option) => option.value === division)?.ticks ?? beatTicks;
}

function getBeatDivisionLabel(division: BeatDivision): string {
  return beatDivisionOptions.find((option) => option.value === division)?.label ?? "1/4";
}

function getBeatDivisionParts(division: BeatDivision): number {
  return beatDivisionOptions.find((option) => option.value === division)?.parts ?? 1;
}

function getGridSlots(): GridSlot[] {
  return Array.from({ length: totalSteps }).flatMap((_, step) => {
    const division = getStepDivision(step);
    const durationTicks = getBeatDivisionTicks(division);
    const parts = getBeatDivisionParts(division);

    return Array.from({ length: parts }, (_, subdivision) => ({
      step,
      tick: step * beatTicks + subdivision * durationTicks,
      durationTicks,
      subdivision,
      parts
    }));
  });
}

function getDurationAtTick(tick: number): number {
  return getGridSlots().find((slot) => slot.tick === tick)?.durationTicks ?? beatTicks;
}

function shiftEventAroundInsertedBar(event: LoopedNote, insertTick: number, barTicks: number): LoopedNote {
  const eventEndTick = event.tick + event.durationTicks;

  if (event.tick >= insertTick) {
    return { ...event, tick: event.tick + barTicks };
  }

  if (event.tick < insertTick && eventEndTick > insertTick) {
    return { ...event, durationTicks: event.durationTicks + barTicks };
  }

  return event;
}

function cutEventAroundRemovedBar(event: LoopedNote, removeStartTick: number, removeEndTick: number, barTicks: number): LoopedNote[] {
  const eventEndTick = event.tick + event.durationTicks;

  if (eventEndTick <= removeStartTick) {
    return [event];
  }

  if (event.tick >= removeEndTick) {
    return [{ ...event, tick: event.tick - barTicks }];
  }

  const leftDurationTicks = Math.max(0, removeStartTick - event.tick);
  const rightDurationTicks = Math.max(0, eventEndTick - removeEndTick);

  if (leftDurationTicks > 0 && rightDurationTicks > 0) {
    return [{ ...event, durationTicks: leftDurationTicks + rightDurationTicks }];
  }

  if (leftDurationTicks > 0) {
    return [{ ...event, durationTicks: leftDurationTicks }];
  }

  if (rightDurationTicks > 0) {
    return [{ ...event, tick: removeStartTick, durationTicks: rightDurationTicks }];
  }

  return [];
}

function shiftStepMapAfterInsertedBar<T>(map: Map<number, T>, insertStep: number): Map<number, T> {
  const shiftedMap = new Map<number, T>();

  map.forEach((value, step) => {
    shiftedMap.set(step >= insertStep ? step + looper.beatsPerBar : step, value);
  });

  return shiftedMap;
}

function shiftStepMapAfterRemovedBar<T>(map: Map<number, T>, removeStartStep: number, removeEndStep: number): Map<number, T> {
  const shiftedMap = new Map<number, T>();

  map.forEach((value, step) => {
    if (step < removeStartStep) {
      shiftedMap.set(step, value);
    } else if (step >= removeEndStep) {
      shiftedMap.set(step - looper.beatsPerBar, value);
    }
  });

  return shiftedMap;
}

function shiftStepSetAfterInsertedBar(set: Set<number>, insertStep: number): Set<number> {
  const shiftedSet = new Set<number>();

  set.forEach((step) => {
    shiftedSet.add(step >= insertStep ? step + looper.beatsPerBar : step);
  });

  return shiftedSet;
}

function shiftStepSetAfterRemovedBar(set: Set<number>, removeStartStep: number, removeEndStep: number): Set<number> {
  const shiftedSet = new Set<number>();

  set.forEach((step) => {
    if (step < removeStartStep) {
      shiftedSet.add(step);
    } else if (step >= removeEndStep) {
      shiftedSet.add(step - looper.beatsPerBar);
    }
  });

  return shiftedSet;
}

function getShiftedSelectedStepAfterInsert(selectedStep: number | null, insertStep: number): number | null {
  if (selectedStep === null) {
    return null;
  }

  return selectedStep >= insertStep ? selectedStep + looper.beatsPerBar : selectedStep;
}

function getShiftedSelectedStep(selectedStep: number | null, removeStartStep: number, removeEndStep: number): number | null {
  if (selectedStep === null) {
    return null;
  }

  if (selectedStep < removeStartStep) {
    return selectedStep;
  }

  if (selectedStep >= removeEndStep) {
    return selectedStep - looper.beatsPerBar;
  }

  return null;
}

function ticksToSeconds(ticks: number): number {
  return Tone.Ticks(ticks).toSeconds();
}

function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) {
    return looper.bpm;
  }

  return Math.min(240, Math.max(40, Math.round(bpm)));
}

function playNote(note: string, velocity: number, duration: Tone.Unit.Time): void {
  void Tone.start().then(async () => {
    await Tone.loaded();
    piano.triggerAttackRelease(note, duration, undefined, velocity);
  });
}

function renderProgress(): void {
  const currentTick = getCurrentTick();
  const currentStep = getStepFromTick(currentTick);

  document.querySelectorAll<HTMLElement>("[data-step], [data-tick]").forEach((cell) => {
    const tick = cell.dataset.tick === undefined ? null : Number(cell.dataset.tick);
    const step = cell.dataset.step === undefined ? null : Number(cell.dataset.step);
    const isCurrentTick = tick !== null && tick === currentTick;
    const isCurrentStep = tick === null && step !== null && step === currentStep;

    cell.classList.toggle("is-current-step", isCurrentTick || isCurrentStep);
  });

  if (looper.isPlaying) {
    progressAnimationId = requestAnimationFrame(renderProgress);
  }
}

function clearPlayhead(): void {
  document.querySelectorAll<HTMLElement>("[data-step], [data-tick]").forEach((cell) => {
    cell.classList.remove("is-current-step");
  });
}

function renderChordHeader(): void {
  chordHeader.innerHTML = `
    <div class="roll-corner">Chord</div>
    ${getChordSegments()
      .map((segment) => {
        const columnStyle = `grid-column: ${segment.startColumn} / span ${segment.span}`;

        return `<div class="chord-heading ${segment.startsBar ? "is-bar-start" : ""}" style="${columnStyle}" title="${segment.label}">${segment.label}</div>`;
      })
      .join("")}
  `;
}

function getChordSegments(): ChordSegment[] {
  const slots = getGridSlots();

  return slots.reduce<ChordSegment[]>((segments, slot, index) => {
    const label = getChordLabelAtTick(slot.tick);
    const previous = segments.at(-1);

    if (previous && previous.label === label && !isBarStart(slot.step)) {
      previous.span += 1;
      return segments;
    }

    segments.push({
      label,
      startColumn: index + 2,
      span: 1,
      startsBar: isBarStart(slot.step)
    });

    return segments;
  }, []);
}

function getChordLabelAtTick(tick: number): string {
  const activeNotes = looper.events
    .filter((event) => tick >= event.tick && tick < event.tick + event.durationTicks)
    .map((event) => ({
      midi: Tone.Frequency(event.note).toMidi(),
      pitchClass: getPitchClass(event.note)
    }))
    .sort((left, right) => left.midi - right.midi);
  const pitchClasses = Array.from(
    new Set(activeNotes.map((note) => note.pitchClass))
  ).sort((left, right) => left - right);

  if (pitchClasses.length === 0) {
    return "Rest";
  }

  if (pitchClasses.length === 1) {
    return pitchClassNames[pitchClasses[0]];
  }

  const recognized = getRecognizedChordName(pitchClasses, activeNotes[0]?.pitchClass);

  if (recognized) {
    return recognized;
  }

  return pitchClasses.map((pitchClass) => pitchClassNames[pitchClass]).join(" ");
}

function getRecognizedChordName(pitchClasses: number[], bassPitchClass?: number): string | null {
  for (const root of pitchClasses) {
    const intervals = normalizeIntervals(pitchClasses.map((pitchClass) => pitchClass - root));
    const template = chordTemplates.find((candidate) => {
      return arraysMatch(normalizeIntervals(candidate.intervals), intervals);
    });

    if (template) {
      const chordName = `${pitchClassNames[root]}${template.suffix}`;
      const slashBass = bassPitchClass !== undefined && bassPitchClass !== root ? `/${pitchClassNames[bassPitchClass]}` : "";

      return `${chordName}${slashBass}`;
    }
  }

  return null;
}

function normalizeIntervals(intervals: number[]): number[] {
  return Array.from(new Set(intervals.map((interval) => (interval + 120) % 12))).sort((left, right) => left - right);
}

function arraysMatch(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getPitchClass(note: string): number {
  return Tone.Frequency(note).toMidi() % 12;
}

function renderRollHeader(): void {
  let gridColumn = 2;

  rollHeader.innerHTML = `
    <div class="roll-corner">Note</div>
    ${Array.from({ length: totalSteps }, (_, step) => {
      const beat = (step % looper.beatsPerBar) + 1;
      const division = getStepDivision(step);
      const rollLabel = looper.rolledSteps.has(step) ? ", rolled" : "";
      const divisionClass = division !== "1/4" ? "has-custom-division" : "";
      const parts = getBeatDivisionParts(division);
      const columnStyle = `grid-column: ${gridColumn} / span ${parts}`;

      gridColumn += parts;

      return `<button class="roll-heading ${looper.rolledSteps.has(step) ? "is-rolled" : ""} ${looper.selectedStep === step ? "is-selected" : ""} ${divisionClass} ${isBarStart(step) ? "is-bar-start" : ""}" type="button" data-step="${step}" style="${columnStyle}" aria-label="${formatStep(step)}, ${getBeatDivisionLabel(division)}${rollLabel}">
        <span>${beat}</span>
        <small>${getBeatDivisionLabel(division)}</small>
      </button>`;
    }).join("")}
  `;
}

function renderBeatEditor(): void {
  const selectedStep = looper.selectedStep;

  selectedBeatLabel.textContent = selectedStep === null ? "No beat selected" : formatStep(selectedStep);
  divisionButtons.innerHTML = beatDivisionOptions
    .map((option) => {
      const isActive = selectedStep !== null && getStepDivision(selectedStep) === option.value;
      const disabledAttribute = selectedStep === null ? "disabled" : "";

      return `<button class="division-button ${isActive ? "is-active" : ""}" type="button" data-division="${option.value}" ${disabledAttribute}>${option.label}</button>`;
    })
    .join("");

  rollSelectedButton.disabled = selectedStep === null;
  rollSelectedButton.classList.toggle("is-active", selectedStep !== null && looper.rolledSteps.has(selectedStep));
  rollSelectedButton.textContent = selectedStep !== null && looper.rolledSteps.has(selectedStep)
    ? "Roll is on"
    : "Roll selected beat";
}

function renderBarHeader(): void {
  let gridColumn = 2;

  barHeader.innerHTML = `
    <div class="roll-corner"></div>
    ${Array.from({ length: looper.bars }, (_, index) => {
      const span = getGridSlots().filter((slot) => Math.floor(slot.step / looper.beatsPerBar) === index).length;
      const columnStyle = `grid-column: ${gridColumn} / span ${span}`;
      const disabledAttribute = looper.bars <= 1 ? "disabled" : "";
      const leadingControl = index === 0
        ? `<button class="bar-insert-button" type="button" data-insert-bar-index="0" aria-label="Insert bar before bar 1">+</button>`
        : `<span class="bar-leading-spacer" aria-hidden="true"></span>`;

      gridColumn += span;

      return `
        <div class="bar-heading" style="${columnStyle}">
          ${leadingControl}
          <button class="bar-cue-button" type="button" data-bar-index="${index}">Bar ${index + 1}</button>
          <button class="bar-remove-button" type="button" data-remove-bar-index="${index}" aria-label="Remove bar ${index + 1}" ${disabledAttribute}>-</button>
          <button class="bar-insert-button" type="button" data-insert-bar-index="${index + 1}" aria-label="Insert bar after bar ${index + 1}">+</button>
        </div>
      `;
    }).join("")}
  `;
}

function renderRoll(): void {
  const slots = getGridSlots();

  rollGrid.innerHTML = pianoRollNotes
    .map((note) => {
      const rowCells = slots.map((slot) => {
        const activeEvent = looper.events.find((event) => {
          return event.note === note && slot.tick >= event.tick && slot.tick < event.tick + event.durationTicks;
        });
        const isActive = Boolean(activeEvent);
        const isStart = activeEvent?.tick === slot.tick;
        const subbeatLabel = slot.parts > 1 ? `, part ${slot.subdivision + 1} of ${slot.parts}` : "";

        return `
          <button
            class="roll-cell ${isActive ? "is-active" : ""} ${isStart ? "is-note-start" : ""} ${isActive && !isStart ? "is-note-hold" : ""} ${slot.subdivision === 0 ? "is-beat-start" : ""} ${slot.subdivision === 0 && isBarStart(slot.step) ? "is-bar-start" : ""} ${isOctaveStart(note) ? "is-octave-start" : ""} ${isBlackKey(note) ? "is-black-key" : ""}"
            type="button"
            aria-pressed="${isActive}"
            aria-label="${note}, ${formatStep(slot.step)}${subbeatLabel}"
            data-note="${note}"
            data-step="${slot.step}"
            data-tick="${slot.tick}"
            data-duration-ticks="${slot.durationTicks}"
          ></button>
        `;
      }).join("");

      return `
        <div
          class="roll-note ${isBlackKey(note) ? "is-black-key" : ""} ${isOctaveStart(note) ? "is-octave-start" : ""}"
          data-note="${note}"
        >
          ${note}
        </div>
        ${rowCells}
      `;
    })
    .join("");
}

function updateRollColumns(): void {
  const slotCount = getGridSlots().length;
  const columns = `minmax(70px, 88px) repeat(${slotCount}, minmax(34px, 1fr))`;
  const minWidth = `${88 + slotCount * 34}px`;

  barHeader.style.gridTemplateColumns = columns;
  barHeader.style.minWidth = minWidth;
  chordHeader.style.gridTemplateColumns = columns;
  chordHeader.style.minWidth = minWidth;
  rollHeader.style.gridTemplateColumns = columns;
  rollHeader.style.minWidth = minWidth;
  rollGrid.style.gridTemplateColumns = columns;
  rollGrid.style.minWidth = minWidth;
}

function renderTimeline(): void {
  renderBarHeader();
  renderChordHeader();
  renderRollHeader();
  renderRoll();
  updateRollColumns();
}

function scrollRollToOctave(octave: number): void {
  const targetNote = rollGrid.querySelector<HTMLElement>(`.roll-note[data-note="C${octave}"]`);

  if (!targetNote) {
    return;
  }

  rollGrid.parentElement?.scrollTo({
    top: Math.max(0, targetNote.offsetTop - 120),
    left: 0
  });
}

function updateEventCount(): void {
  eventCount.textContent = `${looper.events.length} ${looper.events.length === 1 ? "note" : "notes"}`;
}

function formatStep(step: number): string {
  const bar = Math.floor(step / looper.beatsPerBar) + 1;
  const beat = (step % looper.beatsPerBar) + 1;

  return `bar ${bar}, beat ${beat}`;
}

function formatTick(tick: number): string {
  const step = getStepFromTick(tick);
  const slot = getGridSlots().find((item) => item.tick === tick);

  if (!slot || slot.parts === 1) {
    return formatStep(step);
  }

  return `${formatStep(step)}, part ${slot.subdivision + 1}`;
}

function isBlackKey(note: string): boolean {
  return note.includes("#");
}

function isOctaveStart(note: string): boolean {
  return /^B\d+$/.test(note);
}

function isBarStart(step: number): boolean {
  return step > 0 && step % looper.beatsPerBar === 0;
}

async function enableMidi(): Promise<void> {
  if (!navigator.requestMIDIAccess) {
    statusText.textContent = "Web MIDI is not available in this browser.";
    return;
  }

  try {
    const access = await navigator.requestMIDIAccess();
    access.inputs.forEach((input) => {
      input.onmidimessage = handleMidiMessage;
    });
    midiButton.textContent = "MIDI Enabled";
    midiButton.classList.add("is-active");
    statusText.textContent = `${access.inputs.size} MIDI input${access.inputs.size === 1 ? "" : "s"} listening. MIDI notes land on the current beat.`;
  } catch {
    statusText.textContent = "MIDI permission was not granted.";
  }
}

function handleMidiMessage(message: MIDIMessageEvent): void {
  if (!message.data || message.data.length < 3) {
    return;
  }

  const [status, noteNumber, velocityNumber] = message.data;
  const command = status & 0xf0;
  const isNoteOn = command === 0x90 && velocityNumber > 0;

  if (!isNoteOn) {
    return;
  }

  const note = Tone.Frequency(noteNumber, "midi").toNote();

  if (!pianoRollNotes.includes(note)) {
    playNote(note, velocityNumber / 127, "8n");
    statusText.textContent = `${note} is outside the visible octave range.`;
    return;
  }

  const tick = getCurrentTick();

  looper.addNoteAtTick(note, tick, getDurationAtTick(tick));
}
