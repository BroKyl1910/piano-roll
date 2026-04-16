import * as Tone from "tone";
import "./style.css";

type PadNote = {
  id: string;
  label: string;
  note: string;
  color: string;
};

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
  isRecording: boolean;
  events: LoopedNote[];
  start(): Promise<void>;
  stop(): void;
  clear(): void;
  toggleRecord(): void;
  recordNote(note: string, velocity?: number): void;
}

const pads: PadNote[] = [
  { id: "kick", label: "C3 Kick", note: "C3", color: "#d9483b" },
  { id: "snare", label: "D3 Snare", note: "D3", color: "#2d6b57" },
  { id: "hat", label: "G3 Hat", note: "G3", color: "#f0c95d" },
  { id: "bass", label: "C2 Bass", note: "C2", color: "#171717" }
];

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
          Tap pads or play a connected MIDI keyboard while record is armed.
          The loop runs for four bars, and the main progress meter fills over each four-beat bar.
        </p>
        <div class="button-row">
          <button class="primary-button" id="playButton" type="button">Start</button>
          <button class="secondary-button" id="recordButton" type="button">Record</button>
          <button class="secondary-button" id="clearButton" type="button">Clear</button>
        </div>
        <div class="utility-row">
          <button class="secondary-button" id="midiButton" type="button">Enable MIDI</button>
        </div>
      </div>

      <div class="meta" aria-live="polite">
        <div class="meta-item">
          <span class="meta-label">Tempo</span>
          <span class="meta-value" id="bpmValue">120 BPM</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Captured</span>
          <span class="meta-value" id="eventCount">0 notes</span>
        </div>
      </div>
    </aside>

    <section class="surface">
      <div class="transport">
        <div class="beat-count">
          <strong id="beatNumber">1</strong>
        </div>
        <div class="progress-shell">
          <div class="bar-track" aria-label="Current bar progress">
            <div class="bar-fill" id="progressFill"></div>
          </div>
          <div class="bar-labels" id="barLabels"></div>
        </div>
      </div>

      <div class="pads" id="pads"></div>
      <div class="events" id="statusText">Ready.</div>
    </section>
  </section>
