// main.ts - Main plugin file
import { ConnectionsModal, StructureNoteModal, WritingTopicsModal, 
         DailyReviewModal, OutlineModal, ProcessingModal, 
         QuickNoteModal } from './additional-modals';
import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, Modal, SuggestModal } from 'obsidian';

interface ZettelkastenSettings {
    apiKey: string;
    apiProvider: 'openai' | 'anthropic' | 'local';
    apiEndpoint: string;
    fleetingNotesFolder: string;
    permanentNotesFolder: string;
    structureNotesFolder: string;
    autoProcess: boolean;
    connectionThreshold: number;
}

const DEFAULT_SETTINGS: ZettelkastenSettings = {
    apiKey: '',
    apiProvider: 'openai',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    fleetingNotesFolder: 'Fleeting Notes',
    permanentNotesFolder: 'Permanent Notes',
    structureNotesFolder: 'Structure Notes',
    autoProcess: false,
    connectionThreshold: 0.7
}

export default class ZettelkastenPlugin extends Plugin {
    settings: ZettelkastenSettings;
    aiService: AIService;

    async onload() {
        await this.loadSettings();
        
        this.aiService = new AIService(this.settings, this.app);

        // Add ribbon icon
        this.addRibbonIcon('brain', 'Zettelkasten AI', () => {
            new ZettelkastenModal(this.app, this).open();
        });

        // Add commands
        this.addCommand({
            id: 'create-fleeting-note',
            name: 'Create Fleeting Note',
            callback: () => this.createFleetingNote()
        });

        this.addCommand({
            id: 'process-to-permanent',
            name: 'Process to Permanent Note',
            callback: () => this.processCurrentNoteToPermanent()
        });

        this.addCommand({
            id: 'find-connections',
            name: 'Find Connections',
            callback: () => this.findConnections()
        });

        this.addCommand({
            id: 'create-structure-note',
            name: 'Create Structure Note',
            callback: () => this.createStructureNote()
        });

        this.addCommand({
            id: 'suggest-writing-topics',
            name: 'Suggest Writing Topics',
            callback: () => this.suggestWritingTopics()
        });

        this.addCommand({
            id: 'daily-review',
            name: 'Daily Review Suggestions',
            callback: () => this.dailyReview()
        });

        // Add settings tab
        this.addSettingTab(new ZettelkastenSettingTab(this.app, this));

        // Auto-process fleeting notes if enabled
        if (this.settings.autoProcess) {
            this.registerInterval(
                window.setInterval(() => this.autoProcessFleetingNotes(), 60000)
            );
        }
    }

    async createFleetingNote() {
        const content = await this.promptForInput('Enter fleeting note content:');
        if (!content) return;

        const timestamp = this.generateTimestamp();
        const fileName = `Fleeting-${timestamp}.md`;
        const filePath = `${this.settings.fleetingNotesFolder}/${fileName}`;

        const noteContent = `---
type: fleeting
created: ${new Date().toISOString()}
processed: false
---

# Fleeting Note - ${timestamp}

${content}

## Processing Notes
<!-- AI will add processing suggestions here -->
`;

        await this.createNote(filePath, noteContent);
        new Notice('Fleeting note created!');
    }

