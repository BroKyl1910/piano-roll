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

interface FourBarMidiLooper {
  bars: number;
  beatsPerBar: number;
  bpm: number;
  isPlaying: boolean;
  rolledSteps: Set<number>;
  events: LoopedNote[];
  start(): Promise<void>;
  stop(): void;
  clear(): void;
  addBar(): void;
  cueBar(barIndex: number): void;
  setBpm(bpm: number): void;
  previewNote(note: string): void;
  addNoteAtStep(note: string, step: number, render?: boolean): void;
  hasHeldNoteAtStep(note: string, step: number): boolean;
  splitNoteAtStep(note: string, step: number): void;
  removeNoteAtStep(note: string, step: number, render?: boolean): void;
  toggleRollStep(step: number): void;
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
  <section class="app" aria-label="4-bar MIDI looper">
    <aside class="controls">
      <div>
        <p class="eyebrow">Tone.js Transport</p>
        <h1>Piano Looper</h1>
        <p class="hint">
          Click a cell to hear its note. Double-click a cell to add
          that note on that beat. Double-click and drag to paint a row.
          Right-click removes notes, and Space starts or stops playback.
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
          <div class="roll-header" id="rollHeader"></div>
          <div class="roll-grid" id="rollGrid"></div>
        </div>
        <button class="add-bar-button" id="addBarButton" type="button" aria-label="Add bar">+</button>
      </section>