`;

const playButton = queryButton("#playButton");
const recordButton = queryButton("#recordButton");
const clearButton = queryButton("#clearButton");
const midiButton = queryButton("#midiButton");
const progressFill = queryElement<HTMLDivElement>("#progressFill");
const beatNumber = queryElement<HTMLElement>("#beatNumber");
const barLabels = queryElement<HTMLDivElement>("#barLabels");
const padGrid = queryElement<HTMLDivElement>("#pads");
const statusText = queryElement<HTMLDivElement>("#statusText");
const eventCount = queryElement<HTMLElement>("#eventCount");
const bpmValue = queryElement<HTMLElement>("#bpmValue");

const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.01,
    decay: 0.12,
    sustain: 0.2,
    release: 0.15
  }
}).toDestination();

const loopLengthTicks = Tone.Transport.PPQ * 4 * 4;
const barLengthTicks = Tone.Transport.PPQ * 4;
const sixteenthTicks = Tone.Transport.PPQ / 4;
let progressAnimationId = 0;

const looper: FourBarMidiLooper = {
  bars: 4,
  beatsPerBar: 4,
  bpm: 120,
  isPlaying: false,
  isRecording: false,
  events: [],
  async start() {
    await Tone.start();
    Tone.Transport.start();
    this.isPlaying = true;
    playButton.textContent = "Stop";
    statusText.textContent = this.isRecording ? "Recording into the loop." : "Playing loop.";
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
    eventCount.textContent = "0 notes";
    statusText.textContent = "Loop cleared.";
  },
  toggleRecord() {
    this.isRecording = !this.isRecording;
    recordButton.classList.toggle("is-active", this.isRecording);
    recordButton.textContent = this.isRecording ? "Recording" : "Record";
    statusText.textContent = this.isRecording ? "Recording armed." : "Recording off.";
  },
  recordNote(note: string, velocity = 0.85) {
    playNote(note, velocity);

    if (!this.isRecording) {
      return;
    }

    const tick = quantizeTick(Tone.Transport.ticks % loopLengthTicks);
    this.events.push({
      note,
      velocity,
      tick,
      durationTicks: sixteenthTicks
    });
    eventCount.textContent = `${this.events.length} ${this.events.length === 1 ? "note" : "notes"}`;
  }
};

Tone.Transport.bpm.value = looper.bpm;
Tone.Transport.loop = true;
Tone.Transport.loopStart = 0;
Tone.Transport.loopEnd = "4m";
bpmValue.textContent = `${looper.bpm} BPM`;

new Tone.Loop((time) => {
  const tick = Tone.Transport.ticks % loopLengthTicks;
  const dueEvents = looper.events.filter((event) => Math.abs(event.tick - tick) < sixteenthTicks / 2);

  dueEvents.forEach((event) => {
    synth.triggerAttackRelease(event.note, ticksToSeconds(event.durationTicks), time, event.velocity);
    flashPad(event.note);
  });
}, "16n").start(0);

barLabels.innerHTML = Array.from({ length: looper.bars }, (_, index) => {
  return `<div class="bar-label" data-bar="${index + 1}">Bar ${index + 1}</div>`;
}).join("");

padGrid.innerHTML = pads
  .map(
    (pad) => `
      <button class="pad" type="button" data-note="${pad.note}" style="--pad-color: ${pad.color}">
        ${pad.label}
      </button>
    `
  )
  .join("");

padGrid.addEventListener("pointerdown", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>(".pad");

  if (!target) {
    return;
  }

  looper.recordNote(target.dataset.note ?? "C3");
});

playButton.addEventListener("click", () => {
  if (looper.isPlaying) {
    looper.stop();
    return;
  }

  void looper.start();
});

recordButton.addEventListener("click", () => {
  looper.toggleRecord();
});

clearButton.addEventListener("click", () => {
  looper.clear();
});

midiButton.addEventListener("click", () => {
  void enableMidi();
});

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

function quantizeTick(tick: number): number {
  return Math.round(tick / sixteenthTicks) * sixteenthTicks;
}

function ticksToSeconds(ticks: number): number {
  return Tone.Ticks(ticks).toSeconds();
}

function playNote(note: string, velocity: number): void {
  void Tone.start().then(() => {
    synth.triggerAttackRelease(note, "16n", undefined, velocity);
    flashPad(note);
  });
}

function renderProgress(): void {
  const tick = Tone.Transport.ticks % loopLengthTicks;
  const currentBar = Math.floor(tick / barLengthTicks) + 1;
  const tickInsideBar = tick % barLengthTicks;
  const currentBeat = Math.floor(tickInsideBar / Tone.Transport.PPQ) + 1;
  const fillPercent = (tickInsideBar / barLengthTicks) * 100;

  progressFill.style.width = `${fillPercent}%`;
  beatNumber.textContent = String(currentBeat);

  document.querySelectorAll<HTMLElement>(".bar-label").forEach((label) => {
    label.classList.toggle("is-current", Number(label.dataset.bar) === currentBar);
  });

  if (looper.isPlaying) {
    progressAnimationId = requestAnimationFrame(renderProgress);
  }
}

function flashPad(note: string): void {
  const pad = document.querySelector<HTMLElement>(`.pad[data-note="${note}"]`);

  if (!pad) {
    return;
  }

  pad.classList.add("is-playing");
  window.setTimeout(() => pad.classList.remove("is-playing"), 120);
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
    statusText.textContent = `${access.inputs.size} MIDI input${access.inputs.size === 1 ? "" : "s"} listening.`;
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

  const frequency = Tone.Frequency(noteNumber, "midi").toNote();
  looper.recordNote(frequency, velocityNumber / 127);
}
