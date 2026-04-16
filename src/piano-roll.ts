import * as Tone from "tone";
import "./style.css";

type NoteName = "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";
type SoundfontMap = Record<string, string>;

declare global {
  interface Window {
    MIDI?: {
      Soundfont?: Record<string, SoundfontMap>;
    };
  }
}

type LoopedNote = {
  note: string;
  instrument: InstrumentId;
  velocity: number;
  tick: number;
  durationTicks: number;
  dynamics?: number;
  vibrato?: number;
};

type InstrumentId = "piano" | "flute" | "violin" | "cello";
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

type InstrumentOption = {
  id: InstrumentId;
  label: string;
  color: string;
  release: number;
  volumeDb: number;
  soundfontName?: string;
  sampleNotes?: string[];
};

type InstrumentSettings = {
  dynamics: number;
  vibrato: number;
};

type InstrumentVoice = {
  sampler: Tone.Sampler;
  vibrato: Tone.Vibrato;
  volume: Tone.Volume;
};

type SelectedSoundSegment = {
  note: string;
  instrument: InstrumentId;
  tick: number;
};

type SavedRoll = {
  version: 1;
  bars: number;
  beatsPerBar: number;
  bpm: number;
  events: LoopedNote[];
  stepDivisions: Array<[number, BeatDivision]>;
  rolledSteps: number[];
  loopStartBar?: number;
  loopEndBar?: number;
  loopSelectionEnabled?: boolean;
  selectedKey?: string;
  selectedInstrument?: InstrumentId;
  instrumentSettings?: Array<[InstrumentId, InstrumentSettings]>;
};

interface FourBarMidiLooper {
  bars: number;
  beatsPerBar: number;
  bpm: number;
  isPlaying: boolean;
  loopStartBar: number;
  loopEndBar: number;
  loopSelectionEnabled: boolean;
  selectedKey: string;
  selectedInstrument: InstrumentId;
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
  setLoopRange(startBar: number, endBar: number): void;
  setLoopSelectionEnabled(enabled: boolean): void;
  setSelectedKey(key: string): void;
  setSelectedInstrument(instrument: InstrumentId): void;
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
        <section class="loop-editor" aria-label="Loop range controls">
          <span class="meta-label">Loop Range</span>
          <div class="loop-range-inputs">
            <label>
              <span>From</span>
              <input id="loopFromInput" type="number" min="1" max="4" step="1" value="1" />
            </label>
            <label>
              <span>To</span>
              <input id="loopToInput" type="number" min="1" max="4" step="1" value="4" />
            </label>
          </div>
          <label class="loop-checkbox">
            <input id="loopSelectionCheckbox" type="checkbox" />
            <span>Loop selection</span>
          </label>
        </section>
        <section class="key-editor" aria-label="Key guide controls">
          <label>
            <span class="meta-label">Key Guide</span>
            <select id="keySelect"></select>
          </label>
        </section>
        <section class="instrument-editor" aria-label="Instrument controls">
          <label>
            <span class="meta-label">Instrument</span>
            <span class="instrument-select-shell">
              <span class="instrument-swatch" id="instrumentSwatch" aria-hidden="true"></span>
              <select id="instrumentSelect"></select>
            </span>
          </label>
          <label class="instrument-slider">
            <span>
              <span class="meta-label">Dynamics</span>
              <strong id="dynamicsValue">100%</strong>
            </span>
            <input id="dynamicsInput" type="range" min="0" max="120" step="1" value="100" />
          </label>
          <label class="instrument-slider">
            <span>
              <span class="meta-label">Vibrato</span>
              <strong id="vibratoValue">0%</strong>
            </span>
            <input id="vibratoInput" type="range" min="0" max="100" step="1" value="0" />
          </label>
          <div class="instrument-scope" id="instrumentScope">New notes</div>
        </section>
        <div class="button-row">
          <button class="primary-button" id="playButton" type="button">Start</button>
          <button class="secondary-button" id="clearButton" type="button">Clear</button>
        </div>
        <div class="utility-row">
          <button class="secondary-button" id="saveButton" type="button">Save Roll</button>
          <button class="secondary-button" id="loadButton" type="button">Load File</button>
          <button class="secondary-button" id="reloadLastButton" type="button">Reload Last Save</button>
        </div>
        <button class="secondary-button hidden-midi-button" id="midiButton" type="button">Enable MIDI</button>
        <input class="file-input" id="rollFileInput" type="file" accept="application/json,.json" />
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
        <div class="roll-minimap" id="rollMinimap" aria-label="Note overview"></div>
        <div class="roll-time-minimap" id="rollTimeMinimap" aria-label="Time overview"></div>
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
const reloadLastButton = queryButton("#reloadLastButton");
const rollFileInput = queryElement<HTMLInputElement>("#rollFileInput");
const tempoInput = queryElement<HTMLInputElement>("#tempoInput");
const barHeader = queryElement<HTMLDivElement>("#barHeader");
const chordHeader = queryElement<HTMLDivElement>("#chordHeader");
const rollHeader = queryElement<HTMLDivElement>("#rollHeader");
const rollGrid = queryElement<HTMLDivElement>("#rollGrid");
const rollScroll = queryElement<HTMLDivElement>("#rollScroll");
const rollMinimap = queryElement<HTMLDivElement>("#rollMinimap");
const rollTimeMinimap = queryElement<HTMLDivElement>("#rollTimeMinimap");
const statusText = queryElement<HTMLDivElement>("#statusText");
const eventCount = queryElement<HTMLElement>("#eventCount");
const bpmValue = queryElement<HTMLElement>("#bpmValue");
const selectedBeatLabel = queryElement<HTMLElement>("#selectedBeatLabel");
const divisionButtons = queryElement<HTMLDivElement>("#divisionButtons");
const rollSelectedButton = queryButton("#rollSelectedButton");
const loopFromInput = queryElement<HTMLInputElement>("#loopFromInput");
const loopToInput = queryElement<HTMLInputElement>("#loopToInput");
const loopSelectionCheckbox = queryElement<HTMLInputElement>("#loopSelectionCheckbox");
const keySelect = queryElement<HTMLSelectElement>("#keySelect");
const instrumentSelect = queryElement<HTMLSelectElement>("#instrumentSelect");
const instrumentSwatch = queryElement<HTMLElement>("#instrumentSwatch");
const dynamicsInput = queryElement<HTMLInputElement>("#dynamicsInput");
const dynamicsValue = queryElement<HTMLElement>("#dynamicsValue");
const vibratoInput = queryElement<HTMLInputElement>("#vibratoInput");
const vibratoValue = queryElement<HTMLElement>("#vibratoValue");
const instrumentScope = queryElement<HTMLElement>("#instrumentScope");

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
});

