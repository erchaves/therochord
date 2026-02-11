# therochord

<a href="https://ibb.co/N2FkZ25W"><img src="https://i.ibb.co/Kx5QFxdV/IMG-6219-2.jpg" alt="IMG-6219-2" border="0"></a>

**therochord** is a unique web-based musical instrument that turns your computer keyboard and mouse into a expressive chordal accompaniment and theremin-style lead synthesizer. It combines diatonic chord triggers with a frequency-sliding lead voice that can simultaneously be activated with a mouse, trackpad, or mobile device's accelerometer/gyroscope.

I got the idea from buying a $4 numerical keypad at a thrift store and realizing it would be an interesting way to play chords. I couldn't think of any chordal instruments that operate on the "Nashville Number System" (which is how I tend to think of them in my head) so I decided to create one. Once that was working how I liked, I wondered if there was a way to simultaneously play a lead voice without needing to press a lot more buttons. It turns out that the mouse, trackpad, and mobile device's accelerometer/gyroscope are all great for this.

## How to Launch

therochord is a static web application. The easiest way to run it locally is using a simple Python web server.

0. **Clone this repository**
1. **Open your terminal** and navigate to the project directory:
   ```bash
   cd ./therochord
   ```
2. **Launch the server**:
   ```bash
   python3 -m http.server 8000
   ```
3. **Open your browser** and go to:
   [http://localhost:8000](http://localhost:8000)

---

## How to Play

### 1. Start the Engine

Click the **"Start audio engine"** button (or press `Enter`) to enable audio in your browser.

### 2. Play Chords

Press keys **1 through 7** to trigger the diatonic chords of the selected scale.

- **Hold** a key to sustain the chord.
- **Release** to stop.

### 3. Mouse Theremin

Click and drag anywhere on the screen (or the vertical bar on the right) to play the lead synth.

- **Vertical Position**: Controls the pitch.
- **Horizontal Bar Highlights**: Shows the root note (green) and other diatonic notes (white) to help you find the right melody.
- **Mobile Support**: On mobile devices, use the yellow button and move your phone up/down (using the accelerometer/gyroscope) for the theremin effect.

---

## Keyboard Controls

### Chord Modifiers (Hold + Chord Key)

By default, keys `1-7` play triads. Hold these modifiers to change the chord quality:

| Quality             | QWERTY Key | Numpad Key           |
| :------------------ | :--------- | :------------------- |
| **Major**           | `Q`        | `Enter`              |
| **Minor**           | `W`        | `-`                  |
| **Dominant 7th**    | `E`        | `/`                  |
| **Major 7th**       | `A`        | `9`                  |
| **Minor 7th**       | `S`        | `-` + `/` (or `Del`) |
| **Diminished 7th**  | `D`        | `*`                  |
| **Major 6th**       | `Z`        | `8`                  |
| **Minor 6th**       | `X`        | `-` + `8`            |
| **Half-Diminished** | `C`        | `Tab` / `Clear`      |
| **Augmented**       | `V`        | `+`                  |

### Transposition & Key

- **Root Sharp (♯)**: Hold `R` (or `.` on Numpad) while playing a chord.
- **Root Flat (♭)**: Hold `F` (or `0` on Numpad) while playing a chord.
- **Change Global Key**: Use the dropdown menu, or hold `Enter` and press `+` or `-` to shift the key up or down a semitone.

---

## Features

- **Voice Leading**: When enabled, the app automatically chooses chord voicings that minimize note movement, creating smooth transitions.
- **Layout Support**: Toggle between **QWERTY** and **Numpad** optimized layouts.
- **Dynamic Visuals**: The background and "chord tint" change color based on the chord degree being played.
- **Theory Driven**: Powered by `@tonaljs` for accurate musical theory and `Tone.js` for high-quality synthesis.