    async processCurrentNoteToPermanent() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file');
            return;
        }

        const content = await this.app.vault.read(activeFile);
        const frontmatter = this.extractFrontmatter(content);
        
        if (frontmatter.type !== 'fleeting') {
            new Notice('Current note is not a fleeting note');
            return;
        }

        new ProcessingModal(this.app, this, activeFile, content).open();
    }

    async findConnections() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file');
            return;
        }

        const content = await this.app.vault.read(activeFile);
        const connections = await this.aiService.findSimilarNotes(content);
        
        new ConnectionsModal(this.app, connections).open();
    }

    async createStructureNote() {
        new StructureNoteModal(this.app, this).open();
    }

    async suggestWritingTopics() {
        const topics = await this.aiService.identifyWritingTopics();
        new WritingTopicsModal(this.app, this, topics).open();
    }

    async dailyReview() {
        const suggestions = await this.aiService.getDailyReviewSuggestions();
        new DailyReviewModal(this.app, suggestions).open();
    }

    // Helper methods
    generateTimestamp(): string {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    }

    async createNote(path: string, content: string): Promise<TFile> {
        // Ensure folder exists
        const folderPath = path.substring(0, path.lastIndexOf('/'));
        if (!(await this.app.vault.adapter.exists(folderPath))) {
            await this.app.vault.createFolder(folderPath);
        }

        return await this.app.vault.create(path, content);
    }

    extractFrontmatter(content: string): any {
        const match = content.match(/^---\n(.*?)\n---/s);
        if (!match) return {};
        
        try {
            return Object.fromEntries(
                match[1].split('\n')
                    .filter(line => line.includes(':'))
                    .map(line => {
                        const [key, ...value] = line.split(':');
                        return [key.trim(), value.join(':').trim()];
                    })
            );
        } catch {
            return {};
        }
    }

    async promptForInput(prompt: string): Promise<string> {
        return new Promise((resolve) => {
            new InputModal(this.app, prompt, resolve).open();
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// AI Service for handling LLM interactions
class AIService {
    constructor(private settings: ZettelkastenSettings, private app: App) {}

    async processFleetingToPermanent(content: string, userInput?: string): Promise<{
        title: string;
        content: string;
        keywords: string[];
        connections: string[];
    }> {
        const prompt = `
Convert this fleeting note to a permanent note following Zettelkasten principles:

Fleeting note: ${content}
User elaboration: ${userInput || 'None'}

Requirements:
1. Create atomic note (one clear idea)
2. Write for future ignorant self
3. Make self-contained
4. Suggest 2-3 potential keywords
5. Suggest potential connections to other concepts

Return JSON with: title, content, keywords, connections
`;

        const response = await this.callLLM(prompt);
        return JSON.parse(response);
    }

    async findSimilarNotes(content: string): Promise<Array<{
        file: string;
        similarity: number;
        reason: string;
    }>> {
        // Get all permanent notes
        const permanentNotes = this.app.vault.getFiles()
            .filter(file => file.path.startsWith('Permanent Notes/'));

        const similarities = [];
        
        for (const file of permanentNotes) {
            const noteContent = await this.app.vault.read(file);
            const similarity = await this.calculateSimilarity(content, noteContent);
            
            if (similarity > this.settings.connectionThreshold) {
                similarities.push({
                    file: file.name,
                    similarity,
                    reason: await this.explainConnection(content, noteContent)
                });
            }
        }

        return similarities.sort((a, b) => b.similarity - a.similarity);
    }

    async identifyWritingTopics(): Promise<Array<{
        topic: string;
        noteCount: number;
        readiness: number;
        angle: string;
    }>> {
        const allNotes = this.app.vault.getFiles()
            .filter(file => file.path.startsWith('Permanent Notes/'));

        const noteContents = await Promise.all(
            allNotes.map(file => this.app.vault.read(file))
        );

        const prompt = `
Analyze these notes and identify potential writing topics:

Notes: ${noteContents.slice(0, 50).join('\n---\n')}

Identify 3-5 topics where there are enough interconnected notes to write about.
For each topic, suggest:
1. Topic name
2. Estimated note count
3. Readiness score (1-10)
4. Unique writing angle

Return as JSON array.
`;

        const response = await this.callLLM(prompt);
        return JSON.parse(response);
    }

    async createStructureNote(topic: string, relatedFiles: string[]): Promise<string> {
        const noteContents = await Promise.all(
            relatedFiles.map(async fileName => {
                const file = this.app.vault.getAbstractFileByPath(fileName) as TFile;
                const content = await this.app.vault.read(file);
                return `${fileName}:\n${content}`;
            })
        );

        const prompt = `
Create a structure note for topic: ${topic}

Related notes:
${noteContents.join('\n---\n')}

Create a structure note that:
1. Provides topic overview
2. Organizes related notes logically
3. Identifies knowledge gaps
4. Uses Obsidian wiki-link format [[Note Name]]

Return the complete structure note content.
`;

        return await this.callLLM(prompt);
    }

    async getDailyReviewSuggestions(): Promise<{
        reviewNotes: string[];
        connectOrphans: string[];
        developClusters: string[];
    }> {
        // Implementation for daily review suggestions
        const allFiles = this.app.vault.getFiles();
        
        // Select random permanent notes for review
        const permanentNotes = allFiles
            .filter(f => f.path.startsWith('Permanent Notes/'))
            .sort(() => 0.5 - Math.random())
            .slice(0, 10)
            .map(f => f.name);

        // Find notes with few connections (orphans)
        const orphans = await this.findOrphanedNotes();
        
        // Identify developing clusters
        const clusters = await this.identifyDevelopingClusters();

        return {
            reviewNotes: permanentNotes,
            connectOrphans: orphans,
            developClusters: clusters
        };
    }

    private async callLLM(prompt: string): Promise<string> {
        const { apiProvider, apiKey, apiEndpoint } = this.settings;

        if (!apiKey) {
            throw new Error('API key not configured');
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };

        const body = {
            model: apiProvider === 'openai' ? 'gpt-4' : 'claude-3-sonnet-20240229',
            messages: [
                { role: 'user', content: prompt }
            ],
            max_tokens: 2000,
            temperature: 0.7
        };

        try {
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            const data = await response.json();
            return data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
        } catch (error) {
            console.error('LLM API call failed:', error);
            throw error;
        }
    }

    private async calculateSimilarity(content1: string, content2: string): Promise<number> {
        // Simple keyword-based similarity for demo
        // In production, use embeddings
        const words1 = content1.toLowerCase().split(/\s+/);
        const words2 = content2.toLowerCase().split(/\s+/);
        
        const intersection = words1.filter(word => words2.includes(word));
        const union = [...new Set([...words1, ...words2])];
        
        return intersection.length / union.length;
    }

    private async explainConnection(content1: string, content2: string): Promise<string> {
        const prompt = `
Explain how these two notes connect:

Note 1: ${content1.slice(0, 200)}...
Note 2: ${content2.slice(0, 200)}...

Provide a brief explanation of their relationship.
`;

        return await this.callLLM(prompt);
    }

    private async findOrphanedNotes(): Promise<string[]> {
        // Find notes with few internal links
        const files = this.app.vault.getFiles()
            .filter(f => f.path.startsWith('Permanent Notes/'));
        
        const orphans = [];
        for (const file of files) {
            const content = await this.app.vault.read(file);
            const linkCount = (content.match(/\[\[.*?\]\]/g) || []).length;
            
            if (linkCount < 2) {
                orphans.push(file.name);
            }
        }
        
        return orphans.slice(0, 5);
    }

    private async identifyDevelopingClusters(): Promise<string[]> {
        // Identify topics with 3-4 notes that could become larger clusters
        return ['productivity', 'learning theory', 'systems thinking'];
    }
}

// Modal classes for UI interactions
class ZettelkastenModal extends Modal {
    plugin: ZettelkastenPlugin;

    constructor(app: App, plugin: ZettelkastenPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Zettelkasten AI Assistant' });

        const buttonContainer = contentEl.createDiv('zettelkasten-buttons');

        const buttons = [
            { text: 'Create Fleeting Note', action: () => this.plugin.createFleetingNote() },
            { text: 'Process Current Note', action: () => this.plugin.processCurrentNoteToPermanent() },
            { text: 'Find Connections', action: () => this.plugin.findConnections() },
            { text: 'Create Structure Note', action: () => this.plugin.createStructureNote() },
            { text: 'Writing Topics', action: () => this.plugin.suggestWritingTopics() },
            { text: 'Daily Review', action: () => this.plugin.dailyReview() }
        ];

        buttons.forEach(({ text, action }) => {
            buttonContainer.createEl('button', { text }, btn => {
                btn.addEventListener('click', () => {
                    action();
                    this.close();
                });
            });
        });
    }
}

class ProcessingModal extends Modal {
    plugin: ZettelkastenPlugin;
    file: TFile;
    content: string;

    constructor(app: App, plugin: ZettelkastenPlugin, file: TFile, content: string) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.content = content;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Process to Permanent Note' });

        const textArea = contentEl.createEl('textarea', {
            placeholder: 'Add any elaboration or context...'
        });
        textArea.rows = 4;
        textArea.style.width = '100%';

        const buttonContainer = contentEl.createDiv();
        
        const processBtn = buttonContainer.createEl('button', { text: 'Process' });
        processBtn.addEventListener('click', async () => {
            try {
                const elaboration = textArea.value;
                const result = await this.plugin.aiService.processFleetingToPermanent(
                    this.content, 
                    elaboration
                );

                // Create permanent note
                const timestamp = this.plugin.generateTimestamp();
                const fileName = `${result.title.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.md`;
                const filePath = `${this.plugin.settings.permanentNotesFolder}/${fileName}`;

                const noteContent = `---
type: permanent
created: ${new Date().toISOString()}
keywords: [${result.keywords.map(k => `"${k}"`).join(', ')}]
---

# ${result.title}

${result.content}

## Potential Connections
${result.connections.map(c => `- ${c}`).join('\n')}

## Source
Processed from: [[${this.file.basename}]]
`;

                await this.plugin.createNote(filePath, noteContent);
                
                // Update original fleeting note
                const updatedFleeting = this.content.replace(
                    '<!-- AI will add processing suggestions here -->',
                    `<!-- Processed to: [[${result.title}]] -->`
                );
                await this.app.vault.modify(this.file, updatedFleeting);

                new Notice(`Created permanent note: ${result.title}`);
                this.close();
            } catch (error) {
                new Notice('Processing failed: ' + error.message);
            }
        });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
    }
}

class InputModal extends Modal {
    resolve: (value: string) => void;
    prompt: string;

    constructor(app: App, prompt: string, resolve: (value: string) => void) {
        super(app);
        this.prompt = prompt;
        this.resolve = resolve;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: this.prompt });

        const input = contentEl.createEl('input', { type: 'text' });
        input.style.width = '100%';
        input.style.marginBottom = '1em';

        const submitBtn = contentEl.createEl('button', { text: 'Submit' });
        submitBtn.addEventListener('click', () => {
            this.resolve(input.value);
            this.close();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.resolve(input.value);
                this.close();
            }
        });

        input.focus();
    }
}

