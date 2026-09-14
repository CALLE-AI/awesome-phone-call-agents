import fs from "node:fs";

const DEFAULT_TEMPLATE_PATH = "skills/google-form-callback/template.md";
const JSON_BLOCK_RE = /```json\s*([\s\S]*?)```/i;
const GOAL_SECTION_RE = /^## Goal Template\s*$/im;
const TEXT_FENCE_RE = /^```(?:text)?\s*\n([\s\S]*?)\n```\s*$/i;

export { DEFAULT_TEMPLATE_PATH };

function stripTextFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(TEXT_FENCE_RE);
  return match ? match[1].trim() : trimmed;
}

function normalizeTemplate(config, goalTemplate, sourcePath) {
  const phoneField = config.phoneField || config.phone_field || "phone";
  const recipientNameField =
    config.recipientNameField || config.recipient_name_field || "lead_name";
  const languageField = config.languageField || config.language_field || null;
  const language = config.language || "English";

  if (!Array.isArray(config.fields) || config.fields.length === 0) {
    throw new Error(`Template ${sourcePath} must define at least one field`);
  }
  if (!goalTemplate) {
    throw new Error(`Template ${sourcePath} must include a Goal Template section`);
  }

  return {
    ...config,
    phoneField,
    recipientNameField,
    languageField,
    language,
    requiredFields: config.requiredFields || config.required_fields || [],
    resultField: config.resultField || config.result_field || "call_result",
    summaryField: config.summaryField || config.summary_field || "call_summary",
    goalTemplate,
  };
}

export function readTemplate(pathName = DEFAULT_TEMPLATE_PATH) {
  const text = fs.readFileSync(pathName, "utf8");
  const jsonMatch = text.match(JSON_BLOCK_RE);
  if (!jsonMatch) {
    throw new Error(`Template ${pathName} must include a JSON configuration fence`);
  }

  const goalSection = text.match(GOAL_SECTION_RE);
  if (!goalSection) {
    throw new Error(`Template ${pathName} must include "## Goal Template"`);
  }

  const config = JSON.parse(jsonMatch[1]);
  const goalText = stripTextFence(text.slice(goalSection.index + goalSection[0].length));
  return normalizeTemplate(config, goalText, pathName);
}

export function readTemplateOrContract({ templatePath, contractPath, inputTemplate, inputContract }) {
  if (inputTemplate) {
    return normalizeTemplate(inputTemplate, inputTemplate.goalTemplate, "input.template");
  }
  if (templatePath) {
    return readTemplate(templatePath);
  }
  if (inputContract) {
    if (inputContract.goalTemplate) {
      return normalizeTemplate(inputContract, inputContract.goalTemplate, "input.contract");
    }
    const defaultGoalTemplate = inputContract.goalTemplates?.default;
    if (defaultGoalTemplate) {
      return normalizeTemplate(inputContract, defaultGoalTemplate, "input.contract");
    }
    throw new Error("input.contract must include goalTemplate or goalTemplates.default");
  }
  if (contractPath) {
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    return readTemplateOrContract({ inputContract: contract });
  }
  return readTemplate(DEFAULT_TEMPLATE_PATH);
}

export function renderValue(value) {
  const values = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];
  const cleaned = values.map((entry) => String(entry).trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(", ") : "not provided";
}

export function compileGoal(template, fields) {
  const withConditionals = template.replace(
    /\{\{#([a-z][a-z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match, slug, body) => {
      const value = renderValue(fields[slug]);
      return value === "not provided" ? "" : body;
    }
  );

  return withConditionals
    .replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_match, slug) => renderValue(fields[slug]))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