const beatTicks = Tone.Transport.PPQ;
const barLengthTicks = Tone.Transport.PPQ * 4;
const beatDivisionOptions: Array<{ value: BeatDivision; label: string; ticks: number; parts: number }> = [
  { value: "1/4", label: "1/4", ticks: beatTicks, parts: 1 },
  { value: "1/8", label: "1/8", ticks: beatTicks / 2, parts: 2 },
  { value: "1/16", label: "1/16", ticks: beatTicks / 4, parts: 4 },
  { value: "triplet", label: "Triplet", ticks: beatTicks / 3, parts: 3 }
];
const pitchClassNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const keyOptions = [
  { value: "none", label: "Off", root: null, intervals: [] },
  ...pitchClassNames.flatMap((root, index) => [
    { value: `${index}:major`, label: `${root} major`, root: index, intervals: [0, 2, 4, 5, 7, 9, 11] },
    { value: `${index}:minor`, label: `${root} minor`, root: index, intervals: [0, 2, 3, 5, 7, 8, 10] }
  ])
];
const soundfontBaseUrl = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/";
const instrumentOptions: InstrumentOption[] = [
  { id: "piano", label: "Piano", color: "#7fd9b3", release: 1.2, volumeDb: 0 },
  {
    id: "flute",
    label: "Flute",
    color: "#8fb8ff",
    soundfontName: "flute",
    sampleNotes: ["C4", "E4", "G4", "B4", "D5", "F5", "A5", "C6"],
    release: 0.8,
    volumeDb: -5
  },
  {
    id: "violin",
    label: "Violin",
    color: "#f0c95d",
    soundfontName: "violin",
    sampleNotes: ["G3", "C4", "E4", "G4", "B4", "D5", "F5", "A5"],
    release: 0.9,
    volumeDb: -6
  },
  {
    id: "cello",
    label: "Cello",
    color: "#d68ac8",
    soundfontName: "cello",
    sampleNotes: ["C2", "E2", "G2", "B2", "D3", "F3", "A3", "C4"],
    release: 1.1,
    volumeDb: -6
  }
];
const instrumentSettings = new Map<InstrumentId, InstrumentSettings>(
  instrumentOptions.map((option) => [option.id, { dynamics: 100, vibrato: 0 }])
);
const instrumentVoices: Partial<Record<InstrumentId, InstrumentVoice>> = {
  piano: createInstrumentVoice("piano", piano)
};
const loadingInstrumentSamples = new Map<InstrumentId, Promise<void>>();
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
let barSelectionAnchor: number | null = null;
let barSelectionMoved = false;
let suppressNextBarCue = false;
let selectedSoundSegment: SelectedSoundSegment | null = null;

const looper: FourBarMidiLooper = {
  bars: 4,
  beatsPerBar: 4,
  bpm: 90,
  isPlaying: false,
  loopStartBar: 0,
  loopEndBar: 3,
  loopSelectionEnabled: false,
  selectedKey: "0:major",
  selectedInstrument: "piano",
  rolledSteps: new Set<number>(),
  selectedStep: null,
  stepDivisions: new Map<number, BeatDivision>(),
  events: ["C3", "E3", "G3"].map((note) => ({
    note,
    instrument: "piano",
    velocity: 0.88,
    tick: 0,
    durationTicks: barLengthTicks
  })),
  async start() {
    await Tone.start();
    await loadNeededInstrumentSamples();
    await Tone.loaded();
    applyTransportLoop();
    if (this.loopSelectionEnabled && !isTickInsideLoopRange(Tone.Transport.ticks)) {
      Tone.Transport.ticks = getLoopStartTick();
    }
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
    shiftLoopRangeAfterInsertedBar(clampedBarIndex);
    this.bars += 1;
    totalSteps = this.bars * this.beatsPerBar;
    applyTransportLoop();
    Tone.Transport.ticks = 0;
    clearPlayhead();
    renderBeatEditor();
    renderLoopControls();
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
    shiftLoopRangeAfterRemovedBar(barIndex);
    this.bars -= 1;
    totalSteps = this.bars * this.beatsPerBar;
    clampLoopRange();
    applyTransportLoop();
    Tone.Transport.ticks = 0;
    clearPlayhead();
    renderBeatEditor();
    renderLoopControls();
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
  setLoopRange(startBar: number, endBar: number) {
    this.loopStartBar = startBar;
    this.loopEndBar = endBar;
    clampLoopRange();
    applyTransportLoop();
    renderLoopControls();
    renderBarHeader();
    statusText.textContent = `Loop range set to bars ${this.loopStartBar + 1}-${this.loopEndBar + 1}.`;
  },
  setLoopSelectionEnabled(enabled: boolean) {
    this.loopSelectionEnabled = enabled;
    applyTransportLoop();
    renderLoopControls();
    renderBarHeader();
    statusText.textContent = enabled
      ? `Looping bars ${this.loopStartBar + 1}-${this.loopEndBar + 1}.`
      : "Looping the full roll.";
  },
  setSelectedKey(key: string) {
    this.selectedKey = getValidKeyValue(key);
    keySelect.value = this.selectedKey;
    renderRoll();
    statusText.textContent = this.selectedKey === "none"
      ? "Key guide off."
      : `${getKeyLabel(this.selectedKey)} guide on.`;
  },
  setSelectedInstrument(instrument: InstrumentId) {
    this.selectedInstrument = getValidInstrumentId(instrument);
    clearSelectedSoundSegment();
    instrumentSelect.value = this.selectedInstrument;
    renderInstrumentControls();
    const selectedInstrument = this.selectedInstrument;
    statusText.textContent = `Loading ${getInstrumentLabel(selectedInstrument)} samples.`;
    void ensureInstrumentSamples(selectedInstrument).then(() => {
      if (this.selectedInstrument === selectedInstrument) {
        statusText.textContent = `${getInstrumentLabel(this.selectedInstrument)} selected.`;
      }
    });
    renderRoll();
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
    playNote(this.selectedInstrument, note, 0.88, "8n");
    statusText.textContent = `Previewing ${note} on ${getInstrumentLabel(this.selectedInstrument)}.`;
  },
  addNoteAtTick(note: string, tick: number, durationTicks: number, render = true) {
    const instrument = this.selectedInstrument;
    const expression = getInstrumentSettings(instrument);
    const alreadyPlaced = this.events.some((event) => getEventInstrument(event) === instrument && event.note === note && tick >= event.tick && tick < event.tick + event.durationTicks);

    if (alreadyPlaced) {
      statusText.textContent = `${getInstrumentLabel(instrument)} already has ${note} on ${formatTick(tick)}.`;
      return;
    }

    const previousEvent = this.events.find((event) => {
      return getEventInstrument(event) === instrument
        && event.note === note
        && event.tick + event.durationTicks === tick
        && eventsHaveSameExpression(event, expression);
    });
    const nextEvent = this.events.find((event) => {
      return getEventInstrument(event) === instrument
        && event.note === note
        && event.tick === tick + durationTicks
        && eventsHaveSameExpression(event, expression);
    });

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
        instrument,
        velocity: 0.88,
        tick,
        durationTicks,
        dynamics: expression.dynamics,
        vibrato: expression.vibrato
      });
    }

    statusText.textContent = `${getInstrumentLabel(instrument)} ${note} placed on ${formatTick(tick)}.`;
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
      return getEventInstrument(event) === this.selectedInstrument && event.note === note && tick > event.tick && tick < event.tick + event.durationTicks;
    });
  },
  splitNoteAtTick(note: string, tick: number, durationTicks: number) {
    const instrument = this.selectedInstrument;
    const event = this.events.find((item) => getEventInstrument(item) === instrument && item.note === note && tick > item.tick && tick < item.tick + item.durationTicks);

    if (!event) {
      this.addNoteAtTick(note, tick, durationTicks);
      return;
    }

    const originalEndTick = event.tick + event.durationTicks;
    event.durationTicks = tick - event.tick;
    this.events.push({
      note,
      instrument,
      velocity: event.velocity,
      tick,
      durationTicks: originalEndTick - tick,
      dynamics: getEventDynamics(event),
      vibrato: getEventVibrato(event)
    });
    selectSoundSegment(note, instrument, tick);
    statusText.textContent = `${getInstrumentLabel(instrument)} ${note} retriggers on ${formatTick(tick)}.`;
    updateEventCount();
    renderChordHeader();
    renderRoll();
  },
  removeNoteAtTick(note: string, tick: number, durationTicks: number, render = true) {
    const instrument = this.selectedInstrument;
    const existingIndex = this.events.findIndex((event) => getEventInstrument(event) === instrument && event.note === note && tick >= event.tick && tick < event.tick + event.durationTicks);

    if (existingIndex < 0) {
      statusText.textContent = `${getInstrumentLabel(instrument)} does not have ${note} on ${formatTick(tick)}.`;
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
        instrument,
        velocity: event.velocity,
        tick: tick + durationTicks,
        durationTicks: rightDurationTicks,
        dynamics: getEventDynamics(event),
        vibrato: getEventVibrato(event)
      });
    }

    if (selectedSoundSegment && !findSelectedSoundSegmentEvent()) {
      clearSelectedSoundSegment();
    }

    statusText.textContent = `${getInstrumentLabel(instrument)} ${note} removed from ${formatTick(tick)}.`;
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
renderKeySelect();
renderInstrumentSelect();
renderLoopControls();

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
    triggerInstrument(getEventInstrument(event), event.note, ticksToSeconds(event.durationTicks), time + rollOffset, getEventVelocity(event), getEventExpression(event));
  });
}, `${transportPulseTicks}i`);

