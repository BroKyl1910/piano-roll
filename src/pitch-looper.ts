import * as Tone from "tone";
import "./style.css";

type NoteName = "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";

type LoopedNote = {
  note: string;
  velocity: number;
  tick: number;
  durationTicks: number;
};

interface FourBarMidiLooper {
  bars: number;
  beatsPerBar: number;
  bpm: number;
  isPlaying: boolean;
  selectedNote: NoteName;
  selectedOctave: number;
  events: LoopedNote[];
  start(): Promise<void>;
  stop(): void;
  clear(): void;
  setNote(note: NoteName): void;
  setOctave(octave: number): void;
  setBpm(bpm: number): void;
  toggleStep(step: number): void;
  previewSelectedNote(): void;
}

const noteNames: NoteName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const octaveRange = [1, 2, 3, 4, 5, 6, 7];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App mount point is missing.");
}

app.innerHTML = `
  <section class="app" aria-label="4-bar MIDI looper">
    <aside class="controls">
      <div>
        <p class="eyebrow">Tone.js Transport</p>
        <h1>4-Bar Looper</h1>
        <p class="hint">
          Pick a note and octave, then click any beat square to place it.
          Click the same square again to remove that pitch from the loop.
        </p>
        <div class="button-row">
          <button class="primary-button" id="playButton" type="button">Start</button>
          <button class="secondary-button" id="clearButton" type="button">Clear</button>
        </div>
        <div class="utility-row">
          <button class="secondary-button" id="midiButton" type="button">Enable MIDI</button>
        </div>
      </div>

      <div class="meta" aria-live="polite">
        <div class="meta-item">
          <span class="meta-label">Tempo</span>
          <label class="tempo-control">
            <input id="tempoInput" type="number" min="40" max="240" step="1" value="120" />
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
      <div class="transport">
        <div class="beat-count">
          <span>Beat</span>
          <strong id="beatNumber">1</strong>
        </div>
        <div class="progress-shell">
          <div class="bar-track" aria-label="Current bar progress">
            <div class="bar-fill" id="progressFill"></div>
          </div>
          <div class="bar-labels" id="barLabels"></div>
        </div>
      </div>

      <section class="note-picker" aria-label="Note picker">
        <div>
          <p class="picker-label">Note</p>
          <div class="note-buttons" id="noteButtons"></div>
        </div>
        <div>
          <p class="picker-label">Octave</p>
          <div class="octave-buttons" id="octaveButtons"></div>
        </div>
        <button class="preview-button" id="previewButton" type="button">Play Selected</button>
      </section>

      <section class="sequencer" aria-label="Note placement grid">
        <div class="step-header" id="stepHeader"></div>
        <div class="step-grid" id="stepGrid"></div>
      </section>

      <div class="events" id="statusText">Selected note: C4. Click a beat square to place it.</div>
    </section>
  </section>
`;

const playButton = queryButton("#playButton");
const clearButton = queryButton("#clearButton");
const midiButton = queryButton("#midiButton");
const previewButton = queryButton("#previewButton");
const tempoInput = queryElement<HTMLInputElement>("#tempoInput");
const progressFill = queryElement<HTMLDivElement>("#progressFill");
const beatNumber = queryElement<HTMLElement>("#beatNumber");
const barLabels = queryElement<HTMLDivElement>("#barLabels");
const noteButtons = queryElement<HTMLDivElement>("#noteButtons");
const octaveButtons = queryElement<HTMLDivElement>("#octaveButtons");
const stepHeader = queryElement<HTMLDivElement>("#stepHeader");
const stepGrid = queryElement<HTMLDivElement>("#stepGrid");
const statusText = queryElement<HTMLDivElement>("#statusText");
const eventCount = queryElement<HTMLElement>("#eventCount");
const bpmValue = queryElement<HTMLElement>("#bpmValue");

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
    statusText.textContent = `Piano loaded. Selected note: ${getSelectedPitch()}.`;
  }
}).toDestination();

