import { Chord, Note, Scale, note, transpose } from "bg-tonal";
import * as Tone from "bg-tone";

const appState = {
  isAudioStarted: false,
  root: "C",
  scaleType: "major",
  synth: null,
  modifiers: {
    dominant: false,   // 'd' key
    minor: false,      // '-' key
    diminished: false, // 'o' key
    majorSixth: false, // 's' key
    augmented: false,   // '+' key
    majorSeventh: false, // '9' or 'm' key
    halfDiminished: false, // 'c' or 'Backspace'
    major: false, // 'Enter'
    minorSeventh: false, // 's' key
    minorSix: false // 'x' key
  },
  lastVoicing: null,
  activeVoicings: {},
  thereminSynth: null,
  physicalModifiers: new Set(), // Keys physically held down
  modReleaseTimeout: null,
  pendingChordStarts: {},
  voiceLeadingEnabled: true,
  mobileThereminEnabled: false,
  keyChangeKPending: false  // k + number/0/-/+ to change key
};

// modifier keys
const majorModifiers = ["q", "Q", "Enter"];
const minorModifiers = ["w", "W", "-"];
const dominantModifiers = ["e", "E", "/"];

const minorSeventhModifiers = ["s", "S", "Backspace"];
const majorSeventhModifiers = ["a", "A", "9"];
const diminishedModifiers = ["d", "D", "*"];

const augmentedModifiers = ["v", "V", "+"];
const halfDiminishedModifiers = ["c", "C", "Escape", "NumLock", "Tab"];

const rootShiftDownModifiers = ["f", "F", "0"];
const rootShiftUpModifiers = ["r", "R", "."];
const majorSixthModifiers = ["z", "Z", "8"];
const minorSixModifiers = ["x", "X"];

const KEY_ORDER = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Tonnetz: (fifth, third) -> chroma. Pitch at (f,t) = (7*f + 4*t) mod 12.
function tonnetzChroma(f, t) {
  return ((7 * f + 4 * t) % 12 + 12) % 12;
}
function chromaToNoteName(chroma) {
  return KEY_ORDER[chroma];
}

// Theremin Constants
const THEREMIN_MIN_FREQ = 130.81; // C3
const THEREMIN_MAX_FREQ = 1046.50; // C6
const THEREMIN_SEMITONES = 36; // 3 Octaves

// Varied Tints for Keys 1-7 (Spectrum)
const CHORD_TINTS = [
  "#d62828", // 1: Red
  "#f77f00", // 2: Orange
  "#fcbf49", // 3: Yellow
  "#206a5d", // 4: Green
  "#003049", // 5: Navy/Blue
  "#5e60ce", // 6: Indigo
  "#bc4749"  // 7: Rose/Pink
];
const chordTint = document.getElementById("chord-tint");

// Background Effect
const bgEffect = document.getElementById("background-fx");
let isBgFlipped = false;

// Helper: Toggle Background Effect
function toggleBgEffect(isActive) {
  if (!bgEffect) return;

  if (isActive) {
    // Randomly select image
    const bgImages = ['howl.gif', 'ghost.gif', 'owlman.gif', 'whale.gif'];
    const randomImage = bgImages[Math.floor(Math.random() * bgImages.length)];

    // RESTART ANIMATION HACK
    // Toggle background-image to 'none' and back to force restart
    bgEffect.style.backgroundImage = 'none';
    void bgEffect.offsetWidth; // Force Reflow
    bgEffect.style.backgroundImage = `url('images/${randomImage}')`;

    bgEffect.classList.add("active");
    // Flip on new attack
    isBgFlipped = !isBgFlipped;
    if (isBgFlipped) {
      bgEffect.classList.add("flipped");
    } else {
      bgEffect.classList.remove("flipped");
    }
  } else {
    bgEffect.classList.remove("active");
  }
}

// Initialize Synth
function initAudio() {
  if (appState.isAudioStarted) return;

  appState.synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    volume: -10,
    envelope: {
      attack: 0.02,
      decay: 0.1,
      sustain: 0.3,
      release: 1
    }
  }).toDestination();

  // Add some reverb for nicer sound
  const reverb = new Tone.Reverb(1.5).toDestination();
  appState.synth.connect(reverb);

  // Initialize Theremin Synth (MonoSynth with visual portamento)
  appState.thereminSynth = new Tone.MonoSynth({
    volume: 1,
    oscillator: { type: "sine" },
    envelope: { attack: 0.1, max: 0.5 },
    portamento: 0.05 // Glide amount
  }).connect(reverb);

  console.log("Audio Initialized");

  // Handle Motion Permission for iOS 13+
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(permission => {
        if (permission === 'granted') {
          console.log("Motion permission granted");
        } else {
          console.warn("Motion permission denied");
        }
      })
      .catch(err => {
        console.error("Error requesting motion permission during initAudio:", err);
      });
  }

  appState.isAudioStarted = true;
  updateInteractionState();
  document.getElementById("start-audio").style.display = 'none';
  document.getElementById("chord-info-container").style.display = 'block';
  Tone.start();
}

// Helper to map quality to display string
function getQualityName(qualitySymbol, baseName) {
  if (!qualitySymbol) return baseName;

  // Map Tonal/Internal symbols to Helper text
  switch (qualitySymbol) {
    case "7": return "Dominant 7th";
    case "m": return "Minor Triad";
    case "dim7": return "Diminished 7th";
    case "6": return "Major 6th";
    case "7#5": return "Aug 7";
    case "maj7": return "Maj 7";
    case "m7b5": return "m7b5";
    case "m7": return "Min 7";
    case "m6": return "Minor 6th";
    case "M": return "Major";
    default: return baseName; // Fallback
  }
}

// Theory Logic
function getScaleChords(root, scaleType) {
  // Get scale notes:
  const scale = Scale.get(`${root} ${scaleType}`);
  const notes = scale.notes;

  // We only need the note names now, voicing is handled later
  const chords = notes.map((rootNote, index) => {
    // Build a triad from 1, 3, 5 relative to this root within the scale
    // Indices in 'notes': i, i+2, i+4
    // Wrap around logic for indices
    const indices = [0, 2, 4].map(interval => (index + interval) % 7);
    const chordNotes = indices.map(i => notes[i]);

    // Detect chord name
    const detected = Chord.detect(chordNotes);
    let name = detected.length > 0 ? detected[0] : "";

    // Custom Diatonic Naming (ignoring Tonal's complex output)
    let displayName = name;
    // Major scale degrees: 1(Maj), 2(min), 3(min), 4(Maj), 5(Maj), 6(min), 7(dim)
    // We can infer from the intervals or just hardcode for Major scale for now?
    // Let's use Tonal's detection to check "m", "dim", etc in the detected name
    // Or just look at intervals.
    // Triads: [1P, 3M, 5P] -> Major, [1P, 3m, 5P] -> Minor, [1P, 3m, 5d] -> Dim

    // Simple Heuristic for Diatonic Triads
    const rootN = Note.get(chordNotes[0]);
    const thirdN = Note.get(chordNotes[1]);
    const fifthN = Note.get(chordNotes[2]);
    const thirdInt = Note.distance(chordNotes[0], chordNotes[1]); // e.g. "3M" or "3m"
    const fifthInt = Note.distance(chordNotes[0], chordNotes[2]); // e.g. "5P" or "5d"

    if (thirdInt === "3M" && fifthInt === "5P") displayName = "Major Triad";
    else if (thirdInt === "3m" && fifthInt === "5P") displayName = "Minor Triad";
    else if (thirdInt === "3m" && fifthInt === "5d") displayName = "Diminished Triad"; // Instruction for 'vii' (7) key usually implies Dim.

    // Construct full display name e.g. "C Major Triad"
    displayName = `${rootNote} ${displayName}`;

    return {
      degree: index + 1,
      root: rootNote,
      notes: chordNotes,
      // playNotes will be calculated dynamically for voice leading
      name: name,
      displayName: displayName,
      type: "diatonic"
    };
  });

  return chords;
}

