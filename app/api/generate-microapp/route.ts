// /app/api/generate-microapp/route.ts
// Microapp Builder Wizard - API Endpoint v2
// This handles form submissions and generates CVUF files using Claude

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Resend client for email delivery
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ============================================================================
// FIELD MAPPING - CVUF integrationIDs to Internal API fields
// ============================================================================
// The CVUF form uses specific integrationID names. This function normalizes
// them to the internal field names used by the rest of the API.

function parseCommaSeparatedString(value: any): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeInputs(body: Record<string, any>): Record<string, any> {
  return {
    // Core info - direct mappings
    microappName: body.microappName,
    microappDescription: body.problemDescription,  // CVUF: problemDescription
    userType: body.userType,
    owningDepartment: body.owningDepartment,
    triggerEvent: body.triggerEvent,
    currentProcess: body.currentProcess,
    
    // Data collection - some renamed
    needsContactInfo: body.fieldsList,  // CVUF: fieldsList (array of contact fields)
    needsIdentifiers: body.needsIdentifiers,
    needsDates: body.hasDateFields,  // CVUF: hasDateFields
    needsChoices: body.needsChoices,
    needsRichInput: body.hasFileUploads,  // CVUF: hasFileUploads
    needsFinancial: body.needsFinancial,
    hasSignature: body.hasSignature,
    customDropdowns: body.dropdownOptions,  // CVUF: dropdownOptions
    otherFields: body.otherFields,
    
    // Workflow
    hasBranching: body.hasBranching,
    branchingLogic: body.branchingLogic,
    needsApproval: body.needsApproval,
    approvalDetails: body.approvalDetails,
    canSaveProgress: body.saveAndReturn,  // CVUF: saveAndReturn
    
    // Post-submit actions
    submitActions: parseCommaSeparatedString(body.submitActions),
    emailRecipients: body.notificationRecipients,  // CVUF: notificationRecipients
    slackChannel: body.slackChannel,
    crmSystem: body.crmType,  // CVUF: crmType
    ticketSystem: body.ticketSystem,
    otherIntegrations: body.otherIntegrations,
    
    // Data lookup
    needsDataLookup: body.hasExternalLookup,  // CVUF: hasExternalLookup
    lookupDetails: body.lookupDetails,
    hasPrepopulation: body.hasPrepopulation,
    prepopulationDetails: body.prepopulationDetails,
    
    // Requirements
    needsMultiLanguage: body.multiLanguage,  // CVUF: multiLanguage
    languages: body.languages,
    complianceRequirements: body.complianceRequirements,
    brandingNotes: body.brandingNotes,
    estimatedVolume: body.estimatedVolume,
    additionalNotes: body.additionalNotes,
    
    // Contact info
    userName: body.userName,
    userEmail: body.userEmail,
  };
}

// ============================================================================
// REFERENCE ARCHITECTURE - Embedded in System Prompt
// ============================================================================