renderBarHeader();
renderChordHeader();
renderRollHeader();
renderBeatEditor();

rollGrid.addEventListener("click", (event) => {
  const noteHeader = (event.target as HTMLElement).closest<HTMLElement>(".roll-note[data-note]");

  if (noteHeader?.dataset.note) {
    clearSelectedSoundSegment();
    looper.previewNote(noteHeader.dataset.note);
    return;
  }

  const target = getRollCell(event.target);

  if (!target || event.detail > 1) {
    return;
  }

  const note = target.dataset.note ?? "C4";
  const tick = Number(target.dataset.tick);
  const selectedEvent = getActiveEventsAtTick(note, tick).find((event) => getEventInstrument(event) === looper.selectedInstrument);

  if (selectedEvent) {
    selectSoundSegment(selectedEvent.note, getEventInstrument(selectedEvent), selectedEvent.tick);
    window.clearTimeout(previewClickTimer);
    statusText.textContent = `${getInstrumentLabel(getEventInstrument(selectedEvent))} ${selectedEvent.note} segment selected.`;
    return;
  } else {
    clearSelectedSoundSegment();
  }

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

  if (suppressNextBarCue) {
    suppressNextBarCue = false;
    return;
  }

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

barHeader.addEventListener("pointerdown", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-bar-index]");

  if (!target || event.button !== 0) {
    return;
  }

  startBarSelection(Number(target.dataset.barIndex), event);
});

window.addEventListener("pointermove", (event) => {
  lastPointerClientX = event.clientX;
  lastPointerClientY = event.clientY;
  updateBarSelectionFromElement(document.elementFromPoint(event.clientX, event.clientY));
  const target = getRollCell(document.elementFromPoint(event.clientX, event.clientY));

  if (!target || !dragMode || !dragNote || target.dataset.note !== dragNote) {
    return;
  }

  applyDragToCell(target);
});

window.addEventListener("pointerup", stopDrag);
window.addEventListener("pointerup", stopBarSelection);
window.addEventListener("pointercancel", stopDrag);
window.addEventListener("pointercancel", stopBarSelection);

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
  rollFileInput.click();
});

reloadLastButton.addEventListener("click", () => {
  reloadLastSavedRoll();
});

rollFileInput.addEventListener("change", () => {
  void loadRollFromFile();
});

loopFromInput.addEventListener("change", () => {
  looper.setLoopRange(Number(loopFromInput.value) - 1, looper.loopEndBar);
});

loopToInput.addEventListener("change", () => {
  looper.setLoopRange(looper.loopStartBar, Number(loopToInput.value) - 1);
});

loopSelectionCheckbox.addEventListener("change", () => {
  looper.setLoopSelectionEnabled(loopSelectionCheckbox.checked);
});

keySelect.addEventListener("change", () => {
  looper.setSelectedKey(keySelect.value);
});

instrumentSelect.addEventListener("change", () => {
  looper.setSelectedInstrument(getValidInstrumentId(instrumentSelect.value));
});

dynamicsInput.addEventListener("input", () => {
  setInstrumentDynamics(looper.selectedInstrument, Number(dynamicsInput.value));
});

vibratoInput.addEventListener("input", () => {
  setInstrumentVibrato(looper.selectedInstrument, Number(vibratoInput.value));
});

rollScroll.addEventListener("scroll", () => {
  updateMinimapViewport();
});

rollMinimap.addEventListener("click", (event) => {
  const rowTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-minimap-note]");

  if (rowTarget?.dataset.minimapNote) {
    scrollRollToNote(rowTarget.dataset.minimapNote);
    return;
  }

  const rect = rollMinimap.getBoundingClientRect();
  const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
  const maxScrollTop = rollScroll.scrollHeight - rollScroll.clientHeight;

  rollScroll.scrollTop = Math.max(0, Math.min(maxScrollTop, ratio * maxScrollTop));
});

rollTimeMinimap.addEventListener("click", (event) => {
  const rect = rollTimeMinimap.getBoundingClientRect();
  const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
  const maxScrollLeft = rollScroll.scrollWidth - rollScroll.clientWidth;

  rollScroll.scrollLeft = Math.max(0, Math.min(maxScrollLeft, ratio * maxScrollLeft));
});