function getChordWithModifiers(degreeIndex, baseChord) {
  // 1-based degree:
  const degree = degreeIndex + 1;

  // 1. Calculate Effective Root (Handle Transposition)
  let effectiveRoot = baseChord.root;
  let interval = null;

  if (appState.modifiers.rootShiftDown) interval = "-2m"; // Down minor second (semitone)
  else if (appState.modifiers.rootShiftUp) interval = "2m"; // Up minor second

  if (interval) {
    effectiveRoot = transpose(baseChord.root, interval);
  }

  // 2. Determine Quality Overrides
  let quality = null;

  // Logic:
  // Minor + Dominant -> m7
  if (appState.modifiers.minor && appState.modifiers.dominant) quality = "m7";
  // Minor + Major 6th -> m6
  else if (appState.modifiers.minor && appState.modifiers.majorSixth) quality = "m6";
  // Dominant -> 7 (Dominant 7th)
  else if (appState.modifiers.dominant) quality = "7";
  // Minor -> m (Minor Triad)
  else if (appState.modifiers.minor) quality = "m";
  // Diminished -> dim7 (Diminished 7th)
  else if (appState.modifiers.diminished) quality = "dim7";
  // Major 6th -> 6
  else if (appState.modifiers.majorSixth) quality = "6";
  // Augmented -> 7#5 (Augmented 7th)
  else if (appState.modifiers.augmented) quality = "7#5";
  // Major 7th -> maj7
  else if (appState.modifiers.majorSeventh) quality = "maj7";
  // Half-Diminished -> m7b5
  else if (appState.modifiers.halfDiminished) quality = "m7b5";
  // Minor 7th -> m7
  else if (appState.modifiers.minorSeventh) quality = "m7";
  // Minor 6th -> m6
  else if (appState.modifiers.minorSix) quality = "m6";
  // Major Triad -> M
  else if (appState.modifiers.major) quality = "M";

  // 3. Construct New Chord
  // Case A: Quality Override exists -> Generate completely new chord from effectiveRoot
  // 3. Construct New Chord
  // Case A: Quality Override exists -> Generate completely new chord from effectiveRoot
  if (quality) {
    const newChord = Chord.get(`${effectiveRoot}${quality}`);
    const displayQual = getQualityName(quality, "");

    return {
      ...baseChord,
      root: effectiveRoot,
      notes: newChord.notes,
      name: newChord.name,
      displayName: `${effectiveRoot} ${displayQual}`,
      type: "override"
    };
  }

  // Case B: No Quality Override, but Root Override exists -> Transpose existing chord notes
  if (interval) {
    const newNotes = baseChord.notes.map(n => transpose(n, interval));
    const detected = Chord.detect(newNotes);
    const name = detected.length > 0 ? detected[0] : "";

    // Preserve the original diatonic quality name but with new root
    // baseChord.displayName format is "Root Quality blah"
    // We need to swap the root.
    const parts = baseChord.displayName.split(" ");
    parts[0] = effectiveRoot;
    const newDisplay = parts.join(" ");

    return {
      ...baseChord,
      root: effectiveRoot,
      notes: newNotes,
      name: name,
      displayName: newDisplay,
      type: "transposed"
    };
  }

  // Case C: No changes
  return baseChord;
}

// Helper: Update Tint (disabled – background no longer changes when playing)
function updateTint(degreeIndex) {
  if (!chordTint) return;
  chordTint.classList.remove("active");
}

// Start Chord (Attack)
function startChord(degreeIndex) {
  if (!appState.isAudioStarted) return;

  // Apply Sepia Tint
  updateTint(degreeIndex);

  const chords = getScaleChords(appState.root, appState.scaleType);
  let chord = chords[degreeIndex]; // degreeIndex is 0-6
  if (!chord) return;

  // Apply Modifiers
  chord = getChordWithModifiers(degreeIndex, chord);

  // Calculate new notes for the chord
  const targetNotes = chord.notes;
  let nextVoicingNotes;

  if (appState.voiceLeadingEnabled) {
    if (!appState.lastVoicing) {
      appState.lastVoicing = targetNotes.map(n => n + "4");
    }
    let options = generateVoicingOptions(targetNotes, ["3", "4"]);
    const limitMidi = note("C5").midi;
    const validOptions = options.filter(opt => opt.every(n => note(n).midi <= limitMidi));
    const candidates = validOptions.length > 0 ? validOptions : options;
    nextVoicingNotes = getBestVoicing(appState.lastVoicing, candidates);
    appState.lastVoicing = nextVoicingNotes;
  } else {
    nextVoicingNotes = [];
    let currentOctave = 4;
    let prevMidi = -1;
    targetNotes.forEach((n, idx) => {
      let candidateName = n + currentOctave;
      let candidateMidi = note(candidateName).midi;
      if (idx > 0 && candidateMidi <= prevMidi) {
        currentOctave++;
        candidateName = n + currentOctave;
        candidateMidi = note(candidateName).midi;
      }
      nextVoicingNotes.push(candidateName);
      prevMidi = candidateMidi;
    });
    appState.lastVoicing = nextVoicingNotes;
  }

  // Add Bass Note
  const notesObjs = nextVoicingNotes.map(n => note(n));
  notesObjs.sort((a, b) => a.midi - b.midi);
  const lowestOctave = notesObjs[0].oct;
  const bassNote = chord.root + (lowestOctave - 1);
  const fullVoicing = [...nextVoicingNotes, bassNote];
  const simpleVoicing = fullVoicing.map(n => Note.simplify(n));

  // NOTE DIFFING: Only change what's necessary
  const currentVoicing = appState.activeVoicings[degreeIndex] || [];

  // Find notes to release (in current but not in new)
  const toRelease = currentVoicing.filter(n => !simpleVoicing.includes(n));
  // Find notes to attack (in new but not in current)
  const toAttack = simpleVoicing.filter(n => !currentVoicing.includes(n));

  if (toRelease.length > 0) {
    appState.synth.triggerRelease(toRelease);
  }
  if (toAttack.length > 0) {
    appState.synth.triggerAttack(toAttack);
  }

  // Store acting voicing
  appState.activeVoicings[degreeIndex] = simpleVoicing;

  // UI Update
  updateDisplay(chord, simpleVoicing);
  const keyEl = document.querySelector(`.key[data-note="${degreeIndex + 1}"]`);
  if (keyEl) keyEl.classList.add("active");
  const npBtn = document.querySelector(`.np-btn[data-note="${degreeIndex + 1}"]`);
  if (npBtn) npBtn.classList.add("active");
}

// Stop Chord (Release)
function stopChord(degreeIndex) {
  if (!appState.isAudioStarted) return;

  const notes = appState.activeVoicings[degreeIndex];
  if (notes) {
    // Only release notes not still needed by another held chord (e.g. 7→6 while holding modifier)
    const otherDegrees = Object.keys(appState.activeVoicings).filter(k => parseInt(k, 10) !== degreeIndex);
    const notesStillNeeded = new Set();
    otherDegrees.forEach(k => {
      (appState.activeVoicings[k] || []).forEach(n => notesStillNeeded.add(n));
    });
    const toRelease = notes.filter(n => !notesStillNeeded.has(n));
    if (toRelease.length > 0) appState.synth.triggerRelease(toRelease);
    delete appState.activeVoicings[degreeIndex];

    // Check if any chords left active
    if (Object.keys(appState.activeVoicings).length === 0) {
      updateTint(null); // Fade out
      document.getElementById("current-chord").innerText = "—";
      document.getElementById("notes-display").innerHTML = "";
    }

    const keyEl = document.querySelector(`.key[data-note="${degreeIndex + 1}"]`);
    if (keyEl) keyEl.classList.remove("active");
    const npBtn = document.querySelector(`.np-btn[data-note="${degreeIndex + 1}"]`);
    if (npBtn) npBtn.classList.remove("active");
  }
}