const beatTicks = Tone.Transport.PPQ;
const loopLengthTicks = Tone.Transport.PPQ * 4 * 4;
const barLengthTicks = Tone.Transport.PPQ * 4;
const totalSteps = 16;
let progressAnimationId = 0;

const looper: FourBarMidiLooper = {
  bars: 4,
  beatsPerBar: 4,
  bpm: 120,
  isPlaying: false,
  selectedNote: "C",
  selectedOctave: 4,
  events: [],
  async start() {
    await Tone.start();
    await Tone.loaded();
    Tone.Transport.start();
    this.isPlaying = true;
    playButton.textContent = "Stop";
    statusText.textContent = "Playing the four-bar loop.";
    renderProgress();
  },
  stop() {
    Tone.Transport.stop();
    Tone.Transport.ticks = 0;
    cancelAnimationFrame(progressAnimationId);
    this.isPlaying = false;
    playButton.textContent = "Start";
    statusText.textContent = "Stopped.";
    renderProgress();
  },
  clear() {
    this.events = [];
    updateEventCount();
    renderSteps();
    statusText.textContent = "Pattern cleared.";
  },
  setNote(note: NoteName) {
    this.selectedNote = note;
    renderNotePicker();
    statusText.textContent = `Selected note: ${getSelectedPitch()}.`;
    this.previewSelectedNote();
  },
  setOctave(octave: number) {
    this.selectedOctave = octave;
    renderNotePicker();
    statusText.textContent = `Selected note: ${getSelectedPitch()}.`;
    this.previewSelectedNote();
  },
  setBpm(bpm: number) {
    const clampedBpm = clampBpm(bpm);
    this.bpm = clampedBpm;
    Tone.Transport.bpm.value = clampedBpm;
    tempoInput.value = String(clampedBpm);
    statusText.textContent = `Tempo set to ${clampedBpm} BPM.`;
  },
  toggleStep(step: number) {
    const note = getSelectedPitch();
    const tick = step * beatTicks;
    const existingIndex = this.events.findIndex((event) => event.note === note && event.tick === tick);

    if (existingIndex >= 0) {
      this.events.splice(existingIndex, 1);
      statusText.textContent = `${note} removed from ${formatStep(step)}.`;
    } else {
      this.events.push({
        note,
        velocity: 0.88,
        tick,
        durationTicks: beatTicks
      });
      playNote(note, 0.88);
      statusText.textContent = `${note} placed on ${formatStep(step)}.`;
    }

    updateEventCount();
    renderSteps();
  },
  previewSelectedNote() {
    playNote(getSelectedPitch(), 0.88);
  }
};

Tone.Transport.bpm.value = looper.bpm;
Tone.Transport.loop = true;
Tone.Transport.loopStart = 0;
Tone.Transport.loopEnd = "4m";
bpmValue.textContent = "BPM";
tempoInput.value = String(looper.bpm);

Tone.Transport.scheduleRepeat((time) => {
  const step = getCurrentStep();
  const dueEvents = looper.events.filter((event) => event.tick === step * beatTicks);

  dueEvents.forEach((event) => {
    piano.triggerAttackRelease(event.note, ticksToSeconds(event.durationTicks), time, event.velocity);
  });
}, "4n");

barLabels.innerHTML = Array.from({ length: looper.bars }, (_, index) => {
  return `<div class="bar-label" data-bar="${index + 1}">Bar ${index + 1}</div>`;
}).join("");

stepHeader.innerHTML = Array.from({ length: totalSteps }, (_, step) => {
  const beat = (step % looper.beatsPerBar) + 1;
  return `<div class="step-heading" data-step="${step}">${beat}</div>`;
}).join("");

noteButtons.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-note]");

  if (!target) {
    return;
  }

  looper.setNote(target.dataset.note as NoteName);
});

octaveButtons.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-octave]");

  if (!target) {
    return;
  }

  looper.setOctave(Number(target.dataset.octave));
});

stepGrid.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-step]");

  if (!target) {
    return;
  }

  looper.toggleStep(Number(target.dataset.step));
});