window.addEventListener("resize", () => {
  updateMinimapViewport();
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
updateMinimapViewport();

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
  const savedRoll = serializeRoll();
  const didSaveLocal = saveRollToLocalStorage(savedRoll);

  downloadRollFile(savedRoll);
  statusText.textContent = didSaveLocal
    ? `Saved ${looper.bars} ${looper.bars === 1 ? "bar" : "bars"} at ${looper.bpm} BPM.`
    : "Downloaded roll JSON, but could not update the browser reload save.";
}

function serializeRoll(): SavedRoll {
  return {
    version: 1,
    bars: looper.bars,
    beatsPerBar: looper.beatsPerBar,
    bpm: looper.bpm,
    events: looper.events.map((event) => ({ ...event })),
    stepDivisions: Array.from(looper.stepDivisions.entries()),
    rolledSteps: Array.from(looper.rolledSteps),
    loopStartBar: looper.loopStartBar,
    loopEndBar: looper.loopEndBar,
    loopSelectionEnabled: looper.loopSelectionEnabled,
    selectedKey: looper.selectedKey,
    selectedInstrument: looper.selectedInstrument,
    instrumentSettings: Array.from(instrumentSettings.entries()).map(([instrument, settings]) => [
      instrument,
      { ...settings }
    ])
  };
}

function saveRollToLocalStorage(savedRoll: SavedRoll): boolean {
  try {
    localStorage.setItem(savedRollStorageKey, JSON.stringify(savedRoll));
    return true;
  } catch {
    return false;
  }
}

function downloadRollFile(savedRoll: SavedRoll): void {
  const json = `${JSON.stringify(savedRoll, null, 2)}\n`;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = getRollFileName(savedRoll);
  link.click();
  URL.revokeObjectURL(url);
}

function getRollFileName(savedRoll: SavedRoll): string {
  const date = new Date().toISOString().slice(0, 10);

  return `midi-roll-${savedRoll.bars}-bars-${savedRoll.bpm}-bpm-${date}.json`;
}

async function loadRollFromFile(): Promise<void> {
  const file = rollFileInput.files?.[0];

  if (!file) {
    return;
  }

  try {
    const parsedRoll = JSON.parse(await file.text()) as Partial<SavedRoll>;

    if (!isSavedRoll(parsedRoll)) {
      statusText.textContent = "That JSON file does not look like a saved roll.";
      return;
    }

    applySavedRoll(parsedRoll);
    statusText.textContent = `Loaded ${file.name}.`;
  } catch {
    statusText.textContent = "Could not read that roll file.";
  } finally {
    rollFileInput.value = "";
  }
}

function reloadLastSavedRoll(): void {
  const savedRoll = getSavedRollFromLocalStorage();

  if (!savedRoll) {
    statusText.textContent = "No browser reload save found.";
    return;
  }

  applySavedRoll(savedRoll);
  statusText.textContent = `Reloaded last save: ${looper.bars} ${looper.bars === 1 ? "bar" : "bars"} at ${looper.bpm} BPM.`;
}

function applySavedRoll(savedRoll: SavedRoll): void {
  if (looper.isPlaying) {
    looper.stop();
  }

  looper.bars = savedRoll.bars;
  looper.beatsPerBar = savedRoll.beatsPerBar;
  looper.bpm = savedRoll.bpm;
  looper.events = savedRoll.events;
  looper.stepDivisions = new Map(savedRoll.stepDivisions);
  looper.rolledSteps = new Set(savedRoll.rolledSteps);
  looper.loopStartBar = savedRoll.loopStartBar ?? 0;
  looper.loopEndBar = savedRoll.loopEndBar ?? savedRoll.bars - 1;
  looper.loopSelectionEnabled = savedRoll.loopSelectionEnabled ?? false;
  looper.selectedKey = getValidKeyValue(savedRoll.selectedKey ?? "none");
  looper.selectedInstrument = getValidInstrumentId(savedRoll.selectedInstrument ?? "piano");
  applySavedInstrumentSettings(savedRoll.instrumentSettings);
  looper.selectedStep = null;
  looper.events = looper.events.map(normalizeSavedEvent);
  totalSteps = looper.bars * looper.beatsPerBar;
  clampLoopRange();
  applyTransportLoop();
  Tone.Transport.ticks = 0;
  Tone.Transport.bpm.value = looper.bpm;
  tempoInput.value = String(looper.bpm);
  keySelect.value = looper.selectedKey;
  instrumentSelect.value = looper.selectedInstrument;
  renderInstrumentControls();
  clearPlayhead();
  renderBeatEditor();
  renderLoopControls();
  renderTimeline();
  updateEventCount();
  scrollRollToOctave(4);
}

function getSavedRollFromLocalStorage(): SavedRoll | null {
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
    && value.rolledSteps.every((step) => Number.isInteger(step))
    && isOptionalSavedBar(value.loopStartBar)
    && isOptionalSavedBar(value.loopEndBar)
    && (value.loopSelectionEnabled === undefined || typeof value.loopSelectionEnabled === "boolean")
    && (value.selectedKey === undefined || isValidKeyValue(value.selectedKey))
    && (value.selectedInstrument === undefined || isValidInstrumentId(value.selectedInstrument))
    && (value.instrumentSettings === undefined || isSavedInstrumentSettings(value.instrumentSettings));
}

function isSavedNote(event: Partial<LoopedNote>): event is LoopedNote {
  return typeof event.note === "string"
    && pianoRollNotes.includes(event.note)
    && (event.instrument === undefined || isValidInstrumentId(event.instrument))
    && Number.isFinite(event.velocity)
    && Number.isFinite(event.tick)
    && Number.isFinite(event.durationTicks)
    && (event.dynamics === undefined || Number.isFinite(event.dynamics))
    && (event.vibrato === undefined || Number.isFinite(event.vibrato))
    && typeof event.tick === "number"
    && typeof event.durationTicks === "number"
    && event.tick >= 0
    && event.durationTicks > 0;
}

function normalizeSavedEvent(event: LoopedNote): LoopedNote {
  return {
    ...event,
    instrument: getEventInstrument(event),
    dynamics: clampPercent(event.dynamics ?? 100, 0, 120),
    vibrato: clampPercent(event.vibrato ?? 0, 0, 100)
  };
}

function isSavedInstrumentSettings(value: Array<[InstrumentId, InstrumentSettings]>): boolean {
  return Array.isArray(value)
    && value.every((entry) => {
      return Array.isArray(entry)
        && entry.length === 2
        && isValidInstrumentId(entry[0])
        && isValidInstrumentSettings(entry[1]);
    });
}

function isValidInstrumentSettings(value: Partial<InstrumentSettings>): value is InstrumentSettings {
  return Number.isFinite(value.dynamics)
    && Number.isFinite(value.vibrato)
    && typeof value.dynamics === "number"
    && typeof value.vibrato === "number";
}

function applySavedInstrumentSettings(savedSettings: Array<[InstrumentId, InstrumentSettings]> | undefined): void {
  instrumentOptions.forEach((option) => {
    instrumentSettings.set(option.id, { dynamics: 100, vibrato: 0 });
  });

  savedSettings?.forEach(([instrument, settings]) => {
    instrumentSettings.set(instrument, {
      dynamics: clampPercent(settings.dynamics, 0, 120),
      vibrato: clampPercent(settings.vibrato, 0, 100)
    });
  });

  instrumentOptions.forEach((option) => applyInstrumentSettings(option.id));
}

function isSavedDivisionEntry(entry: [number, BeatDivision]): entry is [number, BeatDivision] {
  return Array.isArray(entry)
    && entry.length === 2
    && Number.isInteger(entry[0])
    && beatDivisionOptions.some((option) => option.value === entry[1]);
}

function isOptionalSavedBar(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 0);
}