const TONNETZ_VOICING_KEY = "tonnetz";

function playTriadFromTonnetz(rootName, isMinor) {
  if (!appState.isAudioStarted) return;
  const quality = isMinor ? "m" : "";
  const chordObj = Chord.get(`${rootName}${quality}`);
  const baseChord = {
    root: rootName,
    notes: chordObj.notes,
    name: chordObj.name,
    displayName: `${rootName} ${isMinor ? "Minor" : "Major"}`
  };
  let chord = getChordWithModifiers(0, baseChord);
  const targetNotes = chord.notes;
  let nextVoicingNotes;
  if (appState.voiceLeadingEnabled && appState.lastVoicing) {
    const options = generateVoicingOptions(targetNotes, ["3", "4"]);
    const limitMidi = note("C5").midi;
    const validOptions = options.filter(opt => opt.every(n => note(n).midi <= limitMidi));
    const candidates = validOptions.length > 0 ? validOptions : options;
    nextVoicingNotes = getBestVoicing(appState.lastVoicing, candidates);
  } else {
    nextVoicingNotes = [];
    let currentOctave = 4;
    let prevMidi = -1;
    targetNotes.forEach((n, idx) => {
      let candidateName = n + currentOctave;
      let candidateMidi = note(candidateName).midi;
      if (idx > 0 && candidateMidi <= prevMidi) {
        currentOctave++;
        candidateName = n + currentOctave;
        candidateMidi = note(candidateName).midi;
      }
      nextVoicingNotes.push(candidateName);
      prevMidi = candidateMidi;
    });
  }
  appState.lastVoicing = nextVoicingNotes;
  const notesObjs = nextVoicingNotes.map(n => note(n));
  notesObjs.sort((a, b) => a.midi - b.midi);
  const lowestOctave = notesObjs[0].oct;
  const bassNote = chord.root + (lowestOctave - 1);
  const fullVoicing = [...nextVoicingNotes, bassNote];
  const simpleVoicing = fullVoicing.map(n => Note.simplify(n));
  const currentVoicing = appState.activeVoicings[TONNETZ_VOICING_KEY] || [];
  const toRelease = currentVoicing.filter(n => !simpleVoicing.includes(n));
  const toAttack = simpleVoicing.filter(n => !currentVoicing.includes(n));
  if (toRelease.length > 0) appState.synth.triggerRelease(toRelease);
  if (toAttack.length > 0) appState.synth.triggerAttack(toAttack);
  appState.activeVoicings[TONNETZ_VOICING_KEY] = simpleVoicing;
  updateTint(0);
  updateDisplay(chord, simpleVoicing);
}

function stopTonnetzChord() {
  if (!appState.isAudioStarted) return;
  const notes = appState.activeVoicings[TONNETZ_VOICING_KEY];
  if (notes) {
    appState.synth.triggerRelease(notes);
    delete appState.activeVoicings[TONNETZ_VOICING_KEY];
    if (Object.keys(appState.activeVoicings).length === 0) {
      updateTint(null);
      document.getElementById("current-chord").innerText = "—";
      document.getElementById("notes-display").innerHTML = "";
    }
  }
}

function generateVoicingOptions(notes, octaves) {
  // Generate closed voicings for these notes in given octaves
  // notes: ["C", "E", "G"]

  let options = [];

  // For each inversion (0, 1, 2...)
  // Inversion 0: C E G
  // Inversion 1: E G C
  // Inversion 2: G C E

  const inversions = [];
  const len = notes.length;
  for (let i = 0; i < len; i++) {
    const inv = [];
    for (let j = 0; j < len; j++) {
      inv.push(notes[(i + j) % len]);
    }
    inversions.push(inv);
  }

  // For each octave, and each inversion, assign octaves to make it valid (ascending)
  // e.g. Inversion E G C. If base is E3, G3, C4.
  octaves.forEach(baseOctave => {
    inversions.forEach(invNotes => {
      // Build absolute notes
      let currentOctave = parseInt(baseOctave);
      let voicing = [];
      let lastChroma = -1;

      // We need a reference 'C' to know when we wrapped?
      // Tonal Strategy:
      // Just assign `currentOctave` to first note.
      // For subsequent notes, if chroma < prev chroma, increment octave.

      invNotes.forEach((n, idx) => {
        const nObj = note(n);
        if (idx > 0) {
          const prevNObj = note(invNotes[idx - 1]);
          if (nObj.chroma < prevNObj.chroma) {
            // Check strictly wrapping?
            // Yes, E(4) -> G(7) -> C(0). 0 < 7, so C must be next octave.
            currentOctave++;
          }
        }
        voicing.push(n + currentOctave);
      });
      options.push(voicing);
    });
  });

  return options;
}

function getBestVoicing(lastVoicing, options) {
  // Minimize total semi-tone distance
  // We assume same number of notes for now?
  // If number of notes differs (Triad vs 7th), we match as best we can.
  // Logic: Pad or truncate? Or just compare first N?
  // Let's compare all against all? No, voice-to-voice.
  // Sort voicings by pitch? They are already sorted pitch-wise.

  let best = options[0];
  let minDiff = Infinity;

  // Helper to get MIDI
  const getMidi = (n) => note(n).midi;

  const lastMidi = lastVoicing.map(getMidi);

  options.forEach(opt => {
    const currentMidi = opt.map(getMidi);

    // Calculate distance
    // If sizes differ:
    // Size 3 -> 4: (C E G) -> (C E G Bb). C->C, E->E, G->G, G->Bb?
    // Let's align by pitch/index.

    let diff = 0;
    const maxLen = Math.max(lastMidi.length, currentMidi.length);

    for (let i = 0; i < maxLen; i++) {
      const v1 = lastMidi[i % lastMidi.length];
      const v2 = currentMidi[i % currentMidi.length];
      diff += Math.abs(v2 - v1);
    }

    if (diff < minDiff) {
      minDiff = diff;
      best = opt;
    }
  });

  return best;
}

function updateDisplay(chord, voicing) {
  document.getElementById("current-chord").innerText = chord.displayName || chord.name || chord.notes[0];
  // Show played notes
  document.getElementById("notes-display").innerText = voicing.join(" - ");
}

// Update Active Chords (Hot-Swap / Transitions)
function updateActiveChords() {
  if (!appState.isAudioStarted) return;
  // Iterate over all active keys and refresh them
  Object.keys(appState.activeVoicings).forEach(key => {
    const degree = parseInt(key);
    startChord(degree); // startChord now handles note diffing internally
  });
}

function changeGlobalKey(direction) {
  const currentKey = appState.root;
  let index = KEY_ORDER.indexOf(currentKey);
  if (index === -1) index = 0; // Fallback

  let newIndex = (index + direction) % KEY_ORDER.length;
  if (newIndex < 0) newIndex = KEY_ORDER.length + newIndex;

  const newKey = KEY_ORDER[newIndex];
  appState.root = newKey;

  // Update UI
  document.getElementById("root-note").value = newKey;

  // Update any active chords to new key
  updateActiveChords();
  initThereminScale(); // Update Theremin grid on hotkey change
}

// Helper for UI updates
function updateModifierUI(modName, isActive) {
  const badgeEl = document.getElementById(`mod-${modName}`);
  if (badgeEl) isActive ? badgeEl.classList.add("active") : badgeEl.classList.remove("active");

  const npBtn = document.getElementById(`np-${modName}`);
  if (npBtn) isActive ? npBtn.classList.add("active") : npBtn.classList.remove("active");
}

