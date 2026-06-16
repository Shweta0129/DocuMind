// Generator configurations: defines fields per module and metadata.
// Field types: text, textarea

import { FileText, ClipboardList, BookUser, FlaskConical } from "lucide-react";

export const GENERATORS = {
  brd: {
    key: "brd",
    title: "BRD Generator",
    subtitle: "Business Requirements Document",
    description: "Translate business problems into structured, stakeholder-ready BRDs.",
    accent: "#A8E6CF",
    icon: FileText,
    tag: "Strategy",
    fields: [
      { name: "Project Name", type: "text", placeholder: "Customer Onboarding Revamp", required: true },
      { name: "Business Problem", type: "textarea", placeholder: "Describe the pain point you're solving…", rows: 3 },
      { name: "Current Process", type: "textarea", placeholder: "How is this handled today?", rows: 3 },
      { name: "Proposed Solution", type: "textarea", placeholder: "What's the proposed solution?", rows: 3 },
      { name: "Stakeholders", type: "textarea", placeholder: "List key stakeholders & their roles", rows: 2 },
      { name: "Business Objectives", type: "textarea", placeholder: "Measurable business outcomes", rows: 2 },
      { name: "Functional Requirements", type: "textarea", placeholder: "What the system must do", rows: 3 },
      { name: "Non Functional Requirements", type: "textarea", placeholder: "Performance, security, scale…", rows: 2 },
      { name: "Assumptions", type: "textarea", placeholder: "Assumptions you're making", rows: 2 },
      { name: "Constraints", type: "textarea", placeholder: "Budget, timeline, technical limits", rows: 2 },
      { name: "Success Criteria", type: "textarea", placeholder: "How will success be measured?", rows: 2 },
    ],
  },
  sop: {
    key: "sop",
    title: "SOP Generator",
    subtitle: "Standard Operating Procedure",
    description: "Codify repeatable processes into clean SOPs your team will actually read.",
    accent: "#FFD3B6",
    icon: ClipboardList,
    tag: "Operations",
    fields: [
      { name: "Process Name", type: "text", placeholder: "Vendor Onboarding", required: true },
      { name: "Department", type: "text", placeholder: "Procurement" },
      { name: "Purpose", type: "textarea", placeholder: "Why does this SOP exist?", rows: 2 },
      { name: "Scope", type: "textarea", placeholder: "What's in / out of scope?", rows: 2 },
      { name: "Roles and Responsibilities", type: "textarea", placeholder: "Who does what?", rows: 3 },
      { name: "Required Equipment", type: "textarea", placeholder: "Tools, systems, materials", rows: 2 },
      { name: "Safety Precautions", type: "textarea", placeholder: "Safety considerations", rows: 2 },
      { name: "Frequency", type: "text", placeholder: "Daily / Weekly / Per request" },
      { name: "Step-by-Step Process", type: "textarea", placeholder: "Outline the steps", rows: 4 },
      { name: "Acceptance Criteria", type: "textarea", placeholder: "When is the process complete?", rows: 2 },
      { name: "Escalation Procedure", type: "textarea", placeholder: "What happens if things go wrong?", rows: 2 },
    ],
  },
  "user-story": {
    key: "user-story",
    title: "User Story Generator",
    subtitle: "Agile User Stories",
    description: "Turn feature ideas into well-formed Agile user stories with acceptance criteria.",
    accent: "#A8C6F7",
    icon: BookUser,
    tag: "Product",
    fields: [
      { name: "Project Name", type: "text", placeholder: "Mobile Banking App", required: true },
      { name: "Feature Name", type: "text", placeholder: "Biometric Login", required: true },
      { name: "User Type", type: "text", placeholder: "Returning customer" },
      { name: "Business Goal", type: "textarea", placeholder: "What outcome does this feature drive?", rows: 2 },
      { name: "Acceptance Criteria", type: "textarea", placeholder: "Conditions that must be true", rows: 3 },
      { name: "Dependencies", type: "textarea", placeholder: "Other features, APIs, teams…", rows: 2 },
    ],
  },
  "test-case": {
    key: "test-case",
    title: "Test Case Generator",
    subtitle: "QA Test Cases",
    description: "Generate a complete, traceable suite of QA test cases for any feature.",
    accent: "#FFE45E",
    icon: FlaskConical,
    tag: "Quality",
    fields: [
      { name: "Application Name", type: "text", placeholder: "Acme CRM", required: true },
      { name: "Feature", type: "text", placeholder: "Lead Capture Form", required: true },
      { name: "Requirement Description", type: "textarea", placeholder: "Describe what should be tested", rows: 4 },
      { name: "Expected Behaviour", type: "textarea", placeholder: "What should happen under normal use?", rows: 3 },
    ],
  },
};

export const GENERATOR_LIST = Object.values(GENERATORS);
