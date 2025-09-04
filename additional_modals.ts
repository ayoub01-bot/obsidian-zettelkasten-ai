// additional-modals.ts - Additional modal components for the plugin

import { App, Modal, Notice, TFile, Setting } from 'obsidian';
import ZettelkastenPlugin from './main';

// Modal for displaying connection suggestions
export class ConnectionsModal extends Modal {
    connections: Array<{
        file: string;
        similarity: number;
        reason: string;
    }>;

    constructor(app: App, connections: any[]) {
        super(app);
        this.connections = connections;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Suggested Connections' });

        if (this.connections.length === 0) {
            contentEl.createEl('p', { text: 'No connections found. Try lowering the connection threshold in settings.' });
            return;
        }

        const connectionsList = contentEl.createDiv('connections-list');

        this.connections.forEach(connection => {
            const connectionItem = connectionsList.createDiv('connection-item');
            
            const header = connectionItem.createDiv('connection-header');
            const title = header.createEl('h4', { text: connection.file });
            const similarity = header.createEl('span', { 
                text: `${(connection.similarity * 100).toFixed(0)}% match`,
                cls: 'connection-similarity'
            });

            const reason = connectionItem.createEl('p', { text: connection.reason });

            const linkBtn = connectionItem.createEl('button', { text: 'Add Link' });
            linkBtn.addEventListener('click', async () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return;

                const content = await this.app.vault.read(activeFile);
                const linkText = `\n\n## Related\n- [[${connection.file.replace('.md', '')}]] - ${connection.reason}`;
                
                await this.app.vault.modify(activeFile, content + linkText);
                new Notice(`Added link to ${connection.file}`);
                this.close();
            });
        });
    }
}

// Modal for creating structure notes
export class StructureNoteModal extends Modal {
    plugin: ZettelkastenPlugin;
    selectedNotes: string[] = [];

    constructor(app: App, plugin: ZettelkastenPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Create Structure Note' });

        // Topic input
        const topicSetting = new Setting(contentEl)
            .setName('Topic')
            .setDesc('What topic should this structure note organize?')
            .addText(text => text.setPlaceholder('e.g., "Machine Learning Concepts"'));

        // Note selection
        contentEl.createEl('h3', { text: 'Select Related Notes' });
        
        const notesList = contentEl.createDiv('notes-selection');
        const permanentNotes = this.app.vault.getFiles()
            .filter(file => file.path.startsWith(this.plugin.settings.permanentNotesFolder));

        permanentNotes.forEach(file => {
            const noteItem = notesList.createDiv('note-selection-item');
            
            const checkbox = noteItem.createEl('input', { type: 'checkbox' });
            checkbox.id = file.path;
            checkbox.addEventListener('change', (e) => {
                if ((e.target as HTMLInputElement).checked) {
                    this.selectedNotes.push(file.path);
                } else {
                    this.selectedNotes = this.selectedNotes.filter(path => path !== file.path);
                }
            });

            const label = noteItem.createEl('label', { text: file.basename });
            label.htmlFor = file.path;
        });

        // Buttons
        const buttonContainer = contentEl.createDiv('button-container');
        
        const createBtn = buttonContainer.createEl('button', { text: 'Create Structure Note', cls: 'primary' });
        createBtn.addEventListener('click', async () => {
            const topicInput = contentEl.querySelector('input[type="text"]') as HTMLInputElement;
            const topic = topicInput.value;

            if (!topic) {
                new Notice('Please enter a topic');
                return;
            }

            if (this.selectedNotes.length === 0) {
                new Notice('Please select at least one note');
                return;
            }

            try {
                const structureId = await this.plugin.aiService.createStructureNote(topic, this.selectedNotes);
                new Notice(`Created structure note for: ${topic}`);
                this.close();
            } catch (error) {
                new Notice('Failed to create structure note: ' + error.message);
            }
        });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
    }
}