// Set Modifier State (for Mouse/Keyboard)
function setModifier(modName, isActive) {
  const transModNames = ["rootShiftUp", "rootShiftDown"];
  const isTransMod = transModNames.includes(modName);

  if (isActive) {
    appState.modifiers[modName] = true;
    appState.physicalModifiers.add(modName);
    updateModifierUI(modName, true);

    // GROUP EXCLUSIVITY:
    Object.keys(appState.modifiers).forEach(m => {
      if (m === modName) return;

      const isM7Combo = (modName === "minor" && m === "dominant") || (modName === "dominant" && m === "minor");
      const isM6Combo = (modName === "minor" && m === "majorSixth") || (modName === "majorSixth" && m === "minor");
      const mIsTrans = transModNames.includes(m);

      if (isTransMod) {
        // If we pressed a Trans Mod, only clear other Trans Mods
        if (mIsTrans) {
          appState.modifiers[m] = false;
          updateModifierUI(m, false);
        }
      } else {
        // If we pressed a Quality Mod, clear other Quality Mods (except special combos)
        if (!mIsTrans && !isM7Combo && !isM6Combo) {
          appState.modifiers[m] = false;
          updateModifierUI(m, false);
        }
      }
    });

    if (appState.modReleaseTimeout) {
      clearTimeout(appState.modReleaseTimeout);
      appState.modReleaseTimeout = null;
    }
  } else {
    appState.physicalModifiers.delete(modName);

    if (appState.modReleaseTimeout) clearTimeout(appState.modReleaseTimeout);

    appState.modReleaseTimeout = setTimeout(() => {
      if (!appState.physicalModifiers.has(modName)) {
        appState.modifiers[modName] = false;
        updateModifierUI(modName, false);
      }

      if (appState.physicalModifiers.size === 0) {
        Object.keys(appState.modifiers).forEach(m => {
          appState.modifiers[m] = false;
          updateModifierUI(m, false);
        });
      }
      updateActiveChords();
      appState.modReleaseTimeout = null;
    }, 150);
  }

  updateActiveChords();
}

// Event Listeners
document.getElementById("start-audio").addEventListener("click", () => {
  initAudio();
});

// Help Modal Logic
const helpModal = document.getElementById("help-modal");
const helpBtn = document.getElementById("help-btn");
const closeModalBtn = document.getElementById("close-modal");

helpBtn.addEventListener("click", () => {
  helpModal.style.display = "flex";
  helpBtn.blur();
});

closeModalBtn.addEventListener("click", () => {
  helpModal.style.display = "none";
});

// Close when clicking outside content
helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) {
    helpModal.style.display = "none";
  }
});


document.getElementById("root-note").addEventListener("change", (e) => {
  appState.root = e.target.value;
  initThereminScale(); // Update Theremin grid to new key
  e.target.blur(); // Remove focus to prevent keyboard capturing
});

document.getElementById("voice-leading-btn").addEventListener("click", (e) => {
  appState.voiceLeadingEnabled = !appState.voiceLeadingEnabled;
  e.target.classList.toggle("active", appState.voiceLeadingEnabled);
  e.target.innerText = `Voice Leading: ${appState.voiceLeadingEnabled ? "ON" : "OFF"}`;
  e.target.blur();
});

const LAYOUTS = ["tonnetz", "qwerty", "numpad"];
let currentLayoutIndex = 0;

function updateLayoutUI(layoutName) {
  const tonnetzInterface = document.getElementById("tonnetz-interface");
  const defaultInterface = document.getElementById("default-interface");
  const numpadInterface = document.getElementById("numpad-interface");
  const toggleBtn = document.getElementById("layout-toggle-btn");

  if (layoutName !== "tonnetz") {
    stopTonnetzChord();
    tonnetzHeldRows = [];
    tonnetzHeldCols = [];
    tonnetzLockedRow = null;
    tonnetzLockedCol = null;
    tonnetzShiftLayerActive = false;
    tonnetzShiftLocked = false;
    updateTonnetzShiftUI(false, false);
    document.querySelectorAll(".tonnetz-cell.active").forEach(c => c.classList.remove("active"));
    updateTonnetzLabelStyles();
  }

  const show = (el, on) => {
    if (el) el.style.display = on ? "block" : "none";
  };
  show(tonnetzInterface, layoutName === "tonnetz");
  show(defaultInterface, layoutName === "qwerty");
  show(numpadInterface, layoutName === "numpad");

  if (toggleBtn) {
    const labels = { tonnetz: "Layout: Tonnetz", qwerty: "Layout: QWERTY", numpad: "Layout: NUMPAD" };
    toggleBtn.innerText = labels[layoutName] || "Layout: Tonnetz";
    toggleBtn.classList.toggle("active", layoutName !== "qwerty");
  }
}

function updateInteractionState() {
  const isStarted = appState.isAudioStarted;
  const selectors = [
    ".key",
    ".mod-key",
    ".np-btn",
    ".tonnetz-cell",
    "#mobile-theremin-btn",
    "#layout-toggle-btn",
    "#voice-leading-btn",
    "#root-note"
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (isStarted) {
        el.classList.remove("disabled-interaction");
      } else {
        el.classList.add("disabled-interaction");
      }
    });
  });
}

document.getElementById("layout-toggle-btn").addEventListener("click", (e) => {
  currentLayoutIndex = (currentLayoutIndex + 1) % LAYOUTS.length;
  updateLayoutUI(LAYOUTS[currentLayoutIndex]);
  e.target.blur();
});

// k + number: 1=C, 2=Db, 3=D, 4=Eb, 5=E, 6=F, 7=Gb, 8=G, 9=Ab, 0=A, -=Bb, +=B
const KEY_CHANGE_COMBO_MAP = {
  "1": 0,
  "2": 1,
  "3": 2,
  "4": 3,
  "5": 4,
  "6": 5,
  "7": 6,
  "8": 7,
  "9": 8,
  "0": 9,
  "-": 10,
  "+": 11,
  // for good measure -if caps is on by accident
  "_": 10,
  "=": 11
};

// -------------------------------------------------------------------
// Tonnetz Board
// -------------------------------------------------------------------
const TONNETZ_F_MIN = -2;
const TONNETZ_F_MAX = 5;
const TONNETZ_T_MIN = -1;
const TONNETZ_T_MAX = 4;
const TONNETZ_UNIT = 42;
const TONNETZ_LABEL_LEFT = 28;
const TONNETZ_LABEL_TOP = 24;
// Push triangles and row labels down so they clear the column number row (1–8)
// This needs to be added back to the whole conatiner so the thermain note is still accurate
const TONNETZ_CONTENT_OFFSET_Y = 30;

const TONNETZ_X_OFF = (-TONNETZ_F_MIN + -0.5 * TONNETZ_T_MIN) * TONNETZ_UNIT;

// Row keys (top to bottom): row 0 = t=4, row 5 = t=-1
const TONNETZ_ROW_KEYS = ["q", "w", "e", "r", "t", "y"];
const TONNETZ_COL_COUNT = TONNETZ_F_MAX - TONNETZ_F_MIN + 1; // 8

// Map (f,t) -> { majorCell, minorCell } for keyboard play
let tonnetzCellMap = new Map();

function tonnetzToPx(f, t) {
  const x = (f + 0.5 * t) * TONNETZ_UNIT + TONNETZ_X_OFF + TONNETZ_LABEL_LEFT;
  const y = (TONNETZ_T_MAX - t) * TONNETZ_UNIT + TONNETZ_LABEL_TOP;
  return { x, y };
}