function isValidKeyValue(value: string): boolean {
  return keyOptions.some((option) => option.value === value);
}

function getValidKeyValue(value: string): string {
  return isValidKeyValue(value) ? value : "none";
}

function isValidInstrumentId(value: unknown): value is InstrumentId {
  return instrumentOptions.some((option) => option.id === value);
}

function getValidInstrumentId(value: unknown): InstrumentId {
  return isValidInstrumentId(value) ? value : "piano";
}

function getEventInstrument(event: Pick<LoopedNote, "instrument">): InstrumentId {
  return getValidInstrumentId(event.instrument);
}

function getInstrumentLabel(instrument: InstrumentId): string {
  return instrumentOptions.find((option) => option.id === instrument)?.label ?? "Piano";
}

function getInstrumentColor(instrument: InstrumentId): string {
  return instrumentOptions.find((option) => option.id === instrument)?.color ?? instrumentOptions[0].color;
}

function getInstrumentOption(instrument: InstrumentId): InstrumentOption {
  return instrumentOptions.find((option) => option.id === instrument) ?? instrumentOptions[0];
}

function getInstrumentSettings(instrument: InstrumentId): InstrumentSettings {
  const settings = instrumentSettings.get(instrument);

  if (settings) {
    return settings;
  }

  const defaultSettings = { dynamics: 100, vibrato: 0 };
  instrumentSettings.set(instrument, defaultSettings);

  return defaultSettings;
}

function getEventExpression(event: LoopedNote): InstrumentSettings {
  return {
    dynamics: getEventDynamics(event),
    vibrato: getEventVibrato(event)
  };
}

function getEventDynamics(event: LoopedNote): number {
  return clampPercent(event.dynamics ?? getInstrumentSettings(getEventInstrument(event)).dynamics, 0, 120);
}

function getEventVibrato(event: LoopedNote): number {
  return clampPercent(event.vibrato ?? getInstrumentSettings(getEventInstrument(event)).vibrato, 0, 100);
}

function getEventVelocity(event: LoopedNote): number {
  return Math.min(1, event.velocity * (getEventDynamics(event) / 100));
}

function eventsHaveSameExpression(event: LoopedNote, expression: InstrumentSettings): boolean {
  return getEventDynamics(event) === expression.dynamics && getEventVibrato(event) === expression.vibrato;
}

function selectSoundSegment(note: string, instrument: InstrumentId, tick: number): void {
  selectedSoundSegment = { note, instrument, tick };
  renderInstrumentControls();
  renderRoll();
}

function clearSelectedSoundSegment(): void {
  if (!selectedSoundSegment) {
    renderInstrumentControls();
    return;
  }

  const previousNote = selectedSoundSegment.note;

  selectedSoundSegment = null;
  renderInstrumentControls();
  updateRollRow(previousNote);
}

function findSelectedSoundSegmentEvent(): LoopedNote | null {
  if (!selectedSoundSegment) {
    return null;
  }

  return looper.events.find((event) => {
    return event.note === selectedSoundSegment?.note
      && getEventInstrument(event) === selectedSoundSegment.instrument
      && event.tick === selectedSoundSegment.tick;
  }) ?? null;
}

function setInstrumentDynamics(instrument: InstrumentId, value: number): void {
  const selectedEvent = findSelectedSoundSegmentEvent();

  if (selectedEvent && getEventInstrument(selectedEvent) === instrument) {
    selectedEvent.dynamics = clampPercent(value, 0, 120);
    renderInstrumentControls();
    updateRollRow(selectedEvent.note);
    statusText.textContent = `${getInstrumentLabel(instrument)} ${selectedEvent.note} segment dynamics ${selectedEvent.dynamics}%.`;
    return;
  }

  const settings = getInstrumentSettings(instrument);

  settings.dynamics = clampPercent(value, 0, 120);
  applyInstrumentSettings(instrument);
  renderInstrumentControls();
  statusText.textContent = `${getInstrumentLabel(instrument)} dynamics ${settings.dynamics}%.`;
}

function setInstrumentVibrato(instrument: InstrumentId, value: number): void {
  const selectedEvent = findSelectedSoundSegmentEvent();

  if (selectedEvent && getEventInstrument(selectedEvent) === instrument) {
    selectedEvent.vibrato = clampPercent(value, 0, 100);
    renderInstrumentControls();
    updateRollRow(selectedEvent.note);
    statusText.textContent = `${getInstrumentLabel(instrument)} ${selectedEvent.note} segment vibrato ${selectedEvent.vibrato}%.`;
    return;
  }

  const settings = getInstrumentSettings(instrument);

  settings.vibrato = clampPercent(value, 0, 100);
  applyInstrumentSettings(instrument);
  renderInstrumentControls();
  statusText.textContent = `${getInstrumentLabel(instrument)} vibrato ${settings.vibrato}%.`;
}