const CVUF_REFERENCE = `
# CallVu CVUF Reference Architecture

## Document Structure
Every CVUF must have this structure:
\`\`\`json
{"form": { ...all properties... }}
\`\`\`

## Required Root Properties
- formName, title: Display name
- direction: "ltr"
- templateType: 3
- stepperType: "Progress"
- formVersion: "10.4.40"
- steps: [] (array of step objects)
- theme: {} (complete theme object)
- newRules: [] (conditional visibility rules)

## Step Structure
\`\`\`json
{
  "stepName": "Step Name",
  "text": "Display Name",
  "identifier": "step_name_001",
  "hideFooter": false,
  "buttonsConfig": {
    "back": {"className": "", "isHidden": false, "text": ""},
    "next": {"className": "", "isHidden": false, "text": "Continue"},
    "targetStep": "step_next_002",
    "isFirstNode": false
  },
  "blocks": [],
  "style": {"alignment": ""}
}
\`\`\`

First step: isFirstNode=true, back button hidden
Last step: hideFooter=true, no targetStep

## Field Types and Required Properties

### shortText
\`\`\`json
{"type":"shortText","name":"editor.fields.shortText","identifier":"shorttext_xxx_001","integrationID":"fieldName","label":"Label","width":"full","columnID":0}
\`\`\`

### textarea
\`\`\`json
{"type":"textarea","name":"editor.fields.textarea","identifier":"textarea_xxx_001","integrationID":"fieldName","label":"Label","width":"full","maxLength":2000,"columnID":0}
\`\`\`

### emailInput
\`\`\`json
{"type":"emailInput","name":"editor.fields.emailinput","identifier":"email_xxx_001","integrationID":"fieldName","label":"Label","width":"half","icon":"fa-envelope","columnID":0}
\`\`\`

### phoneInput
\`\`\`json
{"type":"phoneInput","name":"editor.fields.phoneinput","identifier":"phone_xxx_001","integrationID":"fieldName","label":"Label","width":"half","columnID":0}
\`\`\`

### dropdownInput (MUST have items array)
\`\`\`json
{"type":"dropdownInput","name":"editor.fields.dropdowninput","identifier":"dropdown_xxx_001","integrationID":"fieldName","label":"Label","width":"full","items":[{"label":"Option 1","value":"option1"},{"label":"Option 2","value":"option2"}],"columnID":0}
\`\`\`

### radioInput (MUST have items array)
\`\`\`json
{"type":"radioInput","name":"editor.fields.radioinput","identifier":"radio_xxx_001","integrationID":"fieldName","label":"Label","width":"full","items":[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}],"innertype":"radioOutlinedInput","backgroundColor":"altBackground","color":"text","columnID":0}
\`\`\`

### checkboxInput (MUST have items array)
\`\`\`json
{"type":"checkboxInput","name":"editor.fields.checkboxinput","identifier":"checkbox_xxx_001","integrationID":"fieldName","label":"Label","width":"full","items":[{"label":"Option A","value":"a"},{"label":"Option B","value":"b"}],"columnID":0}
\`\`\`

### dateInput
\`\`\`json
{"type":"dateInput","name":"editor.fields.dateinput","identifier":"date_xxx_001","integrationID":"fieldName","label":"Label","width":"half","columnID":0}
\`\`\`

### numberInput
\`\`\`json
{"type":"numberInput","name":"editor.fields.numberinput","identifier":"number_xxx_001","integrationID":"fieldName","label":"Label","width":"half","columnID":0}
\`\`\`

### fileUpload
\`\`\`json
{"type":"fileUpload","name":"editor.fields.fileupload","identifier":"file_xxx_001","integrationID":"fieldName","label":"Label","width":"full","accept":".pdf,.jpg,.png","maxSize":10485760,"multiple":false,"columnID":0}
\`\`\`

### signature
\`\`\`json
{"type":"signature","name":"editor.fields.signature","identifier":"signature_xxx_001","integrationID":"fieldName","label":"Sign here","width":"full","columnID":0}
\`\`\`

### paragraph (static HTML content)
\`\`\`json
{"type":"paragraph","name":"editor.fields.paragraph","identifier":"paragraph_xxx_001","integrationID":"paragraph_xxx_001","label":"","width":"full","editedParagraph":"<div style='text-align:center;'><h2>Title</h2><p>Description</p></div>","localOnly":true,"columnID":0}
\`\`\`

### smartButton (navigation)
\`\`\`json
{"type":"smartButton","name":"editor.fields.smartbutton","identifier":"smartbutton_xxx_001","integrationID":"buttonName","label":"Button Text","width":"full","buttonSize":"fullWidth","buttonType":"primary","selectedStep":{"text":"Next Step Name","value":1,"identifier":"step_next_002"},"selectedDialogBlock":"","columnID":0}
\`\`\`

## Theme (always include complete theme)
\`\`\`json
{"theme":{"primary":"#0891B2","secondary":"#E0F2FE","title":"#0F172A","text":"#334155","background":"#ffffff","blockBackground":"#ffffff","headerText":"#0F172A","headerBackground":"#ffffff","font":"Inter-Regular","warning":"#F59E0B","altBackground":"#F8FAFC","danger":"#EF4444","link":"#0891B2","success":"#10B981","dark":"#1E293B","bright":"#FEF3C7","neutral":"#E2E8F0"}}
\`\`\`

## Block-Level Conditional Visibility (CORRECT METHOD)
To conditionally show/hide content, use BLOCK-level visibility, not field-level:

1. Set isHiddenInRuntime: true on the BLOCK (not individual fields)
2. Use newRules with resultBlocks to show the block

\`\`\`json
{
  "newRules": [{
    "id": "rule_xxx",
    "ruleName": "show_details_block",
    "type": "visibility",
    "condition": {
      "expression": "equalText(<<triggerField>>, 'yes')",
      "isRegex": false
    },
    "action": [{
      "id": "action_xxx",
      "visible": true,
      "resultBlocks": ["block_details_001"],
      "resultFields": [],
      "navigateTo": {"type": "Step", "id": ""}
    }]
  }]
}
\`\`\`

Available condition functions:
- equalText(<<field>>, 'value')
- contains(<<field>>, 'value') - for checkbox/multi-select
- isEmpty(<<field>>)
- isNotEmpty(<<field>>)

## Block Structure
\`\`\`json
{
  "blockName": "Section Title",
  "identifier": "block_xxx_001",
  "icon": "",
  "isHiddenInRuntime": false,
  "rows": [{"fields": [...]}],
  "type": "regular",
  "style": {
    "alignment": "center",
    "nobackground": false,
    "noborders": false,
    "size": "full",
    "background": "#ffffff"
  }
}
\`\`\`

## Universal Field Properties
All fields need: identifier, integrationID, type, name, width, columnID
Optional: required, readOnly, isHiddenInRuntime, hint, tooltip, validations

## CRITICAL RULES
1. All identifiers must be unique across the entire form
2. All targetStep values must reference existing step identifiers
3. dropdownInput/radioInput/checkboxInput MUST have non-empty items array
4. First step: isFirstNode=true, back button hidden
5. Last step: hideFooter=true
6. Output minified JSON (no pretty printing, no markdown)
7. Never set required=true on fields inside hidden blocks
8. Use block-level visibility, NOT field-level isHiddenInRuntime
`;