function initTonnetzBoard() {
  const container = document.getElementById("tonnetz-board");
  if (!container) return;

  container.innerHTML = "";
  tonnetzCellMap.clear();

  const contentW = (TONNETZ_F_MAX - TONNETZ_F_MIN + 1.5) * TONNETZ_UNIT + TONNETZ_X_OFF;
  const contentH = (TONNETZ_T_MAX - TONNETZ_T_MIN + 1) * TONNETZ_UNIT;
  const w = contentW + TONNETZ_LABEL_LEFT + 12;
  const h = contentH + TONNETZ_LABEL_TOP + 8;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${Math.ceil(w)} ${Math.ceil(h)}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Column labels (1, 2, 3, ... 8) centered above the top row of triangles (t = TONNETZ_T_MAX)
  const colLabelG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  colLabelG.setAttribute("class", "tonnetz-col-labels");
  const topRowT = TONNETZ_T_MAX;
  for (let i = 0; i < TONNETZ_COL_COUNT; i++) {
    const f = TONNETZ_F_MIN + i;
    const cx = TONNETZ_LABEL_LEFT + (f + 0.5 * topRowT + 0.5) * TONNETZ_UNIT + TONNETZ_X_OFF;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", cx);
    text.setAttribute("y", 4 - TONNETZ_CONTENT_OFFSET_Y);
    text.setAttribute("class", "tonnetz-axis-label tonnetz-col-label");
    text.setAttribute("data-col", String(i + 1));
    text.textContent = String(i + 1);
    colLabelG.appendChild(text);
  }
  svg.appendChild(colLabelG);

  // Row labels (q, w, e, r, t, y) next to the first triangle of each row (leftmost vertex at f = F_MIN)
  const rowLabelG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  rowLabelG.setAttribute("class", "tonnetz-row-labels");
  const rowLabelGap = 20;
  for (let i = 0; i < TONNETZ_ROW_KEYS.length; i++) {
    const t = TONNETZ_T_MAX - i;
    const firstTriangleX = TONNETZ_LABEL_LEFT + (TONNETZ_F_MIN + 0.5 * t) * TONNETZ_UNIT + TONNETZ_X_OFF;
    const cx = firstTriangleX - rowLabelGap;
    const cy = TONNETZ_LABEL_TOP + (TONNETZ_T_MAX - t) * TONNETZ_UNIT - TONNETZ_UNIT / 2;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", cx);
    text.setAttribute("y", cy);
    text.setAttribute("class", "tonnetz-axis-label tonnetz-row-label");
    text.setAttribute("data-row", String(i));
    text.textContent = TONNETZ_ROW_KEYS[i];
    rowLabelG.appendChild(text);
  }
  svg.appendChild(rowLabelG);

  const majorLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  majorLayer.setAttribute("class", "tonnetz-layer-major");
  const minorLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  minorLayer.setAttribute("class", "tonnetz-layer-minor");

  const majorCells = [];
  const minorCells = [];

  for (let t = TONNETZ_T_MIN; t <= TONNETZ_T_MAX; t++) {
    for (let f = TONNETZ_F_MIN; f <= TONNETZ_F_MAX; f++) {
      const rootChroma = tonnetzChroma(f, t);
      const rootName = chromaToNoteName(rootChroma);
      const key = `${f},${t}`;

      const majorV = [
        tonnetzToPx(f, t),
        tonnetzToPx(f, t + 1),
        tonnetzToPx(f + 1, t)
      ];
      const majorPoints = majorV.map(p => `${p.x},${p.y}`).join(" ");
      const majorPoly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      majorPoly.setAttribute("points", majorPoints);
      majorPoly.setAttribute("class", "tonnetz-cell major");
      majorPoly.setAttribute("data-root", rootName);
      majorPoly.setAttribute("data-f", String(f));
      majorPoly.setAttribute("data-t", String(t));
      majorPoly.setAttribute("data-quality", "major");
      majorPoly.setAttribute("aria-label", `${rootName} major`);
      majorCells.push({ el: majorPoly, rootName, isMinor: false, f, t });

      const minorV = [
        tonnetzToPx(f, t),
        tonnetzToPx(f - 1, t + 1),
        tonnetzToPx(f + 1, t)
      ];
      const minorPoints = minorV.map(p => `${p.x},${p.y}`).join(" ");
      const minorPoly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      minorPoly.setAttribute("points", minorPoints);
      minorPoly.setAttribute("class", "tonnetz-cell minor");
      minorPoly.setAttribute("data-root", rootName);
      minorPoly.setAttribute("data-f", String(f));
      minorPoly.setAttribute("data-t", String(t));
      minorPoly.setAttribute("data-quality", "minor");
      minorPoly.setAttribute("aria-label", `${rootName} minor`);
      minorCells.push({ el: minorPoly, rootName, isMinor: true, f, t });

      tonnetzCellMap.set(key, { majorCell: majorPoly, minorCell: minorPoly, rootName });
    }
  }

  majorLayer.append(...majorCells.map(({ el }) => el));
  minorLayer.append(...minorCells.map(({ el }) => el));
  svg.appendChild(majorLayer);
  svg.appendChild(minorLayer);

  const allCells = [...majorCells, ...minorCells];
  allCells.forEach(({ el, rootName, isMinor }) => {
    const start = (e) => {
      e.preventDefault();
      promptForAudioEngine(() => {
        playTriadFromTonnetz(rootName, isMinor);
        document.querySelectorAll(".tonnetz-cell.active").forEach(c => c.classList.remove("active"));
        el.classList.add("active");
      });
    };
    const stop = (e) => {
      e.preventDefault();
      stopTonnetzChord();
      el.classList.remove("active");
    };
    el.addEventListener("mousedown", start);
    el.addEventListener("mouseup", stop);
    el.addEventListener("mouseleave", stop);
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchend", stop, { passive: false });
  });

  container.appendChild(svg);
}

// Tonnetz: play triangle at (f, t); isMinor = true -> minor (green), false -> major (purple)
function playTonnetzAtCoord(f, t, isMinor) {
  const key = `${f},${t}`;
  const rec = tonnetzCellMap.get(key);
  if (!rec) return;
  const el = isMinor ? rec.minorCell : rec.majorCell;
  playTriadFromTonnetz(rec.rootName, isMinor);
  document.querySelectorAll(".tonnetz-cell.active").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
}

// Tonnetz keyboard: chord = last-pressed row + last-pressed col (arrays keep order).
let tonnetzHeldRows = [];
let tonnetzHeldCols = [];
let tonnetzShiftLayerActive = false;
let tonnetzShiftLocked = false;
let lastShiftKeyDown = 0;
let tonnetzLockedRow = null;
let tonnetzLockedCol = null;
const TONNETZ_DOUBLE_PRESS_MS = 400;
let lastTonnetzRowDown = { key: null, time: 0 };
let lastTonnetzColDown = { key: null, time: 0 };

function tonnetzActiveRow() {
  if (tonnetzLockedRow !== null) return tonnetzLockedRow;
  return tonnetzHeldRows.length ? tonnetzHeldRows[tonnetzHeldRows.length - 1] : null;
}
function tonnetzActiveCol() {
  if (tonnetzLockedCol !== null) return tonnetzLockedCol;
  return tonnetzHeldCols.length ? tonnetzHeldCols[tonnetzHeldCols.length - 1] : null;
}
function removeLastFromArray(arr, value) {
  const i = arr.lastIndexOf(value);
  if (i >= 0) arr.splice(i, 1);
}

function isTonnetzLayoutActive() {
  const el = document.getElementById("tonnetz-interface");
  return el && el.style.display !== "none";
}

function updateTonnetzShiftUI(shiftHeld, shiftLocked) {
  const iface = document.getElementById("tonnetz-interface");
  const hint = document.getElementById("tonnetz-shift-hint");
  if (!iface || !hint) return;
  const active = !!shiftHeld || !!shiftLocked;
  iface.classList.toggle("tonnetz-shift-active", !!active);
  iface.classList.toggle("tonnetz-shift-locked", !!shiftLocked);
  // Green (minor) layer stays on top so it takes precedence; purple is only clickable where only purple is visible
  const span = hint.querySelector(".tonnetz-shift-hint-text");
  if (span) {
    if (shiftLocked) {
      span.textContent = "Purple (major) locked. Double-press Shift to unlock.";
    } else {
      span.textContent = shiftHeld
        ? "Purple (major) on top. Release Shift for green (minor)."
        : "Green (minor) on top. Hold Shift for purple (major).";
    }
  }
}

