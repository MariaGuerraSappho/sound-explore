export class AudioProcessor {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.gainNode = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.animationId = null;
    this.isVisualizing = false;

    this.fftCanvas = null;
    this.fftCtx = null;

    this.fftSize = 2048;
    this.bufferLength = this.fftSize / 2;
    this.dataArray = null;
    this.smoothness = 0.5;

    this.mediaDest = null;        // ★ for recording processed audio
    this.preamp = null;           // ★ extra gain stage for low-input devices
  }

  async init(stream) {
    try {
      const userStream = stream || await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.microphone = this.audioContext.createMediaStreamSource(userStream);

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.minDecibels = -120;            // ★ increase sensitivity
      this.analyser.maxDecibels = -20;             // ★ lowered from -10 to -20 to reduce clipping
      this.bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(this.bufferLength);

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1;

      // Connect: microphone -> preamp -> gain -> analyser (+ recorder)
      this.preamp = this.audioContext.createGain();            // ★
      this.preamp.gain.value = 1;                              // ★
      this.microphone.connect(this.preamp);                    // ★
      this.preamp.connect(this.gainNode);                      // ★
      this.gainNode.connect(this.analyser);

      // ★ Route to destination so you can hear it (comment this if you don't want live monitoring)
      // this.gainNode.connect(this.audioContext.destination);

      // ★ Tap the processed signal for MediaRecorder
      this.mediaDest = this.audioContext.createMediaStreamDestination();
      this.gainNode.connect(this.mediaDest);

      // Setup canvas
      this.fftCanvas = document.getElementById('fftCanvas');
      this.fftCtx = this.fftCanvas ? this.fftCanvas.getContext('2d') : null;  // ★ guard

      // Setup media recorder (use processed stream, with supported mime fallback)
      const mimeType = this._pickSupportedMimeType();                          // ★
      this.mediaRecorder = new MediaRecorder(
        this.mediaDest.stream, 
        mimeType ? { mimeType } : undefined
      );                                                                       // ★

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.recordedChunks.push(event.data);
      };

      // (don't auto-start viz)
    } catch (error) {
      console.error('Error initializing audio:', error);
      throw error;
    }
  }

  // ★ Call this from a click/tap before starting anything audio
  async resumeContext() {
    if (this.audioContext && this.audioContext.state !== 'running') {
      await this.audioContext.resume();
    }
  }

  setGain(value) {
    if (this.gainNode) {
      const v = Math.max(0.1, parseFloat(value) || 1);
      // ★ Further reduce multiplier from 3 to 1.5 for much gentler gain curve, max 10x instead of 20x
      const mapped = Math.min(10, Math.sqrt(v) * 1.5);
      if (this.preamp) {
        this.preamp.gain.setTargetAtTime(mapped, this.audioContext.currentTime, 0.01);
      }
    }
  }

  setSmoothness(value) {
    this.smoothness = value;
    this.analyser.smoothingTimeConstant = 0.5 + (value * 0.4);
  }

  startVisualization() {
    if (this.isVisualizing) return;
    if (!this.fftCanvas || !this.fftCtx) return;  // ★ avoid crashing if canvas not ready
    this.isVisualizing = true;
    this.resizeCanvases();
    this.visualize();
  }

  stopVisualization() {
    this.isVisualizing = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  resizeCanvases() {
    if (!this.fftCanvas) return;                   // ★ guard
    const parent = this.fftCanvas.parentElement || this.fftCanvas;
    let width = parent.clientWidth || this.fftCanvas.width || window.innerWidth || 600;  // ★ robust
    let height = parent.clientHeight || this.fftCanvas.height || 200;                    // ★ default > 0
    if (height < 50) height = 200;                 // ★ prevent invisible canvas
    this.fftCanvas.width = width;
    this.fftCanvas.height = height;
  }

  visualize() {
    if (!this.isVisualizing || !this.analyser || !this.fftCtx || !this.fftCanvas) return;

    this.animationId = requestAnimationFrame(() => this.visualize());

    this.analyser.getByteFrequencyData(this.dataArray);

    const average = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
    const normalizedLevel = average / 255;

    // ★ Check for clipping
    const maxValue = Math.max(...this.dataArray);
    const isClipping = maxValue >= 250; // Near max = clipping

    const levelBar = document.getElementById('levelBar');
    if (levelBar) {
      levelBar.style.transform = `scaleY(${normalizedLevel})`;
      // ★ Change color if clipping
      if (isClipping) {
        levelBar.style.background = 'linear-gradient(to top, #ef4444, #dc2626)';
      } else {
        levelBar.style.background = 'linear-gradient(to top, #60a5fa, #a78bfa, #f472b6, #facc15, #a3e63e)';
      }
    }

    const levelText = document.getElementById('levelText');
    if (levelText) {
      // ★ Show clipping warning
      if (isClipping) {
        levelText.textContent = 'CLIP!';
        levelText.style.color = '#ef4444';
      } else {
        levelText.style.color = 'white';
        if (normalizedLevel < 0.3) levelText.textContent = 'Quiet';
        else if (normalizedLevel < 0.7) levelText.textContent = 'Medium';
        else levelText.textContent = 'Loud';
      }
    }

    this.drawFFTSpectrogram();
  }

  drawFFTSpectrogram() {
    if (!this.fftCtx || !this.fftCanvas) return;   // ★ guard
    const ctx = this.fftCtx;
    const canvas = this.fftCanvas;
    const width = canvas.width;
    const height = canvas.height;

    if (width <= 1 || height <= 1) return;         // ★ avoid getImageData errors

    const imageData = ctx.getImageData(1, 0, width - 1, height);
    ctx.putImageData(imageData, 0, 0);

    const barHeight = height / this.bufferLength;
    for (let i = 0; i < this.bufferLength; i++) {
      const value = this.dataArray[i];
      const percent = value / 255;
      const hue = percent * 300;
      ctx.fillStyle = `hsl(${hue}, 90%, 70%)`;
      ctx.fillRect(width - 1, height - (i + 1) * barHeight, 1, barHeight + 1);
    }
  }

  async startRecording() {
    this.recordedChunks = [];
    await this.resumeContext();                     // ★ ensure running
    if (this.mediaRecorder.state !== 'recording') {
      this.mediaRecorder.start();
    }
  }

  async stopRecording() {
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        const type = this.mediaRecorder.mimeType || this._pickSupportedMimeType() || 'audio/webm';
        const blob = new Blob(this.recordedChunks, { type });
        resolve(blob);
      };
      if (this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      } else {
        const type = this.mediaRecorder.mimeType || this._pickSupportedMimeType() || 'audio/webm';
        resolve(new Blob(this.recordedChunks, { type }));
      }
    });
  }

  // ★ Pick a MIME the browser actually supports (helps Safari/Firefox)
  _pickSupportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
      'audio/aac'
    ];
    for (const t of candidates) {
      if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
    }
    return '';
  }

  getCanvasThumbnail() {
    return this.fftCanvas ? this.fftCanvas.toDataURL('image/png') : null;
  }

  getSuggestedTags() {
    if (!this.dataArray) return [];
    const lowBand = this.dataArray.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    const midBand = this.dataArray.slice(50, 200).reduce((a, b) => a + b, 0) / 150;
    const highBand = this.dataArray.slice(200, 512).reduce((a, b) => a + b, 0) / 312;
    const max = Math.max(lowBand, midBand, highBand);
    const tags = [];
    if (lowBand === max) tags.push('low', 'rumble'); else if (midBand === max) tags.push('buzzing'); else tags.push('high', 'chirp');
    const average = (lowBand + midBand + highBand) / 3;
    if (average < 50) tags.push('quiet'); else if (average > 150) tags.push('loud');
    return tags;
  }

  getSoundCharacteristics() {
    if (!this.dataArray) return null;
    const lowBand = this.dataArray.slice(0, 50);
    const midBand = this.dataArray.slice(50, 200);
    const highBand = this.dataArray.slice(200, 512);
    const lowAvg = lowBand.reduce((a, b) => a + b, 0) / lowBand.length;
    const midAvg = midBand.reduce((a, b) => a + b, 0) / midBand.length;
    const highAvg = highBand.reduce((a, b) => a + b, 0) / highBand.length;
    const overall = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
    const maxBand = Math.max(lowAvg, midAvg, highAvg);
    let dominantRange = 'mid';
    if (lowAvg === maxBand) dominantRange = 'low';
    if (highAvg === maxBand) dominantRange = 'high';
    return { overall, lowAvg, midAvg, highAvg, dominantRange };
  }

  recordCharacteristics = [];
  startCharacteristicRecording() { this.recordCharacteristics = []; }
  captureCharacteristic() {
    const c = this.getSoundCharacteristics();
    if (c) this.recordCharacteristics.push(c);
  }
  getRecordedCharacteristics() { return this.recordCharacteristics; }
}