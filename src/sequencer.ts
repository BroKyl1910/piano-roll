import * as Tone from "tone";
import "./style.css";

type PadNote = {
  id: string;
  label: string;
  shortLabel: string;
  note: string;
};

type LoopedNote = {
  note: string;
  padId: string;
  velocity: number;
  tick: number;
  durationTicks: number;
};

interface FourBarMidiLooper {
  bars: number;
  beatsPerBar: number;
  bpm: number;
  isPlaying: boolean;
  events: LoopedNote[];
  start(): Promise<void>;
  stop(): void;
  clear(): void;
  toggleStep(padId: string, step: number): void;
  previewPad(padId: string): void;
}

const pads: PadNote[] = [
  { id: "kick", label: "Kick", shortLabel: "K", note: "C2" },
  { id: "snare", label: "Snare", shortLabel: "S", note: "D2" },
  { id: "hat", label: "Hat", shortLabel: "H", note: "F#2" },
  { id: "bass", label: "Bass", shortLabel: "B", note: "C3" }
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
          Click a square to add a sound to that beat. Each group is one bar,
          and each bar has four beats. Press Start when the pattern is ready.
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
          <span class="meta-value" id="bpmValue">120 BPM</span>
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

      <section class="sequencer" aria-label="Sound placement grid">
        <div class="step-header" id="stepHeader"></div>
        <div class="step-grid" id="stepGrid"></div>
      </section>

      <div class="events" id="statusText">Click grid squares to place sounds.</div>
    </section>
  </section>
`;

const playButton = queryButton("#playButton");
const clearButton = queryButton("#clearButton");
const midiButton = queryButton("#midiButton");
const progressFill = queryElement<HTMLDivElement>("#progressFill");
const beatNumber = queryElement<HTMLElement>("#beatNumber");
const barLabels = queryElement<HTMLDivElement>("#barLabels");
const stepHeader = queryElement<HTMLDivElement>("#stepHeader");
const stepGrid = queryElement<HTMLDivElement>("#stepGrid");
const statusText = queryElement<HTMLDivElement>("#statusText");
const eventCount = queryElement<HTMLElement>("#eventCount");
const bpmValue = queryElement<HTMLElement>("#bpmValue");

const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.01,
    decay: 0.12,
    sustain: 0.18,
    release: 0.12
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
  events: [],
  async start() {
    await Tone.start();
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
  toggleStep(padId: string, step: number) {
    const pad = pads.find((item) => item.id === padId);

    if (!pad) {
      return;
    }

    const tick = step * beatTicks;
    const existingIndex = this.events.findIndex((event) => event.padId === padId && event.tick === tick);

    if (existingIndex >= 0) {
      this.events.splice(existingIndex, 1);
      statusText.textContent = `${pad.label} removed from ${formatStep(step)}.`;
    } else {
      this.events.push({
        note: pad.note,
        padId: pad.id,
        velocity: 0.9,
        tick,
        durationTicks: beatTicks / 2
      });
      this.previewPad(pad.id);
      statusText.textContent = `${pad.label} placed on ${formatStep(step)}.`;
    }

    updateEventCount();
    renderSteps();
  },
  previewPad(padId: string) {
    const pad = pads.find((item) => item.id === padId);

    if (!pad) {
      return;
    }

    playNote(pad.note, 0.9);
    flashPad(pad.id);
  }
};

Tone.Transport.bpm.value = looper.bpm;
Tone.Transport.loop = true;
Tone.Transport.loopStart = 0;
Tone.Transport.loopEnd = "4m";
bpmValue.textContent = `${looper.bpm} BPM`;

Tone.Transport.scheduleRepeat((time) => {
  const step = getCurrentStep();
  const dueEvents = looper.events.filter((event) => event.tick === step * beatTicks);

  dueEvents.forEach((event) => {
    synth.triggerAttackRelease(event.note, ticksToSeconds(event.durationTicks), time, event.velocity);
    flashPad(event.padId);
  });
}, "4n");

barLabels.innerHTML = Array.from({ length: looper.bars }, (_, index) => {
  return `<div class="bar-label" data-bar="${index + 1}">Bar ${index + 1}</div>`;
}).join("");

stepHeader.innerHTML = `
  <div class="sound-heading">Sound</div>
  ${Array.from({ length: totalSteps }, (_, step) => {
    const beat = (step % looper.beatsPerBar) + 1;
    return `<div class="step-heading" data-step="${step}">${beat}</div>`;
  }).join("")}
`;

stepGrid.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-step]");

  if (!target) {
    return;
  }

  const padId = target.dataset.padId;
  const step = Number(target.dataset.step);

  if (padId) {
    looper.toggleStep(padId, step);
    return;
  }

  const previewPadId = target.dataset.previewPadId;

  if (previewPadId) {
    looper.previewPad(previewPadId);
  }
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

midiButton.addEventListener("click", () => {
  void enableMidi();
});

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

function getCurrentStep(): number {
  return Math.floor((Tone.Transport.ticks % loopLengthTicks) / beatTicks) % totalSteps;
}

function ticksToSeconds(ticks: number): number {
  return Tone.Ticks(ticks).toSeconds();
}

function playNote(note: string, velocity: number): void {
  void Tone.start().then(() => {
    synth.triggerAttackRelease(note, "8n", undefined, velocity);
  });
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
  stepGrid.innerHTML = pads
    .map((pad) => {
      const cells = Array.from({ length: totalSteps }, (_, step) => {
        const isActive = looper.events.some((event) => event.padId === pad.id && event.tick === step * beatTicks);
        const label = `${pad.label}, ${formatStep(step)}`;

        return `
          <button
            class="step-cell ${isActive ? "is-active" : ""}"
            type="button"
            aria-pressed="${isActive}"
            aria-label="${label}"
            data-pad-id="${pad.id}"
            data-step="${step}"
          >
            ${isActive ? pad.shortLabel : ""}
          </button>
        `;
      }).join("");

      return `
        <button class="sound-label" type="button" data-preview-pad-id="${pad.id}" data-step="-1">
          ${pad.label}
        </button>
        ${cells}
      `;
    })
    .join("");
}

function updateEventCount(): void {
  eventCount.textContent = `${looper.events.length} ${looper.events.length === 1 ? "note" : "notes"}`;
}

function formatStep(step: number): string {
  const bar = Math.floor(step / looper.beatsPerBar) + 1;
  const beat = (step % looper.beatsPerBar) + 1;

  return `bar ${bar}, beat ${beat}`;
}

function flashPad(padId: string): void {
  const cells = document.querySelectorAll<HTMLElement>(`[data-pad-id="${padId}"].is-active`);
  const label = document.querySelector<HTMLElement>(`[data-preview-pad-id="${padId}"]`);

  label?.classList.add("is-playing");
  cells.forEach((cell) => cell.classList.add("is-playing"));

  window.setTimeout(() => {
    label?.classList.remove("is-playing");
    cells.forEach((cell) => cell.classList.remove("is-playing"));
  }, 120);
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

  const pad = pads.find((item) => item.note === Tone.Frequency(noteNumber, "midi").toNote()) ?? pads[0];
  looper.toggleStep(pad.id, getCurrentStep());
}
