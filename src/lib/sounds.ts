/**
 * Sound effects for counter animations.
 * Uses a single pre-unlocked Audio element for iOS compatibility.
 *
 * iOS Safari only allows audio playback from direct user gestures.
 * We unlock one Audio element on the first tap, then reuse it.
 */

let audioElement: HTMLAudioElement | null = null;
let dingDataUri: string | null = null;
let isUnlocked = false;

function generateDingWav(): string {
    const sampleRate = 44100;
    const duration = 0.2;
    const numSamples = Math.floor(sampleRate * duration);

    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    writeStr(view, 0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(view, 8, "WAVE");
    writeStr(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(view, 36, "data");
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const freq = 1200 - t * 1500;
        const envelope = Math.exp(-t * 15);
        const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.4;
        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return "data:audio/wav;base64," + btoa(binary);
}

function writeStr(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * MUST be called from a direct user gesture (tap/click).
 * Creates and unlocks the Audio element for later use.
 */
export function warmUpAudio(): void {
    if (isUnlocked) return;
    try {
        if (!dingDataUri) {
            dingDataUri = generateDingWav();
        }
        audioElement = new Audio(dingDataUri);
        audioElement.volume = 0.5;
        // Play (silently) to unlock — iOS requires this in a gesture handler
        audioElement.play().then(() => {
            audioElement?.pause();
            if (audioElement) audioElement.currentTime = 0;
            isUnlocked = true;
        }).catch(() => {
            // Fallback: still mark as attempted
            isUnlocked = true;
        });
    } catch {
        isUnlocked = true;
    }
}

/**
 * Play the ding sound. Works after warmUpAudio() has been called.
 */
export function playCounterDing(): void {
    try {
        if (audioElement && isUnlocked) {
            audioElement.currentTime = 0;
            audioElement.play().catch(() => { /* skip */ });
        }
    } catch {
        // not available
    }
}