// ============================================================================
// TEMPLATE MATCHING
// ============================================================================

const TEMPLATE_INDEX = [
  { id: "customer_complaint", keywords: ["complaint", "issue", "problem", "customer service", "support ticket"], department: "Customer Service" },
  { id: "feedback_survey", keywords: ["feedback", "survey", "satisfaction", "nps", "rating"], department: "Customer Service" },
  { id: "pto_request", keywords: ["pto", "vacation", "time off", "leave", "absence"], department: "HR" },
  { id: "expense_report", keywords: ["expense", "reimbursement", "receipt", "travel"], department: "Finance" },
  { id: "onboarding", keywords: ["onboarding", "new hire", "new employee", "orientation"], department: "HR" },
  { id: "incident_report", keywords: ["incident", "accident", "safety", "injury"], department: "Operations" },
  { id: "maintenance_request", keywords: ["maintenance", "repair", "fix", "broken", "facilities"], department: "Operations" },
  { id: "vendor_registration", keywords: ["vendor", "supplier", "registration", "onboard"], department: "Finance" },
  { id: "contact_form", keywords: ["contact", "inquiry", "general", "question"], department: "Marketing" },
  { id: "quote_request", keywords: ["quote", "pricing", "estimate", "proposal"], department: "Sales" },
];

function matchTemplate(description: string, department: string): { templateId: string | null; score: number } {
  const descLower = description.toLowerCase();
  let bestMatch = { templateId: null as string | null, score: 0 };

  for (const template of TEMPLATE_INDEX) {
    let score = 0;
    
    for (const keyword of template.keywords) {
      if (descLower.includes(keyword)) {
        score += 20;
      }
    }
    
    if (template.department.toLowerCase() === department.toLowerCase()) {
      score += 30;
    }
    
    if (score > bestMatch.score) {
      bestMatch = { templateId: template.id, score };
    }
  }

  return bestMatch;
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

interface ValidationWarning {
  field: string;
  message: string;
  severity: "warning" | "error";
}

function validateInputs(inputs: Record<string, any>): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (inputs.needsDataLookup === "yes" && !inputs.lookupDetails) {
    warnings.push({
      field: "lookupDetails",
      message: "Data lookup requested but no details provided",
      severity: "warning"
    });
  }

  if (inputs.needsMultiLanguage === "yes" && (!inputs.languages || inputs.languages.length === 0)) {
    warnings.push({
      field: "languages",
      message: "Multi-language requested but no languages selected",
      severity: "warning"
    });
  }

  if (inputs.submitActions?.includes("crm") && !inputs.crmSystem) {
    warnings.push({
      field: "crmSystem",
      message: "CRM integration requested but no CRM system specified",
      severity: "warning"
    });
  }

  if (inputs.submitActions?.includes("notification") && !inputs.emailRecipients) {
    warnings.push({
      field: "emailRecipients",
      message: "Email notifications requested but no recipients specified",
      severity: "warning"
    });
  }

  if (inputs.needsApproval === "yes" && !inputs.approvalDetails) {
    warnings.push({
      field: "approvalDetails",
      message: "Approval workflow requested but no details provided",
      severity: "warning"
    });
  }

  if (inputs.hasBranching === "yes" && !inputs.branchingLogic) {
    warnings.push({
      field: "branchingLogic",
      message: "Conditional branching requested but no logic described",
      severity: "warning"
    });
  }

  if (inputs.estimatedVolume === "10000+" && inputs.submitActions?.includes("notification")) {
    warnings.push({
      field: "estimatedVolume",
      message: "High volume with email notifications - consider batching strategy",
      severity: "warning"
    });
  }

  return warnings;
}

// ============================================================================
// SLACK NOTIFICATION
// ============================================================================

