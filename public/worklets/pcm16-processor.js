/**
 * AudioWorklet processor for capturing PCM16 audio data.
 * Runs in a separate audio thread for zero-latency capture.
 *
 * Sends raw PCM16 (16-bit signed integers, little-endian)
 * to the main thread via MessagePort.
 */
class PCM16Processor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._capturing = true;
        this.port.onmessage = (event) => {
            if (event.data === "stop") {
                this._capturing = false;
            } else if (event.data === "start") {
                this._capturing = true;
            }
        };
    }

    process(inputs) {
        if (!this._capturing) return true;

        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const samples = input[0]; // mono channel
        if (!samples || samples.length === 0) return true;

        // Convert float32 [-1, 1] to PCM16 [-32768, 32767]
        const pcm16 = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Send as transferable ArrayBuffer (zero-copy)
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

        return true;
    }
}

registerProcessor("pcm16-processor", PCM16Processor);
