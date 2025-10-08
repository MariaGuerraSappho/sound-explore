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
    }

    async init() {
        try {
            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                } 
            });

            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.microphone = this.audioContext.createMediaStreamSource(stream);

            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.fftSize;
            this.analyser.smoothingTimeConstant = 0.8;
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);

            // Create Gain Node for volume control
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1; // Default gain

            // Connect: microphone -> gain -> analyser
            this.microphone.connect(this.gainNode);
            this.gainNode.connect(this.analyser);

            // Setup canvas
            this.fftCanvas = document.getElementById('fftCanvas');
            this.fftCtx = this.fftCanvas.getContext('2d');

            // Setup media recorder
            this.mediaRecorder = new MediaRecorder(stream);
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            // DO NOT start visualization automatically - user will click start button

        } catch (error) {
            console.error('Error initializing audio:', error);
            throw error;
        }
    }

    setGain(value) {
        if (this.gainNode) {
            // Using setTargetAtTime for smooth transitions to avoid clicks
            this.gainNode.gain.setTargetAtTime(parseFloat(value), this.audioContext.currentTime, 0.01);
        }
    }

    setSmoothness(value) {
        this.smoothness = value;
        this.analyser.smoothingTimeConstant = 0.5 + (value * 0.4);
    }

    startVisualization() {
        if (this.isVisualizing) return;
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
        const parent = this.fftCanvas.parentElement;
        const width = parent.clientWidth;
        const height = 300;

        this.fftCanvas.width = width;
        this.fftCanvas.height = height;
    }

    visualize() {
        if (!this.isVisualizing) return;

        this.animationId = requestAnimationFrame(() => this.visualize());

        // Get frequency data
        this.analyser.getByteFrequencyData(this.dataArray);

        // Update level meter
        const average = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
        const normalizedLevel = average / 255;
        const levelBar = document.getElementById('levelBar');
        levelBar.style.transform = `scaleY(${normalizedLevel})`;
        
        const levelText = document.getElementById('levelText');
        if (normalizedLevel < 0.3) levelText.textContent = 'Quiet';
        else if (normalizedLevel < 0.7) levelText.textContent = 'Medium';
        else levelText.textContent = 'Loud';

        // Draw FFT spectrogram
        this.drawFFTSpectrogram();
    }

    drawFFTSpectrogram() {
        const ctx = this.fftCtx;
        const canvas = this.fftCanvas;
        const width = canvas.width;
        const height = canvas.height;

        // Scroll left
        const imageData = ctx.getImageData(1, 0, width - 1, height);
        ctx.putImageData(imageData, 0, 0);

        // Draw new column
        const barHeight = height / this.bufferLength;
        
        for (let i = 0; i < this.bufferLength; i++) {
            const value = this.dataArray[i];
            const percent = value / 255;
            
            // Color-blind friendly gradient: blue -> cyan -> yellow -> red
            let r, g, b;
            if (percent < 0.25) {
                r = 0;
                g = percent * 4 * 255;
                b = 255;
            } else if (percent < 0.5) {
                r = 0;
                g = 255;
                b = 255 - (percent - 0.25) * 4 * 255;
            } else if (percent < 0.75) {
                r = (percent - 0.5) * 4 * 255;
                g = 255;
                b = 0;
            } else {
                r = 255;
                g = 255 - (percent - 0.75) * 4 * 255;
                b = 0;
            }

            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(width - 1, height - i * barHeight, 1, barHeight);
        }
    }

    async startRecording() {
        this.recordedChunks = [];
        this.mediaRecorder.start();
    }

    async stopRecording() {
        return new Promise((resolve) => {
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                resolve(blob);
            };
            this.mediaRecorder.stop();
        });
    }

    getCanvasThumbnail() {
        // Return current FFT canvas as thumbnail
        return this.fftCanvas.toDataURL('image/png');
    }

    getSuggestedTags() {
        // Analyze frequency content to suggest tags
        const tags = [];
        
        const lowBand = this.dataArray.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
        const midBand = this.dataArray.slice(50, 200).reduce((a, b) => a + b, 0) / 150;
        const highBand = this.dataArray.slice(200, 512).reduce((a, b) => a + b, 0) / 312;
        
        const max = Math.max(lowBand, midBand, highBand);
        
        if (lowBand === max) {
            tags.push('low', 'rumble');
        } else if (midBand === max) {
            tags.push('buzzing');
        } else {
            tags.push('high', 'chirp');
        }
        
        const average = (lowBand + midBand + highBand) / 3;
        if (average < 50) {
            tags.push('quiet');
        } else if (average > 150) {
            tags.push('loud');
        }
        
        return tags;
    }

    getSoundCharacteristics() {
        if (!this.dataArray) return null;

        // Calculate various characteristics for mission checking
        const lowBand = this.dataArray.slice(0, 50);
        const midBand = this.dataArray.slice(50, 200);
        const highBand = this.dataArray.slice(200, 512);
        
        const lowAvg = lowBand.reduce((a, b) => a + b, 0) / lowBand.length;
        const midAvg = midBand.reduce((a, b) => a + b, 0) / midBand.length;
        const highAvg = highBand.reduce((a, b) => a + b, 0) / highBand.length;
        
        const overall = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
        
        // Find dominant frequency range
        const maxBand = Math.max(lowAvg, midAvg, highAvg);
        let dominantRange = 'mid';
        if (lowAvg === maxBand) dominantRange = 'low';
        if (highAvg === maxBand) dominantRange = 'high';
        
        return {
            overall,
            lowAvg,
            midAvg,
            highAvg,
            dominantRange
        };
    }

    // Store characteristics over time for analysis
    recordCharacteristics = [];
    
    startCharacteristicRecording() {
        this.recordCharacteristics = [];
    }
    
    captureCharacteristic() {
        const char = this.getSoundCharacteristics();
        if (char) {
            this.recordCharacteristics.push(char);
        }
    }
    
    getRecordedCharacteristics() {
        return this.recordCharacteristics;
    }
}