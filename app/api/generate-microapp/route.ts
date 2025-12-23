// /app/api/generate-microapp/route.ts
// Microapp Builder Wizard - API Endpoint
// This handles form submissions and generates CVUF files using Claude

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

## Conditional Rules
\`\`\`json
{"newRules":[{"ruleName":"Show field when X","ruleType":"visibility","triggerField":"triggerIntegrationID","targetField":"targetIntegrationID","condition":"equals","conditionValue":"yes","action":"show"}]}
\`\`\`
Conditions: equals, notEquals, contains, notEmpty, isEmpty
Target field must have isHiddenInRuntime:true

## Block Structure
\`\`\`json
{"blockName":"Section Title","identifier":"block_xxx_001","icon":"","rows":[{"fields":[...]}],"type":"regular","style":{"alignment":"center","nobackground":false,"noborders":false,"size":"full","background":"#ffffff"}}
\`\`\`

## Universal Field Properties
All fields need: identifier, integrationID, type, name, width, columnID
Optional: required, readOnly, isHiddenInRuntime, hint, tooltip, validations

## CRITICAL RULES
1. All identifiers must be unique
2. All targetStep values must reference existing step identifiers
3. dropdownInput/radioInput/checkboxInput MUST have non-empty items array
4. First step: isFirstNode=true, back hidden
5. Last step: hideFooter=true
6. Output minified JSON (no pretty printing)
7. Never set required=true on hidden fields
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
    
    // Keyword matching
    for (const keyword of template.keywords) {
      if (descLower.includes(keyword)) {
        score += 20;
      }
    }
    
    // Department bonus
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

  // Check for logical inconsistencies
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

  // Volume and complexity check
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
          text: "🆕 New Microapp Request",
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
    const inputs = await request.json();
    
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
4. Every dropdown/radio/checkbox MUST have a non-empty items array
5. Follow the exact field structures from the reference
6. Include complete theme object
7. First step: isFirstNode=true, back button hidden
8. Last step: hideFooter=true

Generate a complete, production-ready CVUF file.`
    });

    // Extract the generated CVUF
    const responseText = message.content[0].type === "text" ? message.content[0].text : "";
    
    // Validate JSON
    let cvufJson;
    try {
      cvufJson = JSON.parse(responseText);
    } catch (parseError) {
      // Try to extract JSON if wrapped in anything
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cvufJson = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse generated CVUF");
      }
    }

    const generationTimeMs = Date.now() - startTime;

    // Generate additional outputs
    const dependencies = generateDependencies(inputs);
    const setupGuide = generateSetupGuide(inputs, cvufJson);
    const pitchPoints = generatePitchPoints(inputs);
    const buildTime = estimateBuildTime(inputs);

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

    // Return response matching CallVu field integrationIDs
    return NextResponse.json({
      generatedCVUF: JSON.stringify(cvufJson),
      generatedDependencies: dependencies,
      generatedSetupGuide: setupGuide,
      generatedPitchPoints: pitchPoints,
      generatedBuildTime: buildTime,
      _meta: {
        requestId,
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
  return `Generate a CallVu CVUF microapp file based on these requirements:

## Microapp Details
- Name: ${inputs.microappName}
- Description: ${inputs.microappDescription}
- User Type: ${inputs.userType}
- Department: ${inputs.owningDepartment}
- Trigger: ${inputs.triggerEvent}
- Current Process: ${inputs.currentProcess}

## Data Collection Requirements
- Contact Info: ${inputs.needsContactInfo ? "Yes" : "No"}
- Identifiers/Account Numbers: ${inputs.needsIdentifiers ? "Yes" : "No"}
- Dates/Scheduling: ${inputs.needsDates ? "Yes" : "No"}
- Selection Choices: ${inputs.needsChoices ? "Yes" : "No"}
- Rich Inputs (files/signatures): ${inputs.needsRichInput ? "Yes" : "No"}
- Financial Data: ${inputs.needsFinancial ? "Yes" : "No"}
- Custom Dropdowns: ${inputs.customDropdowns || "None"}
- Other Fields: ${inputs.otherFields || "None"}

## Workflow
- Conditional Branching: ${inputs.hasBranching} ${inputs.branchingLogic ? `- ${inputs.branchingLogic}` : ""}
- Approval Required: ${inputs.needsApproval} ${inputs.approvalDetails ? `- ${inputs.approvalDetails}` : ""}
- Save Progress: ${inputs.canSaveProgress}

## Post-Submit Actions
- Actions: ${inputs.submitActions?.join(", ") || "Store only"}
- Email Recipients: ${inputs.emailRecipients || "Not specified"}
- Slack Channel: ${inputs.slackChannel || "Not specified"}
- CRM System: ${inputs.crmSystem || "Not specified"}
- Ticket System: ${inputs.ticketSystem || "Not specified"}
- Other Integrations: ${inputs.otherIntegrations || "None"}

## Data Lookup
- Needs Lookup: ${inputs.needsDataLookup}
- Details: ${inputs.lookupDetails || "Not specified"}

## Requirements
- Multi-language: ${inputs.needsMultiLanguage} ${inputs.languages?.join(", ") || ""}
- Compliance: ${inputs.complianceRequirements?.join(", ") || "None"}
- Branding: ${inputs.brandingNotes || "Use default CallVu theme"}
- Volume: ${inputs.estimatedVolume}
- Additional Notes: ${inputs.additionalNotes || "None"}

${templateMatch.score >= 70 ? `\nSuggested base template: ${templateMatch.templateId} (${templateMatch.score}% match)` : ""}

Generate a complete CVUF JSON file with:
1. Welcome/intro screen
2. All necessary data collection screens (group logically)
3. Review/confirmation screen if complex
4. Thank you/completion screen
5. Appropriate conditional logic rules
6. All required integrationIDs for API mapping

Output ONLY the minified JSON, nothing else.`;
}

function generateDependencies(inputs: Record<string, any>): string {
  const deps: string[] = [];
  
  deps.push("✅ CallVu Studio account with import permissions");
  
  if (inputs.submitActions?.includes("notification")) {
    deps.push("📧 Email service configuration (SMTP or SendGrid)");
  }
  if (inputs.submitActions?.includes("slack")) {
    deps.push("💬 Slack webhook URL for notifications");
  }
  if (inputs.submitActions?.includes("crm")) {
    deps.push(`🔗 ${inputs.crmSystem || "CRM"} API credentials and field mapping`);
  }
  if (inputs.submitActions?.includes("ticket")) {
    deps.push(`🎫 ${inputs.ticketSystem || "Ticketing system"} API integration`);
  }
  if (inputs.needsDataLookup === "yes") {
    deps.push("🔍 Data lookup API endpoint configuration");
  }
  if (inputs.needsMultiLanguage === "yes") {
    deps.push(`🌐 Translation files for: ${inputs.languages?.join(", ") || "selected languages"}`);
  }
  if (inputs.complianceRequirements?.length > 0) {
    deps.push(`📋 Compliance review for: ${inputs.complianceRequirements.join(", ")}`);
  }
  if (inputs.needsApproval === "yes") {
    deps.push("👥 Approval workflow configuration in CallVu");
  }

  return deps.join("\n");
}

function generateSetupGuide(inputs: Record<string, any>, cvuf: any): string {
  const steps: string[] = [];
  
  steps.push("## Setup Guide\n");
  steps.push("### Step 1: Import CVUF");
  steps.push("1. Open CallVu Studio");
  steps.push("2. Click 'Create New Form' → 'Import'");
  steps.push("3. Paste the generated JSON");
  steps.push("4. Verify all screens imported correctly\n");

  steps.push("### Step 2: Configure Integrations");
  
  if (inputs.submitActions?.includes("notification")) {
    steps.push("\n**Email Notifications:**");
    steps.push("- Go to Settings → Integrations → Email");
    steps.push("- Configure SMTP or select email provider");
    steps.push(`- Set recipients: ${inputs.emailRecipients || "[configure recipients]"}`);
  }

  if (inputs.submitActions?.includes("crm")) {
    steps.push(`\n**${inputs.crmSystem || "CRM"} Integration:**`);
    steps.push("- Go to Settings → Integrations → CRM");
    steps.push("- Add API credentials");
    steps.push("- Map form fields to CRM fields");
  }

  if (inputs.needsDataLookup === "yes") {
    steps.push("\n**Data Lookup:**");
    steps.push("- Go to Settings → API Actions");
    steps.push("- Configure lookup endpoint");
    steps.push("- Map trigger field and response fields");
  }

  steps.push("\n### Step 3: Test");
  steps.push("1. Use Preview mode to test all paths");
  steps.push("2. Submit test entries");
  steps.push("3. Verify integrations fire correctly");
  steps.push("4. Check email/Slack notifications arrive");

  steps.push("\n### Step 4: Deploy");
  steps.push("1. Set form to 'Published'");
  steps.push("2. Configure access permissions");
  steps.push("3. Get shareable link or embed code");

  return steps.join("\n");
}

function generatePitchPoints(inputs: Record<string, any>): string {
  const points: string[] = [];
  
  points.push("## Why This Microapp Matters\n");
  
  // Time savings
  if (inputs.currentProcess === "Manual") {
    points.push("⏱️ **Eliminates manual process** - No more emails, phone calls, or paper forms");
  } else if (inputs.currentProcess === "Spreadsheets") {
    points.push("⏱️ **Replaces spreadsheet chaos** - Structured data capture with validation");
  } else if (inputs.currentProcess === "Bad Software") {
    points.push("⏱️ **Better user experience** - Modern, mobile-friendly interface");
  }

  // Volume impact
  if (inputs.estimatedVolume === "10000+") {
    points.push("📈 **High-volume ready** - Handles 10,000+ submissions/month efficiently");
  } else if (inputs.estimatedVolume === "2000-10000") {
    points.push("📈 **Scales with demand** - Built for thousands of monthly submissions");
  }

  // Integration value
  if (inputs.submitActions?.length > 1) {
    points.push("🔗 **Connected ecosystem** - Automatically syncs to " + inputs.submitActions.join(", "));
  }

  // Compliance
  if (inputs.complianceRequirements?.length > 0) {
    points.push(`✅ **Compliance-ready** - Built with ${inputs.complianceRequirements.join(", ")} requirements in mind`);
  }

  // User experience
  if (inputs.canSaveProgress === "yes") {
    points.push("💾 **User-friendly** - Save and return later capability");
  }

  if (inputs.needsMultiLanguage === "yes") {
    points.push(`🌐 **Global reach** - Supports ${inputs.languages?.length || "multiple"} languages`);
  }

  points.push("\n## Talk Track");
  points.push(`"This microapp transforms how ${inputs.owningDepartment} handles ${inputs.microappName.toLowerCase()}. `);
  points.push(`Instead of ${inputs.currentProcess === "Manual" ? "manual processes" : "the current system"}, `);
  points.push(`users get a streamlined experience that ${inputs.submitActions?.includes("notification") ? "automatically notifies stakeholders" : "captures everything needed"} `);
  points.push(`and ${inputs.submitActions?.includes("crm") ? "syncs directly to your CRM" : "stores data securely"}."`);

  return points.join("\n");
}

function estimateBuildTime(inputs: Record<string, any>): string {
  let hours = 2; // Base time
  
  // Add complexity factors
  if (inputs.hasBranching === "yes") hours += 2;
  if (inputs.needsApproval === "yes") hours += 1;
  if (inputs.submitActions?.length > 2) hours += 2;
  if (inputs.needsDataLookup === "yes") hours += 2;
  if (inputs.needsMultiLanguage === "yes") hours += inputs.languages?.length || 2;
  if (inputs.complianceRequirements?.length > 0) hours += 1;

  if (hours <= 3) {
    return "2-3 hours (Simple)";
  } else if (hours <= 6) {
    return "4-6 hours (Moderate)";
  } else if (hours <= 10) {
    return "1-2 days (Complex)";
  } else {
    return "2-3 days (Enterprise)";
  }
}
