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
    halfDiminished: false, // 'x' or 'Backspace'
    major: false // 'Enter'
  },
  lastVoicing: null,
  activeVoicings: {},
  modReleaseTimeout: null,
  pendingChordStarts: {},
  voiceLeadingEnabled: true
};

// modifier keys
const dominantModifiers = ["d", "D", "/"];
const minorModifiers = ["-", "_"];
const diminishedModifiers = ["o", "O", "*"];
const majorSixthModifiers = ["s", "S", "8"];
const augmentedModifiers = ["+", "="];
const rootShiftDownModifiers = [",", "<", "0"];
const rootShiftUpModifiers = [".", ">"];
const majorSeventhModifiers = ["9", "m", "M"];
const halfDiminishedModifiers = ["x", "X", "Backspace", "Escape"];

const majorModifiers = ["Enter"];

const KEY_ORDER = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Initialize Synth
function initAudio() {
  if (appState.isAudioStarted) return;

  appState.synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
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

  console.log("Audio Initialized");
  appState.isAudioStarted = true;
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
    case "7#5": return "Augmented 7th";
    case "maj7": return "Major 7th";
    case "m7b5": return "Half-Dim (m7b5)";
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
  // Dominant ('d') -> 7 (Dominant 7th)
  if (appState.modifiers.dominant) quality = "7";
  // Minor ('-') -> m (Minor Triad)
  else if (appState.modifiers.minor) quality = "m";
  // Diminished ('o') -> dim7 (Diminished 7th)
  else if (appState.modifiers.diminished) quality = "dim7";
  // Major 6th ('s') -> 6
  else if (appState.modifiers.majorSixth) quality = "6";
  // Augmented ('+') -> 7#5 (Augmented 7th)
  // Augmented ('+') -> 7#5 (Augmented 7th)
  else if (appState.modifiers.augmented) quality = "7#5";
  // Major 7th ('9' or 'm') -> maj7
  else if (appState.modifiers.majorSeventh) quality = "maj7";
  // Half-Diminished ('Escape' or 'Backspace') -> m7b5
  else if (appState.modifiers.halfDiminished) quality = "m7b5";
  // Major Triad ('Enter') -> M
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

// Start Chord (Attack)
function startChord(degreeIndex) {
  if (!appState.isAudioStarted) return;
  // If already playing this key, ignore to prevent stutter/polyphony buildup
  if (appState.activeVoicings[degreeIndex]) return;

  const chords = getScaleChords(appState.root, appState.scaleType);
  let chord = chords[degreeIndex]; // degreeIndex is 0-6
  if (!chord) return;

  // Apply Modifiers
  chord = getChordWithModifiers(degreeIndex, chord);

  // Voice Leading Logic
  const targetNotes = chord.notes;
  let nextVoicing;

  if (appState.voiceLeadingEnabled) {
    // SMART MODE: Minimize movement
    if (!appState.lastVoicing) {
      appState.lastVoicing = targetNotes.map(n => n + "4");
    }

    // Generate options in octaves 3 and 4 to stay lower
    let options = generateVoicingOptions(targetNotes, ["3", "4"]);

    // Constraint: Do not exceed C5
    const limitMidi = note("C5").midi;
    const validOptions = options.filter(opt => {
      return opt.every(n => note(n).midi <= limitMidi);
    });

    // Fallback
    const candidates = validOptions.length > 0 ? validOptions : options;
    nextVoicing = getBestVoicing(appState.lastVoicing, candidates);

    // Update state for next time
    appState.lastVoicing = nextVoicing;

  } else {
    // DUMB MODE: Strictly Ascending Root Position (starting at Octave 4)
    // This ensures we have a proper stack (e.g. B4-D5-F5) instead of inversions (D4-F4-B4)
    // and allows extending beyond C5 as requested.

    nextVoicing = [];
    let currentOctave = 4;
    let prevMidi = -1;

    targetNotes.forEach((n, idx) => {
      let candidateName = n + currentOctave;
      let candidateMidi = note(candidateName).midi;

      // If this note is lower/equal to previous, bump octave
      if (idx > 0 && candidateMidi <= prevMidi) {
        currentOctave++;
        candidateName = n + currentOctave;
        candidateMidi = note(candidateName).midi;
      }

      nextVoicing.push(candidateName);
      prevMidi = candidateMidi;
    });

    // Reset lastVoicing so if we toggle back ON, it starts fresh or uses this as base
    appState.lastVoicing = nextVoicing;
  }

  // Add Root Bass Note an octave down
  const notesObjs = nextVoicing.map(n => note(n));
  notesObjs.sort((a, b) => a.midi - b.midi);
  const lowestOctave = notesObjs[0].oct;
  const bassNote = chord.root + (lowestOctave - 1);

  const fullVoicing = [...nextVoicing, bassNote];
  // Simplify notes to handle double-sharps (e.g. F## -> G) for Tone.js compatibility and readability
  const simpleVoicing = fullVoicing.map(n => Note.simplify(n));

  // Store acting voicing so we can release it later
  appState.activeVoicings[degreeIndex] = simpleVoicing;

  // Trigger Attack (Sustain)
  appState.synth.triggerAttack(simpleVoicing);

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
    appState.synth.triggerRelease(notes);
    delete appState.activeVoicings[degreeIndex];

    const keyEl = document.querySelector(`.key[data-note="${degreeIndex + 1}"]`);
    if (keyEl) keyEl.classList.remove("active");
    const npBtn = document.querySelector(`.np-btn[data-note="${degreeIndex + 1}"]`);
    if (npBtn) npBtn.classList.remove("active");
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

// Update Active Chords (Hot-Swap)
function updateActiveChords() {
  if (!appState.isAudioStarted) return;
  // Iterate over all active keys and re-trigger them
  Object.keys(appState.activeVoicings).forEach(key => {
    const degree = parseInt(key);
    stopChord(degree);
    startChord(degree);
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
}

// Helper for UI updates
function updateModifierUI(modName, isActive) {
  const badgeEl = document.getElementById(`mod-${modName}`);
  if (badgeEl) isActive ? badgeEl.classList.add("active") : badgeEl.classList.remove("active");

  const npBtn = document.getElementById(`np-${modName}`);
  if (npBtn) isActive ? npBtn.classList.add("active") : npBtn.classList.remove("active");
}

// Set Modifier State (for Mouse/Touch)
function setModifier(modName, isActive) {
  appState.modifiers[modName] = isActive;
  updateModifierUI(modName, isActive);

  // Immediate update for mouse interaction
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
  e.target.blur(); // Remove focus to prevent keyboard capturing
});

document.getElementById("voice-leading-toggle").addEventListener("change", (e) => {
  appState.voiceLeadingEnabled = e.target.checked;
  e.target.blur(); // Remove focus
});

document.getElementById("numpad-mode-toggle").addEventListener("change", (e) => {
  const isNumpad = e.target.checked;
  e.target.blur();

  const defaultInterface = document.getElementById("default-interface");
  const numpadInterface = document.getElementById("numpad-interface");

  if (isNumpad) {
    defaultInterface.style.display = 'none';
    numpadInterface.style.display = 'block';
  } else {
    defaultInterface.style.display = 'block';
    numpadInterface.style.display = 'none';
  }
});



// Keyboard Input
window.addEventListener("keydown", (e) => {
  if (e.repeat) return; // Prevent auto-repeat re-triggering globally

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
  // Modifiers tracking
  if (dominantModifiers.includes(e.key)) { appState.modifiers.dominant = true; modChanged = true; updateModifierUI("dominant", true); }
  if (minorModifiers.includes(e.key)) { appState.modifiers.minor = true; modChanged = true; updateModifierUI("minor", true); }
  if (diminishedModifiers.includes(e.key)) { appState.modifiers.diminished = true; modChanged = true; updateModifierUI("diminished", true); }
  if (majorSixthModifiers.includes(e.key)) { appState.modifiers.majorSixth = true; modChanged = true; updateModifierUI("majorSixth", true); }
  if (augmentedModifiers.includes(e.key)) { appState.modifiers.augmented = true; modChanged = true; updateModifierUI("augmented", true); }
  if (rootShiftDownModifiers.includes(e.key)) { appState.modifiers.rootShiftDown = true; modChanged = true; updateModifierUI("rootShiftDown", true); }
  if (rootShiftUpModifiers.includes(e.key)) { appState.modifiers.rootShiftUp = true; modChanged = true; updateModifierUI("rootShiftUp", true); }
  if (majorSeventhModifiers.includes(e.key)) { appState.modifiers.majorSeventh = true; modChanged = true; updateModifierUI("majorSeventh", true); }
  if (halfDiminishedModifiers.includes(e.key)) { appState.modifiers.halfDiminished = true; modChanged = true; updateModifierUI("halfDiminished", true); }
  if (majorModifiers.includes(e.key)) { appState.modifiers.major = true; modChanged = true; updateModifierUI("major", true); }

  // Hot-Swap: if modifiers changed, update held chords
  if (modChanged) {
    if (appState.modReleaseTimeout) {
      clearTimeout(appState.modReleaseTimeout);
      appState.modReleaseTimeout = null;
    }
    updateActiveChords();
  }



  if (!isNaN(num) && num >= 1 && num <= 7) {
    if (!appState.isAudioStarted) {
      alert("Please click 'Start Audio Engine' first");
      return;
    }
    // Debounce/Latency for Modifier Sync (20ms)
    // If user presses Key then Modifier within 20ms, we want the modified chord.
    appState.pendingChordStarts[num] = setTimeout(() => {
      startChord(num - 1);
      delete appState.pendingChordStarts[num];
    }, 25);
  }
});

window.addEventListener("keyup", (e) => {
  let modChanged = false;
  // Modifiers tracking
  if (dominantModifiers.includes(e.key)) { appState.modifiers.dominant = false; modChanged = true; updateModifierUI("dominant", false); }
  if (minorModifiers.includes(e.key)) { appState.modifiers.minor = false; modChanged = true; updateModifierUI("minor", false); }
  if (diminishedModifiers.includes(e.key)) { appState.modifiers.diminished = false; modChanged = true; updateModifierUI("diminished", false); }
  if (majorSixthModifiers.includes(e.key)) { appState.modifiers.majorSixth = false; modChanged = true; updateModifierUI("majorSixth", false); }
  if (augmentedModifiers.includes(e.key)) { appState.modifiers.augmented = false; modChanged = true; updateModifierUI("augmented", false); }
  if (rootShiftDownModifiers.includes(e.key)) { appState.modifiers.rootShiftDown = false; modChanged = true; updateModifierUI("rootShiftDown", false); }
  if (rootShiftUpModifiers.includes(e.key)) { appState.modifiers.rootShiftUp = false; modChanged = true; updateModifierUI("rootShiftUp", false); }
  if (majorSeventhModifiers.includes(e.key)) { appState.modifiers.majorSeventh = false; modChanged = true; updateModifierUI("majorSeventh", false); }
  if (halfDiminishedModifiers.includes(e.key)) { appState.modifiers.halfDiminished = false; modChanged = true; updateModifierUI("halfDiminished", false); }
  if (majorModifiers.includes(e.key)) { appState.modifiers.major = false; modChanged = true; updateModifierUI("major", false); }

  if (modChanged) {
    if (appState.modReleaseTimeout) {
      clearTimeout(appState.modReleaseTimeout);
    }
    // Debounce the release to prevent accidental flashes of natural chord
    appState.modReleaseTimeout = setTimeout(() => {
      updateActiveChords();
      appState.modReleaseTimeout = null;
    }, 50);
  }

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


// Click Input (Refactored for sustain)
document.querySelectorAll(".key").forEach(keyEl => {
  const num = parseInt(keyEl.getAttribute("data-note"));

  keyEl.addEventListener("mousedown", () => {
    if (!appState.isAudioStarted) {
      alert("Please click 'Start Audio Engine' first");
      return;
    }
    startChord(num - 1);
  });

  keyEl.addEventListener("mouseup", () => stopChord(num - 1));
  keyEl.addEventListener("mouseleave", () => stopChord(num - 1));
});

// Numpad Interactions
document.querySelectorAll(".np-btn").forEach(btn => {
  // If it's a note key
  if (btn.hasAttribute("data-note")) {
    const num = parseInt(btn.getAttribute("data-note"));

    // Touch/Mouse support
    const start = (e) => {
      e.preventDefault(); // Prevent double firing if hybrid
      if (!appState.isAudioStarted) {
        alert("Please click 'Start Audio Engine' first");
        return;
      }
      startChord(num - 1);
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