// Modal for displaying writing topic suggestions
export class WritingTopicsModal extends Modal {
    plugin: ZettelkastenPlugin;
    topics: Array<{
        topic: string;
        noteCount: number;
        readiness: number;
        angle: string;
    }>;

    constructor(app: App, plugin: ZettelkastenPlugin, topics: any[]) {
        super(app);
        this.plugin = plugin;
        this.topics = topics;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Suggested Writing Topics' });

        if (this.topics.length === 0) {
            contentEl.createEl('p', { text: 'No writing topics ready yet. Continue building your note collection!' });
            return;
        }

        const topicsList = contentEl.createDiv('writing-topics-list');

        this.topics.forEach(topic => {
            const topicItem = topicsList.createDiv('writing-topic-item');
            
            const header = topicItem.createDiv('writing-topic-header');
            const title = header.createEl('h3', { text: topic.topic });
            const readiness = header.createEl('span', { 
                text: `${topic.readiness}/10`,
                cls: 'readiness-score'
            });

            const details = topicItem.createDiv('topic-details');
            details.createEl('p', { text: `${topic.noteCount} related notes` });
            details.createEl('p', { text: `Suggested angle: ${topic.angle}` });

            const buttonContainer = topicItem.createDiv('button-container');
            
            const outlineBtn = buttonContainer.createEl('button', { text: 'Generate Outline' });
            outlineBtn.addEventListener('click', async () => {
                try {
                    // Find notes related to this topic
                    const relatedFiles = await this.findTopicNotes(topic.topic);
                    const outline = await this.plugin.aiService.generateDraftOutline(topic.topic, relatedFiles);
                    
                    new OutlineModal(this.app, this.plugin, topic.topic, outline).open();
                    this.close();
                } catch (error) {
                    new Notice('Failed to generate outline: ' + error.message);
                }
            });

            const startBtn = buttonContainer.createEl('button', { text: 'Start Writing', cls: 'primary' });
            startBtn.addEventListener('click', async () => {
                await this.createWritingProject(topic);
                this.close();
            });
        });
    }

    private async findTopicNotes(topic: string): Promise<string[]> {
        // Simple keyword matching - could be enhanced with semantic search
        const allFiles = this.app.vault.getFiles()
            .filter(file => file.path.startsWith(this.plugin.settings.permanentNotesFolder));
        
        const relatedFiles = [];
        const keywords = topic.toLowerCase().split(' ');

        for (const file of allFiles) {
            const content = await this.app.vault.read(file);
            const hasKeywords = keywords.some(keyword => 
                content.toLowerCase().includes(keyword) || 
                file.basename.toLowerCase().includes(keyword)
            );
            
            if (hasKeywords) {
                relatedFiles.push(file.path);
            }
        }

        return relatedFiles;
    }

    private async createWritingProject(topic: any) {
        const timestamp = new Date().toISOString().slice(0, 10);
        const fileName = `${topic.topic.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.md`;
        const filePath = `Writing Projects/${fileName}`;

        const content = `---
type: writing-project
topic: ${topic.topic}
created: ${new Date().toISOString()}
status: draft
readiness: ${topic.readiness}/10
related-notes: ${topic.noteCount}
---

# ${topic.topic}

## Proposed Angle
${topic.angle}

## Outline
<!-- Generate outline using the "Generate Outline" command -->

## Draft
<!-- Your writing goes here -->

## Related Notes
<!-- Links to source notes will be added here -->

## Research Gaps
<!-- Areas that need more development -->
`;

        await this.plugin.createNote(filePath, content);
        new Notice(`Created writing project: ${topic.topic}`);
        
        // Open the new file
        const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
        if (file) {
            this.app.workspace.getLeaf().openFile(file);
        }
    }
}

// Modal for displaying and editing outlines
export class OutlineModal extends Modal {
    plugin: ZettelkastenPlugin;
    topic: string;
    outline: any;