// Additional modal classes (ConnectionsModal, StructureNoteModal, etc.) would follow similar patterns...

// Settings tab
class ZettelkastenSettingTab extends PluginSettingTab {
    plugin: ZettelkastenPlugin;

    constructor(app: App, plugin: ZettelkastenPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Zettelkasten AI Settings' });

        new Setting(containerEl)
            .setName('API Provider')
            .setDesc('Choose your AI service provider')
            .addDropdown(dropdown => dropdown
                .addOption('openai', 'OpenAI')
                .addOption('anthropic', 'Anthropic')
                .addOption('local', 'Local LLM')
                .setValue(this.plugin.settings.apiProvider)
                .onChange(async (value) => {
                    this.plugin.settings.apiProvider = value as any;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Your API key for the chosen provider')
            .addText(text => text
                .setPlaceholder('sk-...')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Fleeting Notes Folder')
            .setDesc('Folder for fleeting notes')
            .addText(text => text
                .setValue(this.plugin.settings.fleetingNotesFolder)
                .onChange(async (value) => {
                    this.plugin.settings.fleetingNotesFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Permanent Notes Folder')
            .setDesc('Folder for permanent notes')
            .addText(text => text
                .setValue(this.plugin.settings.permanentNotesFolder)
                .onChange(async (value) => {
                    this.plugin.settings.permanentNotesFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Connection Threshold')
            .setDesc('Minimum similarity score for suggesting connections (0-1)')
            .addSlider(slider => slider
                .setLimits(0.1, 1.0, 0.1)
                .setValue(this.plugin.settings.connectionThreshold)
                .onChange(async (value) => {
                    this.plugin.settings.connectionThreshold = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-process')
            .setDesc('Automatically suggest processing fleeting notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoProcess)
                .onChange(async (value) => {
                    this.plugin.settings.autoProcess = value;
                    await this.plugin.saveSettings();
                }));
    }
}