async function sendSlackNotification(data: {
  microappName: string;
  userName: string;
  userEmail: string;
  owningDepartment: string;
  description: string;
  estimatedVolume: string;
  submitActions: string[];
  complianceRequirements: string[];
  templateMatch: { templateId: string | null; score: number };
  generationTimeMs: number;
  requestId: string;
  warnings: ValidationWarning[];
}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const integrationsList = data.submitActions?.length > 0 
    ? data.submitActions.join(", ") 
    : "None specified";

  const complianceList = data.complianceRequirements?.length > 0
    ? data.complianceRequirements.join(", ")
    : "None specified";

  const warningText = data.warnings.length > 0
    ? `\n\n⚠️ *Warnings:*\n${data.warnings.map(w => `• ${w.message}`).join("\n")}`
    : "";

  const templateText = data.templateMatch.templateId
    ? `${data.templateMatch.templateId} (${data.templateMatch.score}% match)`
    : "Generated from scratch";

  const payload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🆕 New Microapp Generated",
          emoji: true
        }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Microapp:*\n${data.microappName}` },
          { type: "mrkdwn", text: `*Requested by:*\n${data.userName}` },
          { type: "mrkdwn", text: `*Department:*\n${data.owningDepartment}` },
          { type: "mrkdwn", text: `*Volume:*\n${data.estimatedVolume}` }
        ]
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Description:*\n${data.description.substring(0, 500)}${data.description.length > 500 ? "..." : ""}`
        }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Integrations:*\n${integrationsList}` },
          { type: "mrkdwn", text: `*Compliance:*\n${complianceList}` }
        ]
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Template Match:*\n${templateText}` },
          { type: "mrkdwn", text: `*Generation Time:*\n${data.generationTimeMs}ms` }
        ]
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Request ID: ${data.requestId} | Email: ${data.userEmail}${warningText}` }
        ]
      }
    ]
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("Slack notification failed:", error);
  }
}

// ============================================================================
// EMAIL DELIVERY VIA RESEND
// ============================================================================

async function sendEmailWithCVUF(data: {
  userEmail: string;
  userName: string;
  microappName: string;
  cvufJson: string;
  dependencies: string;
  setupGuide: string;
  pitchPoints: string;
  requestId: string;
}) {
  if (!resend) {
    console.log("Resend not configured - skipping email delivery");
    return;
  }

  try {
    await resend.emails.send({
      from: "Microapp Builder <onboarding@resend.dev>",
      to: data.userEmail,
      subject: `Your Microapp is Ready: ${data.microappName}`,
      html: `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://www.callvu.com/wp-content/uploads/2024/01/callvu-logo.svg" alt="CallVu" style="height: 40px;">
          </div>
          
          <h1 style="color: #0F172A; font-size: 24px; margin-bottom: 8px;">🎉 Your Microapp is Ready!</h1>
          <p style="color: #64748B; font-size: 16px; margin-bottom: 24px;">Hi ${data.userName}, your <strong>${data.microappName}</strong> microapp has been generated.</p>
          
          <div style="background: #F1F5F9; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <p style="color: #0F172A; font-weight: 600; margin: 0 0 12px 0;">What's included:</p>
            <p style="color: #334155; margin: 6px 0;">✅ Ready-to-import CVUF file</p>
            <p style="color: #334155; margin: 6px 0;">✅ Step-by-step setup guide</p>
            <p style="color: #334155; margin: 6px 0;">✅ Dependencies checklist</p>
            <p style="color: #334155; margin: 6px 0;">✅ Internal pitch talking points</p>
          </div>

          <h2 style="color: #0F172A; font-size: 18px; margin-bottom: 12px;">📋 Quick Start</h2>
          <ol style="color: #334155; padding-left: 20px;">
            <li style="margin-bottom: 8px;">Open the attached CVUF file</li>
            <li style="margin-bottom: 8px;">Copy the JSON content</li>
            <li style="margin-bottom: 8px;">In CallVu Studio: Create New Form → Import from JSON</li>
            <li style="margin-bottom: 8px;">Paste and import!</li>
          </ol>

          <div style="background: #ECFDF5; border: 1px solid #10B981; border-radius: 8px; padding: 16px; margin: 24px 0;">
            <p style="color: #065F46; font-size: 14px; margin: 0;"><strong>Pro tip:</strong> Review the setup guide below for integration configuration details.</p>
          </div>

          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">

          <h2 style="color: #0F172A; font-size: 18px; margin-bottom: 12px;">📖 Setup Guide</h2>
          <pre style="background: #F8FAFC; border-radius: 8px; padding: 16px; font-size: 12px; overflow-x: auto; white-space: pre-wrap;">${data.setupGuide}</pre>

          <h2 style="color: #0F172A; font-size: 18px; margin: 24px 0 12px 0;">📦 Dependencies</h2>
          <pre style="background: #F8FAFC; border-radius: 8px; padding: 16px; font-size: 12px; overflow-x: auto; white-space: pre-wrap;">${data.dependencies}</pre>

          <h2 style="color: #0F172A; font-size: 18px; margin: 24px 0 12px 0;">💬 Pitch Points</h2>
          <pre style="background: #F8FAFC; border-radius: 8px; padding: 16px; font-size: 12px; overflow-x: auto; white-space: pre-wrap;">${data.pitchPoints}</pre>

          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">

          <h2 style="color: #0F172A; font-size: 18px; margin-bottom: 12px;">📁 Your CVUF File</h2>
          <p style="color: #64748B; font-size: 14px;">Copy the JSON below and import into CallVu Studio:</p>
          <div style="background: #1E293B; border-radius: 8px; padding: 16px; margin-top: 12px;">
            <pre style="color: #E2E8F0; font-size: 11px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 0;">${data.cvufJson}</pre>
          </div>

          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
          
          <p style="color: #94A3B8; font-size: 12px; text-align: center;">Request ID: ${data.requestId}<br>Generated by CallVu Microapp Builder</p>
        </div>
      `,
    });
    console.log(`Email sent successfully to ${data.userEmail}`);
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

// ============================================================================
// GOOGLE SHEETS LOGGING
// ============================================================================

async function logToGoogleSheets(data: {
  requestId: string;
  timestamp: string;
  inputs: Record<string, any>;
  templateMatch: { templateId: string | null; score: number };
  generationTimeMs: number;
  warnings: ValidationWarning[];
  success: boolean;
}) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK;
  if (!webhookUrl) return;

  const payload = {
    requestId: data.requestId,
    timestamp: data.timestamp,
    userName: data.inputs.userName,
    userEmail: data.inputs.userEmail,
    microappName: data.inputs.microappName,
    department: data.inputs.owningDepartment,
    description: data.inputs.microappDescription,
    userType: data.inputs.userType,
    estimatedVolume: data.inputs.estimatedVolume,
    submitActions: JSON.stringify(data.inputs.submitActions || []),
    complianceRequirements: JSON.stringify(data.inputs.complianceRequirements || []),
    templateMatched: data.templateMatch.templateId || "none",
    matchScore: data.templateMatch.score,
    generationTimeMs: data.generationTimeMs,
    warningCount: data.warnings.length,
    warnings: JSON.stringify(data.warnings),
    success: data.success,
    fullInputs: JSON.stringify(data.inputs)
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("Google Sheets logging failed:", error);
  }
}

// ============================================================================
// MAIN API HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Get raw body and normalize field names
    const body = await request.json();
    const inputs = normalizeInputs(body);
    
    // Validate inputs
    const warnings = validateInputs(inputs);
    
    // Match template
    const templateMatch = matchTemplate(
      inputs.microappDescription || "",
      inputs.owningDepartment || ""
    );

    // Build the generation prompt
    const userPrompt = buildGenerationPrompt(inputs, templateMatch);

    // Call Claude API
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ],
      system: `You are an expert CallVu microapp builder. You generate valid, importable CVUF JSON files.