// Re-examine held keys and update sound + active cell. Chord = last-pressed row + last-pressed col.
function applyTonnetzState() {
  if (!isTonnetzLayoutActive()) return;
  document.querySelectorAll(".tonnetz-cell.active").forEach(c => c.classList.remove("active"));
  const activeRow = tonnetzActiveRow();
  const activeCol = tonnetzActiveCol();
  if (activeRow !== null && activeCol !== null && appState.isAudioStarted) {
    const f = (activeCol - 1) + TONNETZ_F_MIN;
    const t = TONNETZ_T_MAX - activeRow;
    const isMinor = !tonnetzShiftLayerActive;
    promptForAudioEngine(() => {
      playTonnetzAtCoord(f, t, isMinor);
    });
  } else {
    stopTonnetzChord();
  }
  updateTonnetzLabelStyles();
}

function updateTonnetzLabelStyles() {
  const board = document.getElementById("tonnetz-board");
  if (!board) return;
  const activeRow = tonnetzActiveRow();
  const activeCol = tonnetzActiveCol();
  board.querySelectorAll(".tonnetz-row-label").forEach(el => {
    const row = parseInt(el.getAttribute("data-row"), 10);
    el.classList.remove("tonnetz-label-playing", "tonnetz-label-locked");
    if (activeRow === row) {
      el.classList.add(tonnetzLockedRow === row ? "tonnetz-label-locked" : "tonnetz-label-playing");
    }
  });
  board.querySelectorAll(".tonnetz-col-label").forEach(el => {
    const col = parseInt(el.getAttribute("data-col"), 10);
    el.classList.remove("tonnetz-label-playing", "tonnetz-label-locked");
    if (activeCol === col) {
      el.classList.add(tonnetzLockedCol === col ? "tonnetz-label-locked" : "tonnetz-label-playing");
    }
  });
}

function getTonnetzRowIndex(key) {
  const k = key.toLowerCase();
  const i = TONNETZ_ROW_KEYS.indexOf(k);
  return i >= 0 ? i : null;
}

function getTonnetzColFromKey(key) {
  const num = parseInt(key, 10);
  if (num >= 1 && num <= TONNETZ_COL_COUNT) return num;
  return null;
}

function setKeyByIndex(index) {
  const root = KEY_ORDER[index];
  if (!root) return;
  appState.root = root;
  document.getElementById("root-note").value = root;
  updateActiveChords();
  initThereminScale();
}

// Keyboard Input
window.addEventListener("keydown", (e) => {
  if (e.repeat) return; // Prevent auto-repeat re-triggering globally

  // Key-change combo: k then 1-9, 0, -, + (cleared on k keyup)
  if (appState.keyChangeKPending) {
    const idx = KEY_CHANGE_COMBO_MAP[e.key];
    if (idx !== undefined) {
      e.preventDefault();
      appState.keyChangeKPending = false;
      setKeyByIndex(idx);
      return;
    }
    appState.keyChangeKPending = false;
  }
  if (e.key === "k" || e.key === "K") {
    appState.keyChangeKPending = true;
    e.preventDefault();
    return;
  }

  // Check if key is one of ours
  const isModifier = dominantModifiers.includes(e.key) ||
    minorModifiers.includes(e.key) ||
    diminishedModifiers.includes(e.key) ||
    majorSixthModifiers.includes(e.key) ||
    augmentedModifiers.includes(e.key) ||
    rootShiftDownModifiers.includes(e.key) ||
    rootShiftUpModifiers.includes(e.key) ||
    majorSeventhModifiers.includes(e.key) ||
    halfDiminishedModifiers.includes(e.key) ||
    minorSeventhModifiers.includes(e.key) ||
    minorSixModifiers.includes(e.key) ||
    majorModifiers.includes(e.key);

  const num = parseInt(e.key);
  const isNoteKey = !isNaN(num) && num >= 1 && num <= 7;

  // Enter to start Audio
  if (e.key === "Enter") {
    // If modal is open, close it? Or just ignore Enter?
    if (helpModal.style.display === "flex") {
      e.preventDefault();
      helpModal.style.display = "none";
      return;
    }

    if (!appState.isAudioStarted) {
      e.preventDefault();
      initAudio();
      return;
    }
  }

  // Escape to close logic
  if (e.key === "Escape" && helpModal.style.display === "flex") {
    helpModal.style.display = "none";
    return;
  }

  // Tonnetz layout: hold Shift = major on top, release = minor. Double-press Shift = lock.
  if (isTonnetzLayoutActive()) {
    if (e.key === "Shift") {
      e.preventDefault();
      const now = Date.now();
      const isDouble = (now - lastShiftKeyDown) < TONNETZ_DOUBLE_PRESS_MS;
      lastShiftKeyDown = now;
      if (isDouble) {
        tonnetzShiftLocked = !tonnetzShiftLocked;
        tonnetzShiftLayerActive = tonnetzShiftLocked;
      } else {
        tonnetzShiftLayerActive = true;
      }
      updateTonnetzShiftUI(tonnetzShiftLayerActive, tonnetzShiftLocked);
      applyTonnetzState();
      return;
    }
    const rowIdx = getTonnetzRowIndex(e.key);
    const colNum = getTonnetzColFromKey(e.key);
    if (rowIdx !== null) {
      e.preventDefault();
      const now = Date.now();
      const isDouble = lastTonnetzRowDown.key === rowIdx && (now - lastTonnetzRowDown.time) < TONNETZ_DOUBLE_PRESS_MS;
      lastTonnetzRowDown = { key: rowIdx, time: now };
      if (isDouble) {
        tonnetzLockedRow = tonnetzLockedRow === rowIdx ? null : rowIdx;
      } else {
        tonnetzHeldRows.push(rowIdx);
      }
      applyTonnetzState();
      return;
    }
    if (colNum !== null) {
      e.preventDefault();
      const now = Date.now();
      const isDouble = lastTonnetzColDown.key === colNum && (now - lastTonnetzColDown.time) < TONNETZ_DOUBLE_PRESS_MS;
      lastTonnetzColDown = { key: colNum, time: now };
      if (isDouble) {
        tonnetzLockedCol = tonnetzLockedCol === colNum ? null : colNum;
      } else {
        tonnetzHeldCols.push(colNum);
      }
      applyTonnetzState();
      return;
    }
  }

  if (isModifier || isNoteKey) {
    e.preventDefault(); // Stop browser scrolling/selecting/focus moving
  }

  let modChanged = false;

  // HIDDEN HOTKEY: Global Key Shift (Enter + +/-)
  if (appState.modifiers.major) {
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      changeGlobalKey(1);
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      changeGlobalKey(-1);
      return;
    }
  }

  // Modifiers tracking
  if (dominantModifiers.includes(e.key)) { setModifier("dominant", true); modChanged = true; }
  if (minorModifiers.includes(e.key)) { setModifier("minor", true); modChanged = true; }
  if (diminishedModifiers.includes(e.key)) { setModifier("diminished", true); modChanged = true; }
  if (majorSixthModifiers.includes(e.key)) { setModifier("majorSixth", true); modChanged = true; }
  if (augmentedModifiers.includes(e.key)) { setModifier("augmented", true); modChanged = true; }
  if (rootShiftDownModifiers.includes(e.key)) { setModifier("rootShiftDown", true); modChanged = true; }
  if (rootShiftUpModifiers.includes(e.key)) { setModifier("rootShiftUp", true); modChanged = true; }
  if (majorSeventhModifiers.includes(e.key)) { setModifier("majorSeventh", true); modChanged = true; }
  if (halfDiminishedModifiers.includes(e.key)) { setModifier("halfDiminished", true); modChanged = true; }
  if (minorSeventhModifiers.includes(e.key)) { setModifier("minorSeventh", true); modChanged = true; }
  if (minorSixModifiers.includes(e.key)) { setModifier("minorSix", true); modChanged = true; }
  if (majorModifiers.includes(e.key)) { setModifier("major", true); modChanged = true; }



  if (!isNaN(num) && num >= 1 && num <= 7) {
    promptForAudioEngine(() => {
      // Debounce/Latency for Modifier Sync (20ms)
      // If user presses Key then Modifier within 20ms, we want the modified chord.
      appState.pendingChordStarts[num] = setTimeout(() => {
        startChord(num - 1);
        delete appState.pendingChordStarts[num];
      }, 25);
    });
  }
});

