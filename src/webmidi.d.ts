interface MIDIMessageEvent extends Event {
  data: Uint8Array;
}

interface MIDIInput extends EventTarget {
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
}

interface MIDIAccess {
  inputs: Map<string, MIDIInput>;
}

interface Navigator {
  requestMIDIAccess?: () => Promise<MIDIAccess>;
}