    constructor(app: App, plugin: ZettelkastenPlugin, topic: string, outline: any) {
        super(app);
        this.plugin = plugin;
        this.topic = topic;
        this.outline = outline;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: `Outline: ${this.topic}` });

        const outlineContent = contentEl.createEl('textarea', {
            placeholder: 'AI-generated outline will appear here...'
        });
        outlineContent.rows = 20;
        outlineContent.style.width = '100%';
        outlineContent.value = typeof this.outline === 'string' ? this.outline : JSON.stringify(this.outline, null, 2);

        const buttonContainer = contentEl.createDiv('button-container');
        
        const saveBtn = buttonContainer.createEl('button', { text: 'Save Outline', cls: 'primary' });
        saveBtn.addEventListener('click', async () => {
            const timestamp = new Date().toISOString().slice(0, 10);
            const fileName = `Outline-${this.topic.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.md`;
            const filePath = `Writing Projects/${fileName}`;

            const content = `---
type: outline
topic: ${this.topic}
created: ${new Date().toISOString()}
---

# Outline: ${this.topic}

${outlineContent.value}
`;

            await this.plugin.createNote(filePath, content);
            new Notice('Outline saved!');
            this.close();
        });

        const editBtn = buttonContainer.createEl('button', { text: 'Refine with AI' });
        editBtn.addEventListener('click', async () => {
            const refinement = await this.plugin.promptForInput('How would you like to refine this outline?');
            if (refinement) {
                try {
                    const refinedOutline = await this.refineOutline(outlineContent.value, refinement);
                    outlineContent.value = refinedOutline;
                    new Notice('Outline refined!');
                } catch (error) {
                    new Notice('Failed to refine outline: ' + error.message);
                }
            }
        });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
    }

    private async refineOutline(currentOutline: string, refinement: string): Promise<string> {
        const prompt = `
Current outline:
${currentOutline}

User wants to refine it with this direction:
${refinement}

Please provide an improved version of the outline.
`;

        return await this.plugin.aiService.callLLM(prompt);
    }
}

// Modal for daily review suggestions
export class DailyReviewModal extends Modal {
    suggestions: {
        reviewNotes: string[];
        connectOrphans: string[];
        developClusters: string[];
    };

    constructor(app: App, suggestions: any) {
        super(app);
        this.suggestions = suggestions;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Daily Review Suggestions' });

        // Random notes to review
        if (this.suggestions.reviewNotes.length > 0) {
            const reviewSection = contentEl.createDiv('daily-review-section');
            reviewSection.createEl('h4', { text: 'Notes to Review' });
            reviewSection.createEl('p', { text: 'Look for new connections in these random notes:' });
            
            const reviewList = reviewSection.createEl('ul', { cls: 'note-list' });
            this.suggestions.reviewNotes.forEach(note => {
                const listItem = reviewList.createEl('li');
                const link = listItem.createEl('a', { text: note, href: '#' });
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openNote(note);
                });
            });
        }

        // Orphaned notes to connect
        if (this.suggestions.connectOrphans.length > 0) {
            const orphansSection = contentEl.createDiv('daily-review-section');
            orphansSection.createEl('h4', { text: 'Connect These Orphaned Notes' });
            orphansSection.createEl('p', { text: 'These notes have few connections:' });
            
            const orphansList = orphansSection.createEl('ul', { cls: 'note-list' });
            this.suggestions.connectOrphans.forEach(note => {
                const listItem = orphansList.createEl('li');
                const link = listItem.createEl('a', { text: note, href: '#' });
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openNote(note);
                });
            });
        }

        // Developing clusters
        if (this.suggestions.developClusters.length > 0) {
            const clustersSection = contentEl.createDiv('daily-review-section');
            clustersSection.createEl('h4', { text: 'Developing Clusters' });
            clustersSection.createEl('p', { text: 'These topics are ready for more development:' });
            
            const clustersList = clustersSection.createEl('ul', { cls: 'note-list' });
            this.suggestions.developClusters.forEach(cluster => {
                const listItem = clustersList.createEl('li');
                listItem.createEl('span', { text: cluster });
            });
        }

        // Action buttons
        const buttonContainer = contentEl.createDiv('button-container');
        
        const doneBtn = buttonContainer.createEl('button', { text: 'Mark Complete', cls: 'primary' });
        doneBtn.addEventListener('click', async () => {
            // Could save review completion to daily notes
            new Notice('Daily review completed!');
            this.close();
        });

        const rescheduleBtn = buttonContainer.createEl('button', { text: 'Remind Me Later' });
        rescheduleBtn.addEventListener('click', () => {
            // Could set a reminder for later
            new Notice('Review rescheduled for later');
            this.close();
        });
    }

    private async openNote(noteName: string) {
        const file = this.app.vault.getFiles().find(f => f.basename === noteName);
        if (file) {
            this.app.workspace.getLeaf().openFile(file);
            this.close();
        }
    }
}