window.addEventListener("keyup", (e) => {
  // Tonnetz layout: release row/col or Shift updates state (hold Shift = major on top)
  if (isTonnetzLayoutActive()) {
    if (e.key === "Shift") {
      if (!tonnetzShiftLocked) tonnetzShiftLayerActive = false;
      updateTonnetzShiftUI(tonnetzShiftLayerActive, tonnetzShiftLocked);
      e.preventDefault();
      applyTonnetzState();
      return;
    }
    const rowIdx = getTonnetzRowIndex(e.key);
    const colNum = getTonnetzColFromKey(e.key);
    if (rowIdx !== null) {
      e.preventDefault();
      removeLastFromArray(tonnetzHeldRows, rowIdx);
      applyTonnetzState();
      return;
    }
    if (colNum !== null) {
      e.preventDefault();
      removeLastFromArray(tonnetzHeldCols, colNum);
      applyTonnetzState();
      return;
    }
  }

  let modChanged = false;
  // Modifiers tracking
  if (dominantModifiers.includes(e.key)) { setModifier("dominant", false); }
  if (minorModifiers.includes(e.key)) { setModifier("minor", false); }
  if (diminishedModifiers.includes(e.key)) { setModifier("diminished", false); }
  if (majorSixthModifiers.includes(e.key)) { setModifier("majorSixth", false); }
  if (augmentedModifiers.includes(e.key)) { setModifier("augmented", false); }
  if (rootShiftDownModifiers.includes(e.key)) { setModifier("rootShiftDown", false); }
  if (rootShiftUpModifiers.includes(e.key)) { setModifier("rootShiftUp", false); }
  if (majorSeventhModifiers.includes(e.key)) { setModifier("majorSeventh", false); }
  if (halfDiminishedModifiers.includes(e.key)) { setModifier("halfDiminished", false); }
  if (minorSeventhModifiers.includes(e.key)) { setModifier("minorSeventh", false); }
  if (minorSixModifiers.includes(e.key)) { setModifier("minorSix", false); }
  if (majorModifiers.includes(e.key)) { setModifier("major", false); }
  if (e.key === "k" || e.key === "K") { appState.keyChangeKPending = false; }

  const num = parseInt(e.key);
  if (!isNaN(num) && num >= 1 && num <= 7) {
    // Cancel pending start if key is released quickly (tap < 20ms)
    if (appState.pendingChordStarts[num]) {
      clearTimeout(appState.pendingChordStarts[num]);
      delete appState.pendingChordStarts[num];
    }
    stopChord(num - 1);
  }
});

function promptForAudioEngine(onInitiated) {
  if (!appState.isAudioStarted) {
    alert("Click OK to confirm 'Start audio engine'");
    initAudio();
    return;
  }
  if (onInitiated) {
    onInitiated();
  }
}


// Click/Touch Input for QWERTY Chord Keys
document.querySelectorAll(".key").forEach(keyEl => {
  const num = parseInt(keyEl.getAttribute("data-note"));

  const start = (e) => {
    e.preventDefault();
    promptForAudioEngine(() => {
      startChord(num - 1);
    });
  };
  const stop = (e) => {
    e.preventDefault();
    stopChord(num - 1);
  };

  keyEl.addEventListener("mousedown", start);
  keyEl.addEventListener("mouseup", stop);
  keyEl.addEventListener("mouseleave", stop);
  keyEl.addEventListener("touchstart", start);
  keyEl.addEventListener("touchend", stop);
});

// Click/Touch Input for QWERTY Modifier Keys
document.querySelectorAll(".mod-key").forEach(modEl => {
  const modName = modEl.id.replace("mod-", "");

  const activate = (e) => {
    e.preventDefault();
    setModifier(modName, true);
  };
  const deactivate = (e) => {
    e.preventDefault();
    setModifier(modName, false);
  };

  modEl.addEventListener("mousedown", activate);
  modEl.addEventListener("mouseup", deactivate);
  modEl.addEventListener("mouseleave", deactivate);
  modEl.addEventListener("touchstart", activate);
  modEl.addEventListener("touchend", deactivate);
});

// Numpad Interactions
document.querySelectorAll(".np-btn").forEach(btn => {
  // If it's a note key
  if (btn.hasAttribute("data-note")) {
    const num = parseInt(btn.getAttribute("data-note"));

    // Touch/Mouse support
    const start = (e) => {
      e.preventDefault(); // Prevent double firing if hybrid
      promptForAudioEngine(() => {
        startChord(num - 1);
      });
    };
    const stop = (e) => {
      e.preventDefault();
      stopChord(num - 1);
    };

    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", stop);
    btn.addEventListener("mouseleave", stop);

    btn.addEventListener("touchstart", start);
    btn.addEventListener("touchend", stop);

  } else {
    // It's a modifier key
    const id = btn.id; // e.g., "np-dominant"
    if (!id) return;

    const modName = id.replace("np-", "");

    const activate = (e) => {
      e.preventDefault();
      setModifier(modName, true);
    };
    const deactivate = (e) => {
      e.preventDefault();
      setModifier(modName, false);
    };

    btn.addEventListener("mousedown", activate);
    btn.addEventListener("mouseup", deactivate);
    btn.addEventListener("mouseleave", deactivate);

    btn.addEventListener("touchstart", activate);
    btn.addEventListener("touchend", deactivate);
  }
});
// -------------------------------------------------------------------
// Theremin Logic
// -------------------------------------------------------------------
const thereminContainer = document.getElementById("theremin-container");
const thereminBar = document.getElementById("theremin-bar"); // Need this for ticks
const pitchIndicator = document.getElementById("pitch-indicator");
const mobileThereminBtn = document.getElementById("mobile-theremin-btn");

let isThereminActive = false;

// Generate Scale Grid
function initThereminScale() {
  if (!thereminBar) return;

  // Clear existing ticks (preserve pitch-indicator)
  const existingTicks = thereminBar.querySelectorAll(".theremin-tick");
  existingTicks.forEach(tick => tick.remove());

  const scaleName = `${appState.root} ${appState.scaleType}`;
  const scale = Scale.get(scaleName);

  // Tonal.js might return notes like "C#", "Db". Map to Chroma index (0-11) for comparison.
  // Note.chroma("C") -> 0, Note.chroma("C#") -> 1, etc.
  const scaleChromas = scale.notes.map(n => Note.chroma(n));
  const rootChroma = Note.chroma(appState.root);

  // We want to generate ticks for 36 semitones (C3 to C6)
  // C3 is index 0. C6 is index 36.
  for (let i = 0; i <= THEREMIN_SEMITONES; i++) {
    const tick = document.createElement("div");
    tick.classList.add("theremin-tick");

    // Calculate position percentage from bottom (0% pitch to 100% pitch)
    // i=0 -> 0% (bottom), i=36 -> 100% (top)
    const percent = (i / THEREMIN_SEMITONES) * 100;
    tick.style.bottom = `${percent}%`; // Use bottom positioning
    tick.style.top = 'auto'; // Override default absolute top if any
    tick.style.transform = 'translateY(50%)'; // Center on line

    // Note Type Logic
    // C3 corresponds to chroma 0 (C).
    // i=0 is C3 (Chroma 0).
    const currentChroma = i % 12;

    if (currentChroma === rootChroma) {
      tick.classList.add("root");
    } else if (scaleChromas.includes(currentChroma)) {
      tick.classList.add("natural");
    } else {
      tick.classList.add("accidental");
    }

    thereminBar.appendChild(tick);
  }
}