${CVUF_REFERENCE}

CRITICAL INSTRUCTIONS:
1. Output ONLY valid minified JSON - no markdown, no explanation, no code blocks
2. The JSON must start with {"form": and end with }}
3. Every identifier must be unique
4. Every dropdown/radio/checkbox MUST have a non-empty items array with at least 2 options
5. Follow the exact field structures from the reference
6. Use block-level visibility with newRules and resultBlocks for conditional content
7. Create professional, user-friendly forms with clear labels and helpful hints`
    });

    const generatedContent = message.content[0].type === "text" ? message.content[0].text : "";
    
    // Clean up the response (remove any markdown if present)
    let cvufJson = generatedContent.trim();
    if (cvufJson.startsWith("```")) {
      cvufJson = cvufJson.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    }

    // Validate JSON
    let parsedCvuf;
    try {
      parsedCvuf = JSON.parse(cvufJson);
    } catch (parseError) {
      throw new Error(`Generated invalid JSON: ${parseError}`);
    }

    // Verify it has the required structure
    if (!parsedCvuf.form) {
      throw new Error("Generated CVUF missing 'form' root property");
    }

    const generationTimeMs = Date.now() - startTime;

    // Generate supporting materials
    const dependencies = generateDependencies(inputs);
    const setupGuide = generateSetupGuide(inputs, parsedCvuf);
    const pitchPoints = generatePitchPoints(inputs);

    // Log to Google Sheets
    await logToGoogleSheets({
      requestId,
      timestamp: new Date().toISOString(),
      inputs,
      templateMatch,
      generationTimeMs,
      warnings,
      success: true
    });

    // Send Slack notification
    await sendSlackNotification({
      microappName: inputs.microappName,
      userName: inputs.userName,
      userEmail: inputs.userEmail,
      owningDepartment: inputs.owningDepartment,
      description: inputs.microappDescription,
      estimatedVolume: inputs.estimatedVolume,
      submitActions: inputs.submitActions || [],
      complianceRequirements: inputs.complianceRequirements || [],
      templateMatch,
      generationTimeMs,
      requestId,
      warnings
    });

    // Send email with CVUF to user
    await sendEmailWithCVUF({
      userEmail: inputs.userEmail,
      userName: inputs.userName,
      microappName: inputs.microappName,
      cvufJson,
      dependencies,
      setupGuide,
      pitchPoints,
      requestId
    });

    // Return success response with all outputs
    return NextResponse.json({
      success: true,
      requestId,
      generatedCVUF: cvufJson,
      generatedDependencies: dependencies,
      generatedSetupGuide: setupGuide,
      generatedPitchPoints: pitchPoints,
      metadata: {
        generationTimeMs,
        templateMatch,
        warnings
      }
    });

  } catch (error) {
    console.error("Generation error:", error);
    
    // Log failure
    await logToGoogleSheets({
      requestId,
      timestamp: new Date().toISOString(),
      inputs: {},
      templateMatch: { templateId: null, score: 0 },
      generationTimeMs: Date.now() - startTime,
      warnings: [],
      success: false
    });

    return NextResponse.json(
      { error: "Failed to generate microapp", details: String(error) },
      { status: 500 }
    );
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildGenerationPrompt(inputs: Record<string, any>, templateMatch: { templateId: string | null; score: number }): string {
  // Format array fields for display
  const formatArray = (arr: any[], separator = ", ") => {
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.join(separator);
    }
    return "None specified";
  };

  return `Generate a CallVu CVUF microapp file based on these requirements:

## Microapp Details
- Name: ${inputs.microappName}
- Description: ${inputs.microappDescription}
- User Type: ${inputs.userType}
- Department: ${inputs.owningDepartment}
- Trigger Event: ${inputs.triggerEvent}
- Current Process: ${inputs.currentProcess}

## Data Collection Requirements
- Contact Info Fields: ${formatArray(inputs.needsContactInfo)}
- Identifiers/Account Numbers: ${formatArray(inputs.needsIdentifiers)}
- Date/Time Fields: ${formatArray(inputs.needsDates)}
- Selection/Choice Fields: ${formatArray(inputs.needsChoices)}
- Rich Inputs: ${formatArray(inputs.needsRichInput)}
- Financial Data: ${formatArray(inputs.needsFinancial)}
- Digital Signature Required: ${inputs.hasSignature || "no"}
- Custom Dropdown Descriptions: ${inputs.customDropdowns || "None"}
- Other Field Requirements: ${inputs.otherFields || "None"}

## Workflow Requirements
- Conditional Branching: ${inputs.hasBranching}${inputs.branchingLogic ? ` - ${inputs.branchingLogic}` : ""}
- Approval Required: ${inputs.needsApproval}${inputs.approvalDetails ? ` - ${inputs.approvalDetails}` : ""}
- Save & Return Later: ${inputs.canSaveProgress}

## Post-Submit Actions
- Selected Actions: ${formatArray(inputs.submitActions)}
- Email Recipients: ${inputs.emailRecipients || "Not specified"}
- Slack/Teams Channel: ${inputs.slackChannel || "Not specified"}
- CRM System: ${inputs.crmSystem || "Not specified"}
- Ticketing System: ${inputs.ticketSystem || "Not specified"}
- Other Integrations: ${inputs.otherIntegrations || "None"}

## Data Lookup Requirements
- Needs External Data Lookup: ${inputs.needsDataLookup}
- Lookup Details: ${inputs.lookupDetails || "Not specified"}
- Pre-populate Fields: ${inputs.hasPrepopulation || "no"}
- Pre-population Details: ${inputs.prepopulationDetails || "Not specified"}

## Additional Requirements
- Multi-language Support: ${inputs.needsMultiLanguage}${inputs.languages ? ` - ${formatArray(inputs.languages)}` : ""}
- Compliance Requirements: ${formatArray(inputs.complianceRequirements)}
- Branding Notes: ${inputs.brandingNotes || "Use default CallVu theme"}
- Expected Monthly Volume: ${inputs.estimatedVolume}
- Additional Notes: ${inputs.additionalNotes || "None"}

${templateMatch.score >= 70 ? `\nSuggested base template style: ${templateMatch.templateId} (${templateMatch.score}% keyword match)` : ""}

Generate a complete, production-ready CVUF JSON file with:
1. Welcome/intro screen with clear purpose statement
2. Logically grouped data collection screens (don't cram too many fields on one screen)
3. Confirmation/thank you screen
4. All necessary conditional visibility rules using block-level visibility
5. Professional styling with the default CallVu theme
6. Clear, helpful labels and hints on all fields
7. Proper validation on required fields

Output ONLY the minified JSON, nothing else. No markdown, no explanation.`;
}