// Modal for quick note creation with templates
export class QuickNoteModal extends Modal {
    plugin: ZettelkastenPlugin;
    templates: { [key: string]: string } = {
        'concept': `# {{title}}

## Definition
{{definition}}

## Key Characteristics
- 

## Examples
- 

## Related Concepts
- 

## Questions
- `,

        'method': `# {{title}}

## Overview
{{overview}}

## Steps
1. 
2. 
3. 

## When to Use
- 

## Alternatives
- 

## Examples
- `,

        'insight': `# {{title}}

## The Insight
{{insight}}

## Why It Matters
{{significance}}

## Implications
- 

## Evidence
- 

## Counter-arguments
- `,

        'question': `# {{title}}

## The Question
{{question}}

## Why It's Important
{{importance}}

## Current Thinking
{{current_thoughts}}

## What I Need to Explore
- 

## Related Questions
- `
    };

    constructor(app: App, plugin: ZettelkastenPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Quick Note Creation' });

        const form = contentEl.createDiv('quick-note-form');

        // Title input
        const titleInput = form.createEl('input', { type: 'text', placeholder: 'Note title...' });
        titleInput.style.width = '100%';
        titleInput.style.marginBottom = '10px';

        // Template selection
        const templateSelect = form.createEl('select');
        templateSelect.style.width = '100%';
        templateSelect.style.marginBottom = '10px';

        Object.keys(this.templates).forEach(templateName => {
            templateSelect.createEl('option', { 
                value: templateName, 
                text: templateName.charAt(0).toUpperCase() + templateName.slice(1)
            });
        });

        // Content textarea
        const contentArea = form.createEl('textarea', { 
            placeholder: 'Note content (leave empty to use template)...' 
        });
        contentArea.rows = 10;
        contentArea.style.width = '100%';
        contentArea.style.marginBottom = '15px';

        // Template preview
        const updatePreview = () => {
            if (!contentArea.value) {
                const selectedTemplate = this.templates[templateSelect.value];
                contentArea.value = selectedTemplate
                    .replace('{{title}}', titleInput.value || 'Title')
                    .replace(/{{.*?}}/g, '');
            }
        };

        titleInput.addEventListener('input', updatePreview);
        templateSelect.addEventListener('change', updatePreview);

        // Buttons
        const buttonContainer = form.createDiv('button-container');
        
        const createBtn = buttonContainer.createEl('button', { text: 'Create Note', cls: 'primary' });
        createBtn.addEventListener('click', async () => {
            const title = titleInput.value || 'Untitled';
            const content = contentArea.value || this.templates[templateSelect.value];
            
            const timestamp = this.plugin.generateTimestamp();
            const fileName = `${title.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.md`;
            const filePath = `${this.plugin.settings.permanentNotesFolder}/${fileName}`;

            const noteContent = `---
type: permanent
created: ${new Date().toISOString()}
template: ${templateSelect.value}
---

${content.replace(/{{title}}/g, title)}
`;

            await this.plugin.createNote(filePath, noteContent);
            new Notice(`Created note: ${title}`);
            
            // Open the new note
            const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
            if (file) {
                this.app.workspace.getLeaf().openFile(file);
            }
            
            this.close();
        });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        // Focus title input
        titleInput.focus();
    }
}
