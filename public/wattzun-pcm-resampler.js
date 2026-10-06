const OUTPUT_RATE = 24_000;

/** Streaming low-pass filtering and interpolation, retaining phase across render blocks. */
export class WattzunPcmResampler {
  constructor(inputRate, emit) {
    if (!Number.isFinite(inputRate) || inputRate < 8_000 || inputRate > 192_000 || typeof emit !== "function") {
      throw new Error("Unsupported microphone sample rate.");
    }
    this.step = inputRate / OUTPUT_RATE;
    this.emit = emit;
    this.inputCount = 0;
    this.outputCount = 0;
    this.previous = 0;
    this.finished = false;
    this.history = new Float64Array(32);
    this.head = 0;
    this.coefficients = null;
    if (inputRate > OUTPUT_RATE) {
      const cutoff = .45 * OUTPUT_RATE / inputRate;
      const coefficients = new Float64Array(32);
      let total = 0;
      for (let index = 0; index < coefficients.length; index++) {
        const distance = index - (coefficients.length - 1) / 2;
        const sinc = Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
        coefficients[index] = sinc * (.54 - .46 * Math.cos(2 * Math.PI * index / (coefficients.length - 1)));
        total += coefficients[index];
      }
      for (let index = 0; index < coefficients.length; index++) coefficients[index] /= total;
      this.coefficients = coefficients;
    }
  }

  push(sample) {
    if (this.finished || !Number.isFinite(sample)) throw new Error("Invalid microphone sample.");
    let filtered = sample;
    if (this.coefficients) {
      this.history[this.head] = sample;
      filtered = 0;
      for (let index = 0; index < this.coefficients.length; index++) {
        filtered += this.coefficients[index] * this.history[(this.head - index + this.history.length) % this.history.length];
      }
      this.head = (this.head + 1) % this.history.length;
    }
    const position = this.inputCount++;
    while (this.outputCount * this.step <= position) {
      const fraction = this.outputCount * this.step - (position - 1);
      this.emit(position === 0 ? filtered : this.previous + (filtered - this.previous) * fraction);
      this.outputCount++;
    }
    this.previous = filtered;
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    // Upsampling can leave a fraction of the final input frame to emit.
    while (this.outputCount * this.step < this.inputCount) {
      this.emit(this.previous);
      this.outputCount++;
    }
  }
}
