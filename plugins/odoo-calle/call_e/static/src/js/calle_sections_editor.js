/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { CodeEditor } from "@web/core/code_editor/code_editor";

export class CalleSectionsEditor extends Component {
    static template = "call_e.CalleSectionsEditor";
    static components = { CodeEditor };
    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.state = useState({
            addingResponseSectionId: null,
            newResponseName: "",
            openCodeResponseId: null,
            activeTab: "code",
        });
    }

    setTab(tabName) {
        this.state.activeTab = tabName;
    }

    toggleCodeEditor(responseRecord) {
        if (this.state.openCodeResponseId === responseRecord.id) {
            this.state.openCodeResponseId = null;
        } else {
            this.state.openCodeResponseId = responseRecord.id;
            this.state.activeTab = "code";
        }
    }

    getCodeEditorProps(responseRecord) {
        return {
            mode: "python",
            value: responseRecord.data.action_code || "",
            onChange: (newValue) => {
                this.onResponseCodeChange(responseRecord, newValue);
            },
        };
    }

    async onResponseCodeChange(responseRecord, newValue) {
        await responseRecord.update({ action_code: newValue ? newValue : false });
    }

    get sections() {
        return this.props.record.data[this.props.name]?.records || [];
    }

    async onAddSection(targetList = null) {
        const list = targetList || this.props.record.data[this.props.name];
        if (list) {
            await list.addNewRecord({ position: "bottom" });
        }
    }

    async onAddChildSection(responseRecord) {
        if (responseRecord.data.child_section_ids) {
            await responseRecord.data.child_section_ids.addNewRecord({ position: "bottom" });
        }
    }

    async onDeleteSection(sectionRecord, parentList = null) {
        const list = parentList || this.props.record.data[this.props.name];
        if (list) {
            await list.delete(sectionRecord);
        }
    }

    async onSectionTextChange(sectionRecord, ev) {
        await sectionRecord.update({ section_text: ev.target.value });
    }

    startAddResponse(sectionRecord) {
        this.state.addingResponseSectionId = sectionRecord.id;
        this.state.newResponseName = "";
    }

    cancelAddResponse() {
        this.state.addingResponseSectionId = null;
        this.state.newResponseName = "";
    }

    async confirmAddResponse(sectionRecord) {
        const name = this.state.newResponseName ? this.state.newResponseName.trim() : "";
        if (name && sectionRecord.data.response_ids) {
            await sectionRecord.data.response_ids.addNewRecord({
                position: "bottom",
                context: { default_name: name },
            });
        }
        this.state.addingResponseSectionId = null;
        this.state.newResponseName = "";
    }

    async onDeleteResponse(sectionRecord, responseRecord) {
        if (sectionRecord.data.response_ids) {
            await sectionRecord.data.response_ids.delete(responseRecord);
        }
    }
}

export class CallePromptPreview extends Component {
    static template = "call_e.CallePromptPreview";
    static props = {
        ...standardFieldProps,
    };

    get sections() {
        return this.props.record.data[this.props.name]?.records || [];
    }

    get generatedPrompt() {
        const lines = ["Call Instructions and Dialogue Flow:"];
        
        function processSection(sec, secKey, depth = 1, parentCond = "") {
            const text = (sec.data.section_text || "").trim() || "[Empty Section Text]";
            const indent = "  ".repeat(depth - 1);
            const condStr = parentCond;

            const responses = sec.data.response_ids?.records || [];
            if (responses.length > 0) {
                const choices = responses.map((r) => `'${r.data.name || ""}'`).join(", ");
                lines.push(`${indent}- Section (${secKey})${condStr}: ${text} (Expected Answers: ${choices})`);
            } else {
                lines.push(`${indent}- Section (${secKey})${condStr}: ${text}`);
            }

            responses.forEach((resp, rIdx) => {
                const children = resp.data.child_section_ids?.records || [];
                children.forEach((child, cIdx) => {
                    const childKey = `${secKey}_r${rIdx + 1}_s${cIdx + 1}`;
                    const cCond = ` [Condition: Only ask if answer to '${secKey}' is '${resp.data.name || ""}']`;
                    processSection(child, childKey, depth + 1, cCond);
                });
            });
        }

        const topSections = this.sections;
        if (topSections.length === 0) {
            return "No call sections defined yet. Add sections under 'CALL-E Sections' tab to build your call dialogue flow.";
        }

        topSections.forEach((sec, idx) => {
            const secKey = `s_${idx + 1}`;
            processSection(sec, secKey);
        });

        return lines.join("\n");
    }
}

export const calleSectionsEditorField = {
    component: CalleSectionsEditor,
    supportedTypes: ["one2many"],
};

export const callePromptPreviewField = {
    component: CallePromptPreview,
    supportedTypes: ["one2many"],
};

registry.category("fields").add("calle_sections_editor", calleSectionsEditorField);
registry.category("fields").add("calle_prompt_preview", callePromptPreviewField);