function generateDependencies(inputs: Record<string, any>): string {
  const deps: string[] = [];
  
  deps.push("## Required Setup\n");
  deps.push("✅ CallVu Studio account with form import permissions");
  
  if (inputs.submitActions?.includes("notification")) {
    deps.push("📧 Email service configuration (SMTP server or SendGrid/Mailgun API)");
    deps.push(`   └─ Recipients: ${inputs.emailRecipients || "[configure in CallVu]"}`);
  }
  
  if (inputs.submitActions?.includes("slack")) {
    deps.push("💬 Slack/Teams webhook URL");
    deps.push(`   └─ Channel: ${inputs.slackChannel || "[configure webhook]"}`);
  }
  
  if (inputs.submitActions?.includes("crm")) {
    deps.push(`🔗 ${inputs.crmSystem || "CRM"} API integration`);
    deps.push("   └─ API credentials and field mapping configuration");
  }
  
  if (inputs.submitActions?.includes("ticket")) {
    deps.push(`🎫 ${inputs.ticketSystem || "Ticketing system"} integration`);
    deps.push("   └─ API credentials and ticket field mapping");
  }
  
  if (inputs.submitActions?.includes("spreadsheet")) {
    deps.push("📊 Google Sheets integration");
    deps.push("   └─ Sheet URL and column mapping");
  }
  
  if (inputs.needsDataLookup === "yes") {
    deps.push("🔍 External data lookup API endpoint");
    deps.push(`   └─ ${inputs.lookupDetails || "Configure lookup service"}`);
  }
  
  if (inputs.needsMultiLanguage === "yes") {
    deps.push(`🌐 Translation files for: ${inputs.languages?.join(", ") || "selected languages"}`);
  }
  
  if (inputs.complianceRequirements?.length > 0 && !inputs.complianceRequirements.includes("None")) {
    deps.push(`\n## Compliance Checklist`);
    for (const req of inputs.complianceRequirements) {
      if (req !== "None") {
        deps.push(`📋 ${req} compliance review required`);
      }
    }
  }
  
  if (inputs.needsApproval === "yes") {
    deps.push("\n## Workflow Setup");
    deps.push("👥 Configure approval workflow in CallVu");
    deps.push(`   └─ ${inputs.approvalDetails || "Define approvers and routing"}`);
  }

  return deps.join("\n");
}