      <div class="events" id="statusText">Piano loading. Click any cell to preview its pitch.</div>
    </section>
  </section>
`;

const playButton = queryButton("#playButton");
const clearButton = queryButton("#clearButton");
const midiButton = queryButton("#midiButton");
const addBarButton = queryButton("#addBarButton");
const tempoInput = queryElement<HTMLInputElement>("#tempoInput");
const barHeader = queryElement<HTMLDivElement>("#barHeader");
const rollHeader = queryElement<HTMLDivElement>("#rollHeader");
const rollGrid = queryElement<HTMLDivElement>("#rollGrid");
const rollScroll = queryElement<HTMLDivElement>("#rollScroll");
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
    statusText.textContent = "Piano loaded. Click to preview, double-click to place a note.";
  }
}).toDestination();

const beatTicks = Tone.Transport.PPQ;
const barLengthTicks = Tone.Transport.PPQ * 4;
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
  events: ["C3", "E3", "G3"].map((note) => ({
    note,
    velocity: 0.88,
    tick: 0,
    durationTicks: barLengthTicks
  })),
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
    clearPlayhead();
  },
  clear() {
    this.events = [];
    updateEventCount();
    renderRoll();
    statusText.textContent = "Pattern cleared.";
  },
  addBar() {
    this.bars += 1;
    totalSteps = this.bars * this.beatsPerBar;
    Tone.Transport.loopEnd = `${this.bars}m`;
    renderBarHeader();
    renderRollHeader();
    renderRoll();
    updateRollColumns();
    statusText.textContent = `Added bar ${this.bars}.`;
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
  addNoteAtStep(note: string, step: number, render = true) {
    const tick = step * beatTicks;
    const alreadyPlaced = this.events.some((event) => event.note === note && tick >= event.tick && tick < event.tick + event.durationTicks);

    if (alreadyPlaced) {
      statusText.textContent = `${note} is already on ${formatStep(step)}.`;
      return;
    }

    const previousEvent = this.events.find((event) => event.note === note && event.tick + event.durationTicks === tick);
    const nextEvent = this.events.find((event) => event.note === note && event.tick === tick + beatTicks);

    if (previousEvent && nextEvent) {
      previousEvent.durationTicks += beatTicks + nextEvent.durationTicks;
      this.events.splice(this.events.indexOf(nextEvent), 1);
    } else if (previousEvent) {
      previousEvent.durationTicks += beatTicks;
    } else if (nextEvent) {
      nextEvent.tick = tick;
      nextEvent.durationTicks += beatTicks;
    } else {
      this.events.push({
        note,
        velocity: 0.88,
        tick,
        durationTicks: beatTicks
      });
    }

    statusText.textContent = `${note} placed on ${formatStep(step)}.`;
    updateEventCount();
    if (render) {
      renderRoll();
    } else {
      updateRollRow(note);
    }
  },
  hasHeldNoteAtStep(note: string, step: number) {
    const tick = step * beatTicks;

    return this.events.some((event) => {
      return event.note === note && tick > event.tick && tick < event.tick + event.durationTicks;
    });
  },
  splitNoteAtStep(note: string, step: number) {
    const tick = step * beatTicks;
    const event = this.events.find((item) => item.note === note && tick > item.tick && tick < item.tick + item.durationTicks);

    if (!event) {
      this.addNoteAtStep(note, step);
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
    statusText.textContent = `${note} retriggers on ${formatStep(step)}.`;
    updateEventCount();
    renderRoll();
  },
  removeNoteAtStep(note: string, step: number, render = true) {
    const tick = step * beatTicks;
    const existingIndex = this.events.findIndex((event) => event.note === note && tick >= event.tick && tick < event.tick + event.durationTicks);

    if (existingIndex < 0) {
      statusText.textContent = `${note} is not on ${formatStep(step)}.`;
      return;
    }

    const event = this.events[existingIndex];
    const eventEndTick = event.tick + event.durationTicks;

    if (event.durationTicks === beatTicks) {
      this.events.splice(existingIndex, 1);
    } else if (tick === event.tick) {
      event.tick += beatTicks;
      event.durationTicks -= beatTicks;
    } else if (tick + beatTicks === eventEndTick) {
      event.durationTicks -= beatTicks;
    } else {
      const rightDurationTicks = eventEndTick - (tick + beatTicks);

      event.durationTicks = tick - event.tick;
      this.events.push({
        note,
        velocity: event.velocity,
        tick: tick + beatTicks,
        durationTicks: rightDurationTicks
      });
    }

    statusText.textContent = `${note} removed from ${formatStep(step)}.`;
    updateEventCount();
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
  const dueEvents = looper.events
    .filter((event) => event.tick === step * beatTicks)
    .sort((left, right) => Tone.Frequency(left.note).toMidi() - Tone.Frequency(right.note).toMidi());

  dueEvents.forEach((event, index) => {
    const rollOffset = looper.rolledSteps.has(step) ? index * 0.035 : 0;
    piano.triggerAttackRelease(event.note, ticksToSeconds(event.durationTicks), time + rollOffset, event.velocity);
  });
}, "4n");

renderBarHeader();
renderRollHeader();

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
  looper.splitNoteAtStep(target.dataset.note ?? "C4", Number(target.dataset.step));
});

rollHeader.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-step]");

  if (!target) {
    return;
  }

  looper.toggleRollStep(Number(target.dataset.step));
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
    const step = Number(target.dataset.step);

    if (looper.hasHeldNoteAtStep(note, step)) {
      event.preventDefault();
      window.clearTimeout(previewClickTimer);
      suppressNextDoubleClick = true;
      looper.splitNoteAtStep(note, step);
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

addBarButton.addEventListener("click", () => {
  looper.addBar();
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

function getRollCell(target: EventTarget | null): HTMLButtonElement | null {
  return (target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-note][data-step]") ?? null;
}

function getCellId(target: HTMLButtonElement): string {
  return `${target.dataset.note ?? "C4"}:${target.dataset.step ?? "0"}`;
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
  const step = Number(target.dataset.step);
  const cellId = `${note}:${step}`;

  if (draggedCells.has(cellId)) {
    return;
  }

  draggedCells.add(cellId);

  if (dragMode === "add") {
    looper.addNoteAtStep(note, step, false);
    return;
  }

  looper.removeNoteAtStep(note, step, false);
}

function updateRollRow(note: string): void {
  rollGrid.querySelectorAll<HTMLButtonElement>(`.roll-cell[data-note="${CSS.escape(note)}"]`).forEach((cell) => {
    const step = Number(cell.dataset.step);
    const stepTick = step * beatTicks;
    const activeEvent = looper.events.find((event) => {
      return event.note === note && stepTick >= event.tick && stepTick < event.tick + event.durationTicks;
    });
    const isActive = Boolean(activeEvent);
    const isStart = activeEvent?.tick === stepTick;

    cell.classList.toggle("is-active", isActive);
    cell.classList.toggle("is-note-start", Boolean(isStart));
    cell.classList.toggle("is-note-hold", isActive && !isStart);
    cell.setAttribute("aria-pressed", String(isActive));
  });
}

function getCurrentStep(): number {
  return Math.floor((Tone.Transport.ticks % getLoopLengthTicks()) / beatTicks) % totalSteps;
}

function getLoopLengthTicks(): number {
  return totalSteps * beatTicks;
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
  const currentStep = getCurrentStep();

  document.querySelectorAll<HTMLElement>("[data-step]").forEach((cell) => {
    cell.classList.toggle("is-current-step", Number(cell.dataset.step) === currentStep);
  });

  if (looper.isPlaying) {
    progressAnimationId = requestAnimationFrame(renderProgress);
  }
}

function clearPlayhead(): void {
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((cell) => {
    cell.classList.remove("is-current-step");
  });
}

function renderRollHeader(): void {
  rollHeader.innerHTML = `
    <div class="roll-corner">Note</div>
    ${Array.from({ length: totalSteps }, (_, step) => {
      const beat = (step % looper.beatsPerBar) + 1;
      const rollLabel = looper.rolledSteps.has(step) ? " roll" : "";
      return `<button class="roll-heading ${looper.rolledSteps.has(step) ? "is-rolled" : ""} ${isBarStart(step) ? "is-bar-start" : ""}" type="button" data-step="${step}" aria-label="${formatStep(step)}${rollLabel}">${beat}</button>`;
    }).join("")}
  `;
}

function renderBarHeader(): void {
  barHeader.innerHTML = `
    <div class="roll-corner"></div>
    ${Array.from({ length: looper.bars }, (_, index) => {
      return `<button class="bar-heading" type="button" data-bar-index="${index}">Bar ${index + 1}</button>`;
    }).join("")}
  `;
}

function renderRoll(): void {
  rollGrid.innerHTML = pianoRollNotes
    .map((note) => {
      const rowCells = Array.from({ length: totalSteps }, (_, step) => {
        const stepTick = step * beatTicks;
        const activeEvent = looper.events.find((event) => {
          return event.note === note && stepTick >= event.tick && stepTick < event.tick + event.durationTicks;
        });
        const isActive = Boolean(activeEvent);
        const isStart = activeEvent?.tick === stepTick;

        return `
          <button
            class="roll-cell ${isActive ? "is-active" : ""} ${isStart ? "is-note-start" : ""} ${isActive && !isStart ? "is-note-hold" : ""} ${isBarStart(step) ? "is-bar-start" : ""} ${isOctaveStart(note) ? "is-octave-start" : ""} ${isBlackKey(note) ? "is-black-key" : ""}"
            type="button"
            aria-pressed="${isActive}"
            aria-label="${note}, ${formatStep(step)}"
            data-note="${note}"
            data-step="${step}"
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
  const columns = `minmax(70px, 88px) repeat(${totalSteps}, minmax(42px, 1fr))`;
  const barColumns = `minmax(70px, 88px) repeat(${looper.bars}, minmax(168px, 4fr))`;
  const minWidth = `${88 + totalSteps * 42}px`;

  barHeader.style.gridTemplateColumns = barColumns;
  barHeader.style.minWidth = minWidth;
  rollHeader.style.gridTemplateColumns = columns;
  rollHeader.style.minWidth = minWidth;
  rollGrid.style.gridTemplateColumns = columns;
  rollGrid.style.minWidth = minWidth;
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

  looper.addNoteAtStep(note, getCurrentStep());
}