function clampPercent(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
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

function startBarSelection(barIndex: number, event: PointerEvent): void {
  event.preventDefault();
  barSelectionAnchor = barIndex;
  barSelectionMoved = false;
  lastPointerClientX = event.clientX;
  lastPointerClientY = event.clientY;
  looper.setLoopRange(barIndex, barIndex);
  startAutoScroll();
}

function updateBarSelectionFromElement(element: Element | null): void {
  if (barSelectionAnchor === null) {
    return;
  }

  const target = element?.closest<HTMLElement>("[data-bar-index]");

  if (!target) {
    return;
  }

  const barIndex = Number(target.dataset.barIndex);
  barSelectionMoved ||= barIndex !== barSelectionAnchor;
  looper.setLoopRange(barSelectionAnchor, barIndex);
}

function stopBarSelection(): void {
  if (barSelectionAnchor === null) {
    return;
  }

  suppressNextBarCue = barSelectionMoved;
  barSelectionAnchor = null;
  barSelectionMoved = false;
  stopAutoScroll();
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
    if (!dragMode && barSelectionAnchor === null) {
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

      updateBarSelectionFromElement(document.elementFromPoint(lastPointerClientX, lastPointerClientY));
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
    const activeEvents = getActiveEventsAtTick(note, tick);
    const selectedEvent = activeEvents.find((event) => getEventInstrument(event) === looper.selectedInstrument);
    const isActive = activeEvents.length > 0;
    const isStart = activeEvents.some((event) => event.tick === tick);
    const isSelectedInstrumentActive = Boolean(selectedEvent);
    const isSelectedInstrumentStart = selectedEvent?.tick === tick;
    const isSelectedSegment = selectedEvent
      ? selectedSoundSegment?.note === selectedEvent.note
        && selectedSoundSegment.instrument === getEventInstrument(selectedEvent)
        && selectedSoundSegment.tick === selectedEvent.tick
      : false;

    cell.classList.toggle("is-active", isActive);
    cell.classList.toggle("is-note-start", Boolean(isStart));
    cell.classList.toggle("is-selected-instrument-active", isSelectedInstrumentActive);
    cell.classList.toggle("is-selected-instrument-start", Boolean(isSelectedInstrumentStart));
    cell.classList.toggle("is-selected-segment", isSelectedSegment);
    cell.classList.toggle("is-note-hold", isSelectedInstrumentActive && !isSelectedInstrumentStart);
    cell.setAttribute("aria-pressed", String(isActive));
    cell.innerHTML = renderInstrumentBands(activeEvents, tick);
  });

  renderMinimap();
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

function getBarLengthTicks(): number {
  return looper.beatsPerBar * beatTicks;
}

function getLoopStartTick(): number {
  return looper.loopStartBar * getBarLengthTicks();
}

function getLoopEndTick(): number {
  return (looper.loopEndBar + 1) * getBarLengthTicks();
}

function isTickInsideLoopRange(tick: number): boolean {
  return tick >= getLoopStartTick() && tick < getLoopEndTick();
}

function clampLoopRange(): void {
  const lastBar = Math.max(0, looper.bars - 1);
  const startBar = Math.min(lastBar, Math.max(0, looper.loopStartBar));
  const endBar = Math.min(lastBar, Math.max(0, looper.loopEndBar));

  looper.loopStartBar = Math.min(startBar, endBar);
  looper.loopEndBar = Math.max(startBar, endBar);
}

function applyTransportLoop(): void {
  clampLoopRange();
  Tone.Transport.loop = true;
  Tone.Transport.loopStart = looper.loopSelectionEnabled ? `${looper.loopStartBar}m` : 0;
  Tone.Transport.loopEnd = looper.loopSelectionEnabled ? `${looper.loopEndBar + 1}m` : `${looper.bars}m`;
}

function renderLoopControls(): void {
  clampLoopRange();
  loopFromInput.min = "1";
  loopFromInput.max = String(looper.bars);
  loopFromInput.value = String(looper.loopStartBar + 1);
  loopToInput.min = "1";
  loopToInput.max = String(looper.bars);
  loopToInput.value = String(looper.loopEndBar + 1);
  loopSelectionCheckbox.checked = looper.loopSelectionEnabled;
}

function renderKeySelect(): void {
  keySelect.innerHTML = keyOptions
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  keySelect.value = looper.selectedKey;
}

function renderInstrumentSelect(): void {
  instrumentSelect.innerHTML = instrumentOptions
    .map((option) => `<option value="${option.id}" style="color: ${option.color};">${option.label}</option>`)
    .join("");
  instrumentSelect.value = looper.selectedInstrument;
  renderInstrumentControls();
}

function renderInstrumentControls(): void {
  const selectedEvent = findSelectedSoundSegmentEvent();
  const settings = selectedEvent && getEventInstrument(selectedEvent) === looper.selectedInstrument
    ? getEventExpression(selectedEvent)
    : getInstrumentSettings(looper.selectedInstrument);
  const instrumentColor = getInstrumentColor(looper.selectedInstrument);

  instrumentSwatch.style.background = instrumentColor;
  instrumentSelect.closest<HTMLElement>(".instrument-editor")?.style.setProperty("--instrument-color", instrumentColor);
  dynamicsInput.value = String(settings.dynamics);
  dynamicsValue.textContent = `${settings.dynamics}%`;
  vibratoInput.value = String(settings.vibrato);
  vibratoValue.textContent = `${settings.vibrato}%`;
  instrumentScope.textContent = selectedEvent && getEventInstrument(selectedEvent) === looper.selectedInstrument
    ? `${selectedEvent.note} at ${formatTick(selectedEvent.tick)}`
    : "New notes";
}

function getSelectedKeyOption(): (typeof keyOptions)[number] | undefined {
  return keyOptions.find((option) => option.value === looper.selectedKey);
}

function getKeyLabel(value: string): string {
  return keyOptions.find((option) => option.value === value)?.label ?? "Off";
}

function getSelectedKeyPitchClasses(): Set<number> | null {
  const selectedKey = getSelectedKeyOption();

  if (!selectedKey || selectedKey.root === null) {
    return null;
  }

  return new Set(selectedKey.intervals.map((interval) => (selectedKey.root + interval) % 12));
}

function isNoteInSelectedKey(note: string): boolean {
  const keyPitchClasses = getSelectedKeyPitchClasses();

  return Boolean(keyPitchClasses?.has(getPitchClass(note)));
}

function isNoteKeyRoot(note: string): boolean {
  const selectedKey = getSelectedKeyOption();

  return selectedKey?.root === getPitchClass(note);
}

function getScaleDegree(note: string): string {
  const selectedKey = getSelectedKeyOption();

  if (!selectedKey || selectedKey.root === null) {
    return "";
  }

  const pitchClass = getPitchClass(note);
  const degreeIndex = selectedKey.intervals.findIndex((interval) => {
    return (selectedKey.root + interval) % 12 === pitchClass;
  });

  return degreeIndex >= 0 ? String(degreeIndex + 1) : "";
}

function shiftLoopRangeAfterInsertedBar(insertBar: number): void {
  if (insertBar <= looper.loopStartBar) {
    looper.loopStartBar += 1;
    looper.loopEndBar += 1;
  } else if (insertBar <= looper.loopEndBar + 1) {
    looper.loopEndBar += 1;
  }
}

function shiftLoopRangeAfterRemovedBar(removeBar: number): void {
  if (removeBar < looper.loopStartBar) {
    looper.loopStartBar -= 1;
    looper.loopEndBar -= 1;
  } else if (removeBar <= looper.loopEndBar) {
    looper.loopEndBar -= 1;
  }
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

function playNote(instrument: InstrumentId, note: string, velocity: number, duration: Tone.Unit.Time): void {
  void Tone.start().then(async () => {
    await ensureInstrumentSamples(instrument);
    await Tone.loaded();
    triggerInstrument(instrument, note, duration, undefined, velocity * (getInstrumentSettings(instrument).dynamics / 100), getInstrumentSettings(instrument));
  });
}

function triggerInstrument(instrument: InstrumentId, note: string, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity?: number, expression?: InstrumentSettings): void {
  const voice = instrumentVoices[instrument];

  if (!voice) {
    return;
  }

  applyInstrumentSettingsToVoice(instrument, voice, expression, time);
  voice.sampler.triggerAttackRelease(note, duration, time, velocity);
}

async function loadNeededInstrumentSamples(): Promise<void> {
  const neededInstruments = new Set<InstrumentId>([
    looper.selectedInstrument,
    ...looper.events.map((event) => getEventInstrument(event))
  ]);

  await Promise.all(Array.from(neededInstruments, (instrument) => ensureInstrumentSamples(instrument)));
}

function ensureInstrumentSamples(instrument: InstrumentId): Promise<void> {
  if (instrumentVoices[instrument]) {
    return Promise.resolve();
  }

  const option = getInstrumentOption(instrument);

  if (!option.soundfontName || !option.sampleNotes) {
    return Promise.resolve();
  }

  const existingLoad = loadingInstrumentSamples.get(instrument);

  if (existingLoad) {
    return existingLoad;
  }

  const load = loadSoundfontScript(option.soundfontName)
    .then(() => createSampledInstrument(option))
    .catch(() => {
      statusText.textContent = `${option.label} samples could not be loaded.`;
    })
    .finally(() => {
      loadingInstrumentSamples.delete(instrument);
    });

  loadingInstrumentSamples.set(instrument, load);

  return load;
}

function loadSoundfontScript(soundfontName: string): Promise<void> {
  if (window.MIDI?.Soundfont?.[soundfontName]) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = `${soundfontBaseUrl}${soundfontName}-mp3.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${soundfontName} samples.`));
    document.head.append(script);
  });
}