function generateSetupGuide(inputs: Record<string, any>, cvuf: any): string {
  const steps: string[] = [];
  
  steps.push("# Setup Guide\n");
  
  steps.push("## Step 1: Import the CVUF File");
  steps.push("1. Open CallVu Studio");
  steps.push("2. Click 'Create New Form' → 'Import from JSON'");
  steps.push("3. Paste the generated CVUF JSON");
  steps.push("4. Click 'Import' and verify all screens loaded correctly");
  steps.push("5. Review each screen in the visual editor\n");

  steps.push("## Step 2: Review & Customize");
  steps.push("1. Check all field labels and hints for your brand voice");
  steps.push("2. Adjust any dropdown options to match your terminology");
  steps.push("3. Update the logo URL to your company logo");
  steps.push("4. Modify theme colors if needed (Settings → Theme)\n");

  if (inputs.submitActions?.length > 0) {
    steps.push("## Step 3: Configure Integrations");
    
    if (inputs.submitActions.includes("notification")) {
      steps.push("\n### Email Notifications");
      steps.push("1. Go to Settings → Integrations → Email");
      steps.push("2. Configure your SMTP server or email API");
      steps.push(`3. Set up email template with recipient: ${inputs.emailRecipients || "[your recipient]"}`);
      steps.push("4. Map form fields to email template variables");
    }

    if (inputs.submitActions.includes("crm")) {
      steps.push(`\n### ${inputs.crmSystem || "CRM"} Integration`);
      steps.push("1. Go to Settings → Integrations → CRM");
      steps.push("2. Select your CRM provider and authenticate");
      steps.push("3. Map form fields to CRM object fields");
      steps.push("4. Configure record creation/update behavior");
    }

    if (inputs.submitActions.includes("slack")) {
      steps.push("\n### Slack/Teams Notifications");
      steps.push("1. Create a webhook in your Slack/Teams workspace");
      steps.push("2. Go to Settings → Integrations → Webhooks");
      steps.push("3. Add the webhook URL");
      steps.push(`4. Configure message format for #${inputs.slackChannel || "channel"}`);
    }

    if (inputs.submitActions.includes("ticket")) {
      steps.push(`\n### ${inputs.ticketSystem || "Ticketing"} Integration`);
      steps.push("1. Go to Settings → Integrations → Ticketing");
      steps.push("2. Connect your ticketing system account");
      steps.push("3. Map form fields to ticket fields");
      steps.push("4. Set default ticket type/priority/assignment");
    }
  }

  if (inputs.needsDataLookup === "yes") {
    steps.push("\n## Step 4: Configure Data Lookup");
    steps.push("1. Go to Settings → API Actions");
    steps.push("2. Create a new 'Lookup' action");
    steps.push("3. Configure the API endpoint and authentication");
    steps.push("4. Map the trigger field and response fields");
    steps.push(`5. Details: ${inputs.lookupDetails || "Configure based on your API"}`);
  }

  steps.push("\n## Testing Checklist");
  steps.push("- [ ] Preview form and complete all paths");
  steps.push("- [ ] Test with required fields empty (validation should block)");
  steps.push("- [ ] Test conditional visibility rules");
  steps.push("- [ ] Submit test entry and verify integrations fire");
  if (inputs.submitActions?.includes("notification")) {
    steps.push("- [ ] Verify email notification received");
  }
  if (inputs.submitActions?.includes("crm")) {
    steps.push("- [ ] Verify CRM record created/updated");
  }
  steps.push("- [ ] Test on mobile device");

  steps.push("\n## Go Live");
  steps.push("1. Set form status to 'Published'");
  steps.push("2. Configure access permissions (public/authenticated/SSO)");
  steps.push("3. Get shareable link or embed code");
  steps.push("4. Add to your website/portal/email");

  return steps.join("\n");
}