// Call on load
initThereminScale();

function getPitchFromY(y) {
  // Use the visual bar as the reference for range
  if (!thereminBar) return THEREMIN_MIN_FREQ;

  const rect = thereminBar.getBoundingClientRect();

  // Clamp Y to the bar area (so going outside maintains min/max)
  const clampedY = Math.max(rect.top, Math.min(y, rect.bottom));

  // Map Top (rect.top) -> High Pitch (1.0), Bottom (rect.bottom) -> Low Pitch (0.0)
  const normalized = 1 - ((clampedY - rect.top) / rect.height);

  // Using Logarithmic scale for pitch perception
  // f = f_min * (f_max / f_min)^normalized
  const freq = THEREMIN_MIN_FREQ * Math.pow(THEREMIN_MAX_FREQ / THEREMIN_MIN_FREQ, normalized);
  return freq;
}

window.addEventListener("mousedown", (e) => {
  // Left Click only
  if (e.button !== 0) return;

  // Only if audio is started
  if (!appState.isAudioStarted) return;

  // Check if clicking interactive elements to avoid conflict?
  // The user requested "Pressing the left mouse button turns on playback".
  // We should probably allow it globally unless clicking a button?
  if (e.target.tagName === 'BUTTON' || e.target.closest('.key') || e.target.closest('.np-btn') || e.target.closest('.mod-key')) return;

  isThereminActive = true;
  const freq = getPitchFromY(e.clientY);

  if (appState.thereminSynth) {
    appState.thereminSynth.triggerAttack(freq);
  }

  // Update Visuals
  pitchIndicator.classList.add("active");
  toggleBgEffect(true); // Show BG + Flip
  updateThereminVisuals(e.clientY);
});

window.addEventListener("mousemove", (e) => {
  if (isThereminActive && appState.thereminSynth) {
    const freq = getPitchFromY(e.clientY);
    appState.thereminSynth.setNote(freq); // MonoSynth uses setNote for glide
    updateThereminVisuals(e.clientY);
  } else {
    // Just update visuals passively if we want? Or hidden?
    // User said "Show a vertical bar... indicating what pitch we're on"
    // Let's update it passively too so they know where they will start.
    updateThereminVisuals(e.clientY);
  }
});

window.addEventListener("mouseup", () => {
  if (isThereminActive) {
    isThereminActive = false;
    if (appState.thereminSynth) {
      appState.thereminSynth.triggerRelease();
    }
    pitchIndicator.classList.remove("active");
    toggleBgEffect(false); // Hide BG
  }
});

function updateThereminVisuals(y) {
  // Clamp Y to window
  const clampedY = Math.max(0, Math.min(y, window.innerHeight));
  pitchIndicator.style.top = `${clampedY}px`;
  // We used bottom: 50% / top... actually in CSS we put absolute positioning.
  // Let's just set top directly.
  // CSS was: #pitch-indicator { position: absolute; ... }
  // But #theremin-bar is the container. #theremin-container is fixed.
  // #theremin-bar depends on height.

  // Wait, the pitch indicator is inside the bar.
  // Ideally we track GLOBAL Y, but the indicator is inside a container.
  // Since container is centered 80vh, we need relative Y.

  // Easier approach: Move the indicator in the Fixed container?
  // Actually, simply setting `top` on floating fixed element is tricky if nested.

  // Let's simplify: Set the indicator's position relative to the viewport using fixed?
  // No, it's inside #theremin-bar (relative).

  // Let's map global Y to percentage of the bar.
  const containerRect = document.getElementById("theremin-bar").getBoundingClientRect();
  const relativeY = y - containerRect.top;
  const percent = Math.max(0, Math.min(100, (relativeY / containerRect.height) * 100));

  pitchIndicator.style.top = `${percent}%`;
  pitchIndicator.style.bottom = 'auto';
  pitchIndicator.style.transform = 'translate(-50%, -50%)'; // Center on cursor vertically
}

// -------------------------------------------------------------------
// Mobile Theremin / Accelerometer Logic
// -------------------------------------------------------------------

if (mobileThereminBtn) {
  const activateMobileTheremin = (e) => {
    e.preventDefault();
    if (!appState.isAudioStarted) {
      alert("Please press 'Start audio engine' (Enter) before using the Theremin lead.");
      return;
    }

    if (appState.mobileThereminEnabled) return;

    appState.mobileThereminEnabled = true;
    mobileThereminBtn.classList.add("active");

    // Start the theremin sound
    isThereminActive = true;
    if (appState.thereminSynth) {
      appState.thereminSynth.triggerAttack(THEREMIN_MIN_FREQ);
    }
    pitchIndicator.classList.add("active");
    toggleBgEffect(true);
    window.addEventListener("deviceorientation", handleOrientation);
  };

  const deactivateMobileTheremin = (e) => {
    e.preventDefault();
    if (!appState.mobileThereminEnabled) return;

    appState.mobileThereminEnabled = false;
    mobileThereminBtn.classList.remove("active");

    // Stop the theremin sound
    isThereminActive = false;
    if (appState.thereminSynth) {
      appState.thereminSynth.triggerRelease();
    }
    pitchIndicator.classList.remove("active");
    toggleBgEffect(false);
    window.removeEventListener("deviceorientation", handleOrientation);
  };

  mobileThereminBtn.addEventListener("mousedown", activateMobileTheremin);
  mobileThereminBtn.addEventListener("touchstart", activateMobileTheremin);

  mobileThereminBtn.addEventListener("mouseup", deactivateMobileTheremin);
  mobileThereminBtn.addEventListener("touchend", deactivateMobileTheremin);
  mobileThereminBtn.addEventListener("mouseleave", deactivateMobileTheremin);
}

function handleOrientation(event) {
  if (!appState.mobileThereminEnabled || !appState.thereminSynth) return;

  // 'beta' is the front-to-back tilt in degrees [-180, 180]
  // We'll map a comfortable range (e.g., 30 to 90 degrees) to the pitch.
  let tilt = event.beta;

  // Clamp tilt
  const minTilt = 30;
  const maxTilt = 80;
  const clampedTilt = Math.max(minTilt, Math.min(tilt, maxTilt));

  // Normalize (0 to 1)
  const normalized = (clampedTilt - minTilt) / (maxTilt - minTilt);

  // Invert if needed: 0 is bottom (min freq), 1 is top (max freq)
  // Higher tilt (closer to 90) = Higher pitch

  const freq = THEREMIN_MIN_FREQ * Math.pow(THEREMIN_MAX_FREQ / THEREMIN_MIN_FREQ, normalized);
  appState.thereminSynth.setNote(freq);

  // Update visuals using normalized value for the bar percentage
  // 1 - normalized because the bar is top-down (0 is top?)
  // Wait, getPitchFromY maps 1.0 to top, 0.0 to bottom.
  // Our normalized 1.0 is max freq (top).
  updateThereminVisualsFromNormalized(normalized);
}

function updateThereminVisualsFromNormalized(normalized) {
  // percentage from top (0% is top, 100% is bottom)
  const percent = (1 - normalized) * 100;
  pitchIndicator.style.top = `${percent}%`;
  pitchIndicator.style.bottom = 'auto';
  pitchIndicator.style.transform = 'translate(-50%, -50%)';
}
// Initialize Layout Default (Tonnetz first) and Tonnetz board
window.addEventListener("load", () => {
  updateLayoutUI("tonnetz");
  currentLayoutIndex = 0;
  initTonnetzBoard();

  const hasMotion = typeof DeviceOrientationEvent !== 'undefined' || typeof DeviceMotionEvent !== 'undefined';
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (hasMotion && hasTouch) {
    document.body.classList.add("has-accel");
  }

  if (window.innerWidth < 600) {
    const subtext = document.getElementById("start-audio-subtext");
    if (subtext) {
      subtext.innerText = "(please turn off silent mode on your phone)";
    }
  }
  updateInteractionState();
});