function createSampledInstrument(option: InstrumentOption): Promise<void> {
  if (!option.soundfontName || !option.sampleNotes) {
    return Promise.resolve();
  }

  const soundfont = window.MIDI?.Soundfont?.[option.soundfontName];

  if (!soundfont) {
    return Promise.reject(new Error(`Missing ${option.soundfontName} soundfont.`));
  }

  const urls = option.sampleNotes.reduce<Record<string, string>>((samples, note) => {
    const sample = soundfont[note];

    if (sample) {
      samples[note] = sample;
    }

    return samples;
  }, {});

  return new Promise((resolve) => {
    const sampler = new Tone.Sampler({
      urls,
      release: option.release,
      onload: () => resolve()
    });

    instrumentVoices[option.id] = createInstrumentVoice(option.id, sampler);
  });
}

function createInstrumentVoice(instrument: InstrumentId, sampler: Tone.Sampler): InstrumentVoice {
  const vibrato = new Tone.Vibrato({ frequency: 5.6, depth: 0, wet: 0 });
  const volume = new Tone.Volume(0);
  const voice = { sampler, vibrato, volume };

  sampler.connect(vibrato);
  vibrato.connect(volume);
  volume.toDestination();
  applyInstrumentSettingsToVoice(instrument, voice);

  return voice;
}

function applyInstrumentSettings(instrument: InstrumentId): void {
  const voice = instrumentVoices[instrument];

  if (!voice) {
    return;
  }

  applyInstrumentSettingsToVoice(instrument, voice);
}