function generatePitchPoints(inputs: Record<string, any>): string {
  const points: string[] = [];
  
  points.push("# Internal Pitch Points\n");
  points.push("Use these talking points when presenting this microapp to stakeholders.\n");
  
  points.push("## The Problem");
  if (inputs.currentProcess === "Manual") {
    points.push(`Currently, ${inputs.owningDepartment} handles ${inputs.microappName?.toLowerCase() || "this process"} through manual processes like email, phone calls, or paper forms. This is time-consuming, error-prone, and difficult to track.`);
  } else if (inputs.currentProcess === "Spreadsheets") {
    points.push(`Currently, ${inputs.owningDepartment} manages ${inputs.microappName?.toLowerCase() || "this process"} through spreadsheets and documents. This creates version control issues, lacks validation, and makes reporting difficult.`);
  } else if (inputs.currentProcess === "Bad Software") {
    points.push(`The current software solution for ${inputs.microappName?.toLowerCase() || "this process"} isn't meeting our needs. Users find it frustrating, and it doesn't integrate well with our other systems.`);
  } else {
    points.push(`There's no consistent process for ${inputs.microappName?.toLowerCase() || "this"} today. Different team members handle it differently, leading to inconsistent results and no visibility.`);
  }

  points.push("\n## The Solution");
  points.push(`This microapp provides a streamlined, mobile-friendly digital experience for ${inputs.userType?.toLowerCase() || "users"} to ${inputs.microappDescription?.substring(0, 150) || inputs.triggerEvent || "complete their request"}.`);

  points.push("\n## Key Benefits");
  
  // Time savings
  points.push("⏱️ **Faster Processing** - Structured data capture eliminates back-and-forth clarification");
  
  // Integration value
  if (inputs.submitActions?.length > 1) {
    const integrations = inputs.submitActions.filter((a: string) => a !== "store_only");
    if (integrations.length > 0) {
      points.push(`🔗 **Connected Workflow** - Automatically triggers ${integrations.join(", ").replace("notification", "email alerts").replace("crm", "CRM updates").replace("ticket", "ticket creation").replace("slack", "Slack notifications")}`);
    }
  }
  
  // Volume capacity
  if (inputs.estimatedVolume === "10000+" || inputs.estimatedVolume === "2000-10000") {
    points.push("📈 **Scale Ready** - Handles high volume without additional headcount");
  }
  
  // Compliance
  if (inputs.complianceRequirements?.length > 0 && !inputs.complianceRequirements.includes("None")) {
    points.push(`✅ **Compliance Built-In** - Designed with ${inputs.complianceRequirements.filter((c: string) => c !== "None").join(", ")} requirements in mind`);
  }
  
  // User experience
  if (inputs.canSaveProgress === "yes") {
    points.push("💾 **User-Friendly** - Users can save progress and return later");
  }
  
  // Mobile
  points.push("📱 **Mobile-Ready** - Works seamlessly on any device");

  if (inputs.needsMultiLanguage === "yes") {
    points.push(`🌐 **Global Reach** - Available in ${inputs.languages?.length || "multiple"} languages`);
  }

  points.push("\n## ROI Projection");
  points.push("Consider calculating:");
  points.push("- Hours saved per submission × average hourly rate");
  points.push("- Error reduction value (rework, corrections, customer complaints)");
  points.push("- Faster resolution time impact on customer satisfaction");
  if (inputs.estimatedVolume) {
    points.push(`- At ${inputs.estimatedVolume} submissions/month, even small per-submission savings add up`);
  }

  points.push("\n## Sample Talk Track");
  points.push(`"This ${inputs.microappName || "microapp"} transforms how ${inputs.owningDepartment || "we"} handle ${inputs.triggerEvent?.toLowerCase() || "this process"}. Instead of ${inputs.currentProcess === "Manual" ? "manual back-and-forth" : inputs.currentProcess === "Spreadsheets" ? "spreadsheet chaos" : "our current clunky process"}, ${inputs.userType?.toLowerCase() || "users"} get a simple, guided experience that captures everything we need the first time${inputs.submitActions?.includes("notification") ? " and automatically notifies the right people" : ""}${inputs.submitActions?.includes("crm") ? " while keeping our CRM in sync" : ""}."`);

  return points.join("\n");
}
