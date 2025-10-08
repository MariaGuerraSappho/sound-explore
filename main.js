import { AudioProcessor } from './audio-processor.js';
import { Storage } from './storage.js';
import { Exporter } from './export-package.js';

class SoundExplorer {
    constructor() {
        this.storage = new Storage();
        this.audioProcessor = null;
        this.currentRecording = null;
        this.currentTab = 'listen';
        this.recordings = [];
        this.isRecording = false;
        this.recordingStartTime = 0;
        this.recordingDuration = 7000; // ms
        this.geolocationEnabled = false; // retained internally but UI removed
        this.mapBackgroundUrl = null;
        this.currentAudio = null;
        this.draggedRecording = null;
        this.mapPositions = {}; // Store positions of recordings on map
        this.mapActiveTags = [];
        
        // Sound Hunt missions
        this.missions = [
            {
                id: 'quiet-quest',
                name: 'Quiet Quest',
                description: 'Find a very soft sound',
                icon: '',
                check: (chars) => {
                    const avgVolume = chars.reduce((sum, c) => sum + c.overall, 0) / chars.length;
                    return avgVolume < 50;
                }
            },
            {
                id: 'big-boom',
                name: 'Big Boom',
                description: 'Find a very loud sound',
                icon: '',
                check: (chars) => {
                    const maxVolume = Math.max(...chars.map(c => c.overall));
                    return maxVolume > 150;
                }
            },
            {
                id: 'steady-sound',
                name: 'Steady Sound',
                description: 'Record a sound that stays constant',
                icon: '',
                check: (chars) => {
                    if (chars.length < 10) return false;
                    const volumes = chars.map(c => c.overall);
                    const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
                    const variance = volumes.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / volumes.length;
                    return variance < 500 && avg > 30;
                }
            },
            {
                id: 'pattern-pro',
                name: 'Pattern Pro',
                description: 'Record a sound with a repeating pattern',
                icon: '',
                check: (chars) => {
                    if (chars.length < 15) return false;
                    // Look for volume changes that repeat
                    const volumes = chars.map(c => c.overall);
                    const threshold = volumes.reduce((a, b) => a + b, 0) / volumes.length;
                    
                    let peaks = 0;
                    for (let i = 1; i < volumes.length - 1; i++) {
                        if (volumes[i] > threshold * 1.2 && volumes[i] > volumes[i-1] && volumes[i] > volumes[i+1]) {
                            peaks++;
                        }
                    }
                    
                    return peaks >= 3;
                }
            },
            {
                id: 'rumble-ranger',
                name: 'Rumble Ranger',
                description: 'Record a low, rumbling sound',
                icon: '',
                check: (chars) => {
                    const avgLow = chars.reduce((sum, c) => sum + c.lowAvg, 0) / chars.length;
                    const avgHigh = chars.reduce((sum, c) => sum + c.highAvg, 0) / chars.length;
                    return avgLow > 50 && avgLow > avgHigh * 1.3;
                }
            },
            {
                id: 'chirp-chaser',
                name: 'Chirp Chaser',
                description: 'Record a high, chirping sound',
                icon: '',
                check: (chars) => {
                    const avgHigh = chars.reduce((sum, c) => sum + c.highAvg, 0) / chars.length;
                    const avgLow = chars.reduce((sum, c) => sum + c.lowAvg, 0) / chars.length;
                    return avgHigh > 50 && avgHigh > avgLow * 1.3;
                }
            }
        ];
        
        this.completedMissions = [];
        
        this.init();
    }

    async init() {
        // Check if first run
        const hasSeenOnboarding = await this.storage.get('hasSeenOnboarding');
        
        if (!hasSeenOnboarding) {
            this.showOnboarding();
        } else {
            await this.loadSettings();
            await this.loadRecordings();
            this.showApp();
        }
        
        this.setupEventListeners();
        
        // Remove service worker registration due to hosting environment limitations
    }

    showOnboarding() {
        document.getElementById('onboarding').classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
    }

    showApp() {
        document.getElementById('onboarding').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }

    setupEventListeners() {
        // Onboarding
        document.getElementById('allowMicBtn').addEventListener('click', async () => {
            try {
                await this.initAudio();
                document.querySelector('[data-step="1"]').classList.add('hidden');
                document.querySelector('[data-step="2"]').classList.remove('hidden');
            } catch (error) {
                alert('Could not access microphone. Please check permissions.');
                console.error(error);
            }
        });

        document.getElementById('startExploringBtn').addEventListener('click', async () => {
            await this.storage.set('hasSeenOnboarding', true);
            this.showApp();
        });

        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Visualization start/stop button
        document.getElementById('vizStartBtn').addEventListener('click', () => this.toggleVisualization());

        // Listen controls - removed smoothness and focus sliders
        document.getElementById('recordBtn').addEventListener('click', () => this.toggleRecording());

        document.getElementById('gainSlider').addEventListener('input', (e) => {
            if (this.audioProcessor) {
                this.audioProcessor.setGain(e.target.value);
            }
        });

        // Label modal
        document.getElementById('saveLabel').addEventListener('click', () => this.saveRecording());
        document.getElementById('cancelLabel').addEventListener('click', () => this.closeLabelModal());

        document.querySelectorAll('.tag-btn').forEach(btn => {
            btn.addEventListener('click', () => btn.classList.toggle('active'));
        });

        // Gallery
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterGallery(e.target.value);
        });

        // Settings
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('closeSettings').addEventListener('click', () => this.closeSettings());
        
        document.getElementById('recordingLength').addEventListener('input', (e) => {
            this.recordingDuration = e.target.value * 1000;
            document.getElementById('recordingLengthValue').textContent = `${e.target.value} seconds`;
        });

        // geolocation toggle removed from UI; no event listener needed

        document.getElementById('uploadMapBtn').addEventListener('click', () => {
            document.getElementById('mapBackgroundUpload').click();
        });

        document.getElementById('mapBackgroundUpload').addEventListener('change', (e) => {
            this.uploadMapBackground(e.target.files[0]);
        });

        document.getElementById('exportDataBtn').addEventListener('click', () => this.exportPackage());
        document.getElementById('sharePackageBtn').addEventListener('click', () => this.exportPackage(true));
        document.getElementById('importDataBtn').addEventListener('click', () => {
            document.getElementById('importDataFile').click();
        });
        document.getElementById('importDataFile').addEventListener('change', (e) => {
            this.importData(e.target.files[0]);
        });

        document.getElementById('clearDataBtn').addEventListener('click', () => this.confirmClearData());

        // Confirm modal
        document.getElementById('confirmCancel').addEventListener('click', () => {
            document.getElementById('confirmModal').classList.add('hidden');
        });

        window.addEventListener('resize', () => this.resizeMapToImage());
    }

    async initAudio() {
        this.audioProcessor = new AudioProcessor();
        await this.audioProcessor.init();
        
        // Don't start visualization automatically - wait for user to click start button
    }

    switchTab(tab) {
        this.currentTab = tab;
        
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tab}Tab`);
        });

        // Handle tab-specific logic
        if (tab === 'gallery') {
            this.renderGallery();
        }

        if (tab === 'map') {
            this.renderMap();
            // ensure sizing after Map tab becomes visible
            requestAnimationFrame(() => this.resizeMapToImage());
        }

        if (tab === 'hunt') {
            this.renderMissions();
        }
    }

    async toggleRecording() {
        if (!this.audioProcessor || !this.audioProcessor.isVisualizing) {
            alert('Please start listening first by clicking the START LISTENING button.');
            return;
        }

        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    async startRecording() {
        this.isRecording = true;
        this.recordingStartTime = Date.now();

        const recordBtn = document.getElementById('recordBtn');
        recordBtn.classList.add('recording');
        recordBtn.querySelector('.record-text').textContent = 'RECORDING...';

        const timer = document.getElementById('recordingTimer');
        timer.classList.remove('hidden');

        // Update timer
        const timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            document.getElementById('timerText').textContent = `${elapsed}s`;
        }, 100);

        // Start recording audio
        await this.audioProcessor.startRecording();
        
        // Start capturing characteristics for mission checking
        this.audioProcessor.startCharacteristicRecording();
        this.characteristicInterval = setInterval(() => {
            this.audioProcessor.captureCharacteristic();
        }, 100);

        // Auto-stop after duration
        setTimeout(() => {
            if (this.isRecording) {
                clearInterval(timerInterval);
                this.stopRecording();
            }
        }, this.recordingDuration);
    }

    async stopRecording() {
        this.isRecording = false;
        
        // Stop capturing characteristics
        if (this.characteristicInterval) {
            clearInterval(this.characteristicInterval);
            this.characteristicInterval = null;
        }

        const recordBtn = document.getElementById('recordBtn');
        recordBtn.classList.remove('recording');
        recordBtn.querySelector('.record-text').textContent = 'RECORD';

        document.getElementById('recordingTimer').classList.add('hidden');

        // Get recording data
        const audioBlob = await this.audioProcessor.stopRecording();
        const thumbnail = this.audioProcessor.getCanvasThumbnail();

        // Location tagging is disabled (removed from UI); leave location null
        const location = null;

        // Prepare recording object
        this.currentRecording = {
            audioBlob,
            thumbnail,
            timestamp: Date.now(),
            location,
            characteristics: this.audioProcessor.getRecordedCharacteristics(),
            duration: Date.now() - this.recordingStartTime
        };

        // Show label modal
        this.showLabelModal();
    }

    showLabelModal() {
        document.getElementById('labelModal').classList.remove('hidden');
        document.getElementById('labelInput').value = '';
        document.getElementById('labelInput').focus();
        
        // Reset tags
        document.querySelectorAll('.tag-btn').forEach(btn => {
            btn.classList.remove('active');
        });
    }

    closeLabelModal() {
        document.getElementById('labelModal').classList.add('hidden');
        this.currentRecording = null;
    }

    async saveRecording() {
        const label = document.getElementById('labelInput').value.trim() || 'Untitled Sound';
        const tags = Array.from(document.querySelectorAll('.tag-btn.active'))
            .map(btn => btn.dataset.tag);

        const recording = {
            ...this.currentRecording,
            label,
            tags,
            id: Date.now().toString()
        };

        // Save to storage
        await this.storage.saveRecording(recording);
        this.recordings.push(recording);

        this.closeLabelModal();
        
        // Check missions
        this.checkMissions(recording);

        // Switch to gallery to show the new recording
        this.switchTab('gallery');
    }

    checkMissions(recording) {
        let bestMatch = null;
        
        for (const mission of this.missions) {
            // Skip if already completed
            if (this.completedMissions.includes(mission.id)) continue;
            
            // Check if this recording matches the mission
            const matches = mission.check(recording.characteristics, recording.duration);
            
            if (matches) {
                // Take the first matching mission as the best match
                bestMatch = mission;
                break;
            }
        }
        
        // Award only the best matching badge
        if (bestMatch) {
            this.completedMissions.push(bestMatch.id);
            
            // Save progress
            this.storage.set('completedMissions', this.completedMissions);
            
            // Show badge popup for the earned mission
            this.showBadgePopup(bestMatch);
        }
    }

    showBadgePopup(mission) {
        const popup = document.getElementById('badgePopup');
        document.getElementById('badgePopupIcon').textContent = mission.icon;
        document.getElementById('badgePopupTitle').textContent = `${mission.name} Complete!`;
        document.getElementById('badgePopupMessage').textContent = mission.description;
        
        popup.classList.remove('hidden');
        
        document.getElementById('closeBadgePopup').onclick = () => {
            popup.classList.add('hidden');
        };
    }

    async loadRecordings() {
        this.recordings = await this.storage.getAllRecordings();
    }

    async loadSettings() {
        const duration = await this.storage.get('recordingDuration');
        if (duration) {
            this.recordingDuration = duration;
            document.getElementById('recordingLength').value = duration / 1000;
            document.getElementById('recordingLengthValue').textContent = `${duration / 1000} seconds`;
        }

        // geolocation setting removed; ignore stored value if any

        this.mapBackgroundUrl = await this.storage.get('mapBackground');
        if (this.mapBackgroundUrl) {
            const img = document.getElementById('mapBackground');
            img.onload = () => { this.resizeMapToImage(); document.getElementById('mapContainer').classList.add('has-image'); };
            img.src = this.mapBackgroundUrl;
            img.classList.remove('hidden');
        }
        
        // Load map positions
        const positions = await this.storage.get('mapPositions');
        if (positions) {
            this.mapPositions = positions;
        }
    }

    renderGallery() {
        const grid = document.getElementById('galleryGrid');
        
        if (this.recordings.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎵</div>
                    <p>No sounds recorded yet!</p>
                    <p>Go to the Listen tab and press RECORD to capture your first sound.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.recordings.map(rec => `
            <div class="sound-card" data-id="${rec.id}">
                <img src="${rec.thumbnail}" alt="${rec.label}" class="sound-card-image">
                <div class="sound-card-content">
                    <h3 class="sound-card-label">${rec.label}</h3>
                    <div class="sound-card-meta">
                        <span>📅 ${new Date(rec.timestamp).toLocaleDateString()}</span>
                        ${rec.location ? '<span>📍 Location</span>' : ''}
                    </div>
                    <div class="sound-card-tags">
                        ${rec.tags.map(tag => `<span class="tag-chip">${tag}</span>`).join('')}
                    </div>
                    <div class="sound-card-controls">
                        <button class="btn-play" data-id="${rec.id}">
                            <span>▶️ Play</span>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        // Add play button listeners
        grid.querySelectorAll('.btn-play').forEach(btn => {
            btn.addEventListener('click', () => this.playRecording(btn.dataset.id));
        });

        // Render filter tags
        const allTags = [...new Set(this.recordings.flatMap(r => r.tags))];
        const filterContainer = document.getElementById('filterTags');
        filterContainer.innerHTML = allTags.map(tag => `
            <button class="filter-tag" data-tag="${tag}">${tag}</button>
        `).join('');

        filterContainer.querySelectorAll('.filter-tag').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                this.filterGalleryByTags();
            });
        });
    }

    filterGallery(searchTerm) {
        const cards = document.querySelectorAll('.sound-card');
        cards.forEach(card => {
            const label = card.querySelector('.sound-card-label').textContent.toLowerCase();
            const tags = Array.from(card.querySelectorAll('.tag-chip'))
                .map(t => t.textContent.toLowerCase());
            
            const matches = label.includes(searchTerm.toLowerCase()) ||
                          tags.some(tag => tag.includes(searchTerm.toLowerCase()));
            
            card.style.display = matches ? 'block' : 'none';
        });
    }

    filterGalleryByTags() {
        const activeTags = Array.from(document.querySelectorAll('.filter-tag.active'))
            .map(btn => btn.dataset.tag);

        if (activeTags.length === 0) {
            document.querySelectorAll('.sound-card').forEach(card => {
                card.style.display = 'block';
            });
            return;
        }

        document.querySelectorAll('.sound-card').forEach(card => {
            const cardTags = Array.from(card.querySelectorAll('.tag-chip'))
                .map(t => t.textContent);
            
            const matches = activeTags.some(tag => cardTags.includes(tag));
            card.style.display = matches ? 'block' : 'none';
        });
    }

    async playRecording(id) {
        const recording = this.recordings.find(r => r.id === id);
        if (!recording) return;

        // Stop current audio
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }

        const btn = document.querySelector(`.btn-play[data-id="${id}"]`);
        
        // Create audio element
        const audio = new Audio(URL.createObjectURL(recording.audioBlob));
        this.currentAudio = audio;

        if (btn) {
            btn.classList.add('playing');
            btn.innerHTML = '<span>⏸️ Playing</span>';
        }

        audio.play();

        audio.onended = () => {
            if (btn) {
                btn.classList.remove('playing');
                btn.innerHTML = '<span>▶️ Play</span>';
            }
            this.currentAudio = null;
        };
    }

    renderMap() {
        const overlay = document.getElementById('mapOverlay');
        const emptyState = document.getElementById('mapEmptyState');
        const recordingsGrid = document.getElementById('mapRecordingsGrid');
        const filterBar = document.getElementById('mapFilterTags');
        
        // Get recordings that are placed on the map
        const recordingsOnMap = Object.keys(this.mapPositions);
        const recordingsNotOnMap = this.recordings.filter(r => !this.mapPositions[r.id]);

        if (recordingsOnMap.length === 0) {
            emptyState.style.display = 'flex';
        } else {
            emptyState.style.display = 'none';
        }

        // Render recordings on the map
        overlay.innerHTML = recordingsOnMap.map(recId => {
            const rec = this.recordings.find(r => r.id === recId);
            if (!rec) return '';
            
            const pos = this.mapPositions[recId];
            
            return `
                <div class="map-pin" 
                     style="left: ${pos.x}%; top: ${pos.y}%; background: ${pos.color || '#8b5cf6'};" 
                     data-id="${rec.id}"
                     draggable="true">
                    📍
                    <span class="map-pin-label">${rec.label}</span>
                    <button class="map-pin-remove" data-id="${rec.id}">×</button>
                </div>
            `;
        }).join('');

        // Add click listeners to pins for playing
        overlay.querySelectorAll('.map-pin').forEach(pin => {
            pin.addEventListener('click', () => {
                this.playRecording(pin.dataset.id);
            });
            
            // Add drag listeners for repositioning
            pin.addEventListener('dragstart', (e) => {
                this.draggedRecording = pin.dataset.id;
            });
        });

        // Add remove button listeners with stopPropagation
        overlay.querySelectorAll('.map-pin-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeFromMap(btn.dataset.id);
            });
        });

        // Render draggable recordings list
        const allTags = [...new Set(this.recordings.flatMap(r => r.tags || []))];
        filterBar.innerHTML = allTags.map(t => `<button class="filter-tag ${this.mapActiveTags.includes(t)?'active':''}" data-tag="${t}">${t}</button>`).join('');
        filterBar.querySelectorAll('.filter-tag').forEach(btn=>{
            btn.onclick=()=>{ const tag=btn.dataset.tag; const idx=this.mapActiveTags.indexOf(tag);
                if(idx>-1){ this.mapActiveTags.splice(idx,1); btn.classList.remove('active'); } else { this.mapActiveTags.push(tag); btn.classList.add('active'); }
                this.renderMap();
            };
        });
        
        const list = this.recordings.filter(r => !this.mapPositions[r.id]).filter(r => this.mapActiveTags.length===0 || (r.tags||[]).some(t=>this.mapActiveTags.includes(t)));
        recordingsGrid.innerHTML = list.map(rec => {
            const color = this.getColorForRecording(rec.id);
            return `
                <div class="map-recording-item" data-id="${rec.id}" draggable="true">
                    <div class="map-recording-dot" style="background:${color}"></div>
                    <div class="map-recording-label">${rec.label}</div>
                </div>`;
        }).join('');

        recordingsGrid.querySelectorAll('.map-recording-item').forEach(item=>{
            item.addEventListener('dragstart', (e) => { this.draggedRecording = item.dataset.id; e.dataTransfer.effectAllowed='move'; item.style.opacity='0.5'; });
            item.addEventListener('dragend', () => { item.style.opacity='1'; });
        });

        // Setup drop zone on map container
        const mapContainer = document.getElementById('mapContainer');
        
        mapContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            mapContainer.classList.add('drag-over');
        });
        
        mapContainer.addEventListener('dragleave', (e) => {
            if (e.target === mapContainer) {
                mapContainer.classList.remove('drag-over');
            }
        });
        
        mapContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            mapContainer.classList.remove('drag-over');
            
            if (!this.draggedRecording) return;
            
            // Calculate position relative to map container
            const rect = mapContainer.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            
            // Clamp to bounds
            const clampedX = Math.max(5, Math.min(95, x));
            const clampedY = Math.max(5, Math.min(95, y));
            
            this.addToMap(this.draggedRecording, clampedX, clampedY);
            this.draggedRecording = null;
        });

        // ensure background image is visible if available
        if (this.mapBackgroundUrl) {
            const img = document.getElementById('mapBackground');
            if (img.src !== this.mapBackgroundUrl) {
                img.onload = () => { this.resizeMapToImage(); };
                img.src = this.mapBackgroundUrl;
            }
            img.classList.remove('hidden');
            document.getElementById('mapContainer').classList.add('has-image');
            // in case image is already loaded
            if (img.complete && img.naturalWidth) this.resizeMapToImage();
        }
    }

    async addToMap(recordingId, x, y) {
        const color = this.mapPositions[recordingId]?.color || this.getColorForRecording(recordingId);
        this.mapPositions[recordingId] = { x, y, color };
        await this.storage.set('mapPositions', this.mapPositions);
        this.renderMap();
    }

    async removeFromMap(recordingId) {
        delete this.mapPositions[recordingId];
        await this.storage.set('mapPositions', this.mapPositions);
        this.renderMap();
    }

    renderMissions() {
        // Update stats in header
        const statsDiv = document.getElementById('badgesStats');
        const completed = this.completedMissions.length;
        const total = this.missions.length;
        
        statsDiv.innerHTML = `
            <div>🏆 ${completed} / ${total} Badges Earned</div>
        `;
        
        const grid = document.getElementById('missionsGrid');
        
        grid.innerHTML = this.missions.map(mission => {
            const completed = this.completedMissions.includes(mission.id);
            return `
                <div class="mission-card ${completed ? 'completed' : ''}">
                    <div class="mission-icon">${mission.icon}</div>
                    <h3 class="mission-title">${mission.name}</h3>
                    <p class="mission-description">${mission.description}</p>
                    <div class="mission-progress">
                        ${completed ? '🏆 Badge Earned!' : '🎯 Complete this mission to earn the badge'}
                    </div>
                </div>
            `;
        }).join('');
    }

    openSettings() {
        document.getElementById('settingsModal').classList.remove('hidden');
    }

    closeSettings() {
        document.getElementById('settingsModal').classList.add('hidden');
    }

    async uploadMapBackground(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const img = document.getElementById('mapBackground');
            img.onload = () => { this.resizeMapToImage(); document.getElementById('mapContainer').classList.add('has-image'); };
            this.mapBackgroundUrl = e.target.result;
            await this.storage.set('mapBackground', e.target.result);
            img.src = e.target.result;
            img.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }

    async exportPackage(share = false) {
        const exporter = new Exporter();
        const { blob, filename } = await exporter.createZip({
            recordings: this.recordings,
            mapPositions: this.mapPositions,
            mapBackgroundUrl: this.mapBackgroundUrl
        });
        const file = new File([blob], filename, { type: 'application/zip' });

        if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: 'Sound Explorer Package' }); } catch {}
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }

    async importData(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                // Clear existing data
                await this.storage.clear();
                
                // Import recordings
                for (const rec of data.recordings) {
                    const audioBlob = await this.base64ToBlob(rec.audioData);
                    const recording = {
                        ...rec,
                        audioBlob
                    };
                    await this.storage.saveRecording(recording);
                }

                // Import settings
                if (data.settings) {
                    await this.storage.set('recordingDuration', data.settings.recordingDuration);
                    await this.storage.set('geolocationEnabled', data.settings.geolocationEnabled);
                    await this.storage.set('mapBackground', data.settings.mapBackground);
                }

                // Reload
                await this.loadRecordings();
                await this.loadSettings();
                
                alert('Data imported successfully!');
                this.closeSettings();
            } catch (error) {
                alert('Error importing data: ' + error.message);
            }
        };
        reader.readAsText(file);
    }

    confirmClearData() {
        const modal = document.getElementById('confirmModal');
        document.getElementById('confirmMessage').textContent = 
            'This will delete ALL your recordings and settings. This cannot be undone!';
        
        modal.classList.remove('hidden');
        
        document.getElementById('confirmOk').onclick = async () => {
            await this.storage.clear();
            this.recordings = [];
            this.renderGallery();
            modal.classList.add('hidden');
            alert('All data cleared!');
        };
    }

    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async base64ToBlob(base64) {
        const response = await fetch(base64);
        return response.blob();
    }

    async toggleVisualization() {
        if (!this.audioProcessor) {
            try {
                await this.initAudio();
            } catch (error) {
                alert('Could not access microphone. Please check permissions.');
                console.error(error);
                return;
            }
        }

        const btn = document.getElementById('vizStartBtn');
        const icon = btn.querySelector('.viz-start-icon');
        const text = btn.querySelector('.viz-start-text');

        if (this.audioProcessor.isVisualizing) {
            this.audioProcessor.stopVisualization();
            btn.classList.remove('active');
            icon.textContent = '▶️';
            text.textContent = 'START LISTENING';
        } else {
            this.audioProcessor.startVisualization();
            btn.classList.add('active');
            icon.textContent = '⏹️';
            text.textContent = 'STOP LISTENING';
        }
    }
    
    getColorForRecording(id) {
        // Deterministic bright color per id
        const hue = parseInt(id, 10) % 360;
        return `hsl(${hue}, 75%, 55%)`;
    }

    resizeMapToImage() {
        const img = document.getElementById('mapBackground');
        const container = document.getElementById('mapContainer');
        if (!img || img.classList.contains('hidden') || !img.naturalWidth) return;
        if (container.clientWidth === 0) { requestAnimationFrame(() => this.resizeMapToImage()); return; }
        const ratio = img.naturalHeight / img.naturalWidth;
        container.style.height = `${Math.round(container.clientWidth * ratio)}px`;
    }
}

// Initialize app
const app = new SoundExplorer();