playButton.addEventListener("click", () => {
  if (looper.isPlaying) {
    looper.stop();
    return;
  }

  void looper.start();
});

clearButton.addEventListener("click", () => {
  looper.clear();
});

previewButton.addEventListener("click", () => {
  looper.previewSelectedNote();
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

renderNotePicker();
renderSteps();
renderProgress();

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

function getSelectedPitch(): string {
  return `${looper.selectedNote}${looper.selectedOctave}`;
}

function getCurrentStep(): number {
  return Math.floor((Tone.Transport.ticks % loopLengthTicks) / beatTicks) % totalSteps;
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

function playNote(note: string, velocity: number): void {
  void Tone.start().then(async () => {
    await Tone.loaded();
    piano.triggerAttackRelease(note, "4n", undefined, velocity);
  });
}

function renderNotePicker(): void {
  noteButtons.innerHTML = noteNames
    .map((note) => {
      const isSelected = note === looper.selectedNote;

      return `
        <button class="note-button ${isSelected ? "is-active" : ""}" type="button" data-note="${note}">
          ${note}
        </button>
      `;
    })
    .join("");

  octaveButtons.innerHTML = octaveRange
    .map((octave) => {
      const isSelected = octave === looper.selectedOctave;

      return `
        <button class="octave-button ${isSelected ? "is-active" : ""}" type="button" data-octave="${octave}">
          ${octave}
        </button>
      `;
    })
    .join("");
}

function renderProgress(): void {
  const tick = Tone.Transport.ticks % loopLengthTicks;
  const currentBar = Math.floor(tick / barLengthTicks) + 1;
  const tickInsideBar = tick % barLengthTicks;
  const currentBeat = Math.floor(tickInsideBar / Tone.Transport.PPQ) + 1;
  const fillPercent = (tickInsideBar / barLengthTicks) * 100;
  const currentStep = getCurrentStep();

  progressFill.style.width = `${fillPercent}%`;
  beatNumber.textContent = String(currentBeat);

  document.querySelectorAll<HTMLElement>(".bar-label").forEach((label) => {
    label.classList.toggle("is-current", Number(label.dataset.bar) === currentBar);
  });

  document.querySelectorAll<HTMLElement>("[data-step]").forEach((cell) => {
    cell.classList.toggle("is-current-step", Number(cell.dataset.step) === currentStep);
  });

  if (looper.isPlaying) {
    progressAnimationId = requestAnimationFrame(renderProgress);
  }
}

function renderSteps(): void {
  stepGrid.innerHTML = Array.from({ length: totalSteps }, (_, step) => {
    const notes = looper.events
      .filter((event) => event.tick === step * beatTicks)
      .map((event) => event.note)
      .sort(comparePitches);
    const containsSelected = notes.includes(getSelectedPitch());

    return `
      <button
        class="step-cell ${notes.length > 0 ? "is-active" : ""} ${containsSelected ? "has-selected" : ""}"
        type="button"
        aria-label="${notes.length > 0 ? `${formatStep(step)}: ${notes.join(", ")}` : formatStep(step)}"
        data-step="${step}"
      >
        <span>${notes.length > 0 ? notes.join(" ") : "+"}</span>
      </button>
    `;
  }).join("");
}

function updateEventCount(): void {
  eventCount.textContent = `${looper.events.length} ${looper.events.length === 1 ? "note" : "notes"}`;
}

function formatStep(step: number): string {
  const bar = Math.floor(step / looper.beatsPerBar) + 1;
  const beat = (step % looper.beatsPerBar) + 1;

  return `bar ${bar}, beat ${beat}`;
}

function comparePitches(left: string, right: string): number {
  return Tone.Frequency(left).toMidi() - Tone.Frequency(right).toMidi();
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
  const match = /^([A-G]#?)(-?\d+)$/.exec(note);

  if (!match) {
    return;
  }

  looper.selectedNote = match[1] as NoteName;
  looper.selectedOctave = Number(match[2]);
  renderNotePicker();
  looper.toggleStep(getCurrentStep());
}