function applyInstrumentSettingsToVoice(instrument: InstrumentId, voice: InstrumentVoice, expression = getInstrumentSettings(instrument), time?: Tone.Unit.Time): void {
  const option = getInstrumentOption(instrument);
  const dynamicsGain = Math.max(0.001, expression.dynamics / 100);
  const vibratoAmount = expression.vibrato / 100;
  const volumeDb = option.volumeDb + 20 * Math.log10(dynamicsGain);
  const vibratoDepth = vibratoAmount * 0.35;
  const vibratoWet = vibratoAmount === 0 ? 0 : Math.min(0.7, vibratoAmount);

  if (time === undefined) {
    voice.volume.volume.value = volumeDb;
    voice.vibrato.depth.value = vibratoDepth;
    voice.vibrato.wet.value = vibratoWet;
    return;
  }

  voice.volume.volume.setValueAtTime(volumeDb, time);
  voice.vibrato.depth.setValueAtTime(vibratoDepth, time);
  voice.vibrato.wet.setValueAtTime(vibratoWet, time);
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
      const isLoopSelected = index >= looper.loopStartBar && index <= looper.loopEndBar;
      const isLoopStart = index === looper.loopStartBar;
      const isLoopEnd = index === looper.loopEndBar;
      const leadingControl = index === 0
        ? `<button class="bar-insert-button" type="button" data-insert-bar-index="0" aria-label="Insert bar before bar 1">+</button>`
        : `<span class="bar-leading-spacer" aria-hidden="true"></span>`;

      gridColumn += span;

      return `
        <div class="bar-heading ${isLoopSelected ? "is-loop-selected" : ""} ${isLoopStart ? "is-loop-start" : ""} ${isLoopEnd ? "is-loop-end" : ""}" style="${columnStyle}">
          ${leadingControl}
          <button class="bar-cue-button" type="button" data-bar-index="${index}" aria-pressed="${isLoopSelected}">Bar ${index + 1}</button>
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
      const isInKey = isNoteInSelectedKey(note);
      const isKeyRoot = isNoteKeyRoot(note);
      const scaleDegree = getScaleDegree(note);
      const rowCells = slots.map((slot) => {
        const activeEvents = getActiveEventsAtTick(note, slot.tick);
        const selectedEvent = activeEvents.find((event) => getEventInstrument(event) === looper.selectedInstrument);
        const isActive = activeEvents.length > 0;
        const isStart = activeEvents.some((event) => event.tick === slot.tick);
        const isSelectedInstrumentActive = Boolean(selectedEvent);
        const isSelectedInstrumentStart = selectedEvent?.tick === slot.tick;
        const isSelectedSegment = selectedEvent
          ? selectedSoundSegment?.note === selectedEvent.note
            && selectedSoundSegment.instrument === getEventInstrument(selectedEvent)
            && selectedSoundSegment.tick === selectedEvent.tick
          : false;
        const subbeatLabel = slot.parts > 1 ? `, part ${slot.subdivision + 1} of ${slot.parts}` : "";
        const instrumentLabel = activeEvents.length > 0
          ? `, ${activeEvents.map((event) => getInstrumentLabel(getEventInstrument(event))).join(" and ")}`
          : "";

        return `
          <button
            class="roll-cell ${isActive ? "is-active" : ""} ${isStart ? "is-note-start" : ""} ${isSelectedInstrumentActive ? "is-selected-instrument-active" : ""} ${isSelectedSegment ? "is-selected-segment" : ""} ${isSelectedInstrumentStart ? "is-selected-instrument-start" : ""} ${isSelectedInstrumentActive && !isSelectedInstrumentStart ? "is-note-hold" : ""} ${slot.subdivision === 0 ? "is-beat-start" : ""} ${slot.subdivision === 0 && isBarStart(slot.step) ? "is-bar-start" : ""} ${isOctaveStart(note) ? "is-octave-start" : ""} ${isBlackKey(note) ? "is-black-key" : ""}"
            type="button"
            aria-pressed="${isActive}"
            aria-label="${note}, ${formatStep(slot.step)}${subbeatLabel}${instrumentLabel}"
            data-note="${note}"
            data-step="${slot.step}"
            data-tick="${slot.tick}"
            data-duration-ticks="${slot.durationTicks}"
          >${renderInstrumentBands(activeEvents, slot.tick)}</button>
        `;
      }).join("");

      return `
        <div
          class="roll-note ${isBlackKey(note) ? "is-black-key" : ""} ${isOctaveStart(note) ? "is-octave-start" : ""} ${isInKey ? "is-in-key" : ""} ${isKeyRoot ? "is-key-root" : ""}"
          data-note="${note}"
        >
          <span class="key-guide-marker" aria-hidden="true">
            <span class="key-dot"></span>
            <span class="key-degree">${scaleDegree}</span>
          </span>
          <span>${note}</span>
        </div>
        ${rowCells}
      `;
    })
    .join("");

  renderMinimap();
}

function renderMinimap(): void {
  const notesWithEvents = new Set(looper.events.map((event) => event.note));
  const slots = getGridSlots();

  rollMinimap.innerHTML = `
    <div class="minimap-lane" style="grid-template-rows: repeat(${pianoRollNotes.length}, minmax(0, 1fr));">
      ${pianoRollNotes
        .map((note) => {
          return `
            <button
              class="minimap-row ${notesWithEvents.has(note) ? "has-notes" : ""}"
              type="button"
              aria-label="Jump to ${note}"
              data-minimap-note="${note}"
            ></button>
          `;
        })
        .join("")}
      <div class="minimap-viewport" aria-hidden="true"></div>
    </div>
  `;

  rollTimeMinimap.innerHTML = `
    <div class="time-minimap-lane" style="grid-template-columns: repeat(${slots.length}, minmax(0, 1fr));">
      ${slots.map((slot) => {
        const activeEvents = looper.events.filter((event) => slot.tick >= event.tick && slot.tick < event.tick + event.durationTicks);
        const instruments = Array.from(new Set(activeEvents.map((event) => getEventInstrument(event))));
        const startsBar = slot.subdivision === 0 && isBarStart(slot.step);

        return `
          <button
            class="time-minimap-step ${activeEvents.length > 0 ? "has-notes" : ""} ${startsBar ? "is-bar-start" : ""}"
            type="button"
            aria-label="${formatTick(slot.tick)}"
            data-minimap-tick="${slot.tick}"
          >
            ${instruments.map((instrument) => `
              <span class="time-minimap-band" style="background: ${getInstrumentColor(instrument)};"></span>
            `).join("")}
          </button>
        `;
      }).join("")}
      <div class="time-minimap-viewport" aria-hidden="true"></div>
    </div>
  `;

  updateMinimapViewport();
}

function getActiveEventsAtTick(note: string, tick: number): LoopedNote[] {
  return looper.events
    .filter((event) => event.note === note && tick >= event.tick && tick < event.tick + event.durationTicks)
    .sort((left, right) => getInstrumentSortIndex(getEventInstrument(left)) - getInstrumentSortIndex(getEventInstrument(right)));
}

function getInstrumentSortIndex(instrument: InstrumentId): number {
  return instrumentOptions.findIndex((option) => option.id === instrument);
}

function renderInstrumentBands(events: LoopedNote[], tick: number): string {
  if (events.length === 0) {
    return "";
  }

  return `
    <span class="instrument-bands" aria-hidden="true">
      ${events.map((event) => {
        const instrument = getEventInstrument(event);
        const isStart = event.tick === tick;
        const isSelectedSegment = selectedSoundSegment?.note === event.note
          && selectedSoundSegment.instrument === instrument
          && selectedSoundSegment.tick === event.tick;

        return `
          <span
            class="instrument-band ${isStart ? "is-band-start" : "is-band-hold"} ${isSelectedSegment ? "is-selected-segment" : ""}"
            data-instrument="${instrument}"
            title="${getInstrumentLabel(instrument)} ${getEventDynamics(event)}% dynamics, ${getEventVibrato(event)}% vibrato"
            style="background: ${getInstrumentColor(instrument)};"
          ></span>
        `;
      }).join("")}
    </span>
  `;
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
  scrollRollToNote(`C${octave}`);
}

function scrollRollToNote(note: string): void {
  const targetNote = rollGrid.querySelector<HTMLElement>(`.roll-note[data-note="${CSS.escape(note)}"]`);

  if (!targetNote) {
    return;
  }

  rollGrid.parentElement?.scrollTo({
    top: Math.max(0, targetNote.offsetTop - 120),
    left: 0
  });

  updateMinimapViewport();
}

function updateMinimapViewport(): void {
  const viewport = rollMinimap.querySelector<HTMLElement>(".minimap-viewport");
  const timeViewport = rollTimeMinimap.querySelector<HTMLElement>(".time-minimap-viewport");

  if (viewport) {
    const scrollHeight = rollScroll.scrollHeight;
    const clientHeight = rollScroll.clientHeight;
    const viewportHeight = scrollHeight > 0 ? Math.min(100, Math.max(6, (clientHeight / scrollHeight) * 100)) : 100;
    const maxTop = 100 - viewportHeight;
    const viewportTop = scrollHeight > clientHeight
      ? Math.min(maxTop, Math.max(0, (rollScroll.scrollTop / scrollHeight) * 100))
      : 0;

    viewport.style.top = `${viewportTop}%`;
    viewport.style.height = `${viewportHeight}%`;
  }

  if (timeViewport) {
    const scrollWidth = rollScroll.scrollWidth;
    const clientWidth = rollScroll.clientWidth;
    const viewportWidth = scrollWidth > 0 ? Math.min(100, Math.max(6, (clientWidth / scrollWidth) * 100)) : 100;
    const maxLeft = 100 - viewportWidth;
    const viewportLeft = scrollWidth > clientWidth
      ? Math.min(maxLeft, Math.max(0, (rollScroll.scrollLeft / scrollWidth) * 100))
      : 0;

    timeViewport.style.left = `${viewportLeft}%`;
    timeViewport.style.width = `${viewportWidth}%`;
  }
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
    playNote(looper.selectedInstrument, note, velocityNumber / 127, "8n");
    statusText.textContent = `${note} is outside the visible octave range.`;
    return;
  }

  const tick = getCurrentTick();

  looper.addNoteAtTick(note, tick, getDurationAtTick(tick));
}